import type { WordTiming } from "./provider.js";

/**
 * Proportional-to-length word timing estimate: longer words get slightly more
 * time, nothing gets zero. The fallback when neither the provider nor the
 * alignment sidecar can give real timings.
 */
export function estimateWordTimings(text: string, durationSec: number, offsetSec = 0): WordTiming[] {
  const words = text.trim().length === 0 ? [] : text.trim().split(/\s+/);
  if (words.length === 0) return [];
  const weights = words.map((w) => w.length + 2);
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  let t = offsetSec;
  return words.map((word, i) => {
    const share = (weights[i]! / totalWeight) * durationSec;
    const startSec = t;
    t += share;
    return { word, startSec, endSec: t };
  });
}

/**
 * Optional word aligner (the audio sidecar's /align). Returns null when it
 * can't help (service down, no speech detected) — callers keep the estimate.
 */
export interface WordAligner {
  id: string;
  align(opts: { audio: Buffer; contentType: string; text: string; language: string }): Promise<WordTiming[] | null>;
}
