import type { FastifyInstance } from "fastify";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { chargeCredits, computeQuickChangeCost, creditLedger, jobs, refundJobCredits, renders, storyboards, users, type Db } from "@sitereel/db";
import {
  ManualCrawlInput,
  QUEUE_NAMES,
  Tone,
  jobUploadPrefix,
  userUploadPrefix,
  type CrawlJobDataP6,
  type JobStatus,
  type PlanJobDataP6,
  type Storyboard,
  type VoiceJobDataP6,
} from "@sitereel/shared";
import type { StorageClient } from "@sitereel/storage";
import type { AuthVerifier } from "../lib/auth.js";
import { removePendingJobs, uniqueJobId, type Queues } from "../lib/queue.js";
import { withJob, type Logger } from "../lib/logger.js";
import { loadOwnedJob, sendError, sendInvalidBody } from "../lib/http.js";
import { loadLatestStoryboard } from "../lib/storyboards.js";
import { IMAGE_TYPES, PresignRequest, UPLOAD_MAX_BYTES, isSafeSvg, randomKeyId, verifyUploadToken, type UploadSigner } from "../lib/uploads.js";

export interface JobActionRouteDeps {
  db: Db;
  queues: Queues;
  storage: StorageClient;
  storageDriver: "local" | "s3";
  verifyAuth: AuthVerifier;
  logger: Logger;
  uploads: UploadSigner;
  /** Secret for local-driver upload tokens (see lib/uploads.ts). */
  uploadTokenSecret: string;
}

const QuickChangeBody = z
  .object({
    voiceId: z.string().trim().min(1).max(64).optional(),
    tone: Tone.optional(),
    lengthSec: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]).optional(),
  })
  .strict()
  .refine((b) => b.voiceId !== undefined || b.tone !== undefined || b.lengthSec !== undefined, {
  message: "Choose a voice, tone or length to change",
});

const ResumeBody = ManualCrawlInput.extend({
  keys: z.array(z.string().min(1).max(300)).max(8).default([]),
  description: z.string().max(2000).optional(),
  features: z.array(z.string().max(200)).max(12).optional(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, { message: "Brand color must look like #7C5CFF" })
    .optional(),
}).refine((b) => b.keys.length > 0 || (b.description?.trim().length ?? 0) > 0, {
  message: "Upload at least one screenshot or describe your product",
});

/** Thrown inside a transaction to roll it back when the job's status moved under us. */
class StatusConflict extends Error {}

const TERMINAL_STATUSES: readonly JobStatus[] = ["done", "failed", "cancelled"];
const QUICK_CHANGE_STATUSES: readonly JobStatus[] = ["done", "failed"];

