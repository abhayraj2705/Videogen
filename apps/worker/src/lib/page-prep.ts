import type { Frame, Page } from "playwright";

const CONSENT_BUTTON_TEXT = [
  "accept all",
  "accept all cookies",
  "allow all",
  "allow all cookies",
  "accept cookies",
  "accept",
  "i accept",
  "i agree",
  "agree",
  "agree and close",
  "got it",
  "ok",
  "okay",
  "alle akzeptieren",
  "tout accepter",
  "accepter",
  "aceptar",
  "aceptar todo",
  "accetta",
  "accetta tutto",
];

// Known CMP buttons (OneTrust, Cookiebot, Didomi, Quantcast, TrustArc, Usercentrics, Osano, CookieYes, generic).
const CONSENT_SELECTORS = [
  "#onetrust-accept-btn-handler",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#CybotCookiebotDialogBodyButtonAccept",
  "#didomi-notice-agree-button",
  ".qc-cmp2-summary-buttons button[mode='primary']",
  "#truste-consent-button",
  "button[data-testid='uc-accept-all-button']",
  ".osano-cm-accept-all",
  ".cky-btn-accept",
  ".cc-allow",
  ".cc-accept",
  "button[id*='accept' i][id*='cookie' i]",
  "button[class*='accept' i][class*='cookie' i]",
  "[aria-label*='accept all' i]",
  "[data-testid*='accept' i][data-testid*='cookie' i]",
];

// Iframe-hosted CMPs (Sourcepoint, TrustArc, Quantcast iframes) — matched by frame URL.
const CONSENT_FRAME_HINTS = /consent|cmp|privacy|sourcepoint|trustarc|cookie|sp_message|gdpr/i;

const CONSENT_TEXT_RE = new RegExp(`^\\s*(${CONSENT_BUTTON_TEXT.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*$`, "i");

/** Two combined locator probes (known CMP selectors, then consent button text) — a handful of round trips, not one per candidate. */
async function clickFirstVisible(frame: Frame | Page, timeoutMs: number): Promise<boolean> {
  const candidates = [frame.locator(CONSENT_SELECTORS.join(", ")), frame.getByRole("button", { name: CONSENT_TEXT_RE })];
  for (const loc of candidates) {
    try {
      const count = Math.min(await loc.count(), 5);
      for (let i = 0; i < count; i++) {
        const el = loc.nth(i);
        if (await el.isVisible().catch(() => false)) {
          await el.click({ timeout: timeoutMs });
          return true;
        }
      }
    } catch {
      // not present / not clickable — try the next probe
    }
  }
  return false;
}

/**
 * Best-effort consent-banner dismissal so it doesn't block the hero content in
 * screenshots: known CMP selectors and button text in the page, then in any
 * consent-looking iframe, then (as a last resort) hide fixed overlays whose
 * id/class says cookie/consent. Bounded by `budgetMs`.
 */
export async function dismissConsentBanner(page: Page, budgetMs = 4_000): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  const clickTimeout = 1_500;

  if (await clickFirstVisible(page, clickTimeout)) {
    await page.waitForTimeout(250);
    return true;
  }

  for (const frame of page.frames()) {
    if (Date.now() > deadline) break;
    if (frame === page.mainFrame()) continue;
    if (!CONSENT_FRAME_HINTS.test(frame.url()) && !CONSENT_FRAME_HINTS.test(frame.name())) continue;
    if (await clickFirstVisible(frame, clickTimeout)) {
      await page.waitForTimeout(250);
      return true;
    }
  }

  // Nothing clickable: hide consent overlays so at least the screenshots are clean.
  await page
    .addStyleTag({
      content:
        '[id*="cookie" i][style*="fixed"], [class*="cookie-banner" i], [class*="cookie-consent" i], [id*="consent" i], [class*="consent-banner" i], #onetrust-consent-sdk, #CybotCookiebotDialog, iframe[src*="consent" i], iframe[id*="sp_message" i] { display: none !important; }',
    })
    .catch(() => undefined);
  return false;
}

/** Waits for network idle, but never longer than `capMs` — some sites never go idle (analytics beacons, websockets). */
export async function waitForNetworkIdleCapped(page: Page, capMs: number): Promise<void> {
  if (capMs <= 0) return;
  await page.waitForLoadState("networkidle", { timeout: capMs }).catch(() => undefined);
}

/** Waits for document.fonts.ready, capped. */
export async function waitForFontsCapped(page: Page, capMs: number): Promise<void> {
  if (capMs <= 0) return;
  await Promise.race([page.evaluate(() => document.fonts?.ready.then(() => undefined)).catch(() => undefined), page.waitForTimeout(capMs)]);
}

