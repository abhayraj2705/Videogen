import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { crawls, jobs, ratings, shares, storyboards, type Db } from "@sitereel/db";
import type { StorageClient } from "@sitereel/storage";
import { parseFormatSlug, type AspectFormat } from "@sitereel/shared";
import type { AuthVerifier } from "../lib/auth.js";
import { withJob, type Logger } from "../lib/logger.js";
import { generateShareId, isValidShareId } from "../lib/share-id.js";
import { MEDIA_KINDS, serveMedia } from "../lib/media.js";
import { loadRender, loadRendersForStoryboard, toRenderInfo } from "./renders.js";

export interface ShareRouteDeps {
  db: Db;
  storage: StorageClient;
  storageDriver: "local" | "s3";
  verifyAuth: AuthVerifier;
  logger: Logger;
  /** Public web origin; share URLs are `${webOrigin}/v/${shareId}`. */
  webOrigin: string;
}

const RatingBody = z.object({
  thumbs: z.enum(["up", "down"]),
  reason: z.string().trim().max(1000).optional(),
});

/** Loads the active share + its (done) job, or undefined if revoked/missing/not ready. */
async function loadActiveShare(db: Db, shareId: string) {
  const [row] = await db
    .select({ share: shares, job: jobs })
    .from(shares)
    .innerJoin(jobs, eq(jobs.id, shares.jobId))
    .where(and(eq(shares.shareId, shareId), isNull(shares.revokedAt)))
    .limit(1);
  if (!row || row.job.status !== "done" || !row.job.currentStoryboardId) return undefined;
  return row as typeof row & { job: typeof row.job & { currentStoryboardId: string } };
}

/**
 * W9 public sharing + ratings.
 *
 *   POST   /api/jobs/:id/share   owner, job must be done → 200/201 { shareId, url } (idempotent)
 *   DELETE /api/jobs/:id/share   owner → 204
 *   GET    /api/share/:shareId   PUBLIC → PublicShare
 *   GET    /api/share/:shareId/renders/:format/{video|poster|captions}[?download=1]   PUBLIC media
 *   POST   /api/jobs/:id/rating  owner, { thumbs: "up"|"down", reason? } → { ok: true }
 *
 * Public media is scoped to the share slug rather than signed tokens: the
 * slug is already an unguessable bearer secret, and revoking the share kills
 * every media URL immediately (a signed token would live until it expired).
 */
