import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { BROWSER_ARGS } from "./render.js";
import { extractPosterFrame } from "./ffmpeg.js";

/**
 * Renders the free-plan watermark ("Made with SiteReel") as a transparent PNG
 * sized relative to the output frame. Drawn by Chromium rather than ffmpeg's
 * drawtext so it doesn't depend on a fontconfig setup or a font file path
 * existing on the render host — same text engine the film itself uses.
 */
export async function renderWatermarkPng(opts: { text?: string; frameWidth: number; frameHeight: number; outPath: string }): Promise<string> {
  const short = Math.min(opts.frameWidth, opts.frameHeight);
  const fontPx = Math.round(short * 0.026);
  const html = `<!doctype html><html><body style="margin:0;background:transparent">
    <div id="wm" style="display:inline-flex;align-items:center;gap:${Math.round(fontPx * 0.45)}px;padding:${Math.round(fontPx * 0.45)}px ${Math.round(fontPx * 0.8)}px;
      border-radius:${Math.round(fontPx)}px;background:rgba(0,0,0,0.45);color:rgba(255,255,255,0.92);
      font:600 ${fontPx}px system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:0.01em;white-space:nowrap">
      <span style="display:inline-block;width:${Math.round(fontPx * 0.7)}px;height:${Math.round(fontPx * 0.7)}px;border-radius:50%;background:#7c5cff"></span>
      ${escapeHtml(opts.text ?? "Made with SiteReel")}
    </div></body></html>`;
  const browser = await chromium.launch({ args: BROWSER_ARGS });
  try {
    const page = await browser.newPage({ viewport: { width: opts.frameWidth, height: Math.max(200, fontPx * 4) }, deviceScaleFactor: 1 });
    await page.setContent(html);
    await fs.mkdir(path.dirname(opts.outPath), { recursive: true });
    await page.locator("#wm").screenshot({ path: opts.outPath, omitBackground: true });
  } finally {
    await browser.close();
  }
  return opts.outPath;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Poster = frame 0 of the final video, which the distributed renderer bakes
 * from the first scene's settled state (manifest.posterTime). Extracting it
 * from the encoded file (not a separate screenshot) guarantees the poster and
 * the first frame a player shows are byte-for-byte the same picture.
 */
export async function extractBakedPoster(videoPath: string, outPath: string): Promise<void> {
  await extractPosterFrame(videoPath, 0, outPath);
}
