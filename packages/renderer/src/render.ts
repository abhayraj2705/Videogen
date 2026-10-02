import { chromium, type Browser, type Page } from "playwright";
import type { FilmManifest } from "@sitereel/film-runtime";
import { VIRTUAL_CLOCK_INIT_SCRIPT } from "./virtual-clock.js";
import { spawnFfmpegEncoder, spawnSegmentEncoder, concatSegments, muxFinal } from "./ffmpeg.js";
import { once } from "node:events";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const BROWSER_ARGS = ["--font-render-hinting=none", "--force-color-profile=srgb", "--disable-lcd-text"];

export interface RenderOptions {
  manifest: FilmManifest;
  /** http URL to film.html, served by startFilmServer(). */
  filmHost: string;
  /** http URL to the manifest JSON, resolvable by the page (served from the same static root). */
  manifestUrl: string;
  outPath: string;
  audioPath?: string;
  /** Emits progress after each frame — used by the CLI and the worker to publish job events. */
  onProgress?: (frame: number, totalFrames: number) => void;
}

/** Opens film.html for a manifest in a fresh context with the virtual clock installed, and waits for ready. */
export async function openFilmPage(browser: Browser, manifest: FilmManifest, filmHost: string, manifestUrl: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: manifest.width, height: manifest.height }, deviceScaleFactor: 1 });
  await ctx.addInitScript(VIRTUAL_CLOCK_INIT_SCRIPT);
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("[page]", msg.text());
  });
  await page.goto(`${filmHost}/film.html?manifest=${encodeURIComponent(manifestUrl)}`);
  await page.waitForFunction(() => window.__film?.ready === true, undefined, { timeout: 60_000 });
  await warmUpScenes(page, manifest);
  return page;
}

/**
 * Shows every scene once (at its middle) before capture starts. Chromium
 * loads fallback fonts (₹, emoji, CJK, ...) and decodes/rasterizes images
 * lazily the first time an element is displayed — without this, the first
 * frame of each scene could differ from a re-render of the same t, which is
 * both a purity-test failure and a visible glitch frame in the video.
 * String-evaluated to avoid tsx's __name helper in the page realm.
 */
async function warmUpScenes(page: Page, manifest: FilmManifest): Promise<void> {
  const times = manifest.scenes.flatMap((s) => [s.start + (s.end - s.start) * 0.5, Math.max(s.start, s.end - 0.05)]);
  await page.evaluate(`(async (times) => {
    for (const t of times) {
      window.__film.seek(t);
      if (document.fonts) await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    window.__film.seek(0);
  })(${JSON.stringify(times)})`);
}

export async function seekPage(page: Page, t: number): Promise<void> {
  await page.evaluate((tt) => {
    window.__setVirtualTimeMs(tt * 1000);
    window.__film.seek(tt);
  }, t);
}

/**
 * Time a given frame index is captured at. Frame 0 is the baked poster
 * (manifest.posterTime, the first scene's settle) when `bakePoster` is on:
 * platforms that thumbnail the first frame show a composed card instead of
 * an empty background. Every other frame is plain frame/fps.
 */
export function frameTime(frame: number, manifest: FilmManifest, bakePoster: boolean): number {
  if (frame === 0 && bakePoster && manifest.posterTime !== undefined) return manifest.posterTime;
  return frame / manifest.fps;
}

export const totalFramesOf = (manifest: FilmManifest) => Math.round(manifest.duration * manifest.fps);

/**
 * Single-process renderer (Phase 0 path, still used by the fixture CLI's
 * `--single` flag): one Chromium page, one ffmpeg process, frames in order.
 */
export async function renderFilm(opts: RenderOptions): Promise<void> {
  const { manifest } = opts;
  const totalFrames = totalFramesOf(manifest);
  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });

  const browser = await chromium.launch({ args: BROWSER_ARGS });
  try {
    const page = await openFilmPage(browser, manifest, opts.filmHost, opts.manifestUrl);
    const ffmpeg = spawnFfmpegEncoder({ width: manifest.width, height: manifest.height, fps: manifest.fps, outPath: opts.outPath, audioPath: opts.audioPath });
    const ffmpegExit = once(ffmpeg, "exit");
    for (let frame = 0; frame < totalFrames; frame++) {
      await seekPage(page, frame / manifest.fps);
      const png = await page.screenshot({ type: "png" });
      if (!ffmpeg.stdin!.write(png)) await once(ffmpeg.stdin!, "drain");
      opts.onProgress?.(frame + 1, totalFrames);
    }
    ffmpeg.stdin!.end();
    const [code] = await ffmpegExit;
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Distributed render (§4.6 "Render": split ranges, parallel, resume, concat, mux)
// ---------------------------------------------------------------------------

/**
 * Where finished segments live between attempts. The worker backs this with
 * object storage (so a retried render job — possibly on another machine —
 * skips chunks a previous attempt already finished); the CLI uses a local dir.
 */
export interface ChunkStore {
  get(name: string): Promise<Buffer | null>;
  put(name: string, data: Buffer): Promise<void>;
}

export function createDirChunkStore(dir: string): ChunkStore {
  return {
    async get(name) {
      try {
        return await fsp.readFile(path.join(dir, name));
      } catch {
        return null;
      }
    },
    async put(name, data) {
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, name), data);
    },
  };
}

export interface FrameRange {
  index: number;
  start: number; // inclusive
  end: number; // exclusive
}

