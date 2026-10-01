export interface WordTiming {
  word: string;
  startSec: number;
  endSec: number;
}

export interface TtsResult {
  /** Raw audio bytes — provider-dependent format (see contentType). */
  audio: Buffer;
  contentType: string;
  durationSec: number;
  /** Per-word timings, used for both scene duration (§4.6 "Voice": "Scene durations computed from audio") and VTT caption generation (Phase 4 "Encode"). */
  words: WordTiming[];
  costUsd: number;
}

export interface SynthesizeOptions {
  text: string;
  voiceId: string;
  language: "en" | "hi";
}

/**
 * Provider interface (§2.1, §4.6 "Voice"). Every synthesis call goes through
 * this shape regardless of backend, same pattern as packages/llm — a provider
 * that can't produce real audio (no API key, or a transient failure) is never
 * a reason to fail the whole pipeline; see fallback.ts.
 */
export interface TtsProvider {
  id: string;
  synthesize(opts: SynthesizeOptions): Promise<TtsResult>;
}
