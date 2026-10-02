import { createHash } from "node:crypto";
import type { SynthesizeOptions, TtsProvider, TtsResult, WordTiming } from "./provider.js";

/**
 * Minimal blob store the cache needs — structurally compatible with
 * @sitereel/storage's StorageClient (bound to one bucket) without making
 * this package depend on it.
 */
export interface TtsCacheStore {
  get(key: string): Promise<Buffer | null>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
}

export interface CachedTtsResult extends TtsResult {
  cacheHit: boolean;
  cacheKey: string;
}

interface CacheMeta {
  contentType: string;
  durationSec: number;
  words: WordTiming[];
  wordsSource?: TtsResult["wordsSource"];
  costUsd: number;
  provider: string;
}

/** Content hash of everything that changes the audio: text, voice, language, provider. */
export function ttsCacheKey(opts: { text: string; voiceId: string; language: string; providerId: string }): string {
  const normalized = opts.text.trim().replace(/\s+/g, " ");
  return createHash("sha256")
    .update(JSON.stringify([normalized, opts.voiceId, opts.language, opts.providerId]))
    .digest("hex");
}

/**
 * Wraps a provider with a content-addressed cache: identical lines (same
 * text + voice + language + provider) are synthesized once and reused across
 * jobs and re-renders — a re-voice after a storyboard edit only pays for the
 * lines that actually changed. Cache read/write failures never fail synthesis.
 */
export function createCachedTtsProvider(inner: TtsProvider, store: TtsCacheStore, prefix = "tts-cache"): TtsProvider & {
  synthesizeCached(opts: SynthesizeOptions): Promise<CachedTtsResult>;
} {
  const keyFor = (opts: SynthesizeOptions) => `${prefix}/${ttsCacheKey({ text: opts.paragraphs ? `[take] ${opts.paragraphs.join(" | ")}` : opts.text, voiceId: opts.voiceId, language: opts.language, providerId: inner.id })}`;

  async function synthesizeCached(opts: SynthesizeOptions): Promise<CachedTtsResult> {
    const key = keyFor(opts);
    try {
      const [metaBuf, audio] = await Promise.all([store.get(`${key}.json`), store.get(`${key}.audio`)]);
      if (metaBuf && audio && audio.length > 0) {
        const meta = JSON.parse(metaBuf.toString("utf8")) as CacheMeta;
        // A cache hit costs nothing *this* time.
        return { audio, contentType: meta.contentType, durationSec: meta.durationSec, words: meta.words, wordsSource: meta.wordsSource, costUsd: 0, cacheHit: true, cacheKey: key };
      }
    } catch {
      // unreadable cache entry: fall through and re-synthesize
    }

    const result = await inner.synthesize(opts);
    const meta: CacheMeta = {
      contentType: result.contentType,
      durationSec: result.durationSec,
      words: result.words,
      wordsSource: result.wordsSource,
      costUsd: result.costUsd,
      provider: inner.id,
    };
    try {
      await store.put(`${key}.audio`, result.audio, result.contentType);
      await store.put(`${key}.json`, Buffer.from(JSON.stringify(meta)), "application/json");
    } catch {
      // cache is best-effort
    }
    return { ...result, cacheHit: false, cacheKey: key };
  }

  return {
    id: inner.id,
    synthesize: synthesizeCached,
    synthesizeCached,
  };
}

/** Updates a cache entry's word timings after alignment so later hits get the aligned timings too. */
export async function updateCachedWords(store: TtsCacheStore, cacheKey: string, words: WordTiming[], source: TtsResult["wordsSource"]): Promise<void> {
  try {
    const metaBuf = await store.get(`${cacheKey}.json`);
    if (!metaBuf) return;
    const meta = JSON.parse(metaBuf.toString("utf8")) as CacheMeta;
    await store.put(`${cacheKey}.json`, Buffer.from(JSON.stringify({ ...meta, words, wordsSource: source })), "application/json");
  } catch {
    // best-effort
  }
}
