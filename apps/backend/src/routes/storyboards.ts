import type { FastifyInstance } from "fastify";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { audioTakes, jobs, storyboards, type Db } from "@sitereel/db";
import { QUEUE_NAMES, syncOnScreenText, type PlanJobDataP6, type Storyboard, type VoiceJobDataP6 } from "@sitereel/shared";
import type { StorageClient } from "@sitereel/storage";
import type { AuthVerifier } from "../lib/auth.js";
import type { Queues } from "../lib/queue.js";
import { uniqueJobId } from "../lib/queue.js";
import { withJob, type Logger } from "../lib/logger.js";
import { isUniqueViolation, isUuid, loadOwnedJob, sendError, sendInvalidBody } from "../lib/http.js";
import { serveAsset } from "../lib/assets.js";
import {
  EDITABLE_STATUSES,
  isEditableStatus,
  loadLatestCrawl,
  loadLatestStoryboard,
  loadStoryboardVersion,
  publicSource,
  toValidationView,
  validateAgainstCrawl,
} from "../lib/storyboards.js";

export interface StoryboardRouteDeps {
  db: Db;
  queues: Queues;
  storage: StorageClient;
  storageDriver: "local" | "s3";
  verifyAuth: AuthVerifier;
  logger: Logger;
}

const PutStoryboardBody = z.object({
  baseVersion: z.number().int().positive(),
  storyboard: z.record(z.unknown()),
});

const RevoiceBody = z.object({ sceneId: z.string().min(1).max(100) });

const RedesignBody = z.object({ sceneId: z.string().min(1).max(100), instruction: z.string().max(500).default("") });

const ApproveBody = z.object({ version: z.number().int().positive().optional() }).optional();

const VOICE_JOB_OPTS = { attempts: 2, backoff: { type: "fixed" as const, delay: 5_000 } };

/**
 * W6 storyboard editing & versioning (docs/wave-b-contracts.md).
 *
 *   GET  /api/jobs/:id/storyboard            latest version + validation + facts + audio
 *   GET  /api/jobs/:id/storyboard/versions
 *   PUT  /api/jobs/:id/storyboard            { baseVersion, storyboard } → { version, validation } (409 version_conflict)
 *   POST /api/jobs/:id/storyboard/revoice    { sceneId } → 202
 *   POST /api/jobs/:id/storyboard/redesign   { sceneId, instruction } → 202 (the worker saves the next version and emits a plan event)
 *   POST /api/jobs/:id/approve               { version? } → { ok, version } (422 storyboard_invalid)
 *   GET  /api/jobs/:id/audio/:takeId         audio take (media; accepts ?token=)
 */
