import type { Page } from "playwright";
import type { HTMLElement as ParsedElement } from "node-html-parser";
import type { BrandTokens } from "@sitereel/shared";

/**
 * Fetch-free, static list of the ~100 most-used Google Fonts families — enough
 * to label the font stacks real marketing sites ship without calling the
 * Google Fonts catalog API at crawl time (§4.6 "Extract": font detection with
 * Google Fonts mapping).
 */
export const GOOGLE_FONT_FAMILIES = [
  "Roboto", "Open Sans", "Noto Sans", "Montserrat", "Inter", "Poppins", "Lato", "Roboto Condensed", "Oswald", "Raleway",
  "Roboto Mono", "Nunito", "Nunito Sans", "Ubuntu", "Rubik", "Playfair Display", "Roboto Slab", "Merriweather", "Noto Serif", "PT Sans",
  "Kanit", "Work Sans", "Lora", "Fira Sans", "Mulish", "Quicksand", "DM Sans", "Barlow", "Inconsolata", "IBM Plex Sans",
  "Manrope", "Titillium Web", "Heebo", "Karla", "Josefin Sans", "Libre Baskerville", "Noto Sans JP", "PT Serif", "Source Sans 3", "Mukta",
  "Hind", "Bebas Neue", "Nanum Gothic", "Arimo", "Dosis", "Libre Franklin", "Cabin", "Bitter", "Oxygen", "Anton",
  "Space Grotesk", "Outfit", "Plus Jakarta Sans", "Sora", "Lexend", "Figtree", "Urbanist", "Archivo", "Barlow Condensed", "Assistant",
  "Prompt", "Exo 2", "Cormorant Garamond", "EB Garamond", "Crimson Text", "Fjalla One", "Abel", "Teko", "Overpass", "Red Hat Display",
  "Red Hat Text", "Public Sans", "Jost", "Be Vietnam Pro", "Epilogue", "Space Mono", "JetBrains Mono", "Fira Code", "Source Code Pro", "IBM Plex Mono",
  "IBM Plex Serif", "Lexend Deca", "Chivo", "Saira", "Hind Siliguri", "Signika", "Varela Round", "Maven Pro", "Asap", "Catamaran",
  "Questrial", "Pacifico", "Dancing Script", "Caveat", "Shadows Into Light", "Comfortaa", "Righteous", "Abril Fatface", "Archivo Black", "Syne",
  "Instrument Sans", "Instrument Serif", "Geist", "Geist Mono", "Onest", "Albert Sans", "Schibsted Grotesk", "Bricolage Grotesque", "Hanken Grotesk", "Atkinson Hyperlegible",
  "DM Serif Display", "DM Mono", "Fraunces", "Newsreader", "Spectral", "Zilla Slab", "Cairo", "Tajawal", "Noto Sans Devanagari", "Baloo 2",
];

const FONT_LOOKUP = new Map(GOOGLE_FONT_FAMILIES.map((f) => [f.toLowerCase().replace(/\s+/g, ""), f]));
const DEFAULT_FONT = "Inter";

/**
 * Normalizes a single CSS family name: strips quotes, and undoes next/font's
 * mangling ("__Inter_d65c78", "__Plus_Jakarta_Sans_Fallback_3a1b2c") and
 * common suffixes ("Inter var", "InterVariable", "Inter Display").
 */
