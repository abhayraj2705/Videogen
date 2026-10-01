import { runFfmpeg, READING_SECONDS_PER_WORD } from "@sitereel/shared";
import type { SynthesizeOptions, TtsProvider, TtsResult, WordTiming } from "./provider.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const SAMPLE_RATE = 44100;

/** Proportional-to-length word timing: longer words get slightly more time, nothing gets zero. */
function estimateWordTimings(text: string, durationSec: number): WordTiming[] {
  const words = text.trim().length === 0 ? [] : text.trim().split(/\s+/);
  if (words.length === 0) return [];

  const weights = words.map((w) => w.length + 2);
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  let t = 0;
  return words.map((word, i) => {
    const share = (weights[i]! / totalWeight) * durationSec;
    const startSec = t;
    t += share;
    return { word, startSec, endSec: t };
  });
}

/**
 * No-API-key, no-network fallback: synthesizes silence of exactly the
 * reading-floor duration for the given text, with word timings estimated
 * proportionally by word length. Keeps the voice stage — and everything
 * downstream that depends on scene durations coming from "audio" — working
 * with zero cloud accounts configured, same resilience pattern as the LLM
 * fallback in Phase 3. A provider that fails mid-pipeline can fall back to
 * this per-line rather than failing the whole job (see createTtsProvider).
 */
export function createFallbackTtsProvider(opts: { repoRoot?: string } = {}): TtsProvider {
  return {
    id: "fallback:silence",
    async synthesize({ text }: SynthesizeOptions): Promise<TtsResult> {
      const words = text.trim().length === 0 ? [] : text.trim().split(/\s+/);
      const durationSec = Math.max(0.6, words.length * READING_SECONDS_PER_WORD + 0.3);

      const tmpPath = path.join(os.tmpdir(), `sitereel-silence-${randomUUID()}.wav`);
      await runFfmpeg(
        [
          "-y",
          "-f", "lavfi",
          "-i", `anullsrc=channel_layout=mono:sample_rate=${SAMPLE_RATE}`,
          "-t", durationSec.toFixed(3),
          tmpPath,
        ],
        opts.repoRoot,
      );
      const audio = await fs.readFile(tmpPath);
      await fs.unlink(tmpPath).catch(() => undefined);

      return {
        audio,
        contentType: "audio/wav",
        durationSec,
        words: estimateWordTimings(text, durationSec),
        costUsd: 0,
      };
    },
  };
}
