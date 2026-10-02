import { eq, desc } from "drizzle-orm";
import { jobs, crawls, audioTakes, users } from "@sitereel/db";
import { resolveMusicMood, type CrawlOutput, type Storyboard } from "@sitereel/shared";
import type { VoiceSceneResult } from "../stages/voice.js";
import { getAudioSidecarFromEnv, type AudioSidecarClient } from "../lib/audio-sidecar.js";
import { selectMusicTrack, type MusicTrack } from "../lib/music.js";
import { ensureGeneratedTrack } from "../lib/music-gen.js";
import { getBrandKitForUser, getJobBrandKitId, getJobWatermarkSnapshot, loadStoryboardVersion } from "../lib/db-adapters.js";
import { applyBrandKit } from "../lib/brand-kit.js";
import { decideWatermark } from "../lib/job-policy.js";
import type { WorkerDeps } from "./types.js";

export interface BuildInputs {
  storyboard: Storyboard;
  storyboardId: string;
  storyboardVersion: number;
  crawlOutput: CrawlOutput;
  voiceScenes: VoiceSceneResult[];
  jobOptions: (typeof jobs.$inferSelect)["options"];
  /** Owner's plan — "free" gets the watermark at encode. */
  userPlan: (typeof users.$inferSelect)["plan"];
  /** Music bed chosen from options.musicOn/musicMood (deterministic, so Build/QA/Render agree). */
  music: MusicTrack | null;
  /** Per-scene audio identity (audio_takes.text_hash) — the build stage's audio input hash. */
  audioHashes: Record<string, string>;
  /** Watermark decision (plan at job creation / now — see decideWatermark). */
  watermark: boolean;
  /** Brand kit applied over the crawl's brand tokens, if any. */
  brandKitId: string | null;
}

/**
 * Build/QA/Render all need the same (storyboard, crawl material, voice
 * results) triple. Rather than shuttling that through Redis job payloads —
 * BullMQ job data should stay small, and three stages independently
 * re-deriving a FilmManifest from the same DB rows is cheap and idempotent —
 * each stage reloads it here by jobId (+ the storyboard version it works on).
 */
export async function loadBuildInputs(deps: WorkerDeps, jobId: string, opts: { storyboardVersion?: number | null } = {}): Promise<BuildInputs> {
  const [jobRow] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!jobRow) throw new Error(`loadBuildInputs: job ${jobId} not found`);

  // Phase 6 versioning: the requested version, else the latest one.
  const storyboardRow = await loadStoryboardVersion(deps.db, jobId, opts.storyboardVersion ?? null);
  if (!storyboardRow) throw new Error(`loadBuildInputs: job ${jobId} has no storyboard${opts.storyboardVersion ? ` v${opts.storyboardVersion}` : ""}`);

  const [crawlRow] = await deps.db.select().from(crawls).where(eq(crawls.jobId, jobId)).orderBy(desc(crawls.createdAt)).limit(1);
  if (!crawlRow) throw new Error(`loadBuildInputs: no crawl row for job ${jobId}`);

  const [userRow] = await deps.db.select({ plan: users.plan }).from(users).where(eq(users.id, jobRow.userId)).limit(1);

  const takeRows = await deps.db.select().from(audioTakes).where(eq(audioTakes.storyboardId, storyboardRow.id)).orderBy(desc(audioTakes.createdAt));
  // Newest take per scene wins (a re-voice inserts new rows rather than updating).
  const takeBySceneId = new Map<string, (typeof takeRows)[number]>();
  for (const r of takeRows) if (!takeBySceneId.has(r.sceneId)) takeBySceneId.set(r.sceneId, r);

  const voiceScenes: VoiceSceneResult[] = storyboardRow.json.scenes.map((scene) => {
    const take = takeBySceneId.get(scene.id);
    // audio_takes.duration_ms is the clip's own duration.
    const audioDurationSec = take?.key ? take.durationMs / 1000 : null;
    return {
      sceneId: scene.id,
      audioKey: take?.key ?? null,
      audioDurationSec,
      durationSec: audioDurationSec !== null ? Math.max(scene.durationSec, audioDurationSec + 0.5) : scene.durationSec,
      words: take?.words ?? [],
      provider: take?.provider ?? "none",
    };
  });
  const audioHashes = Object.fromEntries(storyboardRow.json.scenes.map((s) => [s.id, `${takeBySceneId.get(s.id)?.textHash ?? "none"}:${takeBySceneId.get(s.id)?.key ?? ""}`]));

  // W10: the job's brand kit (if any, and owned by the job's user) overrides crawl brand tokens.
  const brandKitId = await getJobBrandKitId(deps.db, jobRow);
  const kit = brandKitId ? await getBrandKitForUser(deps.db, brandKitId, jobRow.userId) : null;
  const brand = applyBrandKit(crawlRow.brand, kit);

  // A track generated for this job (MUSIC_SOURCE=generated) wins over the library; stored once, so every stage gets the same one.
  const generated = await ensureGeneratedTrack({ jobId: jobRow.id, options: jobRow.options, storage: deps.storage, sidecar: sidecarFor(deps), log: (msg, extra) => deps.logger.warn(extra ?? {}, msg) });

  return {
    storyboard: storyboardRow.json,
    storyboardId: storyboardRow.id,
    storyboardVersion: storyboardRow.version,
    crawlOutput: { domain: crawlRow.domain, pages: crawlRow.pages, brand, facts: crawlRow.facts, siteBrief: crawlRow.siteBrief },
    voiceScenes,
    jobOptions: jobRow.options,
    userPlan: userRow?.plan ?? "free",
    music: generated ?? selectMusicTrack(deps.repoRoot, { musicOn: jobRow.options.musicOn ?? true, musicMood: resolveMusicMood(jobRow.options), trackId: jobRow.options.musicTrackId, videoType: jobRow.options.videoType, seed: jobRow.id }),
    audioHashes,
    watermark: decideWatermark({ snapshot: getJobWatermarkSnapshot(jobRow), currentPlan: userRow?.plan ?? "free" }),
    brandKitId: kit ? kit.id : null,
  };
}

export function sidecarFor(deps: WorkerDeps): AudioSidecarClient | null {
  if (deps.sidecar !== undefined) return deps.sidecar;
  return getAudioSidecarFromEnv((msg, extra) => deps.logger.warn(extra ?? {}, msg));
}
