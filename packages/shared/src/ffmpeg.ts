import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Resolves an ffmpeg binary. Checked, in order: FFMPEG_PATH env var, PATH,
 * a winget install, and `.tools/ffmpeg/**` at the repo root (where local dev
 * machines without winget/system ffmpeg get a manually-extracted build —
 * see README). Shared by packages/renderer (video) and packages/tts (audio).
 */
export function resolveFfmpegPath(repoRoot?: string): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;

  const wingetPackages = path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Packages");
  if (fs.existsSync(wingetPackages)) {
    const ffmpegDir = fs.readdirSync(wingetPackages).find((name) => name.startsWith("Gyan.FFmpeg_"));
    if (ffmpegDir) {
      const base = path.join(wingetPackages, ffmpegDir);
      const versionDirs = fs.readdirSync(base).filter((n) => fs.statSync(path.join(base, n)).isDirectory());
      for (const v of versionDirs) {
        const candidate = path.join(base, v, "bin", "ffmpeg.exe");
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }

  if (repoRoot) {
    const localTools = path.join(repoRoot, ".tools", "ffmpeg");
    if (fs.existsSync(localTools)) {
      const match = findFileRecursive(localTools, "ffmpeg.exe");
      if (match) return match;
    }
  }

  return "ffmpeg"; // fall back to PATH
}

function findFileRecursive(dir: string, filename: string, depth = 0): string | null {
  if (depth > 4) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === filename) return full;
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, filename, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Runs ffmpeg to completion (non-streaming), rejecting on a non-zero exit code. */
export function runFfmpeg(args: string[], repoRoot?: string): Promise<void> {
  const ffmpegBin = resolveFfmpegPath(repoRoot);
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin, args, { stdio: ["ignore", "inherit", "inherit"] });
    proc.on("error", reject);
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code} (args: ${args.join(" ")})`))));
  });
}

/** ffprobe lives next to whichever ffmpeg resolveFfmpegPath picked (falls back to PATH). */
export function resolveFfprobePath(repoRoot?: string): string {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  const ffmpeg = resolveFfmpegPath(repoRoot);
  if (ffmpeg === "ffmpeg") return "ffprobe";
  const dir = path.dirname(ffmpeg);
  const candidate = path.join(dir, path.basename(ffmpeg).replace(/^ffmpeg/i, "ffprobe"));
  return fs.existsSync(candidate) ? candidate : "ffprobe";
}

/** Runs a binary to completion capturing stdout/stderr (for ffprobe / analysis filters like loudnorm/ebur128). */
export function runCapture(bin: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += String(d)));
    proc.stderr.on("data", (d) => (stderr += String(d)));
    proc.on("error", reject);
    proc.on("exit", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** Quiet variant of runFfmpeg: no banner, errors only, stderr captured into the thrown error instead of inherited. */
export async function runFfmpegQuiet(args: string[], repoRoot?: string): Promise<void> {
  const { code, stderr } = await runCapture(resolveFfmpegPath(repoRoot), ["-hide_banner", "-loglevel", "error", ...args]);
  if (code !== 0) throw new Error(`ffmpeg exited with code ${code}: ${stderr.trim().slice(-2000)} (args: ${args.join(" ")})`);
}

export interface ProbeResult {
  durationSec: number;
  streams: {
    codec_type: string;
    codec_name: string;
    width?: number;
    height?: number;
    nb_frames?: string;
    avg_frame_rate?: string;
    color_primaries?: string;
    duration?: string;
  }[];
}

/** ffprobe -show_streams -show_format, parsed. */
export async function ffprobe(filePath: string, repoRoot?: string): Promise<ProbeResult> {
  const { code, stdout, stderr } = await runCapture(resolveFfprobePath(repoRoot), [
    "-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath,
  ]);
  if (code !== 0) throw new Error(`ffprobe failed (${code}): ${stderr}`);
  const json = JSON.parse(stdout) as { format?: { duration?: string }; streams?: ProbeResult["streams"] };
  return { durationSec: Number(json.format?.duration ?? 0), streams: json.streams ?? [] };
}
