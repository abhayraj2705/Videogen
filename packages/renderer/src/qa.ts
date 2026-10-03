import { chromium, type CDPSession, type Page } from "playwright";
import { PNG } from "pngjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { contrastRatio, createTemplate, safeRect, type FilmManifest } from "@sitereel/film-runtime";
import { BROWSER_ARGS, openFilmPage, seekPage } from "./render.js";
import { tileContactSheet } from "./ffmpeg.js";
import { SCENE_PROBE_JS } from "./qa-probe-src.js";

export interface FilmQaIssue {
  code:
    | "purity_failed"
    | "scene_not_found"
    | "text_not_visible"
    | "overflow"
    | "safe_area"
    | "text_clipped"
    | "low_contrast" | "low_fill" | "qa_crashed";
  message: string;
  severity: "error" | "warning";
  sceneId?: string;
  details?: Record<string, unknown>;
}

export interface ContrastSample {
  sceneId: string;
  text: string;
  color: string;
  background: string;
  ratio: number;
  required: number;
}

export interface FilmQaResult {
  passed: boolean;
  issues: FilmQaIssue[];
  purity: { t: number; ok: boolean; reason?: string }[];
  contrast: ContrastSample[];
  /** Visible text per scene at its settle mark (full text probe). */
  text: { sceneId: string; t: number; visibleText: string }[];
  contactSheet: Buffer | null;
  durationMs: number;
}

export interface FilmQaOptions {
  manifest: FilmManifest;
  filmHost: string;
  manifestUrl: string;
  /** Text that must be fully visible at each scene's settle mark (storyboard onScreenText). */
  expectedText?: Record<string, string[]>;
  puritySamples?: number;
  contactSheet?: boolean;
  /** Pixels of tolerance for overflow/safe-area checks (anti-aliasing, sub-pixel layout). */
  tolerancePx?: number;
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

const cdpSessions = new WeakMap<Page, Promise<CDPSession>>();

/**
 * Lossless frame for the purity comparison. Goes straight to CDP with
 * optimizeForSpeed (fast zlib level): Playwright's page.screenshot spends
 * ~250 ms compressing a 1080p PNG, which made purity the bulk of QA time.
 */
async function grabFrame(page: Page, t: number): Promise<Buffer> {
  await seekPage(page, t);
  let session = cdpSessions.get(page);
  if (!session) {
    session = page.context().newCDPSession(page);
    cdpSessions.set(page, session);
  }
  const shot = await (await session).send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true });
  return Buffer.from(shot.data, "base64");
}

/**
 * Pixel comparison with a tiny tolerance. Exact hashes are too strict:
 * Chromium's raster occasionally differs by ±1 on a single anti-aliased
 * pixel between two paints of the *same* DOM (observed on shopkart's hook
 * scene), while real impurity (Math.random positions, clock-driven motion)
 * moves whole glyphs/elements — hundreds to thousands of pixels.
 */
export function framesDiffer(a: Buffer, b: Buffer, opts: { channelTolerance?: number; maxDiffPixels?: number } = {}): { differ: boolean; diffPixels: number } {
  if (a.equals(b)) return { differ: false, diffPixels: 0 };
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  if (pa.width !== pb.width || pa.height !== pb.height) return { differ: true, diffPixels: Infinity };
  const tolC = opts.channelTolerance ?? 6;
  let diff = 0;
  for (let i = 0; i < pa.data.length; i += 4) {
    if (
      Math.abs(pa.data[i]! - pb.data[i]!) > tolC ||
      Math.abs(pa.data[i + 1]! - pb.data[i + 1]!) > tolC ||
      Math.abs(pa.data[i + 2]! - pb.data[i + 2]!) > tolC
    )
      diff++;
  }
  return { differ: diff > (opts.maxDiffPixels ?? 8), diffPixels: diff };
}

/** Settle time (absolute) for each scene: its template's "settle" mark, clamped inside the scene, after any crossfade. */
export function settleTimes(manifest: FilmManifest): { sceneId: string; t: number }[] {
  return manifest.scenes.map((s) => {
    const len = s.end - s.start;
    let local = len * 0.9;
    try {
      const mark = createTemplate(s.templateId).marks(s.props).find((m) => m.type === "settle");
      if (mark) local = mark.t;
    } catch {
      // unknown template / bad props — keep the 90% fallback
    }
    local = Math.max(local, s.transitionInSec ?? 0);
    // Stay clear of the next scene's crossfade (which starts transitionInSec before this scene's end).
    const next = manifest.scenes.find((n) => n.start > s.start && n.start < s.end);
    const latest = (next ? next.start - s.start : len) - 1 / manifest.fps;
    return { sceneId: s.id, t: s.start + Math.max(0, Math.min(local, latest)) };
  });
}

