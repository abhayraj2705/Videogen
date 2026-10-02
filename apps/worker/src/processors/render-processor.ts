import type { Job as BullJob } from "bullmq";
import { eq } from "drizzle-orm";
import { jobs, stageRuns, renders } from "@sitereel/db";
import { RenderJobData, formatSlug, type JobStatus } from "@sitereel/shared";
import { buildFilmManifest } from "../stages/build.js";
import { runRenderStage } from "../stages/render.js";
import { assembleNarrationTrack, mixFinalAudio } from "../lib/audio-mix.js";
import { buildVtt } from "../lib/vtt.js";
import { loadBuildInputs, sidecarFor } from "./load-build-inputs.js";
import { qaReportKey } from "./qa-processor.js";
import type { WorkerDeps } from "./types.js";

async function setJobStatus(deps: WorkerDeps, jobId: string, status: JobStatus, errorCode?: string): Promise<void> {
  await deps.db
    .update(jobs)
    .set({ status, errorCode: errorCode ?? null, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

export function createRenderProcessor(deps: WorkerDeps) {
  return async function processRender(job: BullJob): Promise<void> {
    const data = RenderJobData.parse(job.data);
    const { jobId, format } = data;
    const log = deps.logger.child({ jobId, stage: "render", format });
    const slug = formatSlug(format);

    await setJobStatus(deps, jobId, "rendering");
    await deps.publish({ jobId, stage: "render", status: "rendering", pct: 5, message: `Rendering ${format}`, payload: { format }, at: new Date().toISOString() });

    const inputs = await loadBuildInputs(deps, jobId);
    const manifest = buildFilmManifest({ storyboard: inputs.storyboard, crawlOutput: inputs.crawlOutput, voiceScenes: inputs.voiceScenes, format, music: inputs.music });
    const watermark = data.watermark ?? inputs.userPlan === "free";

    const [renderRun] = await deps.db
      .insert(stageRuns)
      .values({ jobId, stage: "render", attempt: job.attemptsMade + 1, inputsHash: `${inputs.storyboardId}:${format}`, status: "running", startedAt: new Date() })
      .returning();

    // Audio: narration placed at the timing engine's offsets + music bed,
    // ducked and normalized (sidecar /mix, else local ffmpeg).
    const hasVoice = inputs.voiceScenes.some((v) => v.audioKey);
    let mix: Awaited<ReturnType<typeof mixFinalAudio>> | null = null;
    if (hasVoice || inputs.music) {
      const narration = await assembleNarrationTrack({ manifest, voiceScenes: inputs.voiceScenes, storage: deps.storage, repoRoot: deps.repoRoot });
      mix = await mixFinalAudio({ narration, music: inputs.music, durationSec: manifest.duration, sidecar: sidecarFor(deps), repoRoot: deps.repoRoot });
    }

    const result = await runRenderStage({
      jobId,
      format,
      manifest,
      audioBuffer: mix?.audio ?? null,
      storage: deps.storage,
      env: deps.env,
      watermark,
      log: (m) => log.debug(m),
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
      .set({
        status: "ok",
        endedAt: new Date(),
        outputs: { frames: result.frames, bytes: result.bytes, durationSec: result.durationSec, chunks: result.chunked.chunks, chunksReused: result.chunked.chunksReused, concurrency: result.chunked.concurrency, renderMs: result.chunked.renderMs },
      })
      .where(eq(stageRuns.id, renderRun!.id));

    // §4.6 "Encode": concat + mux + poster bake + watermark happened inside
    // runRenderStage; this records the encode step and publishes artifacts.
    const [encodeRun] = await deps.db
      .insert(stageRuns)
      .values({ jobId, stage: "encode", attempt: job.attemptsMade + 1, inputsHash: `${inputs.storyboardId}:${format}`, status: "running", startedAt: new Date() })
      .returning();

    const vtt = buildVtt(manifest);
    const videoKey = `jobs/${jobId}/renders/${slug}.mp4`;
    const posterKey = `jobs/${jobId}/renders/${slug}.png`;
    const vttKey = `jobs/${jobId}/renders/${slug}.vtt`;
    await Promise.all([
      deps.storage.putObject("renders", videoKey, result.videoBuffer, "video/mp4"),
      deps.storage.putObject("renders", posterKey, result.posterBuffer, "image/png"),
      deps.storage.putObject("renders", vttKey, Buffer.from(vtt), "text/vtt"),
    ]);

    let qa: unknown = null;
    try {
      qa = JSON.parse((await deps.storage.getObject("assets", qaReportKey(jobId, slug))).toString("utf8"));
    } catch {
      qa = { note: "QA report not found in storage" };
    }
    const qaWithAudio = { ...(qa as object), audio: mix ? { path: mix.path, lufs: mix.lufs, truePeakDbtp: mix.truePeakDbtp, music: inputs.music?.id ?? null } : null, watermark };

    await deps.db
      .insert(renders)
      .values({
        storyboardId: inputs.storyboardId,
        format,
        key: videoKey,
        posterKey,
        vttKey,
        frames: result.frames,
        durationMs: Math.round(result.durationSec * 1000),
        bytes: result.bytes,
        qa: qaWithAudio,
      })
      .onConflictDoUpdate({
        target: [renders.storyboardId, renders.format],
        set: { key: videoKey, posterKey, vttKey, frames: result.frames, durationMs: Math.round(result.durationSec * 1000), bytes: result.bytes, qa: qaWithAudio },
      });

    await deps.db
      .update(stageRuns)
      .set({ status: "ok", endedAt: new Date(), outputs: { videoKey, posterKey, vttKey, captions: manifest.captions.length, watermark, audio: mix?.path ?? "none", probe: result.probe } })
      .where(eq(stageRuns.id, encodeRun!.id));

    log.info({ bytes: result.bytes, durationSec: result.durationSec, chunks: result.chunked.chunks, reused: result.chunked.chunksReused, audio: mix?.path }, "render + encode completed");

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
