import type { Job as BullJob } from "bullmq";
import { eq } from "drizzle-orm";
import { jobs } from "@sitereel/db";
import { QUEUE_NAMES, formatSlug, type JobStatus } from "@sitereel/shared";
import { chainJobId } from "./voice-processor.js";
import type { WorkerDeps } from "./types.js";
import { RERUN_STAGE_ORDER, RerunFromStageJobData, type RerunStage } from "../lib/phase6-contracts.js";
import { invalidateStageRuns, loadStoryboardVersion } from "../lib/db-adapters.js";

/** stage_runs.stage names at and after `from` (extract follows crawl, encode follows render). */
export function downstreamStageNames(from: RerunStage): string[] {
  const idx = RERUN_STAGE_ORDER.indexOf(from);
  const names: string[] = [];
  for (const s of RERUN_STAGE_ORDER.slice(idx)) {
    names.push(s);
    if (s === "crawl") names.push("extract");
    if (s === "render") names.push("encode");
  }
  return names;
}

const STATUS_FOR_STAGE: Record<RerunStage, JobStatus> = {
  crawl: "crawling",
  plan: "planning",
  voice: "voicing",
  build: "building",
  qa: "checking",
  render: "rendering",
};

/**
 * Admin "re-run from stage" (W13): invalidates the chosen stage's and every
 * downstream stage's previous runs (so the input-hash skip can't reuse them),
 * resets the job's status/error, and enqueues the stage with `force` so it
 * really re-executes. Downstream stages then re-run naturally through the
 * normal chain.
 */
export function createRerunProcessor(deps: WorkerDeps) {
  return async function processRerun(job: BullJob): Promise<void> {
    const { jobId, fromStage } = RerunFromStageJobData.parse(job.data);
    const log = deps.logger.child({ jobId, stage: "rerun", fromStage });

    const [jobRow] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!jobRow) throw new Error(`rerun: job ${jobId} not found`);

    const stages = downstreamStageNames(fromStage);
    const invalidated = await invalidateStageRuns(deps.db, jobId, stages);
    // Explicit admin action: this deliberately un-cancels / un-fails the job.
    await deps.db.update(jobs).set({ status: STATUS_FOR_STAGE[fromStage], errorCode: null, updatedAt: new Date() }).where(eq(jobs.id, jobId));

    const tag = String(job.id ?? Date.now());
    const opts = (stage: string, ...parts: string[]) => ({ jobId: chainJobId(jobId, stage, "rerun", tag, ...parts), attempts: 2, backoff: { type: "fixed" as const, delay: 5_000 } });
    const latest = await loadStoryboardVersion(deps.db, jobId, null);
    const version = latest?.version;
    if (fromStage !== "crawl" && fromStage !== "plan" && !version) throw new Error(`rerun from ${fromStage}: job has no storyboard yet — re-run from plan`);

    switch (fromStage) {
      case "crawl":
        if (!deps.queues.crawl) throw new Error("rerun: crawl queue not configured");
        await deps.queues.crawl.add(QUEUE_NAMES.crawl, { jobId, url: jobRow.url }, opts("crawl"));
        break;
      case "plan":
        await deps.queues.plan.add(QUEUE_NAMES.plan, { jobId, reason: "rerun" }, opts("plan"));
        break;
      case "voice":
        await deps.queues.voice.add(QUEUE_NAMES.voice, { jobId, storyboardVersion: version, force: true }, opts("voice"));
        break;
      case "build":
        await deps.queues.build.add(QUEUE_NAMES.build, { jobId, storyboardVersion: version, force: true }, opts("build"));
        break;
      case "qa":
        for (const format of jobRow.options.formats) await deps.queues.qa.add(QUEUE_NAMES.qa, { jobId, format, storyboardVersion: version, force: true }, opts("qa", formatSlug(format)));
        break;
      case "render":
        for (const format of jobRow.options.formats) await deps.queues.render.add(QUEUE_NAMES.render, { jobId, format, storyboardVersion: version, force: true }, opts("render", formatSlug(format)));
        break;
    }

    log.info({ invalidated, stages, version }, "admin re-run enqueued");
    await deps.publish({
      jobId,
      stage: fromStage,
      status: STATUS_FOR_STAGE[fromStage],
      pct: 0,
      message: `Re-running from ${fromStage}`,
      payload: { rerun: true, fromStage, invalidated, storyboardVersion: version ?? null },
      at: new Date().toISOString(),
    });
  };
}
