import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq, and } from "drizzle-orm";
import { jobs, renders, type Db } from "@sitereel/db";
import type { StorageClient } from "@sitereel/storage";
import { formatSlug, parseFormatSlug, type AspectFormat } from "@sitereel/shared";
import type { createAuthVerifier } from "../lib/auth.js";

export interface RenderRouteDeps {
  db: Db;
  storage: StorageClient;
  storageDriver: "local" | "s3";
  verifyAuth: ReturnType<typeof createAuthVerifier>;
}

const CONTENT_TYPES: Record<string, string> = {
  video: "video/mp4",
  poster: "image/png",
  captions: "text/vtt",
};

/** Returns the render row + ownership-checked job row, or sends a 404 and returns null. */
async function loadOwnedJobAndRender(
  deps: RenderRouteDeps,
  req: FastifyRequest,
  reply: FastifyReply,
  jobId: string,
  format: AspectFormat,
) {
  const user = await deps.verifyAuth(req, reply);
  if (!user) return null;

  const [jobRow] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!jobRow || jobRow.userId !== user.id || !jobRow.currentStoryboardId) {
    reply.code(404).send({ error: "not_found" });
    return null;
  }

  const [renderRow] = await deps.db
    .select()
    .from(renders)
    .where(and(eq(renders.storyboardId, jobRow.currentStoryboardId), eq(renders.format, format)))
    .limit(1);
  if (!renderRow) {
    reply.code(404).send({ error: "render_not_found" });
    return null;
  }

  return { jobRow, renderRow };
}

/**
 * §4.3 "GET /api/renders/:id/download" — scoped under /api/jobs/:id/renders
 * instead, since renders are keyed by (storyboardId, format) not a flat id
 * yet (no separate public render-id route exists until share links, Phase 6).
 * For STORAGE_DRIVER=s3 this redirects to a short-lived presigned R2 URL; for
 * "local" (the only driver verified end-to-end so far — see PHASE4.md) it
 * streams the file directly, since a local-disk path isn't reachable by the
 * browser at all.
 */
export function registerRenderRoutes(app: FastifyInstance, deps: RenderRouteDeps): void {
  app.get<{ Params: { id: string } }>("/api/jobs/:id/renders", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;

    const [jobRow] = await deps.db.select().from(jobs).where(eq(jobs.id, req.params.id)).limit(1);
    if (!jobRow || jobRow.userId !== user.id) return reply.code(404).send({ error: "not_found" });
    if (!jobRow.currentStoryboardId) return reply.send([]);

    const rows = await deps.db.select().from(renders).where(eq(renders.storyboardId, jobRow.currentStoryboardId));
    return reply.send(
      rows.map((r) => ({
        format: r.format,
        frames: r.frames,
        durationMs: r.durationMs,
        bytes: r.bytes,
        videoUrl: `/api/jobs/${req.params.id}/renders/${formatSlug(r.format)}/video`,
        posterUrl: `/api/jobs/${req.params.id}/renders/${formatSlug(r.format)}/poster`,
        captionsUrl: `/api/jobs/${req.params.id}/renders/${formatSlug(r.format)}/captions`,
      })),
    );
  });

  for (const [kind, key] of [
    ["video", "key"],
    ["poster", "posterKey"],
    ["captions", "vttKey"],
  ] as const) {
    app.get<{ Params: { id: string; format: string }; Querystring: { download?: string } }>(
      `/api/jobs/:id/renders/:format/${kind}`,
      async (req, reply) => {
        let format: AspectFormat;
        try {
          format = parseFormatSlug(req.params.format);
        } catch {
          return reply.code(400).send({ error: "invalid_format" });
        }

        const loaded = await loadOwnedJobAndRender(deps, req, reply, req.params.id, format);
        if (!loaded) return;

        const storageKey = loaded.renderRow[key];
        // The same URL backs the <video>/<img>/<track> tags (inline) and the
        // result page's explicit Download button — cross-origin `<a download>`
        // is unreliable (Chrome ignores it without this header), so the
        // caller opts into Content-Disposition: attachment via ?download=1
        // rather than it always forcing a save-as dialog on playback.
        const asAttachment = req.query.download === "1";

        if (deps.storageDriver === "s3") {
          const url = await deps.storage.presignDownload("renders", storageKey, 300);
          return reply.redirect(url);
        }

        const bytes = await deps.storage.getObject("renders", storageKey);
        reply.header("Content-Type", CONTENT_TYPES[kind]!);
        reply.header("Content-Length", bytes.length);
        if (kind === "video") reply.header("Accept-Ranges", "bytes");
        if (asAttachment) {
          reply.header("Content-Disposition", `attachment; filename="${req.params.id}-${req.params.format}.${kind === "video" ? "mp4" : kind === "poster" ? "png" : "vtt"}"`);
        }
        return reply.send(bytes);
      },
    );
  }
}
