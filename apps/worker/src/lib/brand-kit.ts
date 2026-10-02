import type { BrandTokens } from "@sitereel/shared";
import { assetRef } from "./asset-ref.js";

/**
 * Brand kits (W10). The DB row stores colours/fonts as loose jsonb; two
 * vocabularies are in play — the Wave A schema (`bg`/`text`/`accent`,
 * `display`/`body`) and the Wave B API contract (`primary`/`secondary`/
 * `background`/`foreground`/`accent`, `heading`/`body`). The worker reads both
 * and writes both, so kits created by either side apply correctly.
 */
export interface BrandKitLike {
  colors?: Record<string, string | undefined> | null;
  fonts?: Record<string, string | undefined> | null;
  logoKey?: string | null;
  logoUrl?: string | null;
}

const pick = (obj: Record<string, string | undefined> | null | undefined, ...names: string[]): string | undefined => {
  for (const n of names) {
    const v = obj?.[n];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
};

/**
 * Overrides crawl brand tokens with a kit's colours, fonts and logo. Fields
 * the kit doesn't set keep the crawl's values. A kit logo stored in our
 * bucket becomes an asset:// ref, resolved to a fetchable URL at render time
 * like every other storage asset.
 */
export function applyBrandKit(brand: BrandTokens, kit: BrandKitLike | null | undefined): BrandTokens {
  if (!kit) return brand;
  const c = kit.colors ?? {};
  const f = kit.fonts ?? {};
  const logo = kit.logoKey ? assetRef("assets", kit.logoKey) : kit.logoUrl ?? null;
  return {
    bg: pick(c, "background", "bg") ?? brand.bg,
    fg: pick(c, "foreground", "text", "fg") ?? brand.fg,
    accent: pick(c, "accent", "primary") ?? brand.accent,
    fontDisplay: pick(f, "heading", "display") ?? brand.fontDisplay,
    fontBody: pick(f, "body") ?? brand.fontBody,
    logoUrl: logo ?? brand.logoUrl,
  };
}

/** Kit auto-created from a successful crawl (contract: name = site hostname). Writes both colour/font vocabularies. */
export function brandKitFromCrawl(brand: BrandTokens, siteUrl: string): {
  name: string;
  colors: Record<string, string>;
  fonts: Record<string, string>;
  sourceUrl: string;
} {
  const hostname = kitHostname(siteUrl);
  return {
    name: hostname,
    colors: { primary: brand.accent, background: brand.bg, foreground: brand.fg, accent: brand.accent, bg: brand.bg, text: brand.fg },
    fonts: { heading: brand.fontDisplay, body: brand.fontBody, display: brand.fontDisplay },
    sourceUrl: siteUrl,
  };
}

/** Hostname used to match kits to sites — `www.` is ignored so example.com and www.example.com share a kit. */
export function kitHostname(urlOrHost: string): string {
  let host = urlOrHost;
  try {
    host = new URL(urlOrHost).hostname;
  } catch {
    // already a bare hostname
  }
  return host.toLowerCase().replace(/^www\./, "");
}

/** True if any of the user's kits already covers this site (by sourceUrl hostname or by name). */
export function userHasKitForHost(kits: readonly { name: string; sourceUrl: string | null }[], siteUrl: string): boolean {
  const host = kitHostname(siteUrl);
  return kits.some((k) => (k.sourceUrl && kitHostname(k.sourceUrl) === host) || kitHostname(k.name) === host);
}
