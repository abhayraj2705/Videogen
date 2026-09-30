import type { Page } from "playwright";
import type { BrandTokens } from "@sitereel/shared";

// A small curated set covers the overwhelming majority of marketing sites
// without needing the full Google Fonts catalog API call just to label a
// font stack (§4.6 "Extract" — "font detection with Google Fonts mapping").
const KNOWN_GOOGLE_FONTS = [
  "Inter",
  "Roboto",
  "Poppins",
  "Montserrat",
  "Open Sans",
  "Lato",
  "Nunito",
  "Work Sans",
  "Manrope",
  "DM Sans",
  "Plus Jakarta Sans",
  "Space Grotesk",
  "Outfit",
  "Sora",
];

function mapToKnownFont(fontFamilyCss: string): string {
  const firstFont = fontFamilyCss.split(",")[0]?.trim().replace(/["']/g, "") ?? "";
  const match = KNOWN_GOOGLE_FONTS.find((f) => f.toLowerCase() === firstFont.toLowerCase());
  return match ?? "Inter"; // safe, widely-available default rather than an arbitrary system font
}

interface RawBrand {
  bg: string;
  fg: string;
  accent: string;
  fontDisplayRaw: string;
  fontBodyRaw: string;
  logoUrl: string | null;
}

export async function extractBrandTokens(page: Page, pageUrl: string): Promise<BrandTokens> {
  const raw = await page.evaluate(() => {
    // Plain arrow function, not a nested `function` declaration: esbuild's dev
    // transform (via tsx) injects a `__name(...)` helper call for named function
    // declarations that doesn't exist once this source is serialized into the
    // page's own realm by page.evaluate, throwing a ReferenceError at call time.
    const firstNonTransparent = (start: Element | null): string => {
      let node: Element | null = start;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
        node = node.parentElement;
      }
      return "rgb(255, 255, 255)";
    };

    const bodyStyle = getComputedStyle(document.body);
    const bg = firstNonTransparent(document.body);
    const fg = bodyStyle.color;

    const heading = document.querySelector("h1, h2");
    const fontDisplayRaw = heading ? getComputedStyle(heading).fontFamily : bodyStyle.fontFamily;
    const fontBodyRaw = bodyStyle.fontFamily;

    // Picking the *first* CTA-ish element's color is too fragile — a single
    // secondary/ghost button with no background throws it off. Instead, score
    // every candidate and take the most common non-neutral, mostly-opaque
    // color: the brand accent is whatever solid color repeats across multiple
    // primary actions, not a translucent hover-state overlay.
    //
    // getComputedStyle can return rgb()/rgba() OR, for colors authored via
    // CSS Color 4 functions, oklch()/oklab()/hsl() verbatim — Chromium no
    // longer normalizes everything to rgb(). Each format's alpha is always
    // the last number after an optional "/", so one generic parse covers all
    // of them instead of only matching rgb() and silently discarding the rest.
    const parseAlpha = (color: string): number => {
      const slashMatch = /\/\s*([\d.]+)\s*\)$/.exec(color);
      if (slashMatch) return Number(slashMatch[1]);
      const commaParts = /^[a-z]+\(([^)]+)\)$/i.exec(color)?.[1]?.split(",") ?? [];
      if (commaParts.length === 4) return Number(commaParts[3]);
      return 1;
    };

    const isNeutral = (color: string): boolean => {
      const rgbMatch = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
      if (rgbMatch) {
        const [r, g, b] = [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
        return Math.max(r, g, b) - Math.min(r, g, b) < 12; // low saturation: grayscale/black/white
      }
      const oklchMatch = /^oklch\([\d.]+\s+([\d.]+)/.exec(color);
      if (oklchMatch) return Number(oklchMatch[1]) < 0.03; // chroma near zero: grayscale
      const oklabMatch = /^oklab\([\d.]+\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(color);
      if (oklabMatch) return Math.hypot(Number(oklabMatch[1]), Number(oklabMatch[2])) < 0.03;
      return true; // unrecognized format — don't guess, treat as not a usable candidate
    };

    const candidateSelectors = [
      'button[type="submit"]',
      'a[class*="btn" i][class*="primary" i]',
      'button[class*="primary" i]',
      "button",
      'a[class*="btn" i]',
      'a[class*="button" i]',
      '[role="button"]',
    ];
    const isUsableSolidColor = (c: string | null | undefined): c is string =>
      !!c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent" && parseAlpha(c) >= 0.5 && !isNeutral(c);

    const colorCounts = new Map<string, number>();
    for (const sel of candidateSelectors) {
      document.querySelectorAll(sel).forEach((el) => {
        const c = getComputedStyle(el).backgroundColor;
        if (isUsableSolidColor(c)) colorCounts.set(c, (colorCounts.get(c) ?? 0) + 1);
      });
    }
    let accent = "rgb(0, 0, 0)";
    let bestCount = 0;
    for (const [color, count] of colorCounts) {
      if (count > bestCount) {
        accent = color;
        bestCount = count;
      }
    }
    // Nothing non-neutral/solid found anywhere (monochrome brand, e.g.) — fall
    // back to the single most prominent action element's OPAQUE color. Still
    // alpha-gated: a near-invisible hover overlay is never a better answer
    // than the black placeholder it would replace.
    if (bestCount === 0) {
      for (const sel of candidateSelectors) {
        const el = document.querySelector(sel);
        const c = el ? getComputedStyle(el).backgroundColor : null;
        if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent" && parseAlpha(c) >= 0.5) {
          accent = c;
          break;
        }
      }
    }

    const logoImg =
      document.querySelector('a[href="/"] img[src], a[href="/"] svg image[href]') ??
      document.querySelector('header img[alt*="logo" i][src], nav img[alt*="logo" i][src]') ??
      document.querySelector('header img[src], nav img[src]') ??
      document.querySelector('img[src*="logo" i]');
    const logoHref = logoImg?.getAttribute("src") ?? null;
    const iconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]');
    const logoUrl = logoHref ?? iconLink?.href ?? null;

    return { bg, fg, accent, fontDisplayRaw, fontBodyRaw, logoUrl } satisfies RawBrand;
  });

  let resolvedLogoUrl: string | null = null;
  if (raw.logoUrl) {
    try {
      resolvedLogoUrl = new URL(raw.logoUrl, pageUrl).toString();
    } catch {
      resolvedLogoUrl = null;
    }
  }

  return {
    bg: raw.bg,
    fg: raw.fg,
    accent: raw.accent,
    fontDisplay: mapToKnownFont(raw.fontDisplayRaw),
    fontBody: mapToKnownFont(raw.fontBodyRaw),
    logoUrl: resolvedLogoUrl,
  };
}
