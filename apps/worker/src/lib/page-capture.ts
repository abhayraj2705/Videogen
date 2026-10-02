import type { Page } from "playwright";

/**
 * Capture of a live page as the film will show it.
 *
 * A Chromium `fullPage` screenshot resizes the viewport to the whole document
 * and photographs it without ever scrolling, so anything a site reveals on
 * scroll (IntersectionObserver fades, lazy sections, in-view animations) is
 * photographed before it exists: large blank stretches in the middle of the
 * page. Here the page is scrolled for real, one viewport at a time, each
 * viewport is photographed once its content has landed, and the tiles are
 * joined into the full-page image. The same tiles are the per-section shots.
 */

export interface PageTile {
  /** Scroll offset (CSS px) the tile was taken at. */
  y: number;
  png: Buffer;
  /** Share of the tile (0-1) that is not its background colour. Near zero = an empty stretch. */
  ink: number;
}

export interface TiledCapture {
  /** The joined full-page image, cut short where the page runs out of content. */
  full: Buffer;
  /** Height of `full` in CSS px. */
  heightCss: number;
  tiles: PageTile[];
}

/** Below this share of non-background pixels a viewport is an empty stretch, not a section worth showing. */
export const BLANK_INK = 0.004;
const TILE_SETTLE_MS = 320;

/** Hides fixed bars (and top-stuck sticky ones) so the site header is not stamped onto every tile below the first. */
async function setFloatingChromeHidden(page: Page, hidden: boolean): Promise<void> {
  await page
    .evaluate((hide: boolean) => {
      if (!hide) {
        document.querySelectorAll<HTMLElement>("[data-sr-hidden]").forEach((el) => {
          // Put back exactly what the site had inline (an animation library may own this property).
          const [value, priority] = (el.getAttribute("data-sr-hidden") ?? "|").split("|");
          if (value) el.style.setProperty("opacity", value, priority ?? "");
          else el.style.removeProperty("opacity");
          el.removeAttribute("data-sr-hidden");
        });
        return;
      }
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const position = getComputedStyle(el).position;
        if (position !== "fixed" && position !== "sticky") continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // Sticky panels inside the content stay: only bars stuck to the top edge repeat on every tile.
        if (position === "sticky" && !(r.top <= 1 && r.height < 160)) continue;
        // Opacity, not visibility: a child can opt back into `visibility: visible`, but nothing shows through opacity 0.
        el.setAttribute("data-sr-hidden", `${el.style.getPropertyValue("opacity")}|${el.style.getPropertyPriority("opacity")}`);
        el.style.setProperty("opacity", "0", "important");
      }
    }, hidden)
    .catch(() => undefined);
}

/** Scrolls to `top`, then waits for the viewport's images and a short settle so in-view animations have played. */
async function scrollAndSettle(page: Page, top: number): Promise<number> {
  const actual = await page.evaluate(async (y: number) => {
    window.scrollTo(0, y);
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const inView = Array.from(document.images).filter((img) => {
      const r = img.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight && r.width > 0;
    });
    for (const img of inView) if (img.loading === "lazy") img.loading = "eager";
    await Promise.race([
      Promise.all(inView.map((img) => (img.complete ? Promise.resolve() : new Promise<void>((r) => img.addEventListener("load", () => r(), { once: true }))))),
      new Promise<void>((r) => setTimeout(r, 900)),
    ]);
    return window.scrollY;
  }, top);
  await page.waitForTimeout(TILE_SETTLE_MS);
  return actual;
}

/**
 * Joins tiles into one image inside a blank helper page (no image library in
 * the worker: a canvas does it) and measures how much of each tile is content.
 */
