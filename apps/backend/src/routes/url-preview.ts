import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ssrfSafeFetch, readBodyCapped, SsrfBlockedError } from "@sitereel/shared";
import type { createAuthVerifier } from "../lib/auth.js";

const QuerySchema = z.object({ url: z.string().url() });

/** Title/OG/favicon live in <head>; nothing past the first 512 KB is worth reading (or holding in memory). */
const MAX_PREVIEW_BYTES = 512 * 1024;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}

function attrOf(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  const v = m?.[1] ?? m?.[2] ?? m?.[3];
  return v === undefined ? undefined : decodeEntities(v.trim());
}

/** Finds a <meta> by property/name regardless of attribute order. */
function extractMeta(html: string, name: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = attrOf(tag, "property") ?? attrOf(tag, "name");
    if (key?.toLowerCase() === name.toLowerCase()) return attrOf(tag, "content");
  }
  return undefined;
}

/** Best favicon href: rel=icon (svg preferred) > apple-touch-icon > shortcut icon. */
function extractFavicon(html: string): string | undefined {
  const links = (html.match(/<link\b[^>]*>/gi) ?? []).map((tag) => ({ rel: (attrOf(tag, "rel") ?? "").toLowerCase(), href: attrOf(tag, "href"), type: attrOf(tag, "type") }));
  const icons = links.filter((l) => l.href && /(^|\s)(icon|apple-touch-icon)(\s|$)/.test(l.rel));
  return (icons.find((l) => l.type === "image/svg+xml") ?? icons.find((l) => /(^|\s)icon(\s|$)/.test(l.rel)) ?? icons[0])?.href;
}

function absolutize(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Powers the W4 "create video" URL field (§3.6): a debounced, SSRF-safe fetch
 * that returns title/favicon/OG image and whether the site is reachable at
 * all, before the user commits a credit to a full crawl job. The body read is
 * capped, and favicon/OG URLs are returned absolute (resolved against the
 * final URL after redirects) so the browser can load them directly.
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
      const res = await ssrfSafeFetch(parsed.data.url, {
        timeoutMs: 8000,
        headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "user-agent": "Mozilla/5.0 (compatible; SiteReelPreview/0.1)" },
      });
      const finalUrl = res.url || parsed.data.url;
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return reply.send({ reachable: false, status: res.status });
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType && !/html|xml/i.test(contentType)) {
        await res.body?.cancel().catch(() => undefined);
        return reply.send({ reachable: true, status: res.status, title: null, ogImage: null, favicon: absolutize("/favicon.ico", finalUrl) });
      }

      const { text: html } = await readBodyCapped(res, MAX_PREVIEW_BYTES);
      const titleRaw = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
      const title = titleRaw ? decodeEntities(titleRaw).replace(/\s+/g, " ").trim() : undefined;
      const ogTitle = extractMeta(html, "og:title");
      const ogImage = extractMeta(html, "og:image") ?? extractMeta(html, "twitter:image");

      return reply.send({
        reachable: true,
        status: res.status,
        title: ogTitle || title || null,
        ogImage: absolutize(ogImage, finalUrl),
        favicon: absolutize(extractFavicon(html) ?? "/favicon.ico", finalUrl),
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
