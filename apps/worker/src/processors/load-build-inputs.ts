import { eq, desc } from "drizzle-orm";
import { jobs, crawls, storyboards, audioTakes } from "@sitereel/db";
import type { CrawlOutput, Storyboard } from "@sitereel/shared";
import type { VoiceSceneResult } from "../stages/voice.js";
import type { WorkerDeps } from "./types.js";

export interface BuildInputs {
  storyboard: Storyboard;
  storyboardId: string;
  crawlOutput: CrawlOutput;
  voiceScenes: VoiceSceneResult[];
  jobOptions: (typeof jobs.$inferSelect)["options"];
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

  const takeRows = await deps.db.select().from(audioTakes).where(eq(audioTakes.storyboardId, storyboardRow.id));
  const takeBySceneId = new Map(takeRows.map((r) => [r.sceneId, r]));

  const voiceScenes: VoiceSceneResult[] = storyboardRow.json.scenes.map((scene) => {
    const take = takeBySceneId.get(scene.id);
    return {
      sceneId: scene.id,
      audioKey: take?.key ?? null,
      durationSec: take ? take.durationMs / 1000 : scene.durationSec,
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
  };
}
