import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { jobs, renders, type Db } from "@sitereel/db";
import type { StorageClient } from "@sitereel/storage";
import { formatSlug, parseFormatSlug, type AspectFormat } from "@sitereel/shared";
import type { AuthVerifier } from "../lib/auth.js";
import { MEDIA_KINDS, serveMedia } from "../lib/media.js";

export interface RenderRouteDeps {
  db: Db;
  storage: StorageClient;
  storageDriver: "local" | "s3";
  verifyAuth: AuthVerifier;
}

/** Wire shape — mirrors `RenderInfo` in apps/web/lib/api/client.ts. URLs are relative to the API base. */
export interface RenderInfo {
  format: AspectFormat;
  frames: number;
  durationMs: number;
  bytes: number;
  videoUrl: string;
  posterUrl: string;
  captionsUrl: string;
}

type RenderRow = typeof renders.$inferSelect;

export function toRenderInfo(row: RenderRow, mediaBase: string): RenderInfo {
  const base = `${mediaBase}/${formatSlug(row.format)}`;
  return {
    format: row.format,
    frames: row.frames,
    durationMs: row.durationMs,
    bytes: row.bytes,
    videoUrl: `${base}/video`,
    posterUrl: `${base}/poster`,
    captionsUrl: `${base}/captions`,
  };
}

const FORMAT_ORDER: Record<AspectFormat, number> = { "16:9": 0, "9:16": 1, "1:1": 2 };

export async function loadRendersForStoryboard(db: Db, storyboardId: string): Promise<RenderRow[]> {
  const rows = await db.select().from(renders).where(eq(renders.storyboardId, storyboardId));
  return rows.sort((a, b) => FORMAT_ORDER[a.format] - FORMAT_ORDER[b.format]);
}

export async function loadRender(db: Db, storyboardId: string, format: AspectFormat): Promise<RenderRow | undefined> {
  const [row] = await db
    .select()
    .from(renders)
    .where(and(eq(renders.storyboardId, storyboardId), eq(renders.format, format)))
    .limit(1);
  return row;
}

/**
 * §4.3 "GET /api/renders/:id/download" — scoped under /api/jobs/:id/renders
 * since renders are keyed by (storyboardId, format), not a flat id.
 *
 *   GET /api/jobs/:id/renders                          → RenderInfo[]
 *   GET /api/jobs/:id/renders/:format/{video|poster|captions}[?download=1][&token=…]
 *
 * Media routes accept `?token=` (see lib/auth.ts). Local storage streams with
 * HTTP Range support; S3/R2 redirects to a 5-minute presigned URL.
 */
export function registerRenderRoutes(app: FastifyInstance, deps: RenderRouteDeps): void {
  app.get<{ Params: { id: string } }>("/api/jobs/:id/renders", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;

    const [jobRow] = await deps.db.select().from(jobs).where(eq(jobs.id, req.params.id)).limit(1);
    if (!jobRow || jobRow.userId !== user.id) return reply.code(404).send({ error: "not_found" });
    if (!jobRow.currentStoryboardId) return reply.send([]);

    const rows = await loadRendersForStoryboard(deps.db, jobRow.currentStoryboardId);
    return reply.send(rows.map((r) => toRenderInfo(r, `/api/jobs/${jobRow.id}/renders`)));
  });

  for (const { kind, column, ext } of MEDIA_KINDS) {
    app.get<{ Params: { id: string; format: string }; Querystring: { download?: string } }>(
      `/api/jobs/:id/renders/:format/${kind}`,
      async (req, reply) => {
        let format: AspectFormat;
        try {
          format = parseFormatSlug(req.params.format);
        } catch {
          return reply.code(400).send({ error: "invalid_format" });
        }

        const user = await deps.verifyAuth(req, reply);
        if (!user) return;

        const [jobRow] = await deps.db.select().from(jobs).where(eq(jobs.id, req.params.id)).limit(1);
        if (!jobRow || jobRow.userId !== user.id || !jobRow.currentStoryboardId) {
          return reply.code(404).send({ error: "not_found" });
        }
        const renderRow = await loadRender(deps.db, jobRow.currentStoryboardId, format);
        if (!renderRow) return reply.code(404).send({ error: "render_not_found" });

        // Same URL backs <video>/<img>/<track> (inline) and the explicit
        // Download button — cross-origin `<a download>` is ignored by Chrome,
        // so the caller opts into Content-Disposition via ?download=1.
        return serveMedia(reply, {
          storage: deps.storage,
          storageDriver: deps.storageDriver,
          storageKey: renderRow[column],
          kind,
          rangeHeader: req.headers.range,
          downloadFilename: req.query.download === "1" ? `${jobRow.id}-${req.params.format}.${ext}` : undefined,
          cacheControl: "private, max-age=300",
        });
      },
    );
  }
}
