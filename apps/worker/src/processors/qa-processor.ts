import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import type { Job as BullJob } from "bullmq";
import { eq } from "drizzle-orm";
import { jobs, stageRuns } from "@sitereel/db";
import { QaJobData, QUEUE_NAMES, formatSlug } from "@sitereel/shared";
import { bundleFilmEntry, startFilmServer } from "@sitereel/renderer";
import { buildFilmManifest } from "../stages/build.js";
import { runQaStage } from "../stages/qa.js";
import { resolveAssetRefsDeep } from "../lib/asset-ref.js";
import { loadBuildInputs } from "./load-build-inputs.js";
import type { WorkerDeps } from "./types.js";

const QA_PORT = 4101;

export function createQaProcessor(deps: WorkerDeps) {
  return async function processQa(job: BullJob): Promise<void> {
    const { jobId, format } = QaJobData.parse(job.data);
    const log = deps.logger.child({ jobId, stage: "qa", format });

    const inputs = await loadBuildInputs(deps, jobId);
    const manifest = buildFilmManifest({ storyboard: inputs.storyboard, crawlOutput: inputs.crawlOutput, voiceScenes: inputs.voiceScenes, format });

    const [qaRun] = await deps.db
      .insert(stageRuns)
      .values({ jobId, stage: "qa", attempt: job.attemptsMade + 1, inputsHash: `${inputs.storyboardId}:${format}`, status: "running", startedAt: new Date() })
      .returning();

    await bundleFilmEntry();
    const extraRoot = deps.env.STORAGE_DRIVER === "local" ? path.resolve(deps.env.STORAGE_LOCAL_DIR) : await fs.mkdtemp(path.join(os.tmpdir(), "sitereel-qa-"));
    const server = await startFilmServer(extraRoot, QA_PORT);

    try {
      const resolvedManifest = await resolveAssetRefsDeep(manifest, async (bucket, key) => {
        if (deps.env.STORAGE_DRIVER === "local") return `${server.url}/${bucket}/${key}`;
        return deps.storage.presignDownload(bucket, key, 3600);
      });
      const manifestKey = `jobs/${jobId}/qa/manifest-${formatSlug(format)}.json`;
      await deps.storage.putObject("assets", manifestKey, Buffer.from(JSON.stringify(resolvedManifest)), "application/json");
      const manifestUrl = deps.env.STORAGE_DRIVER === "local" ? `${server.url}/assets/${manifestKey}` : await deps.storage.presignDownload("assets", manifestKey, 3600);

      const report = await runQaStage({ manifest: resolvedManifest, filmHost: server.url, manifestUrl, storyboard: inputs.storyboard, facts: inputs.crawlOutput.facts });

      await deps.db
        .update(stageRuns)
        .set({ status: report.passed ? "ok" : "failed", endedAt: new Date(), outputs: { passed: report.passed, issues: report.issues } })
        .where(eq(stageRuns.id, qaRun!.id));

      if (!report.passed) {
        log.warn({ issues: report.issues }, "QA found hard-gate issues — proceeding to render anyway (no auto-fix loop in Phase 4; see PHASE4.md)");
      } else {
        log.info("QA passed");
      }

      await deps.queues.render.add(QUEUE_NAMES.render, { jobId, format }, { jobId: `${jobId}:${format}`, attempts: 2, backoff: { type: "fixed", delay: 10_000 } });

      await deps.publish({
        jobId,
        stage: "qa",
        status: "checking",
        pct: 100,
        message: report.passed ? `${format} passed QA` : `${format} QA found ${report.issues.length} issue(s) — rendering anyway`,
        payload: { format, passed: report.passed, issueCount: report.issues.length },
        at: new Date().toISOString(),
      });
    } finally {
      await server.close();
      if (deps.env.STORAGE_DRIVER !== "local") await fs.rm(extraRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}
