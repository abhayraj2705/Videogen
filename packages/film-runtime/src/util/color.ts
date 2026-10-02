/**
 * Pure color helpers (WCAG relative luminance + contrast) shared by the
 * player's palette derivation and the QA contrast probe. Only hex and
 * rgb()/rgba() strings are parsed here; the browser-side callers resolve any
 * other CSS color syntax (oklch, named colors, ...) through a canvas first.
 */

export type Rgb = [number, number, number];

export function parseColor(input: string): Rgb | null {
  const s = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  if (s === "white") return [255, 255, 255];
  if (s === "black") return [0, 0, 0];
  return null;
}

export function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRgb(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a) + 0.05;
  const lb = relativeLuminance(b) + 0.05;
  return la > lb ? la / lb : lb / la;
}

/** WCAG contrast ratio between two CSS colors, or null if either can't be parsed. */
export function contrastRatio(a: string, b: string): number | null {
  const ra = parseColor(a);
  const rb = parseColor(b);
  return ra && rb ? contrastRgb(ra, rb) : null;
}

/** WCAG 2.x AA threshold: 3:1 for large text (>= 24px, or >= 18.66px bold), 4.5:1 otherwise. */
export function wcagThreshold(fontSizePx: number, fontWeight: number): number {
  const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
  return large ? 3 : 4.5;
}

/** Picks whichever candidate has the best contrast against `against`. */
export function bestContrast(against: string, candidates: string[]): string {
  let best = candidates[0]!;
  let bestRatio = -1;
  for (const c of candidates) {
    const r = contrastRatio(c, against) ?? 0;
    if (r > bestRatio) {
      bestRatio = r;
      best = c;
    }
  }
  return best;
}
