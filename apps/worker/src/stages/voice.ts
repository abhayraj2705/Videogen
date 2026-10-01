import type { JobOptions, Storyboard } from "@sitereel/shared";
import type { StorageClient } from "@sitereel/storage";
import type { TtsProvider, WordTiming } from "@sitereel/tts";
import { createFallbackTtsProvider } from "@sitereel/tts";

export interface VoiceSceneResult {
  sceneId: string;
  audioKey: string | null;
  /** The scene's actual duration for Build to use — at least long enough for its spoken audio, never shorter than the storyboard's own estimate. */
  durationSec: number;
  words: WordTiming[];
  provider: string;
}

export interface VoiceStageResult {
  scenes: VoiceSceneResult[];
  costUsd: number;
}

/**
 * §4.6 "Voice": synthesizes each scene's narration, computes real scene
 * durations from the resulting audio (never from a guess, once audio exists),
 * and persists each clip under jobs/{jobId}/voice/{sceneId}.wav. A per-line
 * provider failure falls back to synthesized silence rather than failing the
 * whole job — same resilience shape as the LLM/TTS provider patterns in
 * Phases 2-3.
 */
export async function runVoiceStage(
  jobId: string,
  storyboard: Storyboard,
  options: JobOptions,
  deps: { storage: StorageClient; ttsProvider: TtsProvider | null; repoRoot?: string },
): Promise<VoiceStageResult> {
  const fallback = createFallbackTtsProvider({ repoRoot: deps.repoRoot });
  let totalCost = 0;
  const scenes: VoiceSceneResult[] = [];

  for (const scene of storyboard.scenes) {
    if (options.noVoiceover || !scene.narration) {
      scenes.push({ sceneId: scene.id, audioKey: null, durationSec: scene.durationSec, words: [], provider: "none" });
      continue;
    }

    let result;
    let providerId: string;
    try {
      if (!deps.ttsProvider) throw new Error("no TTS provider configured");
      result = await deps.ttsProvider.synthesize({ text: scene.narration, voiceId: options.voiceId, language: options.voiceLanguage });
      providerId = deps.ttsProvider.id;
    } catch {
      result = await fallback.synthesize({ text: scene.narration, voiceId: options.voiceId, language: options.voiceLanguage });
      providerId = fallback.id;
    }

    const audioKey = `jobs/${jobId}/voice/${scene.id}.wav`;
    await deps.storage.putObject("assets", audioKey, result.audio, result.contentType);
    totalCost += result.costUsd;

    scenes.push({
      sceneId: scene.id,
      audioKey,
      durationSec: Math.max(scene.durationSec, result.durationSec + 0.3),
      words: result.words,
      provider: providerId,
    });
  }

  return { scenes, costUsd: totalCost };
}
