import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runFfmpeg } from "@sitereel/shared";
import type { StorageClient } from "@sitereel/storage";
import type { VoiceSceneResult } from "../stages/voice.js";

const SAMPLE_RATE = 44100;

/**
 * Concatenates each scene's voice clip (or generated silence, for scenes with
 * no narration) into one continuous track spanning the manifest's full
 * duration, in scene order. Each clip is resampled to a common format first —
 * the fallback TTS provider outputs 44.1kHz, Gemini TTS outputs 24kHz, and
 * the file-concat demuxer requires identical formats to stream-copy, so this
 * uses the `concat` audio filter (which resamples per input) instead.
 */
export async function assembleSceneAudio(opts: {
  voiceScenes: VoiceSceneResult[];
  storage: StorageClient;
  repoRoot?: string;
}): Promise<Buffer> {
  const { voiceScenes, storage, repoRoot } = opts;
  const tmpDir = path.join(os.tmpdir(), `sitereel-mix-${randomUUID()}`);
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    const clipPaths: string[] = [];
    for (const [i, scene] of voiceScenes.entries()) {
      const clipPath = path.join(tmpDir, `clip-${i}.wav`);
      if (scene.audioKey) {
        // The raw synthesized clip is sized to its own reading-floor estimate,
        // which is almost never exactly `scene.durationSec` (Build picks the
        // LARGER of the storyboard's own duration and audio+padding — see
        // voice.ts). Pad (or trim) here so each clip exactly matches the
        // scene window it's muxed under; otherwise the concatenated track's
        // total length drifts from the video's, and ffmpeg's `-shortest` mux
        // flag silently truncates the tail of the video to match the shorter
        // audio track — a real bug this fixed (stripe.com job: video was
        // 14.9s but the final MP4 played only 10.5s).
        const rawPath = path.join(tmpDir, `raw-${i}.wav`);
        const bytes = await storage.getObject("assets", scene.audioKey);
        await fs.writeFile(rawPath, bytes);
        await runFfmpeg(
          ["-y", "-i", rawPath, "-af", "apad", "-t", scene.durationSec.toFixed(3), "-ar", String(SAMPLE_RATE), "-ac", "1", clipPath],
          repoRoot,
        );
      } else {
        await runFfmpeg(
          ["-y", "-f", "lavfi", "-i", `anullsrc=channel_layout=mono:sample_rate=${SAMPLE_RATE}`, "-t", scene.durationSec.toFixed(3), clipPath],
          repoRoot,
        );
      }
      clipPaths.push(clipPath);
    }

    const outPath = path.join(tmpDir, "mixed.wav");
    if (clipPaths.length === 1) {
      await runFfmpeg(["-y", "-i", clipPaths[0]!, "-ar", String(SAMPLE_RATE), "-ac", "1", outPath], repoRoot);
    } else {
      const inputArgs = clipPaths.flatMap((p) => ["-i", p]);
      const perInput = clipPaths.map((_, i) => `[${i}:a]aresample=${SAMPLE_RATE},aformat=sample_fmts=s16:channel_layouts=mono[a${i}]`).join("; ");
      const concatInputs = clipPaths.map((_, i) => `[a${i}]`).join("");
      const filter = `${perInput}; ${concatInputs}concat=n=${clipPaths.length}:v=0:a=1[aout]`;
      await runFfmpeg(["-y", ...inputArgs, "-filter_complex", filter, "-map", "[aout]", outPath], repoRoot);
    }

    return await fs.readFile(outPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
