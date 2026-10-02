import { createHash } from "node:crypto";
import type { AspectFormat, BrandTokens, Storyboard } from "@sitereel/shared";

/**
 * Downstream-only re-runs (W6, contract "Downstream-only re-runs"): every stage
 * hashes exactly the inputs that change its output. A stage whose hash equals
 * the previous successful run's hash is skipped and its outputs reused; voice
 * goes one level finer and hashes per scene, so an edit to one line re-voices
 * one line.
 *
 * All functions here are pure — the queue processors and the offline
 * `pnpm pipeline run --edit` demo share them, which is what makes the demo a
 * faithful proof of the production skip logic.
 */

export function sha16(value: unknown): string {
  return createHash("sha256")
    .update(typeof value === "string" ? value : stableStringify(value))
    .digest("hex")
    .slice(0, 16);
}

/** JSON.stringify with sorted object keys, so hashes don't depend on key insertion order. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}

const normalizeText = (s: string) => s.trim().replace(/\s+/g, " ");

export interface VoiceHashOptions {
  voiceId: string;
  language: string;
  noVoiceover?: boolean;
}

/** Per-scene voice input: narration + voice + language. Silent scenes hash to a constant per voice setting. */
export function sceneVoiceHash(narration: string | undefined, opts: VoiceHashOptions): string {
  const text = opts.noVoiceover || !narration ? "" : normalizeText(narration);
  return sha16(["voice-v1", text, opts.voiceId, opts.language]);
}

export function voiceSceneHashes(storyboard: Pick<Storyboard, "scenes" | "language">, opts: { voiceId: string; voiceLanguage?: string; noVoiceover?: boolean }): Map<string, string> {
  const language = opts.voiceLanguage ?? storyboard.language ?? "en";
  return new Map(storyboard.scenes.map((s) => [s.id, sceneVoiceHash(s.narration, { voiceId: opts.voiceId, language, noVoiceover: opts.noVoiceover })]));
}

/** Whole-stage voice hash: the ordered list of per-scene hashes. */
export function voiceStageHash(sceneHashes: Map<string, string>): string {
  return sha16(["voice-stage-v1", [...sceneHashes.entries()]]);
}

export interface VoiceSceneDecision {
  /** Scenes that must be (re-)synthesized. */
  synthesize: string[];
  /** Scenes whose previous take can be reused as-is. */
  reuse: string[];
}

/**
 * Which scenes to re-voice: a scene is reused when a previous take exists
 * with the identical per-scene hash, unless it's explicitly forced (re-voice
 * button / admin re-run).
 */
export function decideVoiceScenes(
  current: Map<string, string>,
  previousTakeHashes: Map<string, string>,
  opts: { forceSceneIds?: string[] | null; forceAll?: boolean } = {},
): VoiceSceneDecision {
  const forced = new Set(opts.forceSceneIds ?? []);
  const synthesize: string[] = [];
  const reuse: string[] = [];
  for (const [sceneId, hash] of current) {
    if (opts.forceAll || forced.has(sceneId) || previousTakeHashes.get(sceneId) !== hash) synthesize.push(sceneId);
    else reuse.push(sceneId);
  }
  return { synthesize, reuse };
}

/**
 * Build input: the storyboard content (not its version number — a voice-only
 * quick change produces a new version with identical scenes), per-scene audio
 * hashes, the effective brand tokens (brand kit), music and formats.
 */
export function buildStageHash(input: {
  storyboard: Pick<Storyboard, "scenes" | "tone" | "language">;
  audioHashes: Map<string, string> | Record<string, string>;
  brand: BrandTokens;
  musicId: string | null;
  formats: readonly AspectFormat[];
}): string {
  const audio = input.audioHashes instanceof Map ? Object.fromEntries(input.audioHashes) : input.audioHashes;
  return sha16(["build-v1", input.storyboard.scenes, input.storyboard.tone, input.storyboard.language, audio, input.brand, input.musicId, [...input.formats]]);
}

/** Hash of a resolved (pre-asset-resolution) FilmManifest — QA and render inputs. */
export function manifestHash(manifest: unknown): string {
  return sha16(["manifest-v1", manifest]);
}

export function qaStageHash(manifestH: string, format: AspectFormat): string {
  return `${format}:${sha16(["qa-v1", manifestH, format])}`;
}

export function renderStageHash(input: { manifestHash: string; format: AspectFormat; watermark: boolean; audioHash?: string | null }): string {
  return `${input.format}:${sha16(["render-v1", input.manifestHash, input.format, input.watermark, input.audioHash ?? null])}`;
}

export interface PriorRun {
  inputsHash: string;
  status: string;
  invalidated?: boolean;
}

/**
 * Skip decision: reuse only when the MOST RECENT successful (ok/skipped),
 * non-invalidated run of the stage had the same input hash. Comparing with
 * the latest run (not "any run with that hash") matters because outputs live
 * at stable storage keys that a later run with different inputs overwrites.
 */
export function shouldSkipStage(currentHash: string, priorRuns: readonly PriorRun[], opts: { force?: boolean } = {}): boolean {
  if (opts.force) return false;
  const latest = priorRuns.find((r) => (r.status === "ok" || r.status === "skipped") && !r.invalidated);
  return latest?.inputsHash === currentHash;
}
