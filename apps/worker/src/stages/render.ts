import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FilmManifest } from "@sitereel/film-runtime";
import {
  bundleFilmEntry,
  startFilmServer,
  renderChunked,
  extractBakedPoster,
  renderWatermarkPng,
  type ChunkStore,
  type ChunkedRenderResult,
} from "@sitereel/renderer";
import type { StorageClient } from "@sitereel/storage";
import { ffprobe, formatSlug, type AspectFormat, type ServerEnv } from "@sitereel/shared";
import { resolveAssetRefsDeep } from "../lib/asset-ref.js";
import { resolveFontFaces } from "../lib/brand-fonts.js";

export type RenderEnv = Pick<ServerEnv, "STORAGE_DRIVER" | "STORAGE_LOCAL_DIR">;

export interface RenderStageResult {
  videoBuffer: Buffer;
  posterBuffer: Buffer;
  durationSec: number;
  frames: number;
  bytes: number;
  chunked: ChunkedRenderResult;
  probe: { width?: number; height?: number; frames?: number; hasAudio: boolean; durationSec: number };
}

/**
 * Chunk store backed by object storage, keyed per job+format: a retried render
 * job (BullMQ attempt 2, possibly on a different render container) finds the
 * segments the failed attempt already finished and only renders the rest.
 */
export function storageChunkStore(storage: StorageClient, prefix: string): ChunkStore {
  return {
    async get(name) {
      try {
        return await storage.getObject("assets", `${prefix}/${name}`);
      } catch {
        return null;
      }
    },
    put: (name, data) => storage.putObject("assets", `${prefix}/${name}`, data, "video/mp4"),
  };
}

/** Resolves asset:// refs to URLs the film page can fetch (local film server, or presigned R2). */
export async function publishManifest(opts: {
  manifest: FilmManifest;
  storage: StorageClient;
  env: RenderEnv;
  serverUrl: string;
  key: string;
}): Promise<{ resolved: FilmManifest; manifestUrl: string }> {
  const { manifest, storage, env, serverUrl, key } = opts;
  const withUrls = await resolveAssetRefsDeep(manifest, async (bucket, k) => {
    if (env.STORAGE_DRIVER === "local") return `${serverUrl}/${bucket}/${k}`;
    return storage.presignDownload(bucket, k, 3600);
  });
  // Brand fonts ride in the published manifest only: the pre-resolution manifest (hashes, chunk names) stays small and stable.
  const fontFaces = await resolveFontFaces(manifest.fonts, storage);
  const resolved: FilmManifest = fontFaces.length > 0 ? { ...withUrls, fontFaces } : withUrls;
  await storage.putObject("assets", key, Buffer.from(JSON.stringify(resolved)), "application/json");
  const manifestUrl = env.STORAGE_DRIVER === "local" ? `${serverUrl}/assets/${key}` : await storage.presignDownload("assets", key, 3600);
  return { resolved, manifestUrl };
}

/**
 * §4.6 "Render" + "Encode":
 *  - distributed render: frame ranges split into N chunks rendered in parallel,
 *    one Chromium per chunk (RENDER_CONCURRENCY / RENDER_CHUNKS), resumable
 *    from segments already in storage, then a lossless `-c copy` concat;
 *  - mux: AAC 192k audio trimmed to the exact video length, +faststart, BT.709;
 *  - poster: frame 0 is the first scene's settled frame (manifest.posterTime,
 *    baked during capture) and the poster PNG is extracted from that frame;
 *  - watermark: free plan gets a "Made with SiteReel" overlay burned in
 *    during each chunk's encode (no extra encode pass).
 */
export async function runRenderStage(opts: {
  jobId: string;
  format: AspectFormat;
  manifest: FilmManifest;
  audioBuffer: Buffer | null;
  storage: StorageClient;
  env: RenderEnv;
  watermark?: boolean;
  concurrency?: number;
  chunks?: number;
  onProgress?: (frame: number, total: number) => void;
  log?: (msg: string) => void;
}): Promise<RenderStageResult> {
  const { jobId, format, manifest, audioBuffer, storage, env } = opts;
  const slug = formatSlug(format);

  await bundleFilmEntry();
  const extraRoot = env.STORAGE_DRIVER === "local" ? path.resolve(env.STORAGE_LOCAL_DIR) : await fs.mkdtemp(path.join(os.tmpdir(), "sitereel-render-"));
  const server = await startFilmServer(extraRoot, 0);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sitereel-render-out-"));

  try {
    const { resolved, manifestUrl } = await publishManifest({ manifest, storage, env, serverUrl: server.url, key: `jobs/${jobId}/render/manifest-${slug}.json` });

    let audioPath: string | undefined;
    if (audioBuffer) {
      audioPath = path.join(tmp, `audio-${randomUUID()}.wav`);
      await fs.writeFile(audioPath, audioBuffer);
    }
    const watermarkPng = opts.watermark ? await renderWatermarkPng({ frameWidth: manifest.width, frameHeight: manifest.height, outPath: path.join(tmp, "watermark.png") }) : undefined;

    const envConcurrency = Number(process.env.RENDER_CONCURRENCY) || undefined;
    const envChunks = Number(process.env.RENDER_CHUNKS) || undefined;
    const outPath = path.join(tmp, `${slug}.mp4`);
    const chunked = await renderChunked({
      manifest: resolved,
      filmHost: server.url,
      manifestUrl,
      outPath,
      audioPath,
      concurrency: opts.concurrency ?? envConcurrency,
      chunks: opts.chunks ?? envChunks,
      chunkStore: storageChunkStore(storage, `jobs/${jobId}/render/segments-${slug}`),
      // Pre-resolution manifest: stable across attempts. Font count is included because a retry that
      // loads the brand fonts must not reuse segments an earlier attempt rendered with fallback fonts.
      contentKey: `${JSON.stringify(manifest)}|fonts:${resolved.fontFaces?.length ?? 0}`,

      watermarkPng,
      onProgress: opts.onProgress,
      log: opts.log,
    });

    const posterPath = path.join(tmp, `${slug}.png`);
    await extractBakedPoster(outPath, posterPath);

    const probe = await ffprobe(outPath);
    const v = probe.streams.find((s) => s.codec_type === "video");
    const [videoBuffer, posterBuffer] = await Promise.all([fs.readFile(outPath), fs.readFile(posterPath)]);

    return {
      videoBuffer,
      posterBuffer,
      durationSec: manifest.duration,
      frames: chunked.totalFrames,
      bytes: videoBuffer.length,
      chunked,
      probe: { width: v?.width, height: v?.height, frames: v?.nb_frames ? Number(v.nb_frames) : undefined, hasAudio: probe.streams.some((s) => s.codec_type === "audio"), durationSec: probe.durationSec },
    };
  } finally {
    await server.close();
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    if (env.STORAGE_DRIVER !== "local") await fs.rm(extraRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
