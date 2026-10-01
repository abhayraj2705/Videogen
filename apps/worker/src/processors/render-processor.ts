import type { Job as BullJob } from "bullmq";
import { eq } from "drizzle-orm";
import { jobs, stageRuns, renders } from "@sitereel/db";
import { RenderJobData, formatSlug, type JobStatus } from "@sitereel/shared";
import { buildFilmManifest } from "../stages/build.js";
import { runRenderStage } from "../stages/render.js";
import { assembleSceneAudio } from "../lib/audio-mix.js";
import { buildVtt } from "../lib/vtt.js";
import { loadBuildInputs } from "./load-build-inputs.js";
import type { WorkerDeps } from "./types.js";

async function setJobStatus(deps: WorkerDeps, jobId: string, status: JobStatus, errorCode?: string): Promise<void> {
  await deps.db
    .update(jobs)
    .set({ status, errorCode: errorCode ?? null, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

export function createRenderProcessor(deps: WorkerDeps) {
  return async function processRender(job: BullJob): Promise<void> {
    const { jobId, format } = RenderJobData.parse(job.data);
    const log = deps.logger.child({ jobId, stage: "render", format });

    await setJobStatus(deps, jobId, "rendering");
    await deps.publish({ jobId, stage: "render", status: "rendering", pct: 5, message: `Rendering ${format}`, payload: { format }, at: new Date().toISOString() });

    const inputs = await loadBuildInputs(deps, jobId);
    const manifest = buildFilmManifest({ storyboard: inputs.storyboard, crawlOutput: inputs.crawlOutput, voiceScenes: inputs.voiceScenes, format });

    const [renderRun] = await deps.db
      .insert(stageRuns)
      .values({ jobId, stage: "render", attempt: job.attemptsMade + 1, inputsHash: `${inputs.storyboardId}:${format}`, status: "running", startedAt: new Date() })
      .returning();

    const hasAnyAudio = inputs.voiceScenes.some((v) => v.audioKey);
    const audioBuffer = hasAnyAudio
      ? await assembleSceneAudio({ voiceScenes: inputs.voiceScenes, storage: deps.storage, repoRoot: deps.repoRoot })
      : null;

    const result = await runRenderStage({
      jobId,
      format,
      manifest,
      audioBuffer,
      storage: deps.storage,
      env: deps.env,
      onProgress: (frame, total) => {
        if (frame % 60 === 0 || frame === total) {
          deps
            .publish({ jobId, stage: "render", status: "rendering", pct: Math.round((frame / total) * 90) + 5, message: `${format}: frame ${frame}/${total}`, payload: { format }, at: new Date().toISOString() })
            .catch(() => undefined);
        }
      },
    });

    await deps.db
      .update(stageRuns)
      .set({ status: "ok", endedAt: new Date(), outputs: { frames: result.frames, bytes: result.bytes, durationSec: result.durationSec } })
      .where(eq(stageRuns.id, renderRun!.id));

    // §4.6 "Encode": poster bake + VTT captions. The actual mux (audio + BT.709
    // + faststart) already happened inside runRenderStage/ffmpeg — recorded as
    // its own stage_runs row for state-machine fidelity even though no separate
    // encode *pass* runs; see PHASE4.md for why this is merged with render.
    const [encodeRun] = await deps.db
      .insert(stageRuns)
      .values({ jobId, stage: "encode", attempt: 1, inputsHash: `${inputs.storyboardId}:${format}`, status: "running", startedAt: new Date() })
      .returning();

    const vtt = buildVtt(manifest);
    const slug = formatSlug(format);
    const videoKey = `jobs/${jobId}/renders/${slug}.mp4`;
    const posterKey = `jobs/${jobId}/renders/${slug}.png`;
    const vttKey = `jobs/${jobId}/renders/${slug}.vtt`;
    await Promise.all([
      deps.storage.putObject("renders", videoKey, result.videoBuffer, "video/mp4"),
      deps.storage.putObject("renders", posterKey, result.posterBuffer, "image/png"),
      deps.storage.putObject("renders", vttKey, Buffer.from(vtt), "text/vtt"),
    ]);

    await deps.db.insert(renders).values({
      storyboardId: inputs.storyboardId,
      format,
      key: videoKey,
      posterKey,
      vttKey,
      frames: result.frames,
      durationMs: Math.round(result.durationSec * 1000),
      bytes: result.bytes,
    });

    await deps.db.update(stageRuns).set({ status: "ok", endedAt: new Date(), outputs: { videoKey, posterKey, vttKey } }).where(eq(stageRuns.id, encodeRun!.id));

    log.info({ bytes: result.bytes, durationSec: result.durationSec }, "render + encode completed");

    const [jobRow] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    const doneRenders = await deps.db.select().from(renders).where(eq(renders.storyboardId, inputs.storyboardId));
    const allFormatsDone = jobRow && jobRow.options.formats.every((f) => doneRenders.some((r) => r.format === f));

    await deps.publish({
      jobId,
      stage: "encode",
      status: allFormatsDone ? "done" : "rendering",
      pct: 100,
      message: `${format} ready`,
      payload: { format, videoKey },
      at: new Date().toISOString(),
    });

    if (allFormatsDone) {
      await setJobStatus(deps, jobId, "done");
      log.info({ formats: jobRow!.options.formats }, "job done — all formats rendered");
    }
  };
}