async function composeTiles(helper: Page, tiles: { y: number; png: Buffer }[], cssWidth: number, cssHeight: number, viewportHeight: number): Promise<{ full: Buffer; heightCss: number; ink: number[] }> {
  const out = await helper.evaluate(
    async (input: { tiles: { y: number; b64: string }[]; cssWidth: number; cssHeight: number; viewportHeight: number; blankInk: number }) => {
      const bitmaps: ImageBitmap[] = [];
      for (const t of input.tiles) {
        const bin = atob(t.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        bitmaps.push(await createImageBitmap(new Blob([bytes], { type: "image/png" })));
      }
      const first = bitmaps[0]!;
      const ratio = first.width / input.cssWidth;

      // Content per tile, on a small copy: the share of pixels that differ from the tile's most common brightness.
      const small = document.createElement("canvas");
      small.width = 160;
      small.height = Math.max(1, Math.round((160 * first.height) / first.width));
      const sg = small.getContext("2d", { willReadFrequently: true })!;
      const ink = bitmaps.map((bmp) => {
        sg.clearRect(0, 0, small.width, small.height);
        sg.drawImage(bmp, 0, 0, small.width, small.height);
        const px = sg.getImageData(0, 0, small.width, small.height).data;
        const bins = new Array<number>(256).fill(0);
        const lum = new Uint8Array(px.length / 4);
        for (let i = 0; i < lum.length; i++) {
          const v = Math.round(0.2126 * px[i * 4]! + 0.7152 * px[i * 4 + 1]! + 0.0722 * px[i * 4 + 2]!);
          lum[i] = v;
          bins[v] = bins[v]! + 1;
        }
        let mode = 0;
        for (let v = 1; v < 256; v++) if (bins[v]! > bins[mode]!) mode = v;
        let differing = 0;
        for (let i = 0; i < lum.length; i++) if (Math.abs(lum[i]! - mode) > 14) differing++;
        return differing / lum.length;
      });

      // The page ends where its content does: empty tiles at the bottom are cut off.
      let last = input.tiles.length - 1;
      while (last > 0 && ink[last]! < input.blankInk) last--;
      const heightCss = Math.min(input.cssHeight, input.tiles[last]!.y + input.viewportHeight);

      const canvas = document.createElement("canvas");
      canvas.width = first.width;
      canvas.height = Math.max(1, Math.round(heightCss * ratio));
      const g = canvas.getContext("2d")!;
      input.tiles.forEach((t, i) => g.drawImage(bitmaps[i]!, 0, Math.round(t.y * ratio)));
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("canvas export failed");
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { b64: btoa(s), heightCss, ink };
    },
    { tiles: tiles.map((t) => ({ y: t.y, b64: t.png.toString("base64") })), cssWidth, cssHeight, viewportHeight, blankInk: BLANK_INK },
  );
  return { full: Buffer.from(out.b64, "base64"), heightCss: out.heightCss, ink: out.ink };
}

/**
 * The page as a column of viewport photographs taken while really scrolled,
 * joined into one full-page image no taller than `maxHeightCss`.
 * `helper` is a blank page in the same browser context, used as the canvas.
 */
export async function captureTiledPage(page: Page, helper: Page, opts: { maxHeightCss: number; scale: "css" | "device"; shouldStop?: () => boolean }): Promise<TiledCapture> {
  const dims = await page.evaluate(() => ({ w: document.documentElement.clientWidth || window.innerWidth, vh: window.innerHeight, h: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) }));
  const total = Math.max(dims.vh, Math.min(dims.h, opts.maxHeightCss));
  const raw: { y: number; png: Buffer }[] = [];
  try {
    for (let y = 0; y < total; y += dims.vh) {
      if (raw.length > 0 && opts.shouldStop?.()) break;
      const actual = await scrollAndSettle(page, y);
      // Past the first screen the site header would repeat on every tile.
      if (y > 0 && raw.length === 1) {
        await setFloatingChromeHidden(page, true);
        await page.waitForTimeout(60);
      }
      // The last scroll position is clamped to the bottom of the page: a tile that would overlap the previous one whole is skipped.
      if (raw.length > 0 && actual <= raw[raw.length - 1]!.y) break;
      raw.push({ y: actual, png: await page.screenshot({ type: "png", scale: opts.scale, timeout: 8_000 }) });
      if (actual < y) break;
    }
  } finally {
    await setFloatingChromeHidden(page, false);
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  }
  const cssHeight = Math.min(total, raw[raw.length - 1]!.y + dims.vh);
  const composed = await composeTiles(helper, raw, dims.w, cssHeight, dims.vh);
  return { full: composed.full, heightCss: composed.heightCss, tiles: raw.map((t, i) => ({ ...t, ink: composed.ink[i] ?? 1 })) };
}

