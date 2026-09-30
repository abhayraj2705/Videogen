import { createHash } from "node:crypto";
import type { Job as BullJob } from "bullmq";
import { eq } from "drizzle-orm";
import { jobs, stageRuns, crawls } from "@sitereel/db";
import { CrawlJobData, QUEUE_NAMES, type JobStatus } from "@sitereel/shared";
import { runCrawlStage } from "../stages/crawl.js";
import type { WorkerDeps } from "./types.js";

async function setJobStatus(deps: WorkerDeps, jobId: string, status: JobStatus, errorCode?: string): Promise<void> {
  await deps.db
    .update(jobs)
    .set({ status, errorCode: errorCode ?? null, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

export function createCrawlProcessor(deps: WorkerDeps) {
  return async function processCrawl(job: BullJob): Promise<void> {
    const { jobId, url } = CrawlJobData.parse(job.data);
    const log = deps.logger.child({ jobId, stage: "crawl" });
    const inputsHash = createHash("sha256").update(url).digest("hex").slice(0, 16);

    await setJobStatus(deps, jobId, "crawling");
    await deps.publish({ jobId, stage: "crawl", status: "crawling", pct: 5, message: "Starting crawl", at: new Date().toISOString() });

    const [crawlRun] = await deps.db
      .insert(stageRuns)
      .values({ jobId, stage: "crawl", attempt: job.attemptsMade + 1, inputsHash, status: "running", startedAt: new Date() })
      .returning();

    const result = await runCrawlStage(jobId, url, {
      storage: deps.storage,
      llmProvider: deps.llm.primary,
      onProgress: (pct, message) => {
        deps.publish({ jobId, stage: "crawl", status: "crawling", pct, message, at: new Date().toISOString() }).catch(() => undefined);
      },
    });

    if (result.outcome === "needs_input") {
      log.warn({ reason: result.reason, message: result.message }, "crawl needs input");
      await deps.db
        .update(stageRuns)
        .set({ status: "failed", endedAt: new Date(), error: { reason: result.reason, message: result.message } })
        .where(eq(stageRuns.id, crawlRun!.id));
      await setJobStatus(deps, jobId, "needs_input", result.reason);
      await deps.publish({
        jobId,
        stage: "crawl",
        status: "needs_input",
        pct: 100,
        message: result.message,
        payload: { reason: result.reason },
        at: new Date().toISOString(),
      });
      return;
    }

    const { crawlOutput, costUsd } = result;
    await deps.db
      .update(stageRuns)
      .set({
        status: "ok",
        endedAt: new Date(),
        costUsd: String(costUsd),
        outputs: { domain: crawlOutput.domain, pageCount: crawlOutput.pages.length, factCount: crawlOutput.facts.length },
      })
      .where(eq(stageRuns.id, crawlRun!.id));

    log.info(
      { facts: crawlOutput.facts.length, pages: crawlOutput.pages.length, briefSource: crawlOutput.siteBrief.source },
      "crawl + extract completed",
    );

    await setJobStatus(deps, jobId, "extracting");
    await deps.db.insert(stageRuns).values({
      jobId,
      stage: "extract",
      attempt: 1,
      inputsHash,
      status: "ok",
      startedAt: new Date(),
      endedAt: new Date(),
      outputs: { siteBrief: crawlOutput.siteBrief, brand: crawlOutput.brand },
    });

    // Full crawl material (facts, brand, pages, brief) persists here — the
    // plan stage reads it back by jobId rather than passing it through Redis.
    await deps.db.insert(crawls).values({
      jobId,
      domain: crawlOutput.domain,
      pages: crawlOutput.pages,
      brand: crawlOutput.brand,
      facts: crawlOutput.facts,
      siteBrief: crawlOutput.siteBrief,
    });

    await deps.queues.plan.add(QUEUE_NAMES.plan, { jobId }, { jobId, attempts: 2, backoff: { type: "fixed", delay: 5_000 } });

    await deps.publish({
      jobId,
      stage: "extract",
      status: "extracting",
      pct: 100,
      message: `Found ${crawlOutput.facts.length} facts across ${crawlOutput.pages.length} page(s)`,
      payload: { factCount: crawlOutput.facts.length, briefSource: crawlOutput.siteBrief.source },
      at: new Date().toISOString(),
    });
  };
}
