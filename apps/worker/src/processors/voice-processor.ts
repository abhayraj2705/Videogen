import { createHash } from "node:crypto";
import type { Job as BullJob } from "bullmq";
import { eq } from "drizzle-orm";
import { jobs, stageRuns, audioTakes } from "@sitereel/db";
import { VoiceJobData, QUEUE_NAMES, type JobStatus } from "@sitereel/shared";
import { runVoiceStage } from "../stages/voice.js";
import { loadBuildInputs } from "./load-build-inputs.js";
import type { WorkerDeps } from "./types.js";

async function setJobStatus(deps: WorkerDeps, jobId: string, status: JobStatus, errorCode?: string): Promise<void> {
  await deps.db
    .update(jobs)
    .set({ status, errorCode: errorCode ?? null, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

export function createVoiceProcessor(deps: WorkerDeps) {
  return async function processVoice(job: BullJob): Promise<void> {
    const { jobId } = VoiceJobData.parse(job.data);
    const log = deps.logger.child({ jobId, stage: "voice" });

    await setJobStatus(deps, jobId, "voicing");
    await deps.publish({ jobId, stage: "voice", status: "voicing", pct: 10, message: "Recording voiceover", at: new Date().toISOString() });

    const { storyboard, storyboardId, jobOptions } = await loadBuildInputs(deps, jobId);
    const inputsHash = createHash("sha256").update(JSON.stringify(storyboard.scenes.map((s) => s.narration ?? ""))).digest("hex").slice(0, 16);

    const [voiceRun] = await deps.db
      .insert(stageRuns)
      .values({ jobId, stage: "voice", attempt: job.attemptsMade + 1, inputsHash, status: "running", startedAt: new Date() })
      .returning();

    const result = await runVoiceStage(jobId, storyboard, jobOptions, {
      storage: deps.storage,
      ttsProvider: deps.tts,
      repoRoot: deps.repoRoot,
    });

    await deps.db.insert(audioTakes).values(
      result.scenes.map((s) => ({
        storyboardId,
        sceneId: s.sceneId,
        textHash: inputsHash,
        voice: jobOptions.voiceId,
        provider: s.provider,
        key: s.audioKey,
        durationMs: Math.round(s.durationSec * 1000),
        words: s.words,
      })),
    );

    await deps.db
      .update(stageRuns)
      .set({
        status: "ok",
        endedAt: new Date(),
        costUsd: String(result.costUsd),
        outputs: { scenes: result.scenes.length, totalDurationSec: result.scenes.reduce((s, r) => s + r.durationSec, 0) },
      })
      .where(eq(stageRuns.id, voiceRun!.id));

    log.info({ scenes: result.scenes.length, costUsd: result.costUsd }, "voice completed");

    await setJobStatus(deps, jobId, "building");
    await deps.queues.build.add(QUEUE_NAMES.build, { jobId }, { jobId, attempts: 2, backoff: { type: "fixed", delay: 5_000 } });

    await deps.publish({ jobId, stage: "voice", status: "building", pct: 100, message: "Voiceover ready", at: new Date().toISOString() });
  };
}