export function registerStoryboardRoutes(app: FastifyInstance, deps: StoryboardRouteDeps): void {
  const { db } = deps;

  app.get<{ Params: { id: string } }>("/api/jobs/:id/storyboard", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const job = await loadOwnedJob(db, reply, req.params.id, user.id);
    if (!job) return;

    const latest = await loadLatestStoryboard(db, job.id);
    if (!latest) return sendError(reply, 404, "storyboard_not_found", "This video doesn't have a script yet.");
    const crawl = await loadLatestCrawl(db, job.id);

    // Audio: takes recorded for the latest version, else for the version currently approved/rendered.
    const audioSourceIds = [latest.id, ...(job.currentStoryboardId && job.currentStoryboardId !== latest.id ? [job.currentStoryboardId] : [])];
    const takes = await db
      .select({ id: audioTakes.id, storyboardId: audioTakes.storyboardId, sceneId: audioTakes.sceneId, key: audioTakes.key, durationMs: audioTakes.durationMs, createdAt: audioTakes.createdAt })
      .from(audioTakes)
      .where(inArray(audioTakes.storyboardId, audioSourceIds))
      .orderBy(asc(audioTakes.createdAt));
    const fromLatest = takes.some((t) => t.storyboardId === latest.id);
    const bySceneId = new Map<string, (typeof takes)[number]>();
    for (const take of takes) {
      if (!take.key) continue;
      if (fromLatest && take.storyboardId !== latest.id) continue;
      bySceneId.set(take.sceneId, take); // newest wins (ascending order)
    }

    return reply.send({
      version: latest.version,
      storyboard: latest.json,
      validation: toValidationView(validateAgainstCrawl(latest.json, crawl)),
      facts: crawl?.facts ?? [],
      audio: [...bySceneId.values()].map((t) => ({ sceneId: t.sceneId, url: `/api/jobs/${job.id}/audio/${t.id}`, durationMs: t.durationMs })),
    });
  });

  app.get<{ Params: { id: string } }>("/api/jobs/:id/storyboard/versions", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const job = await loadOwnedJob(db, reply, req.params.id, user.id);
    if (!job) return;
    const rows = await db
      .select({ version: storyboards.version, createdAt: storyboards.createdAt, source: storyboards.source })
      .from(storyboards)
      .where(eq(storyboards.jobId, job.id))
      .orderBy(asc(storyboards.version));
    return reply.send({ versions: rows.map((r) => ({ version: r.version, createdAt: r.createdAt.toISOString(), source: publicSource(r.source) })) });
  });

  app.put<{ Params: { id: string } }>("/api/jobs/:id/storyboard", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const parsed = PutStoryboardBody.safeParse(req.body);
    if (!parsed.success) return sendInvalidBody(reply, parsed.error);
    const job = await loadOwnedJob(db, reply, req.params.id, user.id);
    if (!job) return;
    if (!isEditableStatus(job.status)) {
      return sendError(reply, 409, "not_editable", `The script can only be edited while the video is in ${EDITABLE_STATUSES.join(", ")}.`, { status: job.status });
    }

    const latest = await loadLatestStoryboard(db, job.id);
    if (!latest) return sendError(reply, 404, "storyboard_not_found", "This video doesn't have a script yet.");
    const conflict = () =>
      sendError(reply, 409, "version_conflict", "The script changed since you opened it. Reload to get the latest version.", { latestVersion: latest.version });
    if (parsed.data.baseVersion !== latest.version) return conflict();

    const version = latest.version + 1;
    // Templates render from props, so props win: onScreenText is re-derived from them.
    const submitted = parsed.data.storyboard as unknown as Storyboard;
    const json = { ...submitted, scenes: syncOnScreenText(submitted.scenes), version } as Storyboard;
    const report = validateAgainstCrawl(json, await loadLatestCrawl(db, job.id));
    try {
      await db.insert(storyboards).values({ jobId: job.id, version, json, validation: report, source: "user" });
    } catch (err) {
      // A concurrent save won the (job_id, version) unique index.
      if (isUniqueViolation(err)) return conflict();
      throw err;
    }
    withJob(deps.logger, job.id, user.id).info({ version, valid: report.valid }, "storyboard version saved");
    return reply.send({ version, validation: toValidationView(report) });
  });

  app.post<{ Params: { id: string } }>("/api/jobs/:id/storyboard/revoice", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const parsed = RevoiceBody.safeParse(req.body);
    if (!parsed.success) return sendInvalidBody(reply, parsed.error);
    const job = await loadOwnedJob(db, reply, req.params.id, user.id);
    if (!job) return;
    if (!isEditableStatus(job.status)) {
      return sendError(reply, 409, "not_editable", "Lines can only be re-voiced while reviewing or after the video finished.", { status: job.status });
    }
    const latest = await loadLatestStoryboard(db, job.id);
    if (!latest) return sendError(reply, 404, "storyboard_not_found", "This video doesn't have a script yet.");
    const scenes = (latest.json as { scenes?: { id?: unknown }[] }).scenes ?? [];
    if (!scenes.some((s) => s?.id === parsed.data.sceneId)) {
      return sendError(reply, 404, "scene_not_found", `Scene "${parsed.data.sceneId}" isn't in the latest script.`);
    }

    // sceneIds ⇒ the worker re-voices only these scenes and does not advance past voice.
    const data: VoiceJobDataP6 = { jobId: job.id, storyboardVersion: latest.version, sceneIds: [parsed.data.sceneId] };
    try {
      await deps.queues.voice.add(QUEUE_NAMES.voice, data, { ...VOICE_JOB_OPTS, jobId: uniqueJobId(job.id, "revoice", latest.version) });
    } catch (err) {
      withJob(deps.logger, job.id, user.id).error({ err }, "revoice enqueue failed");
      return sendError(reply, 503, "queue_unavailable", "Couldn't queue the re-voice. Try again in a moment.");
    }
    return reply.code(202).send({ ok: true, version: latest.version, sceneId: parsed.data.sceneId });
  });

  app.post<{ Params: { id: string } }>("/api/jobs/:id/storyboard/redesign", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const parsed = RedesignBody.safeParse(req.body);
    if (!parsed.success) return sendInvalidBody(reply, parsed.error);
    const job = await loadOwnedJob(db, reply, req.params.id, user.id);
    if (!job) return;
    if (!isEditableStatus(job.status)) {
      return sendError(reply, 409, "not_editable", "Scenes can only be redesigned while reviewing or after the video finished.", { status: job.status });
    }
    const latest = await loadLatestStoryboard(db, job.id);
    if (!latest) return sendError(reply, 404, "storyboard_not_found", "This video doesn't have a script yet.");
    const scenes = (latest.json as { scenes?: { id?: unknown }[] }).scenes ?? [];
    if (!scenes.some((s) => s?.id === parsed.data.sceneId)) {
      return sendError(reply, 404, "scene_not_found", `Scene "${parsed.data.sceneId}" isn't in the latest script.`);
    }
    // Redesigns the latest saved version: the editor saves pending edits before asking.
    const data: PlanJobDataP6 = { jobId: job.id, reason: "redesign", redesign: { sceneId: parsed.data.sceneId, instruction: parsed.data.instruction.trim(), baseVersion: latest.version } };
    try {
      await deps.queues.plan.add(QUEUE_NAMES.plan, data, { attempts: 1, jobId: uniqueJobId(job.id, "redesign", latest.version) });
    } catch (err) {
      withJob(deps.logger, job.id, user.id).error({ err }, "redesign enqueue failed");
      return sendError(reply, 503, "queue_unavailable", "Couldn't queue the redesign. Try again in a moment.");
    }
    return reply.code(202).send({ ok: true, version: latest.version, sceneId: parsed.data.sceneId });
  });

  app.post<{ Params: { id: string } }>("/api/jobs/:id/approve", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const parsed = ApproveBody.safeParse(req.body ?? undefined);
    if (!parsed.success) return sendInvalidBody(reply, parsed.error);
    const job = await loadOwnedJob(db, reply, req.params.id, user.id);
    if (!job) return;
    const log = withJob(deps.logger, job.id, user.id);

    if (!isEditableStatus(job.status)) {
      return sendError(reply, 409, "not_in_review", "This video isn't waiting for approval.", { status: job.status });
    }
    const requested = parsed.data?.version;
    const target = requested ? await loadStoryboardVersion(db, job.id, requested) : await loadLatestStoryboard(db, job.id);
    if (!target) return sendError(reply, 404, "storyboard_not_found", requested ? `Script version ${requested} doesn't exist.` : "This video doesn't have a script yet.");

    const view = toValidationView(validateAgainstCrawl(target.json, await loadLatestCrawl(db, job.id)));
    if (!view.ok) {
      return sendError(reply, 422, "storyboard_invalid", "Fix the script's errors before rendering.", { version: target.version, validation: view });
    }

    // Conditional transition: two racing approves can't both enqueue.
    const updated = await db
      .update(jobs)
      .set({ status: "voicing", currentStoryboardId: target.id, errorCode: null, updatedAt: new Date() })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, job.status)))
      .returning({ id: jobs.id });
    if (updated.length === 0) return sendError(reply, 409, "not_in_review", "This video isn't waiting for approval.");

    const data: VoiceJobDataP6 = { jobId: job.id, storyboardVersion: target.version };
    try {
      await deps.queues.voice.add(QUEUE_NAMES.voice, data, { ...VOICE_JOB_OPTS, jobId: uniqueJobId(job.id, "approve", target.version) });
    } catch (err) {
      log.error({ err }, "approve enqueue failed; reverting status");
      await db
        .update(jobs)
        .set({ status: job.status, currentStoryboardId: job.currentStoryboardId, updatedAt: new Date() })
        .where(eq(jobs.id, job.id));
      return sendError(reply, 503, "queue_unavailable", "Couldn't start rendering. Try again in a moment.");
    }

    log.info({ version: target.version }, "storyboard approved, voice enqueued");
    return reply.send({ ok: true, version: target.version });
  });

  app.get<{ Params: { id: string; takeId: string } }>("/api/jobs/:id/audio/:takeId", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const job = await loadOwnedJob(db, reply, req.params.id, user.id);
    if (!job) return;
    if (!isUuid(req.params.takeId)) return sendError(reply, 404, "not_found", "Audio not found.");
    const [row] = await db
      .select({ key: audioTakes.key, jobId: storyboards.jobId })
      .from(audioTakes)
      .innerJoin(storyboards, eq(storyboards.id, audioTakes.storyboardId))
      .where(eq(audioTakes.id, req.params.takeId))
      .limit(1);
    if (!row || row.jobId !== job.id || !row.key) return sendError(reply, 404, "not_found", "Audio not found.");
    return serveAsset(reply, {
      storage: deps.storage,
      storageDriver: deps.storageDriver,
      bucket: "assets",
      key: row.key,
      rangeHeader: req.headers.range,
      cacheControl: "private, max-age=300",
    });
  });
}