const EMPTY_STATE_RE =
  /\bno\s+(?:\w+\s+){0,3}(?:found|yet|available|to (?:show|display))\b|\bnothing (?:here|to (?:see|show)|found)\b|\b0 (?:results|items)\b|\bcoming soon\b|\bpage not found\b|\b404\b|\bsign in to (?:continue|view)\b|\blog in to (?:continue|view)\b/i;

/**
 * True for a page that mostly says it has nothing to show: an empty list
 * ("No templates found"), a 404, a login wall. Such a page is real, but
 * putting it in a product film advertises an empty product.
 */
export function looksEmptyState(visibleText: string): boolean {
  const words = visibleText.trim().split(/\s+/).filter(Boolean).length;
  return words < 140 && EMPTY_STATE_RE.test(visibleText);
}

export interface RecordedClip {
  /** Evenly spaced frames (JPEG); the same Buffer object repeats where the picture did not change. */
  frames: Buffer[];
  fps: number;
  width: number;
  height: number;
}

/**
 * Records the page while it is really scrolled: a slow ease down `viewports`
 * screens over `durationMs`, captured with Chromium's screencast. What the
 * site does on scroll — sticky headers, reveals, parallax, counters — is in
 * the footage, which a pan across a still screenshot can never show.
 * Returns null when the browser delivered too few frames to be worth playing.
 */
