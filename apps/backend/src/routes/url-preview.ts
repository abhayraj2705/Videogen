import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ssrfSafeFetch, SsrfBlockedError } from "@sitereel/shared";
import type { createAuthVerifier } from "../lib/auth.js";

const QuerySchema = z.object({ url: z.string().url() });

function extractMeta(html: string, name: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, "i");
  return re.exec(html)?.[1];
}

/**
 * Powers the W4 "create video" URL field (§3.6): a debounced, SSRF-safe fetch
 * that returns title/favicon/OG image and whether the site is reachable at
 * all, before the user commits a credit to a full crawl job.
 */
export function registerUrlPreviewRoutes(app: FastifyInstance, deps: { verifyAuth: ReturnType<typeof createAuthVerifier> }): void {
  app.get("/api/url/preview", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;

    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", issues: parsed.error.issues });
    }

    try {
      const res = await ssrfSafeFetch(parsed.data.url, { timeoutMs: 8000 });
      if (!res.ok) {
        return reply.send({ reachable: false, status: res.status });
      }
      const html = await res.text();
      const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
      const ogImage = extractMeta(html, "og:image");
      const ogTitle = extractMeta(html, "og:title");
      const favicon = /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']*)["']/i.exec(html)?.[1];

      return reply.send({
        reachable: true,
        status: res.status,
        title: ogTitle ?? title ?? null,
        ogImage: ogImage ?? null,
        favicon: favicon ?? null,
      });
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        return reply.code(400).send({ error: "blocked", message: err.message });
      }
      req.log.warn({ err }, "url preview fetch failed");
      return reply.send({ reachable: false, status: null });
    }
  });
}
