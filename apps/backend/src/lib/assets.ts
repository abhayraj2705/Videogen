import fs from "node:fs";
import path from "node:path";
import type { FastifyReply } from "fastify";
import type { Bucket, StorageClient } from "@sitereel/storage";
import { localPathFromFileUrl, parseRangeHeader } from "./media.js";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".vtt": "text/vtt; charset=utf-8",
};

export function contentTypeForKey(key: string): string {
  return CONTENT_TYPES[path.extname(key).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Serves an arbitrary stored object (audio takes, crawl screenshots, uploaded
 * logos). S3/R2 → 302 to a 5-minute presigned URL; local → streamed from disk
 * with single-range support. SVGs get a sandboxing CSP so an uploaded logo can
 * never run script in our origin even if opened directly.
 */
export async function serveAsset(
  reply: FastifyReply,
  opts: { storage: StorageClient; storageDriver: "local" | "s3"; bucket: Bucket; key: string; rangeHeader?: string; cacheControl: string },
): Promise<FastifyReply> {
  const contentType = contentTypeForKey(opts.key);
  if (contentType === "image/svg+xml") reply.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");

  if (opts.storageDriver === "s3") {
    const url = await opts.storage.presignDownload(opts.bucket, opts.key, 300);
    reply.header("Cache-Control", "no-store");
    return reply.redirect(url, 302);
  }

  const filePath = localPathFromFileUrl(await opts.storage.presignDownload(opts.bucket, opts.key));
  if (!filePath) return reply.code(500).send({ error: "storage_misconfigured", message: "Storage is misconfigured." });
  let size: number;
  try {
    size = (await fs.promises.stat(filePath)).size;
  } catch {
    return reply.code(404).send({ error: "asset_not_found", message: "File not found." });
  }

  reply.header("Content-Type", contentType);
  reply.header("Accept-Ranges", "bytes");
  reply.header("Cache-Control", opts.cacheControl);
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
