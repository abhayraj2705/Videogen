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

export function rgbString([r, g, b]: Rgb): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

export function rgbaString([r, g, b]: Rgb, alpha: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

/** Linear mix of two colors: t = 0 -> a, t = 1 -> b. */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Rotates a color's hue by `degrees` (HSL), keeping saturation and lightness. Greys come back unchanged. */
export function shiftHue([r, g, b]: Rgb, degrees: number): Rgb {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return [r, g, b];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  h = (((h * 60 + degrees) % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
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
