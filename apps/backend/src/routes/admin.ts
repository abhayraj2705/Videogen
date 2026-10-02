import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, asc, desc, eq, ilike, inArray, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { jobs, loadOpsDbMetrics, renders, stageRuns, storyboards, users, type Db } from "@sitereel/db";
import {
  DEFAULT_ALERT_THRESHOLDS,
  JobStatus,
  PHASE6_QUEUE_NAMES,
  RerunStage,
  collectQueueMetrics,
  evaluateAlerts,
  parseFormatSlug,
  type AlertThresholds,
  type AspectFormat,
  type JobEvent,
  type OpsMetrics,
  type QueueProbe,
  type RerunFromStageJobData,
} from "@sitereel/shared";
import type { StorageClient } from "@sitereel/storage";
import type { AuthVerifier, AuthedUser } from "../lib/auth.js";
import { uniqueJobId, type Queues } from "../lib/queue.js";
import type { Logger } from "../lib/logger.js";
import { isUuid, sendError, sendInvalidBody } from "../lib/http.js";
import { serveAsset } from "../lib/assets.js";
import { MEDIA_KINDS, localPathFromFileUrl, serveMedia } from "../lib/media.js";
import { loadLatestCrawl, publicSource, toValidationView } from "../lib/storyboards.js";
import { toRenderInfo } from "./renders.js";

export interface AdminRouteDeps {
  db: Db;
  queues: Queues;
  storage: StorageClient;
  storageDriver: "local" | "s3";
  verifyAuth: AuthVerifier;
  logger: Logger;
  /** Replay buffer reader (JobEventBus.readReplay); optional so tests can omit Redis. */
  readReplay?: (jobId: string) => Promise<{ event: JobEvent }[]>;
  /** Alert thresholds shown alongside the ops metrics (the worker's alert check uses the same env). */
  alertThresholds?: Partial<AlertThresholds>;
}

