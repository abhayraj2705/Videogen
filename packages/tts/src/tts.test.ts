import { describe, expect, it } from "vitest";
import { createCachedTtsProvider, ttsCacheKey, updateCachedWords, type TtsCacheStore } from "./cache.js";
import { createFallbackTtsProvider } from "./fallback.js";
import { estimateWordTimings } from "./timings.js";
import type { TtsProvider } from "./provider.js";

function memoryStore(): TtsCacheStore & { map: Map<string, Buffer> } {
  const map = new Map<string, Buffer>();
  return {
    map,
    async get(k) {
      return map.get(k) ?? null;
    },
    async put(k, b) {
      map.set(k, b);
    },
  };
}

function countingProvider(id = "fake:1"): TtsProvider & { calls: number } {
  const p = {
    id,
    calls: 0,
    async synthesize({ text }: { text: string }) {
      p.calls++;
      return { audio: Buffer.from(`audio:${text}`), contentType: "audio/wav", durationSec: 1.5, words: estimateWordTimings(text, 1.5), wordsSource: "estimate" as const, costUsd: 0.01 };
    },
  };
  return p;
}

describe("TTS cache", () => {
  it("keys on text + voice + language + provider, ignoring whitespace differences", () => {
    const base = { text: "Hello world", voiceId: "default", language: "en", providerId: "p" };
    expect(ttsCacheKey(base)).toBe(ttsCacheKey({ ...base, text: "  Hello   world " }));
    expect(ttsCacheKey(base)).not.toBe(ttsCacheKey({ ...base, voiceId: "calm" }));
    expect(ttsCacheKey(base)).not.toBe(ttsCacheKey({ ...base, language: "hi" }));
    expect(ttsCacheKey(base)).not.toBe(ttsCacheKey({ ...base, providerId: "q" }));
    expect(ttsCacheKey(base)).not.toBe(ttsCacheKey({ ...base, text: "Hello world!" }));
  });

  it("synthesizes identical lines once and serves repeats from storage at zero cost", async () => {
    const inner = countingProvider();
    const store = memoryStore();
    const tts = createCachedTtsProvider(inner, store);
    const a = await tts.synthesizeCached({ text: "Ship faster", voiceId: "default", language: "en" });
    const b = await tts.synthesizeCached({ text: "Ship faster", voiceId: "default", language: "en" });
    const c = await tts.synthesizeCached({ text: "Ship faster", voiceId: "default", language: "hi" });
    expect(inner.calls).toBe(2);
    expect(a.cacheHit).toBe(false);
    expect(b.cacheHit).toBe(true);
    expect(c.cacheHit).toBe(false);
    expect(b.costUsd).toBe(0);
    expect(b.audio.equals(a.audio)).toBe(true);
    expect(b.words).toEqual(a.words);
  });

  it("stores aligned word timings back into the cache entry", async () => {
    const store = memoryStore();
    const tts = createCachedTtsProvider(countingProvider(), store);
    const first = await tts.synthesizeCached({ text: "one two", voiceId: "v", language: "en" });
    const aligned = [
      { word: "one", startSec: 0.1, endSec: 0.5 },
      { word: "two", startSec: 0.7, endSec: 1.2 },
    ];
    await updateCachedWords(store, first.cacheKey, aligned, "aligned");
    const again = await tts.synthesizeCached({ text: "one two", voiceId: "v", language: "en" });
    expect(again.words).toEqual(aligned);
    expect(again.wordsSource).toBe("aligned");
  });

  it("never fails synthesis because the cache store is broken", async () => {
    const broken: TtsCacheStore = {
      get: async () => {
        throw new Error("storage down");
      },
      put: async () => {
        throw new Error("storage down");
      },
    };
    const tts = createCachedTtsProvider(countingProvider(), broken);
    const r = await tts.synthesizeCached({ text: "still works", voiceId: "v", language: "en" });
    expect(r.audio.length).toBeGreaterThan(0);
  });
});

describe("timings + fallback", () => {
  it("estimates contiguous, proportional word timings", () => {
    const w = estimateWordTimings("a bb ccc", 3, 1);
    expect(w[0]!.startSec).toBe(1);
    expect(w[2]!.endSec).toBeCloseTo(4, 6);
    expect(w[1]!.startSec).toBe(w[0]!.endSec);
    expect(w[2]!.endSec - w[2]!.startSec).toBeGreaterThan(w[0]!.endSec - w[0]!.startSec);
  });

  it("fallback provider produces real (silent) wav audio sized to the reading floor", async () => {
    const r = await createFallbackTtsProvider().synthesize({ text: "four words right here", voiceId: "default", language: "en" });
    expect(r.contentType).toBe("audio/wav");
    expect(r.audio.subarray(0, 4).toString()).toBe("RIFF");
    expect(r.durationSec).toBeCloseTo(4 * 0.3 + 0.3, 5);
    expect(r.words).toHaveLength(4);
    expect(r.wordsSource).toBe("estimate");
  }, 30_000);
});
