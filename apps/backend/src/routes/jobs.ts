import type { FastifyInstance } from "fastify";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { brandKits, createJobWithCharge, jobs, refundJobCredits, type Db } from "@sitereel/db";
import { CreateJobRequest, QUEUE_NAMES, SSE_EVENT_NAMES, parseLastEventId, type CrawlJobData } from "@sitereel/shared";
import type { AuthVerifier } from "../lib/auth.js";
import type { Queues } from "../lib/queue.js";
import type { JobEventBus } from "../lib/events.js";
import type { RateLimiters } from "../lib/rate-limit.js";
import { withJob, type Logger } from "../lib/logger.js";
import { ReplayGate, formatSseFrame } from "../lib/sse.js";

export interface JobRouteDeps {
  db: Db;
  queues: Queues;
  events: JobEventBus;
  verifyAuth: AuthVerifier;
  limiters: RateLimiters;
  logger: Logger;
  maxActiveJobsPerUser: number;
}

/** Phase 6: `brandKitId` may be sent top-level or inside `options` (JobOptions already has it). */
const CreateJobBody = CreateJobRequest.extend({ brandKitId: z.string().uuid().optional() });

const SSE_HEARTBEAT_MS = 15_000;
const SSE_RETRY_MS = 3_000;

function domainOf(url: string): string {
  return new URL(url).hostname;
}

