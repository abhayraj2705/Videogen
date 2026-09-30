import type { Page } from "playwright";

const CONSENT_BUTTON_TEXT = [
  "accept all",
  "accept cookies",
  "accept",
  "i agree",
  "agree",
  "allow all",
  "got it",
  "ok",
];

/** Best-effort consent-banner dismissal so it doesn't block the hero content in screenshots. */
export async function dismissConsentBanner(page: Page): Promise<void> {
  for (const text of CONSENT_BUTTON_TEXT) {
    try {
      const button = page.getByRole("button", { name: new RegExp(`^${text}$`, "i") }).first();
      if (await button.isVisible({ timeout: 800 }).catch(() => false)) {
        await button.click({ timeout: 1500 });
        await page.waitForTimeout(200);
        return;
      }
    } catch {
      // selector not present or not clickable — try the next candidate
    }
  }
}

/** Scrolls the full page once so lazy-loaded images/sections are in the DOM before extraction. */
export async function scrollThroughPage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = window.innerHeight;
    const total = document.body.scrollHeight;
    for (let y = 0; y < total; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
}

const INTERESTING_PATH_HINTS = ["pricing", "features", "product", "about", "docs", "solutions"];

/** Finds up to `limit` same-origin pages worth an extra crawl pass (§4.6 "Crawl"). */
export async function discoverSameOriginPages(page: Page, baseUrl: string, limit: number): Promise<string[]> {
  const origin = new URL(baseUrl).origin;

  const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href") ?? ""));

  const candidates = new Map<string, number>(); // url -> score
  for (const href of hrefs) {
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    if (url.pathname === new URL(baseUrl).pathname) continue;

    const lowerPath = url.pathname.toLowerCase();
    const score = INTERESTING_PATH_HINTS.some((hint) => lowerPath.includes(hint)) ? 2 : 1;
    const key = url.toString().split("#")[0]!;
    candidates.set(key, Math.max(candidates.get(key) ?? 0, score));
  }

  return Array.from(candidates.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([url]) => url);
}