interface ProbeOutput {
  found: boolean;
  textItems: { text: string; opacity: number; rect: [number, number, number, number]; color: string; bg: string; fontSize: number; fontWeight: number; clipped: boolean; glue?: boolean }[];
  overflowEls: { tag: string; cls: string; rect: [number, number, number, number] }[];
  /** Bounding box of everything the scene draws at its settle frame; null when it draws nothing. */
  content?: [number, number, number, number] | null;
}

/**
 * A settled scene should use at least this share of the title-safe area; less reads as a small thing lost in
 * the frame. Set below a centred end card (logo, line, button: about 20%), which is small by design.
 */
const MIN_FILL = 0.18;

/**
 * §4.6 "QA" browser probes — everything that needs real pixels/layout:
 *  - purity: seek(t) is pixel-identical (same page re-seek, seek-away-and-back,
 *    AND a fresh page load, which catches randomness at mount time too);
 *  - full text probe: every expected on-screen string is visible (opacity,
 *    non-empty clipped box) at the scene's settle mark;
 *  - overflow: no element's *visible* (ancestor-clipped) box leaves the frame;
 *  - safe area: every text box sits inside the title-safe rect that the
 *    templates themselves lay out against (film-runtime SAFE_AREA);
 *  - text clipping: no text element's content is wider/taller than its box
 *    under a clipping overflow;
 *  - per-element WCAG contrast of text against its effective background;
 *  - contact sheet: a grid of settle frames for human/vision review.
 * Hard gates (error): purity, overflow, safe area, clipping, missing text.
 * Contrast is a warning — brand colors are the customer's call, and the
 * player already derives readable inks where it can.
 */
