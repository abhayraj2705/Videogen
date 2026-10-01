import { chromium } from "playwright";
import { createHash } from "node:crypto";
import type { FilmManifest } from "@sitereel/film-runtime";
import { createTemplate } from "@sitereel/film-runtime";
import { validateStoryboard, type FactLedger, type Storyboard, type ValidationIssue } from "@sitereel/shared";

export interface QaReport {
  passed: boolean;
  issues: ValidationIssue[];
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function parseRgb(color: string): [number, number, number] | null {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** WCAG contrast ratio. Returns null (not failed) for color formats we can't parse (oklch/oklab) rather than guessing. */
function contrastRatio(a: string, b: string): number | null {
  const rgbA = parseRgb(a);
  const rgbB = parseRgb(b);
  if (!rgbA || !rgbB) return null;
  const lA = relativeLuminance(rgbA) + 0.05;
  const lB = relativeLuminance(rgbB) + 0.05;
  return lA > lB ? lA / lB : lB / lA;
}

function checkContrast(manifest: FilmManifest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ratio = contrastRatio(manifest.palette.fg, manifest.palette.bg);
  if (ratio !== null && ratio < 4.5) {
    issues.push({
      code: "low_contrast",
      message: `fg/bg contrast ratio is ${ratio.toFixed(2)}:1, WCAG AA body text needs >= 4.5:1`,
      severity: "warning",
    });
  }
  return issues;
}

/**
 * §4.6 "QA": purity (seek(t) must be pixel-identical — reuses the same check
 * packages/renderer uses in Phase 0), a visible-text probe at each scene's
 * settle mark, a safe-area/overflow check, a contrast check, and a grounding
 * re-check. Hard gates (purity, text, overflow, grounding) produce errors;
 * contrast is a soft warning. Unlike the plan's full spec, there's no
 * vision-LLM contact-sheet review here — that needs a vision-capable model
 * call this environment has no verified key for; documented in PHASE4.md.
 */
export async function runQaStage(opts: {
  manifest: FilmManifest;
  filmHost: string;
  manifestUrl: string;
  storyboard: Storyboard;
  facts: FactLedger;
}): Promise<QaReport> {
  const { manifest, filmHost, manifestUrl, storyboard, facts } = opts;
  const issues: ValidationIssue[] = [];

  issues.push(...checkContrast(manifest));
  const grounding = validateStoryboard(storyboard, facts);
  issues.push(...grounding.issues);

  const browser = await chromium.launch({ args: ["--font-render-hinting=none", "--force-color-profile=srgb"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: manifest.width, height: manifest.height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`${filmHost}/film.html?manifest=${encodeURIComponent(manifestUrl)}`);
    await page.waitForFunction(() => window.__film?.ready === true, undefined, { timeout: 30_000 });

    // Purity: a handful of sample points per scene, not every frame — this is
    // a correctness smoke test, not a frame-by-frame audit.
    const sampleCount = Math.min(9, manifest.scenes.length * 2);
    for (let i = 0; i < sampleCount; i++) {
      const t = (manifest.duration * (i + 0.5)) / sampleCount;
      const hash1 = await hashFrame(page, t);
      const hash2 = await hashFrame(page, t);
      await hashFrame(page, manifest.duration * 0.02);
      const hash3 = await hashFrame(page, t);
      if (hash1 !== hash2 || hash2 !== hash3) {
        issues.push({ code: "purity_failed", message: `seek(${t.toFixed(2)}) is not pixel-stable`, severity: "error" });
      }
    }

    // Text visibility + overflow/safe-area at each scene's settle mark.
    for (const resolvedScene of manifest.scenes) {
      const storyboardScene = storyboard.scenes.find((s) => s.id === resolvedScene.id);
      if (!storyboardScene) continue;

      let settleLocalT = (resolvedScene.end - resolvedScene.start) * 0.9;
      try {
        const marks = createTemplate(resolvedScene.templateId).marks(resolvedScene.props);
        const settleMark = marks.find((m) => m.type === "settle");
        if (settleMark) settleLocalT = settleMark.t;
      } catch {
        // unknown template or marks() threw on malformed props — keep the 90%-of-duration fallback
      }
      const settleT = resolvedScene.start + Math.min(settleLocalT, resolvedScene.end - resolvedScene.start - 0.05);

      await page.evaluate((t) => window.__film.seek(t), settleT);
      const probe = await page.evaluate(
        ({ sceneId, vw, vh }) => {
          const root = document.querySelector<HTMLElement>(`[data-scene-id="${sceneId}"]`);
          if (!root) return { found: false, text: "", overflowed: false };
          const text = (root.innerText ?? "").trim();
          // An element whose box extends past the viewport is only a real
          // problem if nothing between it and the scene root actually clips
          // it — a kenburns-zoomed <img> inside an `overflow: hidden` wrapper
          // is *designed* to overflow its own box; only its clipped, visible
          // extent matters. Each element's "visible" rect is its own box
          // intersected with every ancestor's box up to the scene root.
          let overflowed = false;
          for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
            let rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;

            let node: HTMLElement | null = el.parentElement;
            while (node && node !== root.parentElement) {
              if (getComputedStyle(node).overflow !== "visible") {
                const pr = node.getBoundingClientRect();
                const left = Math.max(rect.left, pr.left);
                const top = Math.max(rect.top, pr.top);
                const right = Math.min(rect.right, pr.right);
                const bottom = Math.min(rect.bottom, pr.bottom);
                rect = { left, top, right, bottom, width: right - left, height: bottom - top } as DOMRect;
                if (rect.width <= 0 || rect.height <= 0) break; // fully clipped away — not a safe-area concern
              }
              node = node.parentElement;
            }
            if (rect.width <= 0 || rect.height <= 0) continue;

            if (rect.left < -2 || rect.top < -2 || rect.right > vw + 2 || rect.bottom > vh + 2) {
              overflowed = true;
              break;
            }
          }
          return { found: true, text, overflowed };
        },
        { sceneId: resolvedScene.id, vw: manifest.width, vh: manifest.height },
      );

      if (!probe.found) {
        issues.push({ code: "scene_not_found", message: `Scene ${resolvedScene.id} root not in DOM at settle time`, sceneId: resolvedScene.id, severity: "error" });
        continue;
      }
      const expectedText = storyboardScene.onScreenText.join(" ").trim();
      if (expectedText && !probe.text.includes(expectedText.slice(0, Math.min(20, expectedText.length)))) {
        issues.push({
          code: "text_not_visible",
          message: `Scene ${resolvedScene.id} expected on-screen text not found at settle time`,
          sceneId: resolvedScene.id,
          severity: "error",
        });
      }
      if (probe.overflowed) {
        issues.push({ code: "overflow", message: `Scene ${resolvedScene.id} has an element outside the safe area at settle time`, sceneId: resolvedScene.id, severity: "error" });
      }
    }
  } finally {
    await browser.close();
  }

  return { passed: issues.every((i) => i.severity !== "error"), issues };
}

async function hashFrame(page: import("playwright").Page, t: number): Promise<string> {
  await page.evaluate((tt) => window.__film.seek(tt), t);
  const png = await page.screenshot({ type: "png" });
  return createHash("sha256").update(png).digest("hex");
}
