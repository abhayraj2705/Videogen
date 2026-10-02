import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveFfmpegPath, runFfmpegQuiet } from "@sitereel/shared";

export interface FfmpegEncodeOptions {
  width: number;
  height: number;
  fps: number;
  outPath: string;
  /** Optional pre-mixed audio track (wav/mp3) to mux with `-shortest`. */
  audioPath?: string;
}

const BT709 = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"];

/**
 * RGB screenshots -> limited-range BT.709 4:2:0. The explicit matrix matters:
 * swscale's default RGB->YUV matrix is BT.601, which (tagged as 709) shifts
 * brand colors slightly. setparams makes the tags survive filter graphs.
 */
const TO_BT709 = "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709";

/** Spawns ffmpeg reading raw PNG frames from stdin (image2pipe) and encoding H.264 BT.709. */
export function spawnFfmpegEncoder(opts: FfmpegEncodeOptions) {
  const ffmpegBin = resolveFfmpegPath();
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel", "error",
    "-f", "image2pipe",
    "-framerate", String(opts.fps),
    "-i", "-",
    ...(opts.audioPath ? ["-i", opts.audioPath] : []),
    "-c:v", "libx264",
    "-vf", TO_BT709,
    ...BT709,
    "-movflags", "+faststart",
    ...(opts.audioPath ? ["-c:a", "aac", "-b:a", "192k", "-shortest"] : []),
    opts.outPath,
  ];
  return spawn(ffmpegBin, args, { stdio: ["pipe", "inherit", "inherit"] });
}

/**
 * Encoder for one chunk of a distributed render. Every chunk uses identical
 * codec settings (and a closed GOP starting at its first frame), which is
 * what makes the later concat a lossless `-c copy`. The optional watermark
 * is overlaid here, per chunk, so the free-plan path costs no extra encode.
 */
export function spawnSegmentEncoder(opts: { fps: number; outPath: string; watermarkPng?: string; preset: string; crf: number; capture?: "jpeg" | "png" }) {
  const ffmpegBin = resolveFfmpegPath();
  const jpeg = opts.capture === "jpeg";
  // Chromium's JPEGs are full-range BT.601 YCbCr; go back through RGB before the
  // overlay so the watermark and the BT.709 conversion see the same thing as with PNG.
  const toRgb = jpeg ? "scale=in_color_matrix=bt601:in_range=pc,format=gbrp," : "";
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel", "error",
    "-f", "image2pipe",
    ...(jpeg ? ["-c:v", "mjpeg"] : []),
    "-framerate", String(opts.fps),
    "-i", "-",
    ...(opts.watermarkPng
      ? ["-i", opts.watermarkPng, "-filter_complex", `[0:v]${toRgb}null[base];[base][1:v]overlay=x=main_w-overlay_w-main_w*0.03:y=main_h-overlay_h-main_h*0.03,${TO_BT709}[v]`, "-map", "[v]"]
      : ["-vf", `${toRgb}${TO_BT709}`]),
    "-c:v", "libx264",
    "-preset", opts.preset,
    "-crf", String(opts.crf),
    "-g", String(opts.fps * 2),
    "-video_track_timescale", String(opts.fps * 512),
    ...BT709,
    opts.outPath,
  ];
  return spawn(ffmpegBin, args, { stdio: ["pipe", "inherit", "inherit"] });
}

/** Lossless concat of same-codec segments (concat demuxer, stream copy). */
export async function concatSegments(segmentPaths: string[], outPath: string, workDir: string): Promise<void> {
  const listPath = path.join(workDir, `concat-${Date.now()}.txt`);
  const body = segmentPaths.map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n");
  await fs.writeFile(listPath, body);
  await runFfmpegQuiet(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
}

/**
 * Final mux: video stream copied untouched; audio (if any) encoded AAC 192k
 * and trimmed to the exact video duration; +faststart for web playback.
 */
export async function muxFinal(opts: { videoPath: string; audioPath?: string; outPath: string; durationSec: number }): Promise<void> {
  if (opts.audioPath) {
    await runFfmpegQuiet([
      "-y",
      "-i", opts.videoPath,
      "-i", opts.audioPath,
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "192k",
      "-af", "apad",
      "-t", opts.durationSec.toFixed(3),
      "-movflags", "+faststart",
      opts.outPath,
    ]);
  } else {
    await runFfmpegQuiet(["-y", "-i", opts.videoPath, "-c", "copy", "-movflags", "+faststart", opts.outPath]);
  }
}

export async function extractPosterFrame(inputPath: string, atSeconds: number, outPath: string): Promise<void> {
  await runFfmpegQuiet(["-y", "-ss", String(atSeconds), "-i", inputPath, "-frames:v", "1", "-update", "1", outPath]);
}

/** Grid of frames (contact sheet) from a list of image files, via ffmpeg's tile filter. */
export async function tileContactSheet(framePaths: string[], outPath: string, opts: { columns?: number; thumbWidth?: number } = {}): Promise<void> {
  if (framePaths.length === 0) throw new Error("tileContactSheet: no frames");
  const columns = Math.min(opts.columns ?? 4, framePaths.length);
  const rows = Math.ceil(framePaths.length / columns);
  const thumbWidth = opts.thumbWidth ?? 480;
  const dir = path.dirname(framePaths[0]!);
  // Sequence-numbered copies so the image2 demuxer can read them as one stream.
  const seqDir = path.join(dir, `sheet-${Date.now()}`);
  await fs.mkdir(seqDir, { recursive: true });
  await Promise.all(framePaths.map((p, i) => fs.copyFile(p, path.join(seqDir, `f${String(i).padStart(3, "0")}${path.extname(p)}`))));
  const ext = path.extname(framePaths[0]!);
  await runFfmpegQuiet([
    "-y",
    "-framerate", "1",
    "-i", path.join(seqDir, `f%03d${ext}`),
    "-vf", `scale=${thumbWidth}:-2,tile=${columns}x${rows}:padding=8:margin=8:color=0x222222`,
    "-frames:v", "1",
    "-q:v", "3",
    outPath,
  ]);
  await fs.rm(seqDir, { recursive: true, force: true });
}