export async function runFilmQa(opts: FilmQaOptions): Promise<FilmQaResult> {
  const started = Date.now();
  const { manifest } = opts;
  const tol = opts.tolerancePx ?? 2;
  const issues: FilmQaIssue[] = [];
  const purity: FilmQaResult["purity"] = [];
  const contrast: ContrastSample[] = [];
  const textOut: FilmQaResult["text"] = [];
  let contactSheet: Buffer | null = null;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sitereel-qa-"));

  const browser = await chromium.launch({ args: BROWSER_ARGS });
  try {
    const page = await openFilmPage(browser, manifest, opts.filmHost, opts.manifestUrl);

    // --- Purity -----------------------------------------------------------
    const n = opts.puritySamples ?? Math.min(12, Math.max(6, manifest.scenes.length * 2));
    const times = Array.from({ length: n }, (_, i) => (manifest.duration * (i + 0.5)) / n);
    const elsewhere = manifest.duration * 0.02;
    const firstFrames: Buffer[] = [];
    for (const t of times) {
      const f1 = await grabFrame(page, t);
      const f2 = await grabFrame(page, t);
      await grabFrame(page, elsewhere);
      const f3 = await grabFrame(page, t);
      firstFrames.push(f1);
      const d12 = framesDiffer(f1, f2);
      const d13 = framesDiffer(f1, f3);
      const ok = !d12.differ && !d13.differ;
      purity.push({ t, ok, reason: ok ? undefined : `re-seek produced different pixels (${Math.max(d12.diffPixels, d13.diffPixels)} px)` });
    }
    // Fresh mount: catches templates that randomize at mount() (stable within one page, different across loads).
    const page2 = await openFilmPage(browser, manifest, opts.filmHost, opts.manifestUrl);
    for (const [i, t] of times.entries()) {
      const d = framesDiffer(await grabFrame(page2, t), firstFrames[i]!);
      if (d.differ && purity[i]!.ok) purity[i] = { t, ok: false, reason: `fresh page load produced different pixels (${d.diffPixels} px)` };
    }
    await page2.context().close();
    for (const p of purity.filter((x) => !x.ok)) {
      const scene = manifest.scenes.find((s) => p.t >= s.start && p.t < s.end);
      issues.push({ code: "purity_failed", severity: "error", sceneId: scene?.id, message: `seek(${p.t.toFixed(2)}) is not deterministic: ${p.reason}` });
    }

    // --- Per-scene layout / text / contrast probes ------------------------
    const safe = safeRect(manifest.width, manifest.height);
    const settles = settleTimes(manifest);
    const sheetFrames: string[] = [];
    for (const { sceneId, t } of settles) {
      await seekPage(page, t);
      if (opts.contactSheet !== false) {
        const p = path.join(tmp, `settle-${sheetFrames.length}.jpg`);
        await page.screenshot({ type: "jpeg", quality: 85, path: p });
        sheetFrames.push(p);
      }

      const probe = (await page.evaluate(`(${SCENE_PROBE_JS})(${JSON.stringify({ sceneId, vw: manifest.width, vh: manifest.height })})`)) as ProbeOutput;

      if (!probe.found) {
        issues.push({ code: "scene_not_found", severity: "error", sceneId, message: `Scene ${sceneId} not visible at its settle time ${t.toFixed(2)}s` });
        continue;
      }

      const visible = probe.textItems.filter((i) => i.opacity > 0.5 && i.rect[2] - i.rect[0] > 0);
      const visibleText = visible.map((i, n) => (n > 0 && !i.glue ? " " : "") + i.text).join("");
      textOut.push({ sceneId, t, visibleText });

      for (const expected of opts.expectedText?.[sceneId] ?? []) {
        if (!normalize(visibleText).includes(normalize(expected))) {
          issues.push({
            code: "text_not_visible",
            severity: "error",
            sceneId,
            message: `Scene ${sceneId}: expected on-screen text "${expected}" not fully visible at settle (saw "${visibleText.slice(0, 120)}")`,
          });
        }
      }

      if (probe.content) {
        const [cl, ct, cr, cb] = probe.content;
        const fill = (Math.max(0, Math.min(cr, safe.right) - Math.max(cl, safe.left)) * Math.max(0, Math.min(cb, safe.bottom) - Math.max(ct, safe.top))) / (safe.width * safe.height);
        if (fill < MIN_FILL) {
          issues.push({ code: "low_fill", severity: "warning", sceneId, message: `Scene ${sceneId}: content covers ${Math.round(fill * 100)}% of the title-safe area at its settled frame (under ${MIN_FILL * 100}%)`, details: { content: probe.content.map(Math.round) } });
        }
      }

      for (const o of probe.overflowEls.slice(0, 3)) {
        issues.push({
          code: "overflow",
          severity: "error",
          sceneId,
          message: `Scene ${sceneId}: <${o.tag} class="${o.cls}"> extends outside the frame (${o.rect.map((v) => Math.round(v)).join(",")})`,
          details: { rect: o.rect },
        });
      }

      for (const item of visible) {
        const [l, tp, r, b] = item.rect;
        const outside = l < safe.left - tol || tp < safe.top - tol || r > safe.right + tol || b > safe.bottom + tol;
        const offFrame = l < -tol || tp < -tol || r > manifest.width + tol || b > manifest.height + tol;
        if (offFrame) {
          issues.push({ code: "overflow", severity: "error", sceneId, message: `Scene ${sceneId}: text "${item.text.slice(0, 40)}" runs outside the frame`, details: { rect: item.rect } });
        } else if (outside) {
          issues.push({
            code: "safe_area",
            severity: "error",
            sceneId,
            message: `Scene ${sceneId}: text "${item.text.slice(0, 40)}" is outside the title-safe area`,
            details: { rect: item.rect.map(Math.round), safe: [safe.left, safe.top, safe.right, safe.bottom].map(Math.round) },
          });
        }
        if (item.clipped) {
          issues.push({ code: "text_clipped", severity: "error", sceneId, message: `Scene ${sceneId}: text "${item.text.slice(0, 40)}" is clipped by its container` });
        }

        const ratio = contrastRatio(item.color, item.bg) ?? 21;
        const required = item.fontSize >= 24 || (item.fontSize >= 18.66 && item.fontWeight >= 700) ? 3 : 4.5;
        contrast.push({ sceneId, text: item.text.slice(0, 60), color: item.color, background: item.bg, ratio: Number(ratio.toFixed(2)), required });
        if (ratio < required) {
          issues.push({
            code: "low_contrast",
            severity: "warning",
            sceneId,
            message: `Scene ${sceneId}: "${item.text.slice(0, 40)}" contrast ${ratio.toFixed(2)}:1 < ${required}:1 (${item.color} on ${item.bg})`,
          });
        }
      }
    }

    // --- Contact sheet ------------------------------------------------------
    if (opts.contactSheet !== false) {
      // Settle frames plus a few evenly spaced in-between frames (transitions, motion).
      const extra = Math.max(0, 12 - sheetFrames.length);
      for (let i = 0; i < extra; i++) {
        const t = (manifest.duration * (i + 0.5)) / extra;
        await seekPage(page, t);
        const p = path.join(tmp, `even-${i}.jpg`);
        await page.screenshot({ type: "jpeg", quality: 85, path: p });
        sheetFrames.push(p);
      }
      const sheetPath = path.join(tmp, "contact-sheet.jpg");
      await tileContactSheet(sheetFrames, sheetPath, { columns: 4, thumbWidth: manifest.width >= manifest.height ? 480 : 270 });
      contactSheet = await fs.readFile(sheetPath);
    }
  } catch (err) {
    issues.push({ code: "qa_crashed", severity: "error", message: `QA probe crashed: ${(err as Error).message}` });
  } finally {
    await browser.close();
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }

  return {
    passed: issues.every((i) => i.severity !== "error"),
    issues,
    purity,
    contrast,
    text: textOut,
    contactSheet,
    durationMs: Date.now() - started,
  };
}
