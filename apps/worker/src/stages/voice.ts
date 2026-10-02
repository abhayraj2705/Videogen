import type { JobOptions, Storyboard } from "@sitereel/shared";
import type { StorageClient } from "@sitereel/storage";
import type { TtsProvider, TtsResult, WordAligner, WordTiming } from "@sitereel/tts";
import { createCachedTtsProvider, createFallbackTtsProvider, updateCachedWords, type TtsCacheStore } from "@sitereel/tts";

export interface VoiceSceneResult {
  sceneId: string;
  audioKey: string | null;
  /** Length of the synthesized clip itself (null for silent scenes) — the timing engine's input. */
  audioDurationSec: number | null;
  /** Legacy: the scene's minimum duration (max of storyboard estimate and audio + padding). */
  durationSec: number;
  /** Word timings relative to the start of this scene's clip. */
  words: WordTiming[];
  provider: string;
  wordsSource?: TtsResult["wordsSource"];
  cacheHit?: boolean;
}

export interface VoiceStageResult {
  scenes: VoiceSceneResult[];
  costUsd: number;
  cacheHits: number;
  aligned: number;
  /** Scenes actually (re-)synthesized this run. */
  synthesized: string[];
  /** Scenes whose previous take was reused untouched (downstream-only re-runs). */
  reused: string[];
}

/** Parallel TTS calls per job: enough to cut a 7-line film's voice stage ~3x without tripping provider rate limits. */
const VOICE_CONCURRENCY = 3;

/** Binds a StorageClient bucket to the TTS cache's tiny get/put interface. */
export function storageTtsCache(storage: StorageClient): TtsCacheStore {
  return {
    async get(key) {
      try {
        return await storage.getObject("assets", key);
      } catch {
        return null;
      }
    },
    put: (key, body, contentType) => storage.putObject("assets", key, body, contentType),
  };
}

/**
 * §4.6 "Voice": per-line synthesis with
 *  - a content-hash cache (text + voice + language + provider) in storage,
 *    so identical lines are synthesized once across jobs and re-voices;
 *  - the job's language passed through to the provider;
 *  - real word timings from the audio sidecar's /align when it's reachable,
 *    else the provider's/estimated timings;
 *  - per-line fallback to synthesized silence if the provider fails — a TTS
 *    outage degrades the voiceover, it never fails the job.
 * Clips are persisted under jobs/{jobId}/voice/{sceneId}.wav.
 */
export async function runVoiceStage(
  jobId: string,
  storyboard: Storyboard,
  options: JobOptions,
  deps: {
    storage: StorageClient;
    ttsProvider: TtsProvider | null;
    aligner?: WordAligner | null;
    repoRoot?: string;
    log?: (msg: string, extra?: Record<string, unknown>) => void;
    /**
     * Phase 6 downstream-only re-runs: previous takes to reuse as-is, by
     * sceneId (the caller decides which via decideVoiceScenes). Scenes not in
     * the map are synthesized.
     */
    reuse?: Map<string, VoiceSceneResult>;
    /** Per-scene input hashes; when given, clips are stored content-addressed (`{sceneId}-{hash}.wav`) so old takes stay intact. */
    sceneHashes?: Map<string, string>;
  },
): Promise<VoiceStageResult> {
  const fallback = createFallbackTtsProvider({ repoRoot: deps.repoRoot });
  const cacheStore = storageTtsCache(deps.storage);
  const cached = deps.ttsProvider ? createCachedTtsProvider(deps.ttsProvider, cacheStore) : null;
  let totalCost = 0;
  let cacheHits = 0;
  let aligned = 0;
  const scenes: VoiceSceneResult[] = [];
  const synthesized: string[] = [];
  const reused: string[] = [];
  const language = options.voiceLanguage ?? storyboard.language ?? "en";

  // Lines are independent, so they're synthesized a few at a time (results keep storyboard order).
  const voiceScene = async (scene: Storyboard["scenes"][number]): Promise<VoiceSceneResult> => {
    const prior = deps.reuse?.get(scene.id);
    if (prior) {
      reused.push(scene.id);
      return { ...prior, sceneId: scene.id, durationSec: prior.audioDurationSec !== null ? Math.max(scene.durationSec, prior.audioDurationSec + 0.5) : scene.durationSec, cacheHit: true };
    }
    synthesized.push(scene.id);
    if (options.noVoiceover || !scene.narration) {
      return { sceneId: scene.id, audioKey: null, audioDurationSec: null, durationSec: scene.durationSec, words: [], provider: "none" };
    }

    const req = { text: scene.narration, voiceId: options.voiceId, language };
    let result: TtsResult;
    let providerId: string;
    let cacheHit = false;
    let cacheKey: string | null = null;
    try {
      if (!cached) throw new Error("no TTS provider configured");
      const r = await cached.synthesizeCached(req);
      result = r;
      cacheHit = r.cacheHit;
      cacheKey = r.cacheKey;
      providerId = cached.id;
    } catch (err) {
      if (cached) deps.log?.("TTS provider failed for a line — using silent fallback", { sceneId: scene.id, error: (err as Error).message });
      result = await fallback.synthesize(req);
      providerId = fallback.id;
    }
    if (cacheHit) cacheHits++;

    let words = result.words;
    let wordsSource = result.wordsSource ?? "estimate";
    // Alignment only makes sense on real speech; the fallback is silence.
    if (wordsSource === "estimate" && providerId !== fallback.id && deps.aligner) {
      const alignedWords = await deps.aligner.align({ audio: result.audio, contentType: result.contentType, text: scene.narration, language }).catch(() => null);
      if (alignedWords && alignedWords.length > 0) {
        words = alignedWords;
        wordsSource = "aligned";
        aligned++;
        if (cacheKey) await updateCachedWords(cacheStore, cacheKey, words, "aligned");
      }
    }

    const sceneHash = deps.sceneHashes?.get(scene.id);
    const audioKey = sceneHash ? `jobs/${jobId}/voice/${scene.id}-${sceneHash}.wav` : `jobs/${jobId}/voice/${scene.id}.wav`;
    await deps.storage.putObject("assets", audioKey, result.audio, result.contentType);
    totalCost += result.costUsd;

    return {
      sceneId: scene.id,
      audioKey,
      audioDurationSec: result.durationSec,
      durationSec: Math.max(scene.durationSec, result.durationSec + 0.5),
      words,
      provider: providerId,
      wordsSource,
      cacheHit,
    };
  };

  const results = new Array<VoiceSceneResult>(storyboard.scenes.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(VOICE_CONCURRENCY, storyboard.scenes.length) }, async () => {
      for (let i = next++; i < storyboard.scenes.length; i = next++) results[i] = await voiceScene(storyboard.scenes[i]!);
    }),
  );
  scenes.push(...results);
  const order = new Map(storyboard.scenes.map((s, i) => [s.id, i]));
  const inOrder = (ids: string[]) => ids.sort((a, b) => order.get(a)! - order.get(b)!);

  return { scenes, costUsd: totalCost, cacheHits, aligned, synthesized: inOrder(synthesized), reused: inOrder(reused) };
}
