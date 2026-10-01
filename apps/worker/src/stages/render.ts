import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FilmManifest } from "@sitereel/film-runtime";
import { bundleFilmEntry, startFilmServer, renderFilm, extractPosterFrame } from "@sitereel/renderer";
import type { StorageClient } from "@sitereel/storage";
import { formatSlug, type AspectFormat, type ServerEnv } from "@sitereel/shared";
import { resolveAssetRefsDeep } from "../lib/asset-ref.js";

const RENDER_PORT = 4100;

export interface RenderStageResult {
  videoBuffer: Buffer;
  posterBuffer: Buffer;
  durationSec: number;
  frames: number;
  bytes: number;
}

/**
 * §4.6 "Render": resolves the manifest's asset:// placeholders into real
 * fetchable URLs (relative to the local film server for STORAGE_DRIVER=local,
 * or presigned R2 URLs for STORAGE_DRIVER=s3), starts the server, and runs
 * the same capture loop Phase 0 built — proving the Build stage's output and
 * the renderer's input are exactly the same contract (§2.2 decision).
 *
 * Phase 0's chunked/distributed design (§4.6: "split ranges across parallel
 * containers") isn't implemented here — this is the single-process renderer,
 * run with render-queue concurrency 1 per the plan's own §4.5 table ("1 per
 * container (CPU-bound)"). Splitting into ranges is an infra scaling change,
 * not a correctness one; the capture loop itself is unchanged either way.
 */
export async function runRenderStage(opts: {
  jobId: string;
  format: AspectFormat;
  manifest: FilmManifest;
  audioBuffer: Buffer | null;
  storage: StorageClient;
  env: ServerEnv;
  onProgress?: (frame: number, total: number) => void;
}): Promise<RenderStageResult> {
  const { jobId, format, manifest, audioBuffer, storage, env } = opts;

  await bundleFilmEntry();
  const extraRoot = env.STORAGE_DRIVER === "local" ? path.resolve(env.STORAGE_LOCAL_DIR) : await fs.mkdtemp(path.join(os.tmpdir(), "sitereel-render-"));
  const server = await startFilmServer(extraRoot, RENDER_PORT);

  try {
    const resolvedManifest = await resolveAssetRefsDeep(manifest, async (bucket, key) => {
      if (env.STORAGE_DRIVER === "local") return `${server.url}/${bucket}/${key}`;
      return storage.presignDownload(bucket, key, 3600);
    });

    const manifestKey = `jobs/${jobId}/manifest-${formatSlug(format)}.json`;
    await storage.putObject("assets", manifestKey, Buffer.from(JSON.stringify(resolvedManifest)), "application/json");
    const manifestUrl = env.STORAGE_DRIVER === "local" ? `${server.url}/assets/${manifestKey}` : await storage.presignDownload("assets", manifestKey, 3600);

    let audioPath: string | undefined;
    if (audioBuffer) {
      audioPath = path.join(os.tmpdir(), `sitereel-audio-${randomUUID()}.wav`);
      await fs.writeFile(audioPath, audioBuffer);
    }

    const outPath = path.join(os.tmpdir(), `sitereel-render-${randomUUID()}.mp4`);
    await renderFilm({
      manifest: resolvedManifest,
      filmHost: server.url,
      manifestUrl,
      outPath,
      audioPath,
      onProgress: opts.onProgress,
    });

    const posterPath = path.join(os.tmpdir(), `sitereel-poster-${randomUUID()}.png`);
    const posterAtSec = manifest.scenes[0] ? (manifest.scenes[0].end - manifest.scenes[0].start) * 0.8 : manifest.duration * 0.1;
    await extractPosterFrame(outPath, posterAtSec, posterPath);

    const [videoBuffer, posterBuffer, stat] = await Promise.all([fs.readFile(outPath), fs.readFile(posterPath), fs.stat(outPath)]);

    await Promise.all([fs.unlink(outPath).catch(() => undefined), fs.unlink(posterPath).catch(() => undefined), audioPath ? fs.unlink(audioPath).catch(() => undefined) : Promise.resolve()]);

    return {
      videoBuffer,
      posterBuffer,
      durationSec: manifest.duration,
      frames: Math.ceil(manifest.duration * manifest.fps),
      bytes: stat.size,
    };
  } finally {
    await server.close();
    if (env.STORAGE_DRIVER !== "local") await fs.rm(extraRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