export function registerJobActionRoutes(app: FastifyInstance, deps: JobActionRouteDeps): void {
  const { db } = deps;

  /**
   * POST /api/jobs/:id/quick-change { voiceId?, tone?, lengthSec? } → 202 { version }
   *   voice only → new storyboard version (same scenes) and voice → render; free.
   *   tone/length → 1 credit (ledger `quick_change`), re-plan with overrides, auto-approve.
   */
  app.post<{ Params: { id: string } }>("/api/jobs/:id/quick-change", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const parsed = QuickChangeBody.safeParse(req.body);
    if (!parsed.success) return sendInvalidBody(reply, parsed.error);
    const job = await loadOwnedJob(db, reply, req.params.id, user.id);
    if (!job) return;
    const log = withJob(deps.logger, job.id, user.id);
    if (!QUICK_CHANGE_STATUSES.includes(job.status)) {
      return sendError(reply, 409, "not_done", "Quick changes are available once the video has finished.", { status: job.status });
    }
    const latest = await loadLatestStoryboard(db, job.id);
    if (!latest) return sendError(reply, 404, "storyboard_not_found", "This video doesn't have a script yet.");

    const change = parsed.data;
    const cost = computeQuickChangeCost(change);
    const nextVersion = latest.version + 1;
    const nextOptions = {
      ...job.options,
      ...(change.voiceId !== undefined ? { voiceId: change.voiceId } : {}),
      ...(change.tone !== undefined ? { tone: change.tone } : {}),
      ...(change.lengthSec !== undefined ? { lengthSec: change.lengthSec } : {}),
    };

    if (cost === 0) {
      // Voice only: same scenes, new version, straight to voice.
      const result = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(storyboards)
          .values({ jobId: job.id, version: nextVersion, json: { ...latest.json, version: nextVersion } as Storyboard, validation: latest.validation, source: latest.source })
          .returning({ id: storyboards.id });
        const moved = await tx
          .update(jobs)
          .set({ options: nextOptions, currentStoryboardId: row!.id, status: "voicing", errorCode: null, updatedAt: new Date() })
          .where(and(eq(jobs.id, job.id), eq(jobs.status, job.status)))
          .returning({ id: jobs.id });
        if (moved.length === 0) throw new StatusConflict();
        return row!.id;
      }).catch((err: unknown) => {
        if (err instanceof StatusConflict) return undefined;
        throw err;
      });
      if (!result) return sendError(reply, 409, "version_conflict", "The video changed while applying this change. Reload and try again.");

      const data: VoiceJobDataP6 = { jobId: job.id, storyboardVersion: nextVersion };
      try {
        await deps.queues.voice.add(QUEUE_NAMES.voice, data, { jobId: uniqueJobId(job.id, "quick-voice", nextVersion), attempts: 2, backoff: { type: "fixed", delay: 5_000 } });
      } catch (err) {
        log.error({ err }, "quick-change voice enqueue failed");
        await db.update(jobs).set({ status: "failed", errorCode: "enqueue_failed", updatedAt: new Date() }).where(eq(jobs.id, job.id));
        return sendError(reply, 503, "queue_unavailable", "Couldn't start the change. Try again in a moment.");
      }
      log.info({ version: nextVersion, voiceId: change.voiceId }, "quick change (voice) enqueued");
      return reply.code(202).send({ version: nextVersion });
    }

    // Tone / length: charge, then re-plan.
    const charged = await db.transaction(async (tx) => {
      const charge = await chargeCredits(tx, { userId: user.id, amount: cost, reason: "quick_change", jobId: job.id });
      if (!charge.ok) return charge;
      const moved = await tx
        .update(jobs)
        .set({ options: nextOptions, status: "planning", errorCode: null, updatedAt: new Date() })
        .where(and(eq(jobs.id, job.id), eq(jobs.status, job.status)))
        .returning({ id: jobs.id });
      if (moved.length === 0) throw new StatusConflict();
      return charge;
    }).catch((err: unknown) => {
      if (err instanceof StatusConflict) return { ok: false as const, error: "conflict" as const };
      throw err;
    });
    if (!charged.ok) {
      if (charged.error === "insufficient_credits") {
        return sendError(reply, 402, "insufficient_credits", `This change needs ${charged.required} credit; you have ${charged.available}.`, {
          required: charged.required,
          available: charged.available,
        });
      }
      if (charged.error === "user_not_found") return sendError(reply, 403, "user_not_provisioned", "Your account isn't set up yet.");
      return sendError(reply, 409, "version_conflict", "The video changed while applying this change. Reload and try again.");
    }

    const overrides = { ...(change.tone ? { tone: change.tone } : {}), ...(change.lengthSec ? { lengthSec: change.lengthSec } : {}), ...(change.voiceId ? { voiceId: change.voiceId } : {}) };
    const data: PlanJobDataP6 = { jobId: job.id, reason: "quick-change", overrides };
    try {
      await deps.queues.plan.add(QUEUE_NAMES.plan, data, { jobId: uniqueJobId(job.id, "quick-plan", nextVersion), attempts: 2, backoff: { type: "fixed", delay: 5_000 } });
    } catch (err) {
      log.error({ err }, "quick-change plan enqueue failed; refunding the change");
      await db.transaction(async (tx) => {
        await tx.update(users).set({ credits: sql`${users.credits} + ${cost}` }).where(eq(users.id, user.id));
        await tx.insert(creditLedger).values({ userId: user.id, delta: cost, reason: "quick_change_refund", jobId: job.id });
        await tx.update(jobs).set({ status: job.status, errorCode: job.errorCode, updatedAt: new Date() }).where(eq(jobs.id, job.id));
      });
      return sendError(reply, 503, "queue_unavailable", "Couldn't start the change. Try again in a moment.");
    }
    log.info({ version: nextVersion, overrides, cost }, "quick change (re-plan) enqueued");
    return reply.code(202).send({ version: nextVersion });
  });

  /** POST /api/jobs/:id/cancel → 202 { ok, refunded }. Refunds the full charge when no render completed. */
  app.post<{ Params: { id: string } }>("/api/jobs/:id/cancel", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const job = await loadOwnedJob(db, reply, req.params.id, user.id);
    if (!job) return;
    const log = withJob(deps.logger, job.id, user.id);
    if (TERMINAL_STATUSES.includes(job.status)) {
      return sendError(reply, 409, "not_cancellable", "This video has already finished.", { status: job.status });
    }
    const moved = await db
      .update(jobs)
      .set({ status: "cancelled", errorCode: "user_cancelled", updatedAt: new Date() })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, job.status)))
      .returning({ id: jobs.id });
    if (moved.length === 0) return sendError(reply, 409, "not_cancellable", "This video's state changed; reload and try again.");

    let removed = 0;
    try {
      removed = await removePendingJobs(deps.queues, job.id);
    } catch (err) {
      // Workers also check for `cancelled` before each stage, so this is best-effort.
      log.warn({ err }, "removing pending queue jobs failed");
    }

    const boardIds = db.select({ id: storyboards.id }).from(storyboards).where(eq(storyboards.jobId, job.id));
    const [anyRender] = await db.select({ id: renders.id }).from(renders).where(inArray(renders.storyboardId, boardIds)).limit(1);
    const { refunded } = anyRender ? { refunded: 0 } : await refundJobCredits(db, job.id);

    log.info({ removed, refunded }, "job cancelled");
    return reply.code(202).send({ ok: true, refunded });
  });

  /**
   * POST /api/uploads/presign { files } → { uploads }
   * Images for a video that doesn't exist yet (the create form's "your own screenshots"). Keys are
   * issued under the caller's own prefix; POST /api/jobs only accepts media keys from that prefix.
   */
  app.post("/api/uploads/presign", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const parsed = PresignRequest.safeParse(req.body);
    if (!parsed.success) return sendInvalidBody(reply, parsed.error);
    if (parsed.data.files.some((f) => f.type === "image/svg+xml")) {
      return sendError(reply, 400, "unsupported_type", "Upload screenshots or photos as PNG, JPEG or WebP.");
    }
    const uploads = await Promise.all(
      parsed.data.files.map((f) => deps.uploads.presign("assets", `${userUploadPrefix(user.id)}${randomKeyId()}.${IMAGE_TYPES[f.type]}`, f.type, f.size)),
    );
    return reply.send({ uploads });
  });

  /** POST /api/jobs/:id/uploads/presign { files } → { uploads } (W8; needs_input only). */
  app.post<{ Params: { id: string } }>("/api/jobs/:id/uploads/presign", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const parsed = PresignRequest.safeParse(req.body);
    if (!parsed.success) return sendInvalidBody(reply, parsed.error);
    const job = await loadOwnedJob(db, reply, req.params.id, user.id);
    if (!job) return;
    if (job.status !== "needs_input") {
      return sendError(reply, 409, "not_needs_input", "Uploads are only needed when we couldn't read the site.", { status: job.status });
    }
    const uploads = await Promise.all(
      parsed.data.files.map((f) => deps.uploads.presign("assets", `${jobUploadPrefix(job.id)}${randomKeyId()}.${IMAGE_TYPES[f.type]}`, f.type, f.size)),
    );
    return reply.send({ uploads });
  });

  /** POST /api/jobs/:id/resume { keys, description?, features?, brandColor? } → 202 (needs_input only). */
  app.post<{ Params: { id: string } }>("/api/jobs/:id/resume", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const parsed = ResumeBody.safeParse(req.body);
    if (!parsed.success) return sendInvalidBody(reply, parsed.error);
    const job = await loadOwnedJob(db, reply, req.params.id, user.id);
    if (!job) return;
    if (job.status !== "needs_input") {
      return sendError(reply, 409, "not_needs_input", "This video isn't waiting for input.", { status: job.status });
    }
    const prefix = jobUploadPrefix(job.id);
    const keyRe = /^[A-Za-z0-9_-]+\.(png|jpg|webp|svg)$/;
    const bad = parsed.data.keys.find((k) => !k.startsWith(prefix) || !keyRe.test(k.slice(prefix.length)));
    if (bad) return sendError(reply, 400, "invalid_key", "One of the uploaded files doesn't belong to this video.", { key: bad });

    const moved = await db
      .update(jobs)
      .set({ status: "queued", errorCode: null, updatedAt: new Date() })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, "needs_input")))
      .returning({ id: jobs.id });
    if (moved.length === 0) return sendError(reply, 409, "not_needs_input", "This video isn't waiting for input.");

    const manual = {
      keys: parsed.data.keys,
      ...(parsed.data.description ? { description: parsed.data.description.trim() } : {}),
      ...(parsed.data.features ? { features: parsed.data.features.map((f) => f.trim()).filter(Boolean) } : {}),
      ...(parsed.data.brandColor ? { brandColor: parsed.data.brandColor } : {}),
    };
    const data: CrawlJobDataP6 = { jobId: job.id, url: job.url, manual };
    try {
      await deps.queues.crawl.add(QUEUE_NAMES.crawl, data, { jobId: uniqueJobId(job.id, "resume"), attempts: 2, backoff: { type: "fixed", delay: 5_000 } });
    } catch (err) {
      withJob(deps.logger, job.id, user.id).error({ err }, "resume enqueue failed");
      await db.update(jobs).set({ status: "needs_input", updatedAt: new Date() }).where(eq(jobs.id, job.id));
      return sendError(reply, 503, "queue_unavailable", "Couldn't continue right now. Try again in a moment.");
    }
    return reply.code(202).send({ ok: true });
  });

  // Local storage driver only: the presigned "URL" is this endpoint + an HMAC-signed grant.
  if (deps.storageDriver === "local") {
    app.register(async (scope) => {
      for (const type of Object.keys(IMAGE_TYPES)) {
        scope.addContentTypeParser(type, { parseAs: "buffer", bodyLimit: UPLOAD_MAX_BYTES }, (_req, body, done) => done(null, body));
      }
      scope.put<{ Params: { token: string } }>("/api/uploads/local/:token", { bodyLimit: UPLOAD_MAX_BYTES }, async (req, reply) => {
        const grant = verifyUploadToken(req.params.token, deps.uploadTokenSecret);
        if (!grant) return sendError(reply, 403, "invalid_upload_token", "This upload link is invalid or expired.");
        const contentType = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
        if (contentType !== grant.type) return sendError(reply, 415, "content_type_mismatch", `Expected ${grant.type}.`);
        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) return sendError(reply, 400, "empty_body", "The file is empty.");
        if (body.length > grant.size || body.length > UPLOAD_MAX_BYTES) return sendError(reply, 413, "too_large", "The file is larger than declared.");
        if (grant.type === "image/svg+xml" && !isSafeSvg(body)) return sendError(reply, 400, "unsafe_svg", "SVGs with scripts or embedded content aren't allowed.");
        await deps.storage.putObject(grant.bucket, grant.key, body, grant.type);
        return reply.send({ ok: true, key: grant.key });
      });
    });
  }
}
