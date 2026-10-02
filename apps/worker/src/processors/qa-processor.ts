import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import type { Job as BullJob } from "bullmq";
import { QUEUE_NAMES, formatSlug, type AspectFormat } from "@sitereel/shared";
import { bundleFilmEntry, startFilmServer } from "@sitereel/renderer";
import { buildFilmManifest } from "../stages/build.js";
import { runQaStage, createLlmVisionReviewer, skippedVisionReviewer } from "../stages/qa.js";
import { publishManifest } from "../stages/render.js";
import { loadBuildInputs, type BuildInputs } from "./load-build-inputs.js";
import { chainJobId } from "./voice-processor.js";
import type { WorkerDeps } from "./types.js";
import { QaJobDataP6 } from "../lib/phase6-contracts.js";
import { manifestHash, qaStageHash, shouldSkipStage } from "../lib/input-hash.js";
import { finishStageRun, listPriorStageRuns, recordSkippedStage, startStageRun } from "../lib/db-adapters.js";
import { assertNotCancelled, failJob } from "../lib/job-lifecycle.js";

/** Where QA artifacts live; the render processor reads the report back into renders.qa. */
export const qaReportKey = (jobId: string, slug: string) => `jobs/${jobId}/qa/report-${slug}.json`;
export const qaContactSheetKey = (jobId: string, slug: string) => `jobs/${jobId}/qa/contact-${slug}.jpg`;

async function enqueueRender(deps: WorkerDeps, jobId: string, format: AspectFormat, inputs: BuildInputs, discriminator: string, force?: boolean) {
  await deps.queues.render.add(
    QUEUE_NAMES.render,
    { jobId, format, watermark: inputs.watermark, storyboardVersion: inputs.storyboardVersion, ...(force ? { force: true } : {}) },
    { jobId: chainJobId(jobId, "render", formatSlug(format), `v${inputs.storyboardVersion}`, discriminator), attempts: 2, backoff: { type: "fixed", delay: 10_000 } },
  );
}

export function createQaProcessor(deps: WorkerDeps) {
  return async function processQa(job: BullJob): Promise<void> {
    const data = QaJobDataP6.parse(job.data);
    const { jobId, format } = data;
    const log = deps.logger.child({ jobId, stage: "qa", format });
    const slug = formatSlug(format);

    const inputs = await loadBuildInputs(deps, jobId, { storyboardVersion: data.storyboardVersion });
    const manifest = buildFilmManifest({ storyboard: inputs.storyboard, crawlOutput: inputs.crawlOutput, voiceScenes: inputs.voiceScenes, format, music: inputs.music });
    const inputsHash = qaStageHash(manifestHash(manifest), format);
    const prior = await listPriorStageRuns(deps.db, jobId, "qa", `${format}:`);

    if (shouldSkipStage(inputsHash, prior, { force: data.force })) {
      // The identical manifest already passed QA (failed runs are never "ok", so never reused).
      await recordSkippedStage(deps.db, { jobId, stage: "qa", inputsHash, outputs: { format, storyboardVersion: inputs.storyboardVersion, passed: true } });
      log.info("QA inputs unchanged — skipped (previous pass reused)");
      await enqueueRender(deps, jobId, format, inputs, String(job.id ?? Date.now()), data.force);
      await deps.publish({ jobId, stage: "qa", status: "checking", pct: 100, message: `${format} unchanged — QA reused`, payload: { format, passed: true, reused: true }, at: new Date().toISOString() });
      return;
    }

    const runId = await startStageRun(deps.db, { jobId, stage: "qa", inputsHash });

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

      await finishStageRun(deps.db, runId, {
        status: report.passed ? "ok" : "failed",
        inputsHash,
        outputs: { format, storyboardVersion: inputs.storyboardVersion, passed: report.passed, blocking: report.blocking, issueCount: report.issues.length, vision: report.vision, contactSheetKey: contactKey },
        error: report.passed ? null : { code: "qa_failed", issues: report.blocking },
      });

      if (!report.passed) {
        // Hard gate: a film that fails purity/overflow/safe-area/text/grounding
        // is never rendered. That's our generated output failing our checks —
        // a system failure, so failJob refunds.
        log.warn({ blocking: report.blocking }, "QA failed — not rendering");
        await failJob(deps, jobId, "qa", "qa_failed", `${format} failed quality checks: ${report.blocking.map((i) => i.code).join(", ")}`);
        return;
      }

      await assertNotCancelled(deps, jobId);
      log.info({ warnings: report.issues.length, vision: report.vision.status }, "QA passed");
      await enqueueRender(deps, jobId, format, inputs, runId, data.force);

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