export function registerShareRoutes(app: FastifyInstance, deps: ShareRouteDeps): void {
  const { db } = deps;

  app.post<{ Params: { id: string } }>("/api/jobs/:id/share", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const log = withJob(deps.logger, req.params.id, user.id);

    const [job] = await db.select().from(jobs).where(eq(jobs.id, req.params.id)).limit(1);
    if (!job || job.userId !== user.id) return reply.code(404).send({ error: "not_found" });
    if (job.status !== "done") return reply.code(409).send({ error: "job_not_done", status: job.status });

    const [existing] = await db
      .select()
      .from(shares)
      .where(and(eq(shares.jobId, job.id), isNull(shares.revokedAt)))
      .orderBy(desc(shares.createdAt))
      .limit(1);
    if (existing) {
      return reply.send({ shareId: existing.shareId, url: `${deps.webOrigin}/v/${existing.shareId}` });
    }

    // Two failure modes, both unique violations: a concurrent POST won the
    // shares_one_active_per_job race (return its share), or a share_id
    // collision (62^12 — astronomically unlikely; just retry).
    for (let attempt = 0; attempt < 3; attempt++) {
      const shareId = generateShareId();
      try {
        await db.transaction(async (tx) => {
          await tx.insert(shares).values({ shareId, jobId: job.id, createdBy: user.id });
          await tx.update(jobs).set({ shareId, updatedAt: new Date() }).where(eq(jobs.id, job.id));
        });
        log.info({ shareId }, "share link created");
        return reply.code(201).send({ shareId, url: `${deps.webOrigin}/v/${shareId}` });
      } catch (err) {
        const [winner] = await db
          .select({ shareId: shares.shareId })
          .from(shares)
          .where(and(eq(shares.jobId, job.id), isNull(shares.revokedAt)))
          .limit(1);
        if (winner) return reply.send({ shareId: winner.shareId, url: `${deps.webOrigin}/v/${winner.shareId}` });
        log.warn({ err, attempt }, "share insert failed, retrying");
      }
    }
    return reply.code(500).send({ error: "share_create_failed" });
  });

  app.delete<{ Params: { id: string } }>("/api/jobs/:id/share", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;

    const [job] = await db.select().from(jobs).where(eq(jobs.id, req.params.id)).limit(1);
    if (!job || job.userId !== user.id) return reply.code(404).send({ error: "not_found" });

    await db.transaction(async (tx) => {
      await tx
        .update(shares)
        .set({ revokedAt: new Date() })
        .where(and(eq(shares.jobId, job.id), isNull(shares.revokedAt)));
      await tx.update(jobs).set({ shareId: null, updatedAt: new Date() }).where(eq(jobs.id, job.id));
    });
    withJob(deps.logger, job.id, user.id).info("share link revoked");
    return reply.code(204).send();
  });

  app.get<{ Params: { shareId: string } }>("/api/share/:shareId", async (req, reply) => {
    if (!isValidShareId(req.params.shareId)) return reply.code(404).send({ error: "not_found" });
    const row = await loadActiveShare(db, req.params.shareId);
    if (!row) return reply.code(404).send({ error: "not_found" });

    const [crawl] = await db
      .select({ siteBrief: crawls.siteBrief })
      .from(crawls)
      .where(eq(crawls.jobId, row.job.id))
      .orderBy(desc(crawls.createdAt))
      .limit(1);
    const [storyboard] = await db
      .select({ json: storyboards.json })
      .from(storyboards)
      .where(eq(storyboards.id, row.job.currentStoryboardId))
      .limit(1);
    const renderRows = await loadRendersForStoryboard(db, row.job.currentStoryboardId);

    reply.header("Cache-Control", "public, max-age=60");
    return reply.send({
      shareId: row.share.shareId,
      title: crawl?.siteBrief.productName ?? row.job.domain,
      caption: storyboard?.json.shareCaption ?? null,
      sourceUrl: row.job.url,
      createdAt: row.share.createdAt.toISOString(),
      renders: renderRows.map((r) => toRenderInfo(r, `/api/share/${row.share.shareId}/renders`)),
    });
  });

  for (const { kind, column, ext } of MEDIA_KINDS) {
    app.get<{ Params: { shareId: string; format: string }; Querystring: { download?: string } }>(
      `/api/share/:shareId/renders/:format/${kind}`,
      async (req, reply) => {
        let format: AspectFormat;
        try {
          format = parseFormatSlug(req.params.format);
        } catch {
          return reply.code(400).send({ error: "invalid_format" });
        }
        if (!isValidShareId(req.params.shareId)) return reply.code(404).send({ error: "not_found" });
        const row = await loadActiveShare(db, req.params.shareId);
        if (!row) return reply.code(404).send({ error: "not_found" });
        const renderRow = await loadRender(db, row.job.currentStoryboardId, format);
        if (!renderRow) return reply.code(404).send({ error: "render_not_found" });

        return serveMedia(reply, {
          storage: deps.storage,
          storageDriver: deps.storageDriver,
          storageKey: renderRow[column],
          kind,
          rangeHeader: req.headers.range,
          downloadFilename: req.query.download === "1" ? `${row.job.domain}-${req.params.format}.${ext}` : undefined,
          // Short public cache so a revoke takes effect within a minute at CDNs.
          cacheControl: "public, max-age=60",
        });
      },
    );
  }

  app.post<{ Params: { id: string } }>("/api/jobs/:id/rating", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;

    const parsed = RatingBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });

    const [job] = await db.select({ id: jobs.id, userId: jobs.userId }).from(jobs).where(eq(jobs.id, req.params.id)).limit(1);
    if (!job || job.userId !== user.id) return reply.code(404).send({ error: "not_found" });

    const values = { jobId: job.id, userId: user.id, thumbs: parsed.data.thumbs, reason: parsed.data.reason || null };
    await db
      .insert(ratings)
      .values(values)
      .onConflictDoUpdate({
        target: [ratings.jobId, ratings.userId],
        set: { thumbs: values.thumbs, reason: values.reason, createdAt: new Date() },
      });
    withJob(deps.logger, job.id, user.id).info({ thumbs: values.thumbs }, "video rated");
    return reply.send({ ok: true });
  });
}
