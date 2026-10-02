import type { Job as BullJob } from "bullmq";
import { and, desc, eq, inArray } from "drizzle-orm";
import { jobs, renders, storyboards } from "@sitereel/db";
import { formatSlug } from "@sitereel/shared";
import { buildFilmManifest } from "../stages/build.js";
import { runRenderStage } from "../stages/render.js";
import { assembleNarrationTrack, mixFinalAudio, type MixResult } from "../lib/audio-mix.js";
import { buildVtt } from "../lib/vtt.js";
import { loadBuildInputs, sidecarFor, type BuildInputs } from "./load-build-inputs.js";
import { qaReportKey } from "./qa-processor.js";
import type { WorkerDeps } from "./types.js";
import { RenderJobDataP6 } from "../lib/phase6-contracts.js";
import { manifestHash, renderStageHash, sha16, shouldSkipStage } from "../lib/input-hash.js";
import { finishStageRun, listPriorStageRuns, recordSkippedStage, startStageRun } from "../lib/db-adapters.js";
import { assertNotCancelled, notifyJobEmail, setJobStatus } from "../lib/job-lifecycle.js";

/** All requested formats rendered for this storyboard version -> job done (+ "video ready" email). */
async function completeIfAllFormatsDone(deps: WorkerDeps, jobId: string, inputs: BuildInputs, format: string, videoKey: string, log: WorkerDeps["logger"]) {
  const [jobRow] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  const doneRenders = await deps.db.select().from(renders).where(eq(renders.storyboardId, inputs.storyboardId));
  const allFormatsDone = !!jobRow && jobRow.options.formats.every((f) => doneRenders.some((r) => r.format === f));

  await deps.publish({
    jobId,
    stage: "encode",
    status: allFormatsDone ? "done" : "rendering",
    pct: 100,
    message: `${format} ready`,
    payload: { format, videoKey, storyboardVersion: inputs.storyboardVersion },
    at: new Date().toISOString(),
  });

  if (allFormatsDone) {
    await deps.db.update(jobs).set({ currentStoryboardId: inputs.storyboardId }).where(eq(jobs.id, jobId));
    await setJobStatus(deps, jobId, "done");
    log.info({ formats: jobRow!.options.formats, version: inputs.storyboardVersion }, "job done — all formats rendered");
    await notifyJobEmail(deps, jobId, "video-ready");
  }
}

async function loadCachedMix(deps: WorkerDeps, mixKey: string): Promise<MixResult | null> {
  try {
    const [audio, meta] = await Promise.all([deps.storage.getObject("assets", `${mixKey}.wav`), deps.storage.getObject("assets", `${mixKey}.json`)]);
    return { ...(JSON.parse(meta.toString("utf8")) as Omit<MixResult, "audio">), audio };
  } catch {
    return null;
  }
}