/** Scrolls the page by viewport with short pauses so lazy-loaded sections are in the DOM before extraction. Bounded by `budgetMs`. */
export async function scrollThroughPage(page: Page, budgetMs = 6_000): Promise<void> {
  await page
    .evaluate(async (budget: number) => {
      const start = Date.now();
      const step = window.innerHeight;
      const maxY = Math.min(document.body.scrollHeight, step * 25);
      for (let y = 0; y < maxY && Date.now() - start < budget; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 150));
      }
      window.scrollTo(0, 0);
    }, budgetMs)
    .catch(() => undefined);
}

/** Visible body text word count — distinguishes a real page from an empty SPA shell or a challenge page. */
export async function visibleWordCount(page: Page): Promise<number> {
  return page
    .evaluate(() => (document.body?.innerText ?? "").trim().split(/\s+/).filter(Boolean).length)
    .catch(() => 0);
}

export interface SectionShot {
  index: number;
  y: number;
  png: Buffer;
}

/**
 * Per-section screenshots: one viewport-sized capture per scroll position,
 * top to bottom, up to `maxSections` (§4.6 "Crawl": per-section screenshots).
 * Scenes like SectionShowcase can then use the exact slice that shows a
 * feature instead of a squashed full-page image.
 */
export async function captureSectionScreenshots(page: Page, maxSections: number, shouldStop: () => boolean): Promise<SectionShot[]> {
  const { viewportHeight, scrollHeight } = await page.evaluate(() => ({ viewportHeight: window.innerHeight, scrollHeight: document.body.scrollHeight }));
  const shots: SectionShot[] = [];
  const count = Math.min(maxSections, Math.max(1, Math.ceil(scrollHeight / viewportHeight)));
  for (let i = 0; i < count; i++) {
    if (shouldStop()) break;
    const y = i * viewportHeight;
    await page.evaluate((top: number) => window.scrollTo(0, top), y);
    await page.waitForTimeout(150);
    const png = await page.screenshot({ type: "png", timeout: 8_000 });
    shots.push({ index: i, y, png });
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  return shots;
}

/** A "full page" screenshot capped at `maxHeightCss` so very long pages at deviceScaleFactor 2 stay within Chromium/R2 limits. */
export async function captureCappedFullPage(page: Page, maxHeightCss: number): Promise<Buffer> {
  const dims = await page.evaluate(() => ({ w: document.documentElement.clientWidth || window.innerWidth, h: document.body.scrollHeight }));
  return page.screenshot({
    type: "png",
    fullPage: true,
    // The overview shot is CSS-pixel scale (half the pixels at DPR 2) — encoding a 2x
    // 8000px-tall PNG costs seconds; the per-section shots keep full device resolution.
    scale: "css",
    clip: { x: 0, y: 0, width: dims.w, height: Math.max(1, Math.min(dims.h, maxHeightCss)) },
    timeout: 15_000,
  });
}

const INTERESTING_PATH_HINTS = ["pricing", "features", "feature", "product", "about", "docs", "solutions", "how-it-works", "customers"];
const SKIP_PATH_HINTS = /\/(login|signin|sign-in|signup|sign-up|register|cart|checkout|account|legal|privacy|terms|cookie|careers|jobs|blog\/.+)/i;
const SKIP_EXTENSIONS = /\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|mov|dmg|exe)$/i;

/** Finds up to `limit` same-origin pages worth an extra crawl pass (§4.6 "Crawl": pricing, features, about, docs). */
export async function discoverSameOriginPages(page: Page, baseUrl: string, limit: number): Promise<string[]> {
  const origin = new URL(baseUrl).origin;
  const basePath = new URL(baseUrl).pathname;

  const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href") ?? ""));
  return rankSameOriginLinks(hrefs, baseUrl, origin, basePath, limit);
}

export function rankSameOriginLinks(hrefs: string[], baseUrl: string, origin: string, basePath: string, limit: number): string[] {
  const candidates = new Map<string, number>(); // url -> score
  for (const href of hrefs) {
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    if (url.pathname === basePath) continue;
    if (SKIP_PATH_HINTS.test(url.pathname) || SKIP_EXTENSIONS.test(url.pathname)) continue;

    const lowerPath = url.pathname.toLowerCase();
    const hintIdx = INTERESTING_PATH_HINTS.findIndex((hint) => lowerPath.includes(hint));
    const depth = lowerPath.split("/").filter(Boolean).length;
    const score = (hintIdx >= 0 ? 10 - hintIdx * 0.5 : 1) - depth * 0.1;
    url.hash = "";
    url.search = "";
    const key = url.toString();
    candidates.set(key, Math.max(candidates.get(key) ?? -Infinity, score));
  }

  return Array.from(candidates.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([url]) => url);
}
