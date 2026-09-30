import { chromium } from "playwright";
import type { FilmManifest } from "@sitereel/film-runtime";
import { createHash } from "node:crypto";
import { VIRTUAL_CLOCK_INIT_SCRIPT } from "./virtual-clock.js";

export interface PurityResult {
  passed: boolean;
  samples: { t: number; hash1: string; hash2: string; hash3: string; ok: boolean }[];
}

/**
 * Purity test (§4.7): for N sample times, seek(t) must always produce identical
 * pixels. Hash at t, hash again (no-op re-render), seek elsewhere and back, hash
 * a third time. All three must match. Catches Math.random, Date.now, rAF-driven
 * animation, or any other impurity a template might accidentally depend on.
 */
export async function runPurityTest(
  manifest: FilmManifest,
  filmHost: string,
  manifestUrl: string,
  sampleCount = 9,
): Promise<PurityResult> {
  const browser = await chromium.launch({
    args: ["--font-render-hinting=none", "--force-color-profile=srgb"],
  });
  const samples: PurityResult["samples"] = [];
  try {
    const ctx = await browser.newContext({
      viewport: { width: manifest.width, height: manifest.height },
      deviceScaleFactor: 1,
    });
    await ctx.addInitScript(VIRTUAL_CLOCK_INIT_SCRIPT);
    const page = await ctx.newPage();

    const pageUrl = `${filmHost}/film.html?manifest=${encodeURIComponent(manifestUrl)}`;
    await page.goto(pageUrl);
    await page.waitForFunction(() => window.__film?.ready === true, undefined, { timeout: 30_000 });

    const sampleTimes = Array.from({ length: sampleCount }, (_, i) => (manifest.duration * (i + 0.5)) / sampleCount);
    const elsewhereT = manifest.duration * 0.02; // a point unlikely to equal any sample

    const hashAt = async (t: number): Promise<string> => {
      await page.evaluate((tt) => {
        window.__setVirtualTimeMs(tt * 1000);
        window.__film.seek(tt);
      }, t);
      const png = await page.screenshot({ type: "png" });
      return createHash("sha256").update(png).digest("hex");
    };

    for (const t of sampleTimes) {
      const hash1 = await hashAt(t);
      const hash2 = await hashAt(t);
      await hashAt(elsewhereT);
      const hash3 = await hashAt(t);
      const ok = hash1 === hash2 && hash2 === hash3;
      samples.push({ t, hash1, hash2, hash3, ok });
    }
  } finally {
    await browser.close();
  }

  return { passed: samples.every((s) => s.ok), samples };
}