/** Splits [0, totalFrames) into `chunks` contiguous, near-equal ranges (never empty). */
export function splitFrameRanges(totalFrames: number, chunks: number): FrameRange[] {
  const n = Math.max(1, Math.min(chunks, totalFrames));
  const base = Math.floor(totalFrames / n);
  const extra = totalFrames % n;
  const ranges: FrameRange[] = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const len = base + (i < extra ? 1 : 0);
    ranges.push({ index: i, start: cursor, end: cursor + len });
    cursor += len;
  }
  return ranges;
}

export interface ChunkedRenderOptions {
  manifest: FilmManifest;
  filmHost: string;
  manifestUrl: string;
  outPath: string;
  audioPath?: string;
  /** Number of frame ranges. Default: concurrency * 2 (smaller tail latency than 1:1). */
  chunks?: number;
  /** Parallel browsers. Default: max(1, floor(cpus / 2)) — each Chromium + x264 pair wants ~2 cores. */
  concurrency?: number;
  /** Segment cache for resume; default is a temp dir (no cross-attempt resume). */
  chunkStore?: ChunkStore;
  /**
   * Identity of the *content* for segment naming. Defaults to the manifest
   * JSON, but callers whose manifest embeds per-attempt URLs (presigned R2
   * links, a random film-server port) must pass the pre-resolution manifest
   * here, or a retry would never recognize its own segments.
   */
  contentKey?: string;
  /** Bake manifest.posterTime into frame 0 (default true when posterTime is set). */
  bakePoster?: boolean;
  /** PNG overlaid bottom-right on every frame (free-plan watermark). */
  watermarkPng?: string;
  /** x264 preset; identical across all chunks so `-c copy` concat is valid. */
  preset?: string;
  crf?: number;
  onProgress?: (framesDone: number, totalFrames: number) => void;
  log?: (msg: string) => void;
}

export interface ChunkedRenderResult {
  totalFrames: number;
  chunks: number;
  chunksReused: number;
  concurrency: number;
  renderMs: number;
  concatMs: number;
}

/** Stable identity for a segment: anything that changes its pixels changes its name. */
function segmentName(contentKey: string, range: FrameRange, salt: string): string {
  const h = createHash("sha256").update(contentKey).update(salt).digest("hex").slice(0, 16);
  return `seg-${h}-${String(range.start).padStart(6, "0")}-${String(range.end).padStart(6, "0")}.mp4`;
}

export async function renderChunked(opts: ChunkedRenderOptions): Promise<ChunkedRenderResult> {
  const { manifest } = opts;
  const totalFrames = totalFramesOf(manifest);
  const concurrency = Math.max(1, opts.concurrency ?? Math.max(1, Math.floor(os.cpus().length / 2)));
  const ranges = splitFrameRanges(totalFrames, opts.chunks ?? concurrency * 2);
  const bakePoster = opts.bakePoster ?? manifest.posterTime !== undefined;
  const preset = opts.preset ?? "medium";
  const crf = opts.crf ?? 20;
  const salt = JSON.stringify({ bakePoster, wm: opts.watermarkPng ? fs.readFileSync(opts.watermarkPng).length : 0, preset, crf });

  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "sitereel-chunks-"));
  const store = opts.chunkStore ?? createDirChunkStore(path.join(workDir, "store"));
  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });

  let framesDone = 0;
  let chunksReused = 0;
  const report = (n: number) => {
    framesDone += n;
    opts.onProgress?.(framesDone, totalFrames);
  };

  const t0 = Date.now();
  const segPaths: string[] = new Array(ranges.length);

  const renderOne = async (range: FrameRange) => {
    const name = segmentName(opts.contentKey ?? JSON.stringify(manifest), range, salt);
    const localPath = path.join(workDir, name);
    const cached = await store.get(name);
    if (cached && cached.length > 0) {
      await fsp.writeFile(localPath, cached);
      segPaths[range.index] = localPath;
      chunksReused++;
      report(range.end - range.start);
      opts.log?.(`chunk ${range.index} [${range.start},${range.end}) reused from store`);
      return;
    }

    // One browser per chunk: isolates crashes/leaks and lets chunks run on separate cores.
    const browser = await chromium.launch({ args: BROWSER_ARGS });
    try {
      const page = await openFilmPage(browser, manifest, opts.filmHost, opts.manifestUrl);
      const enc = spawnSegmentEncoder({ fps: manifest.fps, outPath: localPath, watermarkPng: opts.watermarkPng, preset, crf });
      const exit = once(enc, "exit");
      for (let f = range.start; f < range.end; f++) {
        await seekPage(page, frameTime(f, manifest, bakePoster));
        const png = await page.screenshot({ type: "png" });
        if (!enc.stdin!.write(png)) await once(enc.stdin!, "drain");
        report(1);
      }
      enc.stdin!.end();
      const [code] = await exit;
      if (code !== 0) throw new Error(`segment encoder for chunk ${range.index} exited with ${code}`);
    } finally {
      await browser.close();
    }
    await store.put(name, await fsp.readFile(localPath));
    segPaths[range.index] = localPath;
    opts.log?.(`chunk ${range.index} [${range.start},${range.end}) rendered`);
  };

  try {
    const queue = [...ranges];
    await Promise.all(
      Array.from({ length: Math.min(concurrency, ranges.length) }, async () => {
        for (let r = queue.shift(); r; r = queue.shift()) await renderOne(r);
      }),
    );
    const renderMs = Date.now() - t0;

    const t1 = Date.now();
    const videoOnly = path.join(workDir, "video.mp4");
    await concatSegments(segPaths, videoOnly, workDir);
    await muxFinal({ videoPath: videoOnly, audioPath: opts.audioPath, outPath: opts.outPath, durationSec: totalFrames / manifest.fps });
    const concatMs = Date.now() - t1;

    return { totalFrames, chunks: ranges.length, chunksReused, concurrency, renderMs, concatMs };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
