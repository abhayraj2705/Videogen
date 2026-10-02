import { parseColor, relativeLuminance } from "@sitereel/film-runtime";
import type { CrawlOutput, Tone } from "@sitereel/shared";

/**
 * How the site itself looks, read from what the crawl measured: its colours,
 * its typeface, how round its buttons are, and how much of it is pictures.
 * A film should look like it came from the same place as the site, so this —
 * not just what the site says — decides the film's style and which scenes
 * suit it (see site-profile.ts).
 */
export interface SiteLook {
  /** Dark page background. */
  dark: boolean;
  /** A saturated brand colour, as opposed to black / white / grey. */
  vivid: boolean;
  /** Buttons with generous corner radii (pills, 12px and up). False for sharp corners; null when the crawl did not measure it. */
  rounded: boolean | null;
  typeface: "sans" | "serif" | "mono" | "display";
  /** How picture-led the site is: large content images captured from it. */
  imagery: "rich" | "some" | "none";
  /** Logos captured from a customer / integration strip. */
  logos: number;
  /** The homepage was recorded while scrolling. */
  recorded: boolean;
  /** The film style that matches this look. */
  tone: Tone;
  /** The look in a few words, for the app and the planner: "dark, vivid accent, rounded, sans-serif, picture-led". */
  summary: string;
  /** Why that tone, in a sentence a user can read. */
  toneReason: string;
}

const SERIF = /serif|playfair|merriweather|lora|garamond|baskerville|bitter|crimson|fraunces|newsreader|spectral|slab|georgia|times/i;
const MONO = /mono|code|inconsolata|courier|consolas/i;
const DISPLAY = /bebas|anton|oswald|archivo black|abril|righteous|syne|pacifico|caveat|dancing|fjalla|teko|bricolage/i;

function typefaceOf(family: string): SiteLook["typeface"] {
  // "Sans Serif" must not read as a serif.
  const name = family.replace(/sans[- ]?serif/gi, "sans");
  if (MONO.test(name)) return "mono";
  if (DISPLAY.test(name)) return "display";
  if (SERIF.test(name) && !/sans/i.test(name)) return "serif";
  return "sans";
}

/** Saturation of a colour, 0-1 (HSV): how far it is from grey. */
function saturation(color: string): number {
  const rgb = parseColor(color);
  if (!rgb) return 0;
  const max = Math.max(...rgb);
  return max === 0 ? 0 : (max - Math.min(...rgb)) / max;
}

export function deriveSiteLook(crawl: CrawlOutput): SiteLook {
  const { brand, pages } = crawl;
  const bg = parseColor(brand.bg);
  const dark = bg ? relativeLuminance(bg) < 0.2 : false;
  // Vivid by its brand colour, or by the page itself: a site with a bright gradient hero and a dark button is still a colourful site.
  const vivid = saturation(brand.accent) >= 0.45 || (brand.colorfulness ?? 0) >= 0.22;
  const rounded = brand.radius === undefined ? null : brand.radius >= 12;
  const typeface = typefaceOf(brand.fontDisplay);
  const images = pages.filter((p) => p.origin === "image").length;
  const imagery: SiteLook["imagery"] = images >= 3 ? "rich" : images >= 1 ? "some" : "none";
  const logos = pages.reduce((n, p) => n + (p.logos?.length ?? 0), 0);
  const recorded = pages.some((p) => p.clip);
  const isApp = crawl.facts.some((f) => /app store|google play|download the app|get the app/i.test(f.text));

  // The style follows the look: dark and bold reads as cinematic, round and colourful as playful,
  // an app sold through the stores as app-store, and everything restrained as clean.
  let tone: Tone = "clean";
  let toneReason = "a light, restrained site";
  if (isApp) {
    tone = "app-store";
    toneReason = "the site sells an app through the app stores";
  } else if (dark) {
    tone = "cinematic";
    toneReason = vivid ? "a dark site with a strong accent colour" : "a dark, high-contrast site";
  } else if (vivid && (rounded === true || typeface === "display" || (brand.colorfulness ?? 0) >= 0.35)) {
    tone = "playful";
    toneReason = rounded === true ? "bright colour and round shapes" : "a bright, colourful site";
  } else if (typeface === "serif") {
    toneReason = "a light site set in a serif typeface";
  } else if (!vivid) {
    toneReason = "a light site in black, white and grey";
  }

  const words = [
    dark ? "dark" : "light",
    vivid ? "vivid accent" : "neutral colours",
    ...(rounded === null ? [] : [rounded ? "rounded" : "sharp corners"]),
    typeface === "sans" ? "sans-serif" : typeface === "display" ? "display type" : typeface,
    ...(imagery === "rich" ? ["picture-led"] : imagery === "some" ? ["some pictures"] : []),
  ];
  return { dark, vivid, rounded, typeface, imagery, logos, recorded, tone, summary: words.join(", "), toneReason };
}
