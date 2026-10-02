import { eq, desc } from "drizzle-orm";
import { jobs, crawls, storyboards, audioTakes, users } from "@sitereel/db";
import type { CrawlOutput, Storyboard } from "@sitereel/shared";
import type { VoiceSceneResult } from "../stages/voice.js";
import { getAudioSidecarFromEnv, type AudioSidecarClient } from "../lib/audio-sidecar.js";
import { selectMusicTrack, type MusicTrack } from "../lib/music.js";
import type { WorkerDeps } from "./types.js";

export interface BuildInputs {
  storyboard: Storyboard;
  storyboardId: string;
  crawlOutput: CrawlOutput;
  voiceScenes: VoiceSceneResult[];
  jobOptions: (typeof jobs.$inferSelect)["options"];
  /** Owner's plan — "free" gets the watermark at encode. */
  userPlan: (typeof users.$inferSelect)["plan"];
  /** Music bed chosen from options.musicOn/musicMood (deterministic, so Build/QA/Render agree). */
  music: MusicTrack | null;
}

/**
 * Build/QA/Render all need the same (storyboard, crawl material, voice
 * results) triple. Rather than shuttling that through Redis job payloads —
 * BullMQ job data should stay small, and three stages independently
 * re-deriving a FilmManifest from the same DB rows is cheap and idempotent —
 * each stage reloads it here by jobId.
 */
export async function loadBuildInputs(deps: WorkerDeps, jobId: string): Promise<BuildInputs> {
  const [jobRow] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!jobRow?.currentStoryboardId) throw new Error(`loadBuildInputs: job ${jobId} has no currentStoryboardId`);

  const [storyboardRow] = await deps.db.select().from(storyboards).where(eq(storyboards.id, jobRow.currentStoryboardId)).limit(1);
  if (!storyboardRow) throw new Error(`loadBuildInputs: storyboard ${jobRow.currentStoryboardId} not found`);

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

  return {
    storyboard: storyboardRow.json,
    storyboardId: storyboardRow.id,
    crawlOutput: { domain: crawlRow.domain, pages: crawlRow.pages, brand: crawlRow.brand, facts: crawlRow.facts, siteBrief: crawlRow.siteBrief },
    voiceScenes,
    jobOptions: jobRow.options,
    userPlan: userRow?.plan ?? "free",
    music: selectMusicTrack(deps.repoRoot, { musicOn: jobRow.options.musicOn ?? true, musicMood: jobRow.options.musicMood ?? "upbeat" }),
  };
}

export function sidecarFor(deps: WorkerDeps): AudioSidecarClient | null {
  if (deps.sidecar !== undefined) return deps.sidecar;
  return getAudioSidecarFromEnv((msg, extra) => deps.logger.warn(extra ?? {}, msg));
}
