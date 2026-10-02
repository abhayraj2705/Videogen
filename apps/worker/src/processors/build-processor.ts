import type { Job as BullJob } from "bullmq";
import { QUEUE_NAMES, formatSlug } from "@sitereel/shared";
import { buildFilmManifest } from "../stages/build.js";
import { loadBuildInputs } from "./load-build-inputs.js";
import { chainJobId } from "./voice-processor.js";
import type { WorkerDeps } from "./types.js";
import { BuildJobDataP6 } from "../lib/phase6-contracts.js";
import { buildStageHash, shouldSkipStage } from "../lib/input-hash.js";
import { finishStageRun, listPriorStageRuns, recordSkippedStage, startStageRun } from "../lib/db-adapters.js";
import { assertNotCancelled, setJobStatus } from "../lib/job-lifecycle.js";

export function createBuildProcessor(deps: WorkerDeps) {
  return async function processBuild(job: BullJob): Promise<void> {
    const data = BuildJobDataP6.parse(job.data);
    const { jobId } = data;
    const log = deps.logger.child({ jobId, stage: "build" });

    await deps.publish({ jobId, stage: "build", status: "building", pct: 10, message: "Assembling scenes", at: new Date().toISOString() });

    const inputs = await loadBuildInputs(deps, jobId, { storyboardVersion: data.storyboardVersion });
    const formats = inputs.jobOptions.formats;
    const inputsHash = buildStageHash({
      storyboard: inputs.storyboard,
      audioHashes: inputs.audioHashes,
      brand: inputs.crawlOutput.brand,
      musicId: inputs.music?.id ?? null,
      formats,
    });
    const prior = await listPriorStageRuns(deps.db, jobId, "build");

    if (shouldSkipStage(inputsHash, prior, { force: data.force })) {
      // Same storyboard content, audio, brand and music as the last build: the
      // manifests in storage are already exactly what this build would write.
      await recordSkippedStage(deps.db, { jobId, stage: "build", inputsHash, outputs: { storyboardVersion: inputs.storyboardVersion, formats } });
      log.info({ version: inputs.storyboardVersion }, "build inputs unchanged — skipped");
    } else {
      const runId = await startStageRun(deps.db, { jobId, stage: "build", inputsHash });
      // buildFilmManifest is a pure function of (storyboard, crawlOutput, voiceScenes,
      // format) — QA and Render stages call it again independently rather than
      // have this stage ship a large manifest through Redis (see load-build-inputs.ts).
      // What's produced here is persisted as a debug artifact for the admin inspector.
      for (const format of formats) {
        const manifest = buildFilmManifest({ storyboard: inputs.storyboard, crawlOutput: inputs.crawlOutput, voiceScenes: inputs.voiceScenes, format, music: inputs.music, fps: inputs.jobOptions.fps });
        await deps.storage.putObject("assets", `jobs/${jobId}/build/manifest-${formatSlug(format)}.json`, Buffer.from(JSON.stringify(manifest, null, 2)), "application/json");
      }
      await finishStageRun(deps.db, runId, {
        status: "ok",
        inputsHash,
        outputs: { storyboardVersion: inputs.storyboardVersion, formats, music: inputs.music?.id ?? null, brandKitId: inputs.brandKitId },
      });
      log.info({ formats, version: inputs.storyboardVersion }, "build completed");
    }

    await assertNotCancelled(deps, jobId);
    await setJobStatus(deps, jobId, "checking");
    for (const format of formats) {
      await deps.queues.qa.add(
        QUEUE_NAMES.qa,
        { jobId, format, storyboardVersion: inputs.storyboardVersion, ...(data.force ? { force: true } : {}) },
        { jobId: chainJobId(jobId, "qa", formatSlug(format), `v${inputs.storyboardVersion}`, String(job.id ?? Date.now())), attempts: 2, backoff: { type: "fixed", delay: 5_000 } },
      );
    }

    await deps.publish({ jobId, stage: "build", status: "checking", pct: 100, message: "Running quality checks", payload: { storyboardVersion: inputs.storyboardVersion }, at: new Date().toISOString() });
  };
}
