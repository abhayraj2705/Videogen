import type { Job as BullJob } from "bullmq";
import { desc, eq } from "drizzle-orm";
import { jobs, audioTakes, storyboards } from "@sitereel/db";
import { QUEUE_NAMES, type JobStatus } from "@sitereel/shared";
import { runVoiceStage, type VoiceSceneResult } from "../stages/voice.js";
import { sidecarFor } from "./load-build-inputs.js";
import type { WorkerDeps } from "./types.js";
import { VoiceJobDataP6 } from "../lib/phase6-contracts.js";
import { decideVoiceScenes, voiceSceneHashes, voiceStageHash } from "../lib/input-hash.js";
import { finishStageRun, loadStoryboardVersion, startStageRun } from "../lib/db-adapters.js";
import { assertNotCancelled, setJobStatus } from "../lib/job-lifecycle.js";

/** Unique-per-chain BullMQ job id: a re-run must not be deduplicated against the previous run's completed job. */
export function chainJobId(jobId: string, stage: string, ...parts: (string | number)[]): string {
  return [jobId, stage, ...parts].join(":");
}

export function createVoiceProcessor(deps: WorkerDeps) {
  return async function processVoice(job: BullJob): Promise<void> {
    const data = VoiceJobDataP6.parse(job.data);
    const { jobId } = data;
    const isRevoice = !!data.sceneIds?.length;
    const log = deps.logger.child({ jobId, stage: "voice", revoice: isRevoice });

    const [jobRow] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!jobRow) throw new Error(`voice stage: job ${jobId} not found`);
    const sb = await loadStoryboardVersion(deps.db, jobId, data.storyboardVersion ?? null);
    if (!sb) throw new Error(`voice stage: job ${jobId} has no storyboard${data.storyboardVersion ? ` v${data.storyboardVersion}` : ""}`);
    const options = jobRow.options;

    if (!isRevoice) {
      await setJobStatus(deps, jobId, "voicing");
      await deps.publish({ jobId, stage: "voice", status: "voicing", pct: 10, message: "Recording voiceover", payload: { storyboardVersion: sb.version }, at: new Date().toISOString() });
    }

    // --- Downstream-only re-runs: per-scene input hashes vs. this job's previous takes ---
    const sceneHashes = voiceSceneHashes(sb.json, options);
    const stageHash = voiceStageHash(sceneHashes);
    const priorTakes = await deps.db
      .select({ take: audioTakes })
      .from(audioTakes)
      .innerJoin(storyboards, eq(audioTakes.storyboardId, storyboards.id))
      .where(eq(storyboards.jobId, jobId))
      .orderBy(desc(audioTakes.createdAt));
    const priorBySceneId = new Map<string, (typeof priorTakes)[number]["take"]>();
    for (const { take } of priorTakes) {
      if (!priorBySceneId.has(take.sceneId) && take.textHash === sceneHashes.get(take.sceneId) && take.voice === options.voiceId) priorBySceneId.set(take.sceneId, take);
    }
    const decision = decideVoiceScenes(sceneHashes, new Map([...priorBySceneId].map(([id, t]) => [id, t.textHash])), {
      forceSceneIds: data.sceneIds,
      forceAll: data.force,
    });

    // A re-voice touches only the requested scenes; a full run covers every scene.
    const targetIds = new Set(isRevoice ? data.sceneIds : sb.json.scenes.map((s) => s.id));
    const reuse = new Map<string, VoiceSceneResult>();
    for (const id of decision.reuse) {
      const t = priorBySceneId.get(id);
      if (!t || !targetIds.has(id)) continue;
      reuse.set(id, { sceneId: id, audioKey: t.key, audioDurationSec: t.key ? t.durationMs / 1000 : null, durationSec: t.durationMs / 1000, words: t.words, provider: t.provider });
    }
    const storyboardForRun = { ...sb.json, scenes: sb.json.scenes.filter((s) => targetIds.has(s.id)) };
    const willSynthesize = storyboardForRun.scenes.filter((s) => !reuse.has(s.id)).map((s) => s.id);

    const runHash = isRevoice ? `revoice:${[...targetIds].sort().join(",")}:${stageHash}` : stageHash;
    const runId = await startStageRun(deps.db, { jobId, stage: "voice", inputsHash: runHash });

    const result = await runVoiceStage(jobId, storyboardForRun, options, {
      storage: deps.storage,
      ttsProvider: deps.tts,
      aligner: sidecarFor(deps),
      repoRoot: deps.repoRoot,
      log: (msg, extra) => log.warn(extra ?? {}, msg),
      reuse,
      sceneHashes,
    });

    await assertNotCancelled(deps, jobId);

    // Takes for THIS storyboard version: new ones, plus reused ones carried over from an older version.
    const rows = result.scenes
      .filter((s) => !reuse.has(s.sceneId) || priorBySceneId.get(s.sceneId)?.storyboardId !== sb.id)
      .map((s) => ({
        storyboardId: sb.id,
        sceneId: s.sceneId,
        textHash: sceneHashes.get(s.sceneId)!,
        voice: options.voiceId,
        provider: s.provider,
        key: s.audioKey,
        // The clip's own duration (scene durations are derived later by the timing engine).
        durationMs: Math.round((s.audioDurationSec ?? s.durationSec) * 1000),
        words: s.words,
      }));
    if (rows.length > 0) await deps.db.insert(audioTakes).values(rows);

    await finishStageRun(deps.db, runId, {
      status: willSynthesize.length === 0 ? "skipped" : "ok",
      inputsHash: runHash,
      costUsd: result.costUsd,
      outputs: {
        storyboardVersion: sb.version,
        scenes: result.scenes.length,
        synthesized: result.synthesized,
        reused: result.reused,
        sceneHashes: Object.fromEntries(sceneHashes),
        cacheHits: result.cacheHits,
        alignedLines: result.aligned,
        wordSources: result.scenes.map((s) => s.wordsSource ?? (reuse.has(s.sceneId) ? "reused" : "none")),
        totalAudioSec: result.scenes.reduce((sum, r) => sum + (r.audioDurationSec ?? 0), 0),
      },
    });

    log.info({ version: sb.version, synthesized: result.synthesized, reused: result.reused.length, costUsd: result.costUsd }, "voice completed");

    if (isRevoice) {
      // W6 "re-voice line": the job stays where it is (usually `review`); the
      // editor hears the new take, and approve later reuses it.
      const status = (jobRow.status as JobStatus) ?? "review";
      for (const sceneId of targetIds) {
        const scene = result.scenes.find((s) => s.sceneId === sceneId);
        await deps.publish({
          jobId,
          stage: "voice",
          status,
          pct: 100,
          message: `Re-voiced scene ${sceneId}`,
          payload: { sceneId, storyboardVersion: sb.version, audioKey: scene?.audioKey ?? null, durationMs: Math.round((scene?.audioDurationSec ?? 0) * 1000) },
          at: new Date().toISOString(),
        });
      }
      return;
    }

    await deps.db.update(jobs).set({ currentStoryboardId: sb.id, updatedAt: new Date() }).where(eq(jobs.id, jobId));
    await setJobStatus(deps, jobId, "building");
    await deps.queues.build.add(
      QUEUE_NAMES.build,
      { jobId, storyboardVersion: sb.version, ...(data.force ? { force: true } : {}) },
      { jobId: chainJobId(jobId, "build", `v${sb.version}`, runId), attempts: 2, backoff: { type: "fixed", delay: 5_000 } },
    );

    await deps.publish({
      jobId,
      stage: "voice",
      status: "building",
      pct: 100,
      message: result.synthesized.length === 0 ? "Voiceover unchanged — reused" : `Voiceover ready (${result.synthesized.length} line(s) recorded, ${result.reused.length} reused)`,
      payload: { storyboardVersion: sb.version, synthesized: result.synthesized, reused: result.reused },
      at: new Date().toISOString(),
    });
  };
}