export function createRenderProcessor(deps: WorkerDeps) {
  return async function processRender(job: BullJob): Promise<void> {
    const data = RenderJobDataP6.parse(job.data);
    const { jobId, format } = data;
    const log = deps.logger.child({ jobId, stage: "render", format });
    const slug = formatSlug(format);

    await setJobStatus(deps, jobId, "rendering");
    await deps.publish({ jobId, stage: "render", status: "rendering", pct: 5, message: `Rendering ${format}`, payload: { format }, at: new Date().toISOString() });

    const inputs = await loadBuildInputs(deps, jobId, { storyboardVersion: data.storyboardVersion });
    const manifest = buildFilmManifest({ storyboard: inputs.storyboard, crawlOutput: inputs.crawlOutput, voiceScenes: inputs.voiceScenes, format, music: inputs.music });
    // Watermark: decided from the plan (job-creation snapshot / current plan), not trusted from the payload alone.
    const watermark = inputs.watermark;
    const inputsHash = renderStageHash({ manifestHash: manifestHash(manifest), format, watermark, audioHash: sha16([inputs.audioHashes, inputs.music?.id ?? null]) });

    // --- Downstream-only re-run: identical render inputs -> reuse the previous MP4/poster/VTT ---
    const prior = await listPriorStageRuns(deps.db, jobId, "render", `${format}:`);
    if (shouldSkipStage(inputsHash, prior, { force: data.force })) {
      const versions = await deps.db.select({ id: storyboards.id }).from(storyboards).where(eq(storyboards.jobId, jobId));
      const [prev] = await deps.db
        .select()
        .from(renders)
        .where(and(inArray(renders.storyboardId, versions.map((v) => v.id)), eq(renders.format, format)))
        .orderBy(desc(renders.createdAt))
        .limit(1);
      if (prev) {
        if (prev.storyboardId !== inputs.storyboardId) {
          const { id: _id, createdAt: _c, storyboardId: _s, ...copy } = prev;
          await deps.db
            .insert(renders)
            .values({ ...copy, storyboardId: inputs.storyboardId })
            .onConflictDoUpdate({ target: [renders.storyboardId, renders.format], set: { key: copy.key, posterKey: copy.posterKey, vttKey: copy.vttKey, frames: copy.frames, durationMs: copy.durationMs, bytes: copy.bytes, qa: copy.qa } });
        }
        await recordSkippedStage(deps.db, { jobId, stage: "render", inputsHash, outputs: { format, storyboardVersion: inputs.storyboardVersion, videoKey: prev.key, watermark } });
        log.info({ version: inputs.storyboardVersion }, "render inputs unchanged — reused previous render");
        await completeIfAllFormatsDone(deps, jobId, inputs, format, prev.key, log);
        return;
      }
    }

    const renderRunId = await startStageRun(deps.db, { jobId, stage: "render", inputsHash });

    // Audio: narration placed at the timing engine's offsets + music bed,
    // ducked and normalized (sidecar /mix, else local ffmpeg).
    const hasVoice = inputs.voiceScenes.some((v) => v.audioKey);
    let mix: MixResult | null = null;
    if (hasVoice || inputs.music) {
      // Every format shares one timeline, so the mix is identical across them: the first
      // format's render stores it, the others read it back instead of re-running ffmpeg.
      const mixKey = `jobs/${jobId}/audio/mix-${sha16(["mix-v1", manifestHash({ ...manifest, width: 0, height: 0 }), inputs.audioHashes, inputs.music?.id ?? null])}`;
      mix = await loadCachedMix(deps, mixKey);
      if (!mix) {
        const narration = await assembleNarrationTrack({ manifest, voiceScenes: inputs.voiceScenes, storage: deps.storage, repoRoot: deps.repoRoot });
        mix = await mixFinalAudio({ narration, music: inputs.music, durationSec: manifest.duration, sidecar: sidecarFor(deps), repoRoot: deps.repoRoot });
        const { audio, ...meta } = mix;
        await Promise.all([
          deps.storage.putObject("assets", `${mixKey}.wav`, audio, "audio/wav"),
          deps.storage.putObject("assets", `${mixKey}.json`, Buffer.from(JSON.stringify(meta)), "application/json"),
        ]).catch(() => undefined);
      }
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

    // A cancel during a long render: don't publish artifacts for a cancelled job.
    await assertNotCancelled(deps, jobId);

    await finishStageRun(deps.db, renderRunId, {
      status: "ok",
      inputsHash,
      outputs: { format, storyboardVersion: inputs.storyboardVersion, frames: result.frames, bytes: result.bytes, durationSec: result.durationSec, chunks: result.chunked.chunks, chunksReused: result.chunked.chunksReused, concurrency: result.chunked.concurrency, renderMs: result.chunked.renderMs },
    });

    // §4.6 "Encode": concat + mux + poster bake + watermark happened inside
    // runRenderStage; this records the encode step and publishes artifacts.
    const encodeRunId = await startStageRun(deps.db, { jobId, stage: "encode", inputsHash });

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

    const renderValues = { key: videoKey, posterKey, vttKey, frames: result.frames, durationMs: Math.round(result.durationSec * 1000), bytes: result.bytes, qa: qaWithAudio };
    await deps.db
      .insert(renders)
      .values({ storyboardId: inputs.storyboardId, format, ...renderValues })
      .onConflictDoUpdate({ target: [renders.storyboardId, renders.format], set: renderValues });

    await finishStageRun(deps.db, encodeRunId, {
      status: "ok",
      inputsHash,
      outputs: { format, videoKey, posterKey, vttKey, captions: manifest.captions.length, watermark, audio: mix?.path ?? "none", probe: result.probe },
    });

    log.info({ bytes: result.bytes, durationSec: result.durationSec, chunks: result.chunked.chunks, reused: result.chunked.chunksReused, audio: mix?.path }, "render + encode completed");
    await completeIfAllFormatsDone(deps, jobId, inputs, format, videoKey, log);
  };
}
