import { spawn } from "node:child_process";
import { resolveFfmpegPath } from "@sitereel/shared";

export interface FfmpegEncodeOptions {
  width: number;
  height: number;
  fps: number;
  outPath: string;
  /** Optional pre-mixed audio track (wav/mp3) to mux with `-shortest`. */
  audioPath?: string;
}

/** Spawns ffmpeg reading raw PNG frames from stdin (image2pipe) and encoding H.264 BT.709. */
export function spawnFfmpegEncoder(opts: FfmpegEncodeOptions) {
  const ffmpegBin = resolveFfmpegPath();
  const args = [
    "-y",
    "-f", "image2pipe",
    "-framerate", String(opts.fps),
    "-i", "-",
    ...(opts.audioPath ? ["-i", opts.audioPath] : []),
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-color_primaries", "bt709",
    "-color_trc", "bt709",
    "-colorspace", "bt709",
    "-movflags", "+faststart",
    ...(opts.audioPath ? ["-c:a", "aac", "-b:a", "192k", "-shortest"] : []),
    opts.outPath,
  ];
  return spawn(ffmpegBin, args, { stdio: ["pipe", "inherit", "inherit"] });
}

export function extractPosterFrame(inputPath: string, atSeconds: number, outPath: string): Promise<void> {
  const ffmpegBin = resolveFfmpegPath();
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin, ["-y", "-ss", String(atSeconds), "-i", inputPath, "-frames:v", "1", "-update", "1", outPath], {
      stdio: "inherit",
    });
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg poster exit ${code}`))));
  });
}