export function normalizeFamily(name: string): string {
  let f = name.trim().replace(/^["']|["']$/g, "");
  const next = /^__(.+?)(?:_Fallback)?_[0-9a-f]{5,8}$/i.exec(f);
  if (next) f = next[1]!.replace(/_/g, " ");
  return f.replace(/\s*(var|variable|vf)$/i, "").trim();
}

/** Maps a single family name to a known Google Font, or null. */
export function matchGoogleFont(name: string): string | null {
  const key = normalizeFamily(name).toLowerCase().replace(/\s+/g, "");
  if (FONT_LOOKUP.has(key)) return FONT_LOOKUP.get(key)!;
  // "Inter Display", "Inter Tight"-style variants map to their base family if that base is known.
  let best: string | null = null;
  let bestLen = 0;
  for (const [k, v] of FONT_LOOKUP) {
    if (k.length >= 4 && k.length > bestLen && key.startsWith(k)) {
      best = v;
      bestLen = k.length;
    }
  }
  return best;
}

/**
 * Picks the font to use for a CSS font-family stack: the first family in the
 * stack that's a known Google Font, else any *loaded* face that is one, else
 * the default. `loadedFamilies` comes from document.fonts (faces actually
 * downloaded and in use), which catches self-hosted Google Fonts under
 * unusual aliases.
 */
export function mapToKnownFont(fontFamilyCss: string, loadedFamilies: string[] = []): string {
  const loaded = new Set(loadedFamilies.map((l) => normalizeFamily(l).toLowerCase()));
  const stack = fontFamilyCss.split(",").map((f) => f.trim()).filter(Boolean);
  // The primary family, or a later stack entry that was actually loaded. Unloaded
  // fallbacks (e.g. "sohne-var, 'Source Code Pro'") say nothing about the brand.
  for (const [i, fam] of stack.entries()) {
    if (i > 0 && loaded.size > 0 && !loaded.has(normalizeFamily(fam).toLowerCase())) continue;
    if (i > 0 && /mono|code/i.test(fam)) continue; // a code-font fallback isn't the brand face
    const m = matchGoogleFont(fam);
    if (m) return m;
  }
  // Any loaded proportional Google Font (code fonts load for snippets, not branding).
  for (const l of loadedFamilies) {
    if (/mono|code/i.test(l)) continue;
    const m = matchGoogleFont(l);
    if (m) return m;
  }
  return DEFAULT_FONT;
}

interface RawBrand {
  bg: string;
  fg: string;
  accent: string;
  fontDisplayRaw: string;
  fontBodyRaw: string;
  loadedFamilies: string[];
  logoUrl: string | null;
}

function resolveUrl(raw: string | null | undefined, pageUrl: string): string | null {
  if (!raw) return null;
  if (raw.startsWith("data:")) return raw;
  try {
    const u = new URL(raw, pageUrl);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function extractBrandTokens(page: Page, pageUrl: string): Promise<BrandTokens> {
  const raw = await page.evaluate(() => {
    // Arrow functions only: esbuild's dev transform (via tsx) injects a
    // `__name(...)` helper for named function declarations that doesn't exist
    // once this source is serialized into the page's realm by page.evaluate.
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
    const mainEl = document.querySelector("main") ?? document.body;
    const bg = firstNonTransparent(mainEl);
    const fg = bodyStyle.color;

    const heading = document.querySelector("h1, h2");
    const fontDisplayRaw = heading ? getComputedStyle(heading).fontFamily : bodyStyle.fontFamily;
    const para = document.querySelector("main p, p");
    const fontBodyRaw = para ? getComputedStyle(para).fontFamily : bodyStyle.fontFamily;

    const loadedFamilies: string[] = [];
    try {
      document.fonts.forEach((face) => {
        if (face.status === "loaded" && !loadedFamilies.includes(face.family)) loadedFamilies.push(face.family.replace(/^["']|["']$/g, ""));
      });
    } catch {
      // FontFaceSet unavailable — computed stacks still work
    }

    // Accent: the most common non-neutral, mostly-opaque background across
    // primary actions (see git history for why "first button" was too fragile).
    // getComputedStyle may return rgb()/rgba() or CSS Color 4 oklch()/oklab().
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
        return Math.max(r, g, b) - Math.min(r, g, b) < 12;
      }
      const oklchMatch = /^oklch\([\d.]+\s+([\d.]+)/.exec(color);
      if (oklchMatch) return Number(oklchMatch[1]) < 0.03;
      const oklabMatch = /^oklab\([\d.]+\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(color);
      if (oklabMatch) return Math.hypot(Number(oklabMatch[1]), Number(oklabMatch[2])) < 0.03;
      return true;
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
    if (bestCount === 0) {
      // No colored buttons: try link color, then theme-color, then the most prominent opaque action.
      const linkColor = getComputedStyle(document.querySelector("main a, a") ?? document.body).color;
      const themeHex = (document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content ?? "").trim();
      const hexMatch = /^#([0-9a-f]{6})$/i.exec(themeHex);
      const themeRgb = hexMatch
        ? `rgb(${parseInt(hexMatch[1]!.slice(0, 2), 16)}, ${parseInt(hexMatch[1]!.slice(2, 4), 16)}, ${parseInt(hexMatch[1]!.slice(4, 6), 16)})`
        : "";
      if (isUsableSolidColor(linkColor)) accent = linkColor;
      else if (themeRgb && !isNeutral(themeRgb)) accent = themeRgb;
      else {
        for (const sel of candidateSelectors) {
          const el = document.querySelector(sel);
          const c = el ? getComputedStyle(el).backgroundColor : null;
          if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent" && parseAlpha(c) >= 0.5) {
            accent = c;
            break;
          }
        }
      }
    }

    // ---- Logo candidates, best first ----
    const origin = location.origin;
    const homeLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).filter((a) => {
      const href = a.getAttribute("href") ?? "";
      return href === "/" || href === "./" || href === origin || href === `${origin}/` || href === location.href;
    });
    const imgUrl = (img: Element | null): string | null => {
      if (!img) return null;
      if (img instanceof HTMLImageElement) return img.currentSrc || img.src || img.getAttribute("data-src") || null;
      // <svg><image href|xlink:href>
      return img.getAttribute("href") ?? img.getAttribute("xlink:href") ?? null;
    };
    const svgDataUri = (svg: SVGSVGElement | null): string | null => {
      if (!svg) return null;
      const box = svg.getBoundingClientRect();
      if (box.width < 16 || box.height < 8) return null;
      const clone = svg.cloneNode(true) as SVGSVGElement;
      if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      // currentColor would render black off-page; bake in the computed color.
      const color = getComputedStyle(svg).color;
      clone.setAttribute("style", `color:${color}`);
      if (!clone.getAttribute("width")) clone.setAttribute("width", String(Math.round(box.width)));
      if (!clone.getAttribute("height")) clone.setAttribute("height", String(Math.round(box.height)));
      const markup = new XMLSerializer().serializeToString(clone);
      if (markup.length > 60_000) return null;
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    };
    const logoish = '[alt*="logo" i], [class*="logo" i], [id*="logo" i], [src*="logo" i], [aria-label*="logo" i]';

    let logoUrl: string | null = null;
    for (const a of homeLinks) {
      const img = a.querySelector("img");
      logoUrl = imgUrl(img) ?? imgUrl(a.querySelector("svg image")) ?? svgDataUri(a.querySelector("svg"));
      if (logoUrl) break;
    }
    logoUrl ??=
      imgUrl(document.querySelector(`header img${logoish.split(", ").join(", header img")}`)) ??
      imgUrl(document.querySelector(`nav img${logoish.split(", ").join(", nav img")}`)) ??
      imgUrl(document.querySelector("header svg image, nav svg image")) ??
      svgDataUri(document.querySelector<SVGSVGElement>(`header svg${logoish.split(", ").join(", header svg")}`)) ??
      svgDataUri(document.querySelector<SVGSVGElement>("header svg, nav svg")) ??
      imgUrl(document.querySelector('img[src*="logo" i]')) ??
      document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.href ??
      document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]')?.href ??
      document.querySelector<HTMLMetaElement>('meta[property="og:logo"]')?.content ??
      document.querySelector<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]')?.href ??
      document.querySelector<HTMLMetaElement>('meta[property="og:image"], meta[name="og:image"]')?.content ??
      null;

    return { bg, fg, accent, fontDisplayRaw, fontBodyRaw, loadedFamilies, logoUrl } satisfies RawBrand;
  });

  return {
    bg: raw.bg,
    fg: raw.fg,
    accent: raw.accent,
    fontDisplay: mapToKnownFont(raw.fontDisplayRaw, raw.loadedFamilies),
    fontBody: mapToKnownFont(raw.fontBodyRaw, raw.loadedFamilies),
    logoUrl: resolveUrl(raw.logoUrl, pageUrl),
  };
}

/** Family names requested from Google Fonts <link> tags ("family=Space+Grotesk:wght@400"). */
export function googleFontsFromLinks(hrefs: string[]): string[] {
  const out: string[] = [];
  for (const href of hrefs) {
    if (!/fonts\.googleapis\.com/i.test(href)) continue;
    for (const m of href.matchAll(/family=([^&:]+)/gi)) {
      for (const fam of decodeURIComponent(m[1]!.replace(/\+/g, " ")).split("|")) {
        const name = fam.split(":")[0]!.trim();
        if (name && !out.includes(name)) out.push(name);
      }
    }
  }
  return out;
}

/**
 * Brand tokens from static HTML (plain-fetch fallback): no computed styles, so
 * colors come from theme-color and fonts from Google Fonts links / inline
 * CSS; logo from the same candidate order as the browser path.
 */
export function extractBrandFromHtml(root: ParsedElement, pageUrl: string): BrandTokens {
  const attr = (sel: string, name: string) => root.querySelector(sel)?.getAttribute(name) ?? null;
  const theme = attr('meta[name="theme-color"]', "content");
  const hex = theme && /^#[0-9a-f]{6}$/i.test(theme.trim()) ? theme.trim() : null;
  const rgb = hex ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : null;
  const neutral = !rgb || Math.max(...rgb) - Math.min(...rgb) < 12;
  const accent = hex && !neutral ? hex.toLowerCase() : "rgb(0, 0, 0)";

  const linkHrefs = root.querySelectorAll("link[href]").map((l) => l.getAttribute("href") ?? "");
  const gf = googleFontsFromLinks(linkHrefs);
  const css = root.querySelectorAll("style").map((s) => s.text).join("\n");
  const cssFamilies = Array.from(css.matchAll(/font-family\s*:\s*([^;}]+)/gi)).map((m) => m[1]!);
  const families = [...gf, ...cssFamilies.flatMap((s) => s.split(","))];
  const fontDisplay = mapToKnownFont(families.join(","), []);

  const homeImg = root
    .querySelectorAll("a[href]")
    .filter((a) => ["/", "./", new URL(pageUrl).origin, `${new URL(pageUrl).origin}/`].includes(a.getAttribute("href") ?? ""))
    .map((a) => a.querySelector("img")?.getAttribute("src") ?? a.querySelector("svg image")?.getAttribute("href") ?? a.querySelector("svg image")?.getAttribute("xlink:href"))
    .find(Boolean);
  const logoRaw =
    homeImg ??
    attr('header img[alt*="logo" i], header img[class*="logo" i], header img[src*="logo" i]', "src") ??
    attr('img[src*="logo" i]', "src") ??
    attr('link[rel="apple-touch-icon"]', "href") ??
    attr('link[rel="icon"], link[rel="shortcut icon"]', "href") ??
    attr('meta[property="og:image"]', "content") ??
    null;

  return {
    bg: "rgb(255, 255, 255)",
    fg: "rgb(17, 17, 17)",
    accent,
    fontDisplay,
    fontBody: fontDisplay,
    logoUrl: resolveUrl(logoRaw, pageUrl),
  };
}
