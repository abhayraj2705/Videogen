import type { FontFaceSpec, Fonts } from "@sitereel/film-runtime";
import type { StorageClient } from "@sitereel/storage";

/**
 * Brand fonts for the film. Crawl maps the site's typefaces onto Google Fonts
 * family names (brand-extract.ts); this fetches those families once, keeps
 * the files in storage (shared across jobs), and hands the player `data:`
 * URLs — so a render never depends on the network, a font CDN's CORS setup,
 * or whichever system fonts the render host happens to have.
 *
 * Never throws: any failure (offline, unknown family, oversized files) just
 * means the film falls back to the system font stack, as it did before.
 */

/** A desktop Chrome UA makes the CSS API serve woff2 with per-script unicode-range blocks. */
const CSS_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
/** Scripts worth embedding: the film's languages are en/hi. */
const KEEP_SUBSETS = new Set(["latin", "latin-ext", "devanagari"]);
/** Variable range first (one file covers every weight), then static weights, then whatever the family has. */
const WEIGHT_SPECS = [":wght@400..800", ":wght@400;500;600;700;800", ":wght@400;700", ""];
const MAX_FAMILY_BYTES = 700 * 1024;
const FETCH_TIMEOUT_MS = 6000;
const CACHE_VERSION = "v1";

export interface ParsedFace {
  subset: string;
  weight: string;
  style: string;
  url: string;
  unicodeRange?: string;
}

/** Parses a Google Fonts css2 response into its @font-face blocks (subset comes from the comment above each block). */
export function parseFontCss(css: string): ParsedFace[] {
  const faces: ParsedFace[] = [];
  for (const m of css.matchAll(/\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/gi)) {
    const body = m[2]!;
    const url = /src:\s*url\(([^)]+)\)\s*format\(['"]woff2['"]\)/i.exec(body)?.[1]?.replace(/^['"]|['"]$/g, "");
    if (!url) continue;
    faces.push({
      subset: m[1]!.toLowerCase(),
      weight: /font-weight:\s*([^;]+);/i.exec(body)?.[1]?.trim() ?? "400",
      style: /font-style:\s*([^;]+);/i.exec(body)?.[1]?.trim() ?? "normal",
      url,
      unicodeRange: /unicode-range:\s*([^;]+);/i.exec(body)?.[1]?.trim(),
    });
  }
  return faces;
}

/** First family of a CSS font stack, unquoted: "Inter, system-ui, sans-serif" -> "Inter". */
export function primaryFamily(stack: string): string {
  return (stack.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

async function downloadFamily(family: string): Promise<FontFaceSpec[]> {
  let css: string | null = null;
  for (const spec of WEIGHT_SPECS) {
    const res = await fetchWithTimeout(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}${spec}&display=block`, {
      headers: { "user-agent": CSS_USER_AGENT },
    });
    if (res.ok) {
      css = await res.text();
      break;
    }
    // 400 = this family doesn't have that axis/weight set; try the next, looser spec.
    if (res.status !== 400) return [];
  }
  if (!css) return [];

  const wanted = parseFontCss(css).filter((f) => KEEP_SUBSETS.has(f.subset) && f.style === "normal");
  const files = new Map<string, string>();
  let total = 0;
  const out: FontFaceSpec[] = [];
  // Latin first, so the size cap drops the rarer scripts rather than the base alphabet.
  for (const face of wanted.sort((a, b) => Number(b.subset === "latin") - Number(a.subset === "latin"))) {
    let dataUrl = files.get(face.url);
    if (!dataUrl) {
      const res = await fetchWithTimeout(face.url);
      if (!res.ok) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (total + bytes.length > MAX_FAMILY_BYTES) continue;
      total += bytes.length;
      dataUrl = `data:font/woff2;base64,${bytes.toString("base64")}`;
      files.set(face.url, dataUrl);
    }
    out.push({ family, url: dataUrl, weight: face.weight, style: face.style, ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}) });
  }
  return out;
}

/** One lookup per family per process — QA and every render chunk share it, and an offline host only waits once. */
const inFlight = new Map<string, Promise<FontFaceSpec[]>>();

async function loadFamily(family: string, storage: StorageClient): Promise<FontFaceSpec[]> {
  const key = `fonts/${CACHE_VERSION}/${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
  try {
    return JSON.parse((await storage.getObject("assets", key)).toString("utf8")) as FontFaceSpec[];
  } catch {
    // not cached yet
  }
  try {
    const faces = await downloadFamily(family);
    if (faces.length > 0) await storage.putObject("assets", key, Buffer.from(JSON.stringify(faces)), "application/json").catch(() => undefined);
    return faces;
  } catch {
    return [];
  }
}

/**
 * Font faces for a manifest's display + body stacks. Set SITEREEL_WEBFONTS=off
 * to skip (air-gapped hosts, tests); the film then uses the fallback stack.
 */
export async function resolveFontFaces(fonts: Fonts, storage: StorageClient): Promise<FontFaceSpec[]> {
  if (process.env.SITEREEL_WEBFONTS === "off") return [];
  const families = [...new Set([primaryFamily(fonts.display), primaryFamily(fonts.body)])].filter((f) => f && !/^(system-ui|sans-serif|serif|monospace|-apple-system)$/i.test(f));
  const sets = await Promise.all(
    families.map((family) => {
      let p = inFlight.get(family);
      if (!p) {
        p = loadFamily(family, storage);
        inFlight.set(family, p);
      }
      return p;
    }),
  );
  return sets.flat();
}
