import fs from "node:fs";
import type { FastifyReply } from "fastify";
import type { StorageClient } from "@sitereel/storage";

export type MediaKind = "video" | "poster" | "captions";

export const MEDIA_KINDS: readonly { kind: MediaKind; column: "key" | "posterKey" | "vttKey"; contentType: string; ext: string }[] = [
  { kind: "video", column: "key", contentType: "video/mp4", ext: "mp4" },
  { kind: "poster", column: "posterKey", contentType: "image/png", ext: "png" },
  { kind: "captions", column: "vttKey", contentType: "text/vtt; charset=utf-8", ext: "vtt" },
];

export type ByteRange = { start: number; end: number };

/**
 * Parses a single-range `Range: bytes=…` header against a file of `size` bytes.
 * Returns undefined when there's no (usable) Range header — serve the whole
 * file — and "unsatisfiable" for a syntactically valid range outside the file
 * (→ 416). Multi-range requests are answered with the full body, which the
 * spec allows.
 */
export function parseRangeHeader(header: string | undefined, size: number): ByteRange | "unsatisfiable" | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;
  const [, startStr = "", endStr = ""] = match;
  if (startStr === "" && endStr === "") return undefined;

  if (startStr === "") {
    // suffix range: last N bytes
    const suffix = Number(endStr);
    if (suffix === 0) return "unsatisfiable";
    if (size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(startStr);
  const end = endStr === "" ? size - 1 : Math.min(Number(endStr), size - 1);
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

/** Local driver's presignDownload returns `file://<absolute path>` (packages/storage/src/local.ts). */
export function localPathFromFileUrl(url: string): string | undefined {
  return url.startsWith("file://") ? url.slice("file://".length) : undefined;
}

export interface ServeMediaOptions {
  storage: StorageClient;
  storageDriver: "local" | "s3";
  storageKey: string;
  kind: MediaKind;
  rangeHeader: string | undefined;
  /** When set, sends Content-Disposition: attachment with this filename. */
  downloadFilename?: string;
  cacheControl: string;
}

/**
 * Streams a render artifact. S3/R2: 302 to a short-lived presigned URL (the
 * bucket handles Range itself) — except for ?download=1, which is proxied so
 * we can set Content-Disposition (presigned URLs from @sitereel/storage don't
 * carry a response-content-disposition override yet). Local: streamed from
 * disk with HTTP Range support, since a file:// URL is useless to a browser
 * and <video> seeking needs 206 responses.
 */
export async function serveMedia(reply: FastifyReply, opts: ServeMediaOptions): Promise<FastifyReply> {
  const meta = MEDIA_KINDS.find((m) => m.kind === opts.kind)!;

  if (opts.storageDriver === "s3") {
    if (!opts.downloadFilename) {
      const url = await opts.storage.presignDownload("renders", opts.storageKey, 300);
      reply.header("Cache-Control", "no-store");
      return reply.redirect(url, 302);
    }
    const bytes = await opts.storage.getObject("renders", opts.storageKey);
    reply.header("Content-Type", meta.contentType);
    reply.header("Content-Length", bytes.length);
    reply.header("Content-Disposition", `attachment; filename="${opts.downloadFilename}"`);
    reply.header("Cache-Control", opts.cacheControl);
    return reply.send(bytes);
  }

  const filePath = localPathFromFileUrl(await opts.storage.presignDownload("renders", opts.storageKey));
  if (!filePath) return reply.code(500).send({ error: "storage_misconfigured" });

  let size: number;
  try {
    size = (await fs.promises.stat(filePath)).size;
  } catch {
    return reply.code(404).send({ error: "media_not_found" });
  }

  reply.header("Content-Type", meta.contentType);
  reply.header("Accept-Ranges", "bytes");
  reply.header("Cache-Control", opts.cacheControl);
  if (opts.downloadFilename) reply.header("Content-Disposition", `attachment; filename="${opts.downloadFilename}"`);

  const range = parseRangeHeader(opts.rangeHeader, size);
  if (range === "unsatisfiable") {
    reply.header("Content-Range", `bytes */${size}`);
    return reply.code(416).send();
  }
  if (range) {
    reply.code(206);
    reply.header("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    reply.header("Content-Length", range.end - range.start + 1);
    return reply.send(fs.createReadStream(filePath, { start: range.start, end: range.end }));
  }
  reply.header("Content-Length", size);
  return reply.send(fs.createReadStream(filePath));
}
