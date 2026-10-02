import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import type { Job as BullJob } from "bullmq";
import { eq } from "drizzle-orm";
import { jobs, stageRuns } from "@sitereel/db";
import { QaJobData, QUEUE_NAMES, formatSlug } from "@sitereel/shared";
import { bundleFilmEntry, startFilmServer } from "@sitereel/renderer";
import { buildFilmManifest } from "../stages/build.js";
import { runQaStage, createLlmVisionReviewer, skippedVisionReviewer } from "../stages/qa.js";
import { publishManifest } from "../stages/render.js";
import { loadBuildInputs } from "./load-build-inputs.js";
import type { WorkerDeps } from "./types.js";

/** Where QA artifacts live; the render processor reads the report back into renders.qa. */
export const qaReportKey = (jobId: string, slug: string) => `jobs/${jobId}/qa/report-${slug}.json`;
export const qaContactSheetKey = (jobId: string, slug: string) => `jobs/${jobId}/qa/contact-${slug}.jpg`;

export function createQaProcessor(deps: WorkerDeps) {
  return async function processQa(job: BullJob): Promise<void> {
    const { jobId, format } = QaJobData.parse(job.data);
    const log = deps.logger.child({ jobId, stage: "qa", format });
    const slug = formatSlug(format);

    const inputs = await loadBuildInputs(deps, jobId);
    const manifest = buildFilmManifest({ storyboard: inputs.storyboard, crawlOutput: inputs.crawlOutput, voiceScenes: inputs.voiceScenes, format, music: inputs.music });

    const [qaRun] = await deps.db
      .insert(stageRuns)
      .values({ jobId, stage: "qa", attempt: job.attemptsMade + 1, inputsHash: `${inputs.storyboardId}:${format}`, status: "running", startedAt: new Date() })
      .returning();

    await bundleFilmEntry();
    const extraRoot = deps.env.STORAGE_DRIVER === "local" ? path.resolve(deps.env.STORAGE_LOCAL_DIR) : await fs.mkdtemp(path.join(os.tmpdir(), "sitereel-qa-"));
    const server = await startFilmServer(extraRoot, 0);

    try {
      const { resolved, manifestUrl } = await publishManifest({ manifest, storage: deps.storage, env: deps.env, serverUrl: server.url, key: `jobs/${jobId}/qa/manifest-${slug}.json` });
      const vision = deps.llm.primary ? createLlmVisionReviewer(deps.llm.primary) : deps.llm.escalation ? createLlmVisionReviewer(deps.llm.escalation) : skippedVisionReviewer;

      const { report, contactSheet } = await runQaStage({ manifest: resolved, filmHost: server.url, manifestUrl, storyboard: inputs.storyboard, facts: inputs.crawlOutput.facts, vision });

      const contactKey = contactSheet ? qaContactSheetKey(jobId, slug) : null;
      if (contactSheet && contactKey) await deps.storage.putObject("assets", contactKey, contactSheet, "image/jpeg");
      const stored = { ...report, format, contactSheetKey: contactKey };
      await deps.storage.putObject("assets", qaReportKey(jobId, slug), Buffer.from(JSON.stringify(stored, null, 2)), "application/json");

      await deps.db
        .update(stageRuns)
        .set({
          status: report.passed ? "ok" : "failed",
          endedAt: new Date(),
          outputs: { passed: report.passed, blocking: report.blocking, issueCount: report.issues.length, vision: report.vision, contactSheetKey: contactKey },
          error: report.passed ? null : { code: "qa_failed", issues: report.blocking },
        })
        .where(eq(stageRuns.id, qaRun!.id));

      if (!report.passed) {
        // Hard gate: a film that fails purity/overflow/safe-area/text/grounding
        // is never rendered. The job needs attention (edit storyboard / fix template).
        log.warn({ blocking: report.blocking }, "QA failed — not rendering");
        await deps.db.update(jobs).set({ status: "failed", errorCode: "qa_failed", updatedAt: new Date() }).where(eq(jobs.id, jobId));
        await deps.publish({
          jobId,
          stage: "qa",
          status: "failed",
          pct: 100,
          message: `${format} failed quality checks: ${report.blocking.map((i) => i.code).join(", ")}`,
          payload: { format, passed: false, blocking: report.blocking.slice(0, 10), contactSheetKey: contactKey },
          at: new Date().toISOString(),
        });
        return;
      }

      log.info({ warnings: report.issues.length, vision: report.vision.status }, "QA passed");
      await deps.queues.render.add(
        QUEUE_NAMES.render,
        { jobId, format, watermark: inputs.userPlan === "free" },
        { jobId: `${jobId}:${format}`, attempts: 2, backoff: { type: "fixed", delay: 10_000 } },
      );

      await deps.publish({
        jobId,
        stage: "qa",
        status: "checking",
        pct: 100,
        message: `${format} passed QA`,
        payload: { format, passed: true, issueCount: report.issues.length, contactSheetKey: contactKey },
        at: new Date().toISOString(),
      });
    } finally {
      await server.close();
      if (deps.env.STORAGE_DRIVER !== "local") await fs.rm(extraRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}