export function registerJobRoutes(app: FastifyInstance, deps: JobRouteDeps): void {
  const { db, queues, events, verifyAuth, limiters } = deps;

  /**
   * POST /api/jobs → 201 Job
   *   400 invalid_body | invalid_brand_kit (brandKitId not owned by the caller)
   *   402 { error: "insufficient_credits", required, available }
   *   429 { error: "too_many_active_jobs", active, max }
   *   429 { error: "job_create_rate_limited" | "domain_throttled", retryAfterSec }
   */
  app.post("/api/jobs", async (req, reply) => {
    const user = await verifyAuth(req, reply);
    if (!user) return;

    const parsed = CreateJobBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", message: "Invalid request body", issues: parsed.error.issues });
    }
    const { url } = parsed.data;
    const brandKitId = parsed.data.brandKitId ?? parsed.data.options.brandKitId;
    if (brandKitId) {
      const [kit] = await db
        .select({ id: brandKits.id })
        .from(brandKits)
        .where(and(eq(brandKits.id, brandKitId), eq(brandKits.userId, user.id)))
        .limit(1);
      if (!kit) return reply.code(400).send({ error: "invalid_brand_kit", message: "That brand kit doesn't exist." });
    }
    const options = { ...parsed.data.options, ...(brandKitId ? { brandKitId } : {}) };

    if (!(await limiters.checkJobCreate(req, reply))) return reply;
    if (!(await limiters.checkDomain(req, reply))) return reply;

    const result = await createJobWithCharge(db, {
      userId: user.id,
      url,
      domain: domainOf(url),
      options,
      brandKitId: brandKitId ?? null,
      maxActiveJobs: deps.maxActiveJobsPerUser,
    });

    if (!result.ok) {
      switch (result.error) {
        case "user_not_found":
          return reply.code(403).send({ error: "user_not_provisioned", message: "Your account isn't set up yet — try signing out and back in." });
        case "insufficient_credits":
          return reply.code(402).send({
            error: "insufficient_credits",
            message: `This video needs ${result.required} credit${result.required === 1 ? "" : "s"}; you have ${result.available}.`,
            required: result.required,
            available: result.available,
          });
        case "too_many_active_jobs":
          return reply.code(429).send({
            error: "too_many_active_jobs",
            message: `You already have ${result.active} videos in progress (max ${result.max}). Wait for one to finish.`,
            active: result.active,
            max: result.max,
          });
      }
    }

    const row = result.job;
    const log = withJob(deps.logger, row.id, user.id);

    const crawlData: CrawlJobData = { jobId: row.id, url: row.url };
    try {
      // §4.5: crawl queue retries 2x with 10s backoff before landing in needs_input.
      await queues.crawl.add(QUEUE_NAMES.crawl, crawlData, {
        jobId: row.id,
        attempts: 3,
        backoff: { type: "fixed", delay: 10_000 },
      });
    } catch (err) {
      // System failure before any work happened: fail the job and give the credits back.
      log.error({ err }, "enqueue failed; refunding");
      await db.update(jobs).set({ status: "failed", errorCode: "enqueue_failed", updatedAt: new Date() }).where(eq(jobs.id, row.id));
      await refundJobCredits(db, row.id).catch((refundErr) => log.error({ err: refundErr }, "refund after enqueue failure failed"));
      return reply.code(503).send({ error: "queue_unavailable" });
    }

    log.info({ creditsCharged: row.creditsCharged, creditsRemaining: result.creditsRemaining }, "job created and enqueued");
    return reply.code(201).send(row);
  });

  app.get("/api/jobs", async (req, reply) => {
    const user = await verifyAuth(req, reply);
    if (!user) return;

    const rows = await db.select().from(jobs).where(eq(jobs.userId, user.id)).orderBy(desc(jobs.createdAt)).limit(50);
    return reply.send(rows);
  });

  app.get<{ Params: { id: string } }>("/api/jobs/:id", async (req, reply) => {
    const user = await verifyAuth(req, reply);
    if (!user) return;

    const [row] = await db.select().from(jobs).where(eq(jobs.id, req.params.id)).limit(1);
    if (!row || row.userId !== user.id) return reply.code(404).send({ error: "not_found" });
    return reply.send(row);
  });

  // POST /api/jobs/:id/approve lives in routes/storyboards.ts (Phase 6: optional { version }).

  /**
   * GET /api/jobs/:id/events — SSE.
   *   frames: `event: hello` (no id) then `id: <n>\nevent: job-event\ndata: <JobEvent>`; `: ping` heartbeats.
   *   resume: `Last-Event-ID: <n>` header or `?lastEventId=<n>` → replays buffered events with id > n.
   */
  app.get<{ Params: { id: string }; Querystring: { lastEventId?: string } }>("/api/jobs/:id/events", async (req, reply) => {
    const user = await verifyAuth(req, reply);
    if (!user) return;

    const [row] = await db.select().from(jobs).where(eq(jobs.id, req.params.id)).limit(1);
    if (!row || row.userId !== user.id) return reply.code(404).send({ error: "not_found" });

    const log = withJob(deps.logger, row.id, user.id);
    const lastEventId = parseLastEventId(req.headers["last-event-id"] ?? req.query.lastEventId);

    reply.hijack();
    const raw = reply.raw;
    // Hijacked replies bypass Fastify's header pipeline, so carry over what
    // the CORS/helmet/rate-limit hooks already set.
    raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string | number | string[]>),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let closed = false;
    const write = (chunk: string) => {
      if (!closed) raw.write(chunk);
    };

    write(formatSseFrame({ retryMs: SSE_RETRY_MS, event: SSE_EVENT_NAMES.hello, data: { jobId: row.id, resumeFrom: lastEventId ?? null } }));

    const gate = new ReplayGate((envelope) => write(formatSseFrame({ id: envelope.id, event: SSE_EVENT_NAMES.jobEvent, data: envelope.event })), lastEventId);
    // Subscribe BEFORE reading the replay buffer so nothing published in between is lost; the gate dedupes the overlap.
    const unsubscribe = events.onJobEvent(row.id, (envelope) => gate.live(envelope));
    const heartbeat = setInterval(() => write(`: ping\n\n`), SSE_HEARTBEAT_MS);

    req.raw.on("close", () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      log.debug({ lastSentId: gate.lastId }, "sse client disconnected");
    });

    try {
      gate.replay(await events.readReplay(row.id));
    } catch (err) {
      log.warn({ err }, "sse replay read failed; continuing live-only");
      gate.replay([]);
    }
    log.debug({ lastEventId, replayedThrough: gate.lastId }, "sse client connected");
  });
}