export async function recordScrollClip(page: Page, opts: { durationMs?: number; fps?: number; viewports?: number } = {}): Promise<RecordedClip | null> {
  const durationMs = opts.durationMs ?? 3_400;
  const fps = opts.fps ?? 12;
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  const raw: { t: number; data: Buffer }[] = [];
  const cdp = await page.context().newCDPSession(page);
  try {
    cdp.on("Page.screencastFrame", (f: { data: string; sessionId: number }) => {
      raw.push({ t: Date.now(), data: Buffer.from(f.data, "base64") });
      cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 });
    const t0 = Date.now();
    await page.evaluate(
      (o: { ms: number; viewports: number }) =>
        new Promise<void>((resolve) => {
          const start = performance.now();
          const hold = 350;
          const travel = Math.max(0, Math.min(document.documentElement.scrollHeight - window.innerHeight, window.innerHeight * o.viewports));
          const step = (now: number) => {
            const p = Math.min(1, Math.max(0, (now - start - hold) / (o.ms - 2 * hold)));
            const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
            window.scrollTo(0, travel * e);
            if (now - start < o.ms) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        }),
      { ms: durationMs, viewports: opts.viewports ?? 1.6 },
    );
    await cdp.send("Page.stopScreencast").catch(() => undefined);
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
    if (raw.length < 8) return null;
    // The screencast only delivers a frame when the picture changes; resample to a fixed rate, holding the last one.
    const count = Math.round((durationMs / 1000) * fps);
    const frames: Buffer[] = [];
    let k = 0;
    for (let i = 0; i < count; i++) {
      const at = t0 + (i * 1000) / fps;
      while (k + 1 < raw.length && raw[k + 1]!.t <= at) k++;
      frames.push(raw[k]!.data);
    }
    return { frames, fps, width: viewport.width, height: viewport.height };
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

export interface CapturedAsset {
  /** A name for a logo ("Slack"), or what an image shows (its alt text). */
  name: string;
  png: Buffer;
}

/**
 * Logos from the site's customer / integration strip: the row of small images
 * most sites put under "Trusted by". Each is photographed as rendered and named
 * from its alt text, label or file name. Empty when no such strip is found.
 */
export async function captureLogoStrip(page: Page, max = 8): Promise<CapturedAsset[]> {
  const found = await page
    .evaluate((limit: number) => {
      const NOISE = /\b(logo|logos|icon|image|img|brand|svg|png|wordmark|dark|light|white|black|color|colour)\b/gi;
      const GENERIC = /^(image|photo|picture|avatar|user|profile|star|arrow|check|icon|placeholder|untitled|\d+)$/i;
      const nameOf = (el: Element): string => {
        const img = el as HTMLImageElement;
        const fromFile = (img.currentSrc || img.src || "").split(/[?#]/)[0]!.split("/").pop()?.replace(/\.[a-z0-9]+$/i, "") ?? "";
        const raw = el.getAttribute("alt") || el.getAttribute("aria-label") || el.getAttribute("title") || el.querySelector?.("title")?.textContent || fromFile.replace(/[-_]+/g, " ");
        const name = raw.replace(NOISE, " ").replace(/\s+/g, " ").trim();
        if (!name || name.length > 28 || name.split(" ").length > 3 || GENERIC.test(name) || !/\p{L}/u.test(name)) return "";
        return /^\p{Ll}/u.test(name) ? name[0]!.toUpperCase() + name.slice(1) : name;
      };
      const candidates = Array.from(document.querySelectorAll("img, svg[aria-label], [role='img'][aria-label]")).filter((el) => {
        if (el.closest("header, nav, footer, button, [class*='avatar' i], [class*='testimonial' i]")) return false;
        const r = el.getBoundingClientRect();
        return r.height >= 14 && r.height <= 96 && r.width >= 28 && r.width <= 340 && nameOf(el) !== "";
      });
      // The strip is the nearest common container holding the most such images (at least four).
      const strips = new Map<Element, Element[]>();
      for (const el of candidates) {
        let host: Element | null = el.parentElement;
        for (let up = 0; host && up < 4; up++, host = host.parentElement) {
          const inside = candidates.filter((c) => host!.contains(c));
          if (inside.length >= 4) {
            strips.set(host, inside);
            break;
          }
        }
      }
      const best = [...strips.values()].sort((a, b) => b.length - a.length)[0] ?? [];
      const out: { id: string; name: string }[] = [];
      const seen = new Set<string>();
      for (const el of best) {
        const name = nameOf(el);
        if (seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        const id = `sr-logo-${out.length}`;
        el.setAttribute("data-sr-asset", id);
        out.push({ id, name });
        if (out.length >= limit) break;
      }
      return out;
    }, max)
    .catch(() => [] as { id: string; name: string }[]);

  const assets: CapturedAsset[] = [];
  for (const f of found) {
    const png = await page.locator(`[data-sr-asset="${f.id}"]`).screenshot({ type: "png", timeout: 2_500 }).catch(() => null);
    if (png) assets.push({ name: f.name, png });
  }
  return assets;
}

/**
 * The large pictures in the page's content — product photos, or screenshots of
 * the product the site itself embeds — photographed as rendered, biggest first.
 */
export async function captureContentImages(page: Page, max = 4): Promise<CapturedAsset[]> {
  const found = await page
    .evaluate((limit: number) => {
      const out: { id: string; name: string; area: number }[] = [];
      const seen = new Set<string>();
      for (const el of Array.from(document.querySelectorAll<HTMLImageElement | HTMLVideoElement>("img, video"))) {
        if (el.closest("header, nav, footer, [class*='avatar' i]") || el.hasAttribute("data-sr-asset")) continue;
        const r = el.getBoundingClientRect();
        // Big enough to fill a frame, small enough to be one picture rather than a page-wide background.
        if (r.width < 420 || r.height < 240 || r.height > window.innerHeight * 1.1) continue;
        const natural = el instanceof HTMLImageElement ? el.naturalWidth : el.videoWidth;
        if (natural > 0 && natural < 560) continue;
        const src = el instanceof HTMLImageElement ? el.currentSrc || el.src : el.poster || el.currentSrc;
        if (!src || seen.has(src)) continue;
        seen.add(src);
        const alt = (el.getAttribute("alt") || el.getAttribute("aria-label") || el.getAttribute("title") || "").replace(/\s+/g, " ").trim();
        out.push({ id: `sr-image-${out.length}`, name: alt.slice(0, 80), area: r.width * r.height });
        el.setAttribute("data-sr-asset", `sr-image-${out.length - 1}`);
      }
      return out.sort((a, b) => b.area - a.area).slice(0, limit);
    }, max)
    .catch(() => [] as { id: string; name: string; area: number }[]);

  const assets: CapturedAsset[] = [];
  for (const f of found) {
    const png = await page.locator(`[data-sr-asset="${f.id}"]`).screenshot({ type: "png", timeout: 3_000 }).catch(() => null);
    if (png) assets.push({ name: f.name, png });
  }
  return assets;
}