const ListQuery = z.object({
  status: JobStatus.optional(),
  q: z.string().trim().max(200).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const RerunBody = z.object({ fromStage: RerunStage });


function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | undefined {
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const createdAt = iso ? new Date(iso) : undefined;
  if (!createdAt || Number.isNaN(createdAt.getTime()) || !id || !isUuid(id)) return undefined;
  return { createdAt, id };
}

/**
 * W13 admin (staff only — users.role = 'admin', checked server-side on every request).
 *   GET  /api/admin/jobs?status=&q=&cursor=     → { jobs: AdminJobRow[], nextCursor }
 *   GET  /api/admin/jobs/:id                    → inspector payload
 *   POST /api/admin/jobs/:id/rerun              { fromStage } → 202
 *   GET  /api/admin/benchmark                   → { runs }
 *   GET  /api/admin/ops                         → { metrics, alerts } (Phase 7: success rate, queue wait, cost)
 *   GET  /api/admin/jobs/:id/assets?key=        crawl screenshots etc. (media; accepts ?token=)
 *   GET  /api/admin/jobs/:id/renders/:format/{video|poster|captions}
 */
export function registerAdminRoutes(app: FastifyInstance, deps: AdminRouteDeps): void {
  const { db } = deps;

  async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<AuthedUser | undefined> {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return undefined;
    const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, user.id)).limit(1);
    if (row?.role !== "admin") {
      sendError(reply, 403, "forbidden", "Admins only.");
      return undefined;
    }
    return user;
  }

  app.get("/api/admin/jobs", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) return sendInvalidBody(reply, parsed.error);
    const { status, q, cursor, limit } = parsed.data;

    const where: SQL[] = [];
    if (status) where.push(eq(jobs.status, status));
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const clauses = [ilike(jobs.url, like), ilike(users.email, like)];
      if (isUuid(q)) clauses.push(eq(jobs.id, q), eq(jobs.userId, q));
      where.push(or(...clauses)!);
    }
    if (cursor) {
      const c = decodeCursor(cursor);
      if (!c) return sendError(reply, 400, "invalid_cursor", "Invalid cursor.");
      where.push(or(lt(jobs.createdAt, c.createdAt), and(eq(jobs.createdAt, c.createdAt), lt(jobs.id, c.id)))!);
    }

    const rows = await db
      .select({ id: jobs.id, url: jobs.url, status: jobs.status, createdAt: jobs.createdAt, errorCode: jobs.errorCode, userEmail: users.email })
      .from(jobs)
      .innerJoin(users, eq(users.id, jobs.userId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(jobs.createdAt), desc(jobs.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);

    const ids = page.map((r) => r.id);
    const failedRuns = ids.length
      ? await db
          .select({ jobId: stageRuns.jobId, stage: stageRuns.stage, startedAt: stageRuns.startedAt })
          .from(stageRuns)
          .where(and(inArray(stageRuns.jobId, ids), eq(stageRuns.status, "failed")))
          .orderBy(asc(stageRuns.startedAt))
      : [];
    const failedStage = new Map<string, string>();
    for (const run of failedRuns) failedStage.set(run.jobId, run.stage); // latest failure wins

    const last = page[page.length - 1];
    return reply.send({
      jobs: page.map((r) => ({
        id: r.id,
        url: r.url,
        status: r.status,
        userEmail: r.userEmail,
        createdAt: r.createdAt.toISOString(),
        ...(failedStage.has(r.id) ? { failedStage: failedStage.get(r.id) } : {}),
        ...(r.errorCode ? { errorCode: r.errorCode } : {}),
      })),
      nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
    });
  });

  app.get<{ Params: { id: string } }>("/api/admin/jobs/:id", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    if (!isUuid(req.params.id)) return sendError(reply, 404, "not_found", "Job not found.");
    const [job] = await db.select().from(jobs).where(eq(jobs.id, req.params.id)).limit(1);
    if (!job) return sendError(reply, 404, "not_found", "Job not found.");
    const [owner] = await db.select({ id: users.id, email: users.email, plan: users.plan }).from(users).where(eq(users.id, job.userId)).limit(1);

    const [runs, crawl, boards] = await Promise.all([
      db.select().from(stageRuns).where(eq(stageRuns.jobId, job.id)).orderBy(asc(stageRuns.startedAt)),
      loadLatestCrawl(db, job.id),
      db.select().from(storyboards).where(eq(storyboards.jobId, job.id)).orderBy(asc(storyboards.version)),
    ]);
    const renderRows = boards.length
      ? await db.select().from(renders).where(inArray(renders.storyboardId, boards.map((b) => b.id)))
      : [];
    const currentRenders = renderRows.filter((r) => r.storyboardId === job.currentStoryboardId);

    let events: JobEvent[] = [];
    if (deps.readReplay) {
      try {
        events = (await deps.readReplay(job.id)).map((e) => e.event);
      } catch (err) {
        deps.logger.warn({ err, jobId: job.id }, "admin: replay buffer read failed");
      }
    }

    const assetUrl = (key: string) => `/api/admin/jobs/${job.id}/assets?key=${encodeURIComponent(key)}`;
    return reply.send({
      job,
      user: owner ?? null,
      stageRuns: runs.map((r) => ({
        stage: r.stage,
        attempt: r.attempt,
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.endedAt?.toISOString() ?? null,
        durationMs: r.endedAt ? r.endedAt.getTime() - r.startedAt.getTime() : null,
        costUsd: Number(r.costUsd ?? 0),
        ...(r.error ? { error: r.error } : {}),
        inputsHash: r.inputsHash,
        meta: { inputHash: r.inputsHash, ...((r.outputs as Record<string, unknown> | null) ?? {}) },
      })),
      crawl: crawl
        ? {
            pages: crawl.pages,
            facts: crawl.facts,
            brand: crawl.brand,
            screenshots: crawl.pages.flatMap((p) => [p.screenshotKey, ...((p as { sectionScreenshotKeys?: string[] }).sectionScreenshotKeys ?? [])]).filter(Boolean).map(assetUrl),
          }
        : null,
      storyboards: boards.map((b) => ({
        version: b.version,
        source: publicSource(b.source),
        createdAt: b.createdAt.toISOString(),
        validation: b.validation ? toValidationView(b.validation) : null,
      })),
      renders: currentRenders.map((r) => ({ ...toRenderInfo(r, `/api/admin/jobs/${job.id}/renders`), qa: r.qa ?? null })),
      events,
      logsHint: `Search logs for jobId="${job.id}" (every backend/worker line for this job carries it).`,
    });
  });

  app.post<{ Params: { id: string } }>("/api/admin/jobs/:id/rerun", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const parsed = RerunBody.safeParse(req.body);
    if (!parsed.success) return sendInvalidBody(reply, parsed.error);
    if (!isUuid(req.params.id)) return sendError(reply, 404, "not_found", "Job not found.");
    const [job] = await db.select().from(jobs).where(eq(jobs.id, req.params.id)).limit(1);
    if (!job) return sendError(reply, 404, "not_found", "Job not found.");
    const stage = parsed.data.fromStage;
    if (stage !== "crawl" && stage !== "plan" && !job.currentStoryboardId) {
      return sendError(reply, 409, "no_storyboard", `Can't re-run from ${stage}: the job has no approved storyboard.`);
    }

    // The worker's rerun-from-stage processor invalidates this + downstream stage runs,
    // resets status/errorCode and enqueues the stage with force (apps/worker rerun-processor).
    const data: RerunFromStageJobData = { jobId: job.id, fromStage: stage };
    try {
      await deps.queues.rerunFromStage.add(PHASE6_QUEUE_NAMES.rerunFromStage, data, {
        jobId: uniqueJobId(job.id, "rerun", stage),
        attempts: 2,
        backoff: { type: "fixed", delay: 5_000 },
      });
    } catch (err) {
      deps.logger.error({ err, jobId: job.id, stage }, "admin rerun enqueue failed");
      return sendError(reply, 503, "queue_unavailable", "Couldn't enqueue the re-run.");
    }
    deps.logger.info({ jobId: job.id, stage, adminId: admin.id }, "admin re-run enqueued");
    return reply.code(202).send({ ok: true, fromStage: stage });
  });

  app.get<{ Params: { id: string }; Querystring: { key?: string } }>("/api/admin/jobs/:id/assets", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const key = req.query.key ?? "";
    if (!isUuid(req.params.id) || !key.startsWith(`jobs/${req.params.id}/`) || key.includes("..")) {
      return sendError(reply, 404, "not_found", "Asset not found.");
    }
    return serveAsset(reply, { storage: deps.storage, storageDriver: deps.storageDriver, bucket: "assets", key, rangeHeader: req.headers.range, cacheControl: "private, max-age=60" });
  });

  for (const { kind, column } of MEDIA_KINDS) {
    app.get<{ Params: { id: string; format: string } }>(`/api/admin/jobs/:id/renders/:format/${kind}`, async (req, reply) => {
      if (!(await requireAdmin(req, reply))) return;
      let format: AspectFormat;
      try {
        format = parseFormatSlug(req.params.format);
      } catch {
        return sendError(reply, 400, "invalid_format", "Unknown format.");
      }
      if (!isUuid(req.params.id)) return sendError(reply, 404, "not_found", "Job not found.");
      const [job] = await db.select({ currentStoryboardId: jobs.currentStoryboardId }).from(jobs).where(eq(jobs.id, req.params.id)).limit(1);
      if (!job?.currentStoryboardId) return sendError(reply, 404, "not_found", "Render not found.");
      const [row] = await db
        .select()
        .from(renders)
        .where(and(eq(renders.storyboardId, job.currentStoryboardId), eq(renders.format, format)))
        .limit(1);
      if (!row) return sendError(reply, 404, "render_not_found", "Render not found.");
      return serveMedia(reply, { storage: deps.storage, storageDriver: deps.storageDriver, storageKey: row[column], kind, rangeHeader: req.headers.range, cacheControl: "private, max-age=60" });
    });
  }

  /**
   * Phase 7 ops view: the same metrics and alert rules the worker's scheduled
   * check uses, computed on demand — the first thing the runbooks say to open.
   */
  app.get("/api/admin/ops", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const q = deps.queues;
    // Test fakes don't implement the BullMQ read methods; real queues do.
    const probes = [q.crawl, q.plan, q.voice, q.build, q.qa, q.render].filter(
      (queue): queue is typeof queue & QueueProbe => typeof (queue as Partial<QueueProbe>).getWaitingCount === "function",
    );
    const [dbMetrics, queueMetrics] = await Promise.all([loadOpsDbMetrics(db), collectQueueMetrics(probes)]);
    const metrics: OpsMetrics = { ...dbMetrics, ...queueMetrics };
    return reply.send({ metrics, alerts: evaluateAlerts(metrics, { ...DEFAULT_ALERT_THRESHOLDS, ...deps.alertThresholds }) });
  });

  /**
   * Benchmark reports are uploaded to the assets bucket under benchmark/latest/.
   * StorageClient has no list operation, so the uploader also writes
   * benchmark/latest/index.json (`string[]` of file names, or `{ files }`); with
   * the local driver the directory is listed directly as a fallback.
   */
  app.get("/api/admin/benchmark", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const prefix = "benchmark/latest/";
    let names: string[] = [];
    try {
      const index = JSON.parse((await deps.storage.getObject("assets", `${prefix}index.json`)).toString("utf8")) as unknown;
      const list = Array.isArray(index) ? index : (index as { files?: unknown })?.files;
      if (Array.isArray(list)) names = list.filter((n): n is string => typeof n === "string");
    } catch {
      if (deps.storageDriver === "local") {
        const dir = localPathFromFileUrl(await deps.storage.presignDownload("assets", `${prefix}index.json`));
        if (dir) names = await fs.readdir(path.dirname(dir)).catch(() => []);
      }
    }
    names = names.filter((n) => n.endsWith(".json") && n !== "index.json" && !n.includes("/") && !n.includes(".."));

    const runs = [];
    for (const name of names.sort()) {
      try {
        const report = JSON.parse((await deps.storage.getObject("assets", `${prefix}${name}`)).toString("utf8")) as Record<string, unknown>;
        const createdAt = report.createdAt ?? report.generatedAt ?? report.finishedAt ?? null;
        const summary = report.summary ?? Object.fromEntries(Object.entries(report).filter(([, v]) => typeof v !== "object" || v === null));
        runs.push({ name: name.replace(/\.json$/, ""), createdAt, summary });
      } catch (err) {
        deps.logger.warn({ err, name }, "admin: unreadable benchmark report");
      }
    }
    runs.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
    return reply.send({ runs });
  });
}
