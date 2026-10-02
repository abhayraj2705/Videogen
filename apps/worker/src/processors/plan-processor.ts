import type { Job as BullJob } from "bullmq";
import { eq, desc } from "drizzle-orm";
import { jobs, stageRuns, crawls, storyboards } from "@sitereel/db";
import { PlanJobData, QUEUE_NAMES, type CrawlOutput, type JobStatus } from "@sitereel/shared";
import { runPlanStage } from "../stages/plan.js";
import type { WorkerDeps } from "./types.js";

async function setJobStatus(deps: WorkerDeps, jobId: string, status: JobStatus, errorCode?: string): Promise<void> {
  await deps.db
    .update(jobs)
    .set({ status, errorCode: errorCode ?? null, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

export function createPlanProcessor(deps: WorkerDeps) {
  return async function processPlan(job: BullJob): Promise<void> {
    const { jobId } = PlanJobData.parse(job.data);
    const log = deps.logger.child({ jobId, stage: "plan" });

    await setJobStatus(deps, jobId, "planning");
    await deps.publish({ jobId, stage: "plan", status: "planning", pct: 10, message: "Writing the script", at: new Date().toISOString() });

    const [jobRow] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    const [crawlRow] = await deps.db.select().from(crawls).where(eq(crawls.jobId, jobId)).orderBy(desc(crawls.createdAt)).limit(1);

    if (!jobRow || !crawlRow) {
      throw new Error(`plan stage: missing job or crawl row for jobId=${jobId}`);
    }

    const crawlOutput: CrawlOutput = {
      domain: crawlRow.domain,
      pages: crawlRow.pages,
      brand: crawlRow.brand,
      facts: crawlRow.facts,
      siteBrief: crawlRow.siteBrief,
    };

    const inputsHash = `v1:${crawlRow.id}:${jobRow.options.tone}:${jobRow.options.lengthSec}`;
    const [planRun] = await deps.db
      .insert(stageRuns)
      .values({ jobId, stage: "plan", attempt: job.attemptsMade + 1, inputsHash, status: "running", startedAt: new Date() })
      .returning();

    const result = await runPlanStage(crawlOutput, jobRow.options, {
      primaryProvider: deps.llm.primary,
      escalationProvider: deps.llm.escalation,
    });

    await deps.db
      .update(stageRuns)
      .set({
        status: "ok",
        endedAt: new Date(),
        costUsd: String(result.costUsd),
        outputs: {
          source: result.storyboard.source,
          attempts: result.attempts,
          valid: result.validation.valid,
          sceneCount: result.storyboard.scenes.length,
          latencyMs: result.latencyMs,
          // Per-call cost/latency (including failed calls) so cost per plan is auditable (§8.3).
          llmCalls: result.calls,
        },
      })
      .where(eq(stageRuns.id, planRun!.id));

    const [storyboardRow] = await deps.db
      .insert(storyboards)
      .values({
        jobId,
        version: 1,
        json: result.storyboard,
        validation: result.validation,
        source: result.storyboard.source,
      })
      .returning();

    await deps.db.update(jobs).set({ currentStoryboardId: storyboardRow!.id, updatedAt: new Date() }).where(eq(jobs.id, jobId));

    log.info(
      { source: result.storyboard.source, attempts: result.attempts, valid: result.validation.valid, costUsd: result.costUsd, latencyMs: result.latencyMs },
      "plan completed",
    );

    // reviewBeforeRender=true stops here — the job waits at "review" until
    // POST /api/jobs/:id/approve enqueues voice (§3.6 W6 script review screen,
    // not built yet; the API route is, so this is testable today via curl).
    // reviewBeforeRender=false skips straight to voice.
    const nextStatus: JobStatus = jobRow.options.reviewBeforeRender ? "review" : "voicing";
    await setJobStatus(deps, jobId, nextStatus);
    if (!jobRow.options.reviewBeforeRender) {
      await deps.queues.voice.add(QUEUE_NAMES.voice, { jobId }, { jobId, attempts: 2, backoff: { type: "fixed", delay: 5_000 } });
    }

    await deps.publish({
      jobId,
      stage: "plan",
      status: nextStatus,
      pct: 100,
      message: `Storyboard ready (${result.storyboard.source}, ${result.storyboard.scenes.length} scenes)`,
      payload: { storyboardId: storyboardRow!.id, source: result.storyboard.source, valid: result.validation.valid },
      at: new Date().toISOString(),
    });
  };
}
