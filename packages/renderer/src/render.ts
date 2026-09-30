import { chromium } from "playwright";
import type { FilmManifest } from "@sitereel/film-runtime";
import { VIRTUAL_CLOCK_INIT_SCRIPT } from "./virtual-clock.js";
import { spawnFfmpegEncoder } from "./ffmpeg.js";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";

export interface RenderOptions {
  manifest: FilmManifest;
  /** http URL to film.html, served by startFilmServer(). */
  filmHost: string;
  /** http URL to the manifest JSON, resolvable by the page (served from the same static root). */
  manifestUrl: string;
  outPath: string;
  audioPath?: string;
  /** Emits progress after each frame — used by the CLI and, later, by the worker to publish job events. */
  onProgress?: (frame: number, totalFrames: number) => void;
}

/**
 * Single-process Phase 0 renderer: one Chromium page, one ffmpeg process,
 * frames piped in order. Phase 4 replaces this with chunked parallel ranges
 * across multiple containers (§4.6 "Render"), reusing the same capture logic.
 */
export async function renderFilm(opts: RenderOptions): Promise<void> {
  const { manifest } = opts;
  const totalFrames = Math.ceil(manifest.duration * manifest.fps);

  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });

  const browser = await chromium.launch({
    args: ["--font-render-hinting=none", "--force-color-profile=srgb", "--disable-lcd-text"],
  });
  try {
    const ctx = await browser.newContext({
      viewport: { width: manifest.width, height: manifest.height },
      deviceScaleFactor: 1,
    });
    await ctx.addInitScript(VIRTUAL_CLOCK_INIT_SCRIPT);
    const page = await ctx.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") console.error("[page]", msg.text());
    });

    const pageUrl = `${opts.filmHost}/film.html?manifest=${encodeURIComponent(opts.manifestUrl)}`;
    await page.goto(pageUrl);
    await page.waitForFunction(() => window.__film?.ready === true, undefined, { timeout: 30_000 });

    const ffmpeg = spawnFfmpegEncoder({
      width: manifest.width,
      height: manifest.height,
      fps: manifest.fps,
      outPath: opts.outPath,
      audioPath: opts.audioPath,
    });

    const ffmpegExit = once(ffmpeg, "exit");

    for (let frame = 0; frame < totalFrames; frame++) {
      const t = frame / manifest.fps;
      await page.evaluate((tt) => {
        window.__setVirtualTimeMs(tt * 1000);
        window.__film.seek(tt);
      }, t);
      const png = await page.screenshot({ type: "png" });
      const canWrite = ffmpeg.stdin!.write(png);
      if (!canWrite) await once(ffmpeg.stdin!, "drain");
      opts.onProgress?.(frame + 1, totalFrames);
    }

    ffmpeg.stdin!.end();
    const [code] = await ffmpegExit;
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
  } finally {
    await browser.close();
  }
}
