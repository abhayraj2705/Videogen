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
