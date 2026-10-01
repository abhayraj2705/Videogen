import type { Job as BullJob } from "bullmq";
import { eq } from "drizzle-orm";
import { jobs, stageRuns } from "@sitereel/db";
import { BuildJobData, QUEUE_NAMES, formatSlug, type JobStatus } from "@sitereel/shared";
import { buildFilmManifest } from "../stages/build.js";
import { loadBuildInputs } from "./load-build-inputs.js";
import type { WorkerDeps } from "./types.js";

async function setJobStatus(deps: WorkerDeps, jobId: string, status: JobStatus, errorCode?: string): Promise<void> {
  await deps.db
    .update(jobs)
    .set({ status, errorCode: errorCode ?? null, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

export function createBuildProcessor(deps: WorkerDeps) {
  return async function processBuild(job: BullJob): Promise<void> {
    const { jobId } = BuildJobData.parse(job.data);
    const log = deps.logger.child({ jobId, stage: "build" });

    await deps.publish({ jobId, stage: "build", status: "building", pct: 10, message: "Assembling scenes", at: new Date().toISOString() });

    const inputs = await loadBuildInputs(deps, jobId);
    const [jobRow] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!jobRow) throw new Error(`build stage: job ${jobId} not found`);

    const [buildRun] = await deps.db
      .insert(stageRuns)
      .values({ jobId, stage: "build", attempt: job.attemptsMade + 1, inputsHash: inputs.storyboardId, status: "running", startedAt: new Date() })
      .returning();

    // buildFilmManifest is a pure function of (storyboard, crawlOutput, voiceScenes,
    // format) — QA and Render stages call it again independently rather than
    // have this stage ship a large manifest through Redis (see load-build-inputs.ts).
    // What's actually produced here is validated and persisted as a debug
    // artifact for the admin inspector (§3.6 W13), not consumed downstream.
    for (const format of jobRow.options.formats) {
      const manifest = buildFilmManifest({ storyboard: inputs.storyboard, crawlOutput: inputs.crawlOutput, voiceScenes: inputs.voiceScenes, format });
      await deps.storage.putObject(
        "assets",
        `jobs/${jobId}/build/manifest-${formatSlug(format)}.json`,
        Buffer.from(JSON.stringify(manifest, null, 2)),
        "application/json",
      );
    }

    await deps.db
      .update(stageRuns)
      .set({ status: "ok", endedAt: new Date(), outputs: { formats: jobRow.options.formats } })
      .where(eq(stageRuns.id, buildRun!.id));

    log.info({ formats: jobRow.options.formats }, "build completed");

    await setJobStatus(deps, jobId, "checking");
    for (const format of jobRow.options.formats) {
      await deps.queues.qa.add(QUEUE_NAMES.qa, { jobId, format }, { jobId: `${jobId}:${format}`, attempts: 2, backoff: { type: "fixed", delay: 5_000 } });
    }

    await deps.publish({ jobId, stage: "build", status: "checking", pct: 100, message: "Running quality checks", at: new Date().toISOString() });
  };
}
