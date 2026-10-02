import type { FilmContext } from "../contract.js";

export type Orientation = "landscape" | "portrait" | "square";

/**
 * Title-safe margins per orientation, as fractions of the frame. Portrait
 * reserves extra top/bottom room for platform chrome (Reels/Shorts/TikTok
 * overlay their UI there). QA's safe-area probe (packages/renderer qa.ts)
 * checks rendered text against exactly these numbers, so templates and QA
 * can't silently disagree about where text may go.
 */
export const SAFE_AREA: Record<Orientation, { left: number; right: number; top: number; bottom: number }> = {
  landscape: { left: 0.05, right: 0.05, top: 0.06, bottom: 0.06 },
  portrait: { left: 0.07, right: 0.07, top: 0.1, bottom: 0.14 },
  square: { left: 0.06, right: 0.06, top: 0.06, bottom: 0.06 },
};

export function orientationOf(width: number, height: number): Orientation {
  const r = width / height;
  if (r > 1.2) return "landscape";
  if (r < 0.83) return "portrait";
  return "square";
}

export interface SafeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function safeRect(width: number, height: number): SafeRect {
  const m = SAFE_AREA[orientationOf(width, height)];
  const left = width * m.left;
  const right = width * (1 - m.right);
  const top = height * m.top;
  const bottom = height * (1 - m.bottom);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export interface Layout {
  orientation: Orientation;
  /** 1 unit = 1px at a 1080px short edge. Every font size/spacing is expressed in units so the three formats scale coherently. */
  u: number;
  safe: SafeRect;
  /** CSS padding string that keeps a flex root's content inside the safe area. */
  safePadding: string;
  /** Pick a per-orientation value. */
  pick<T>(v: { landscape: T; portrait: T; square: T }): T;
}

export interface CaptionBand {
  fontSize: number;
  maxLines: number;
  /** Height of the band itself. */
  height: number;
  /** Total space templates must leave free above the safe-area bottom (band + gap). */
  reserve: number;
  width: number;
}

/**
 * Geometry of the burned-in caption band, which sits on the bottom edge of
 * the title-safe area. Shared by the player (draws it) and layoutFor (keeps
 * template content out of it).
 */
export function captionBand(width: number, height: number): CaptionBand {
  const orientation = orientationOf(width, height);
  const u = Math.min(width, height) / 1080;
  const safe = safeRect(width, height);
  const fontSize = { landscape: 38, portrait: 50, square: 40 }[orientation] * u;
  const maxLines = orientation === "landscape" ? 1 : 2;
  const bandHeight = maxLines * fontSize * 1.25 + 28 * u;
  return { fontSize, maxLines, height: bandHeight, reserve: bandHeight + 24 * u, width: safe.width * (orientation === "landscape" ? 0.8 : 1) };
}

export function layoutFor(ctx: Pick<FilmContext, "width" | "height"> & { insetBottom?: number }): Layout {
  const orientation = orientationOf(ctx.width, ctx.height);
  const u = Math.min(ctx.width, ctx.height) / 1080;
  const full = safeRect(ctx.width, ctx.height);
  const inset = Math.max(0, ctx.insetBottom ?? 0);
  const safe: SafeRect = { ...full, bottom: full.bottom - inset, height: full.height - inset };
  return {
    orientation,
    u,
    safe,
    safePadding: `${safe.top}px ${ctx.width - safe.right}px ${ctx.height - safe.bottom}px ${safe.left}px`,
    pick: (v) => v[orientation],
  };
}

/**
 * Characters that fit on one line at a given font size. 0.56em is a slightly
 * pessimistic average advance width for bold sans faces, so wrapped lines
 * err on the side of fitting.
 */
export function charsPerLine(widthPx: number, fontSizePx: number, avgAdvanceEm = 0.56): number {
  return Math.max(6, Math.floor(widthPx / (fontSizePx * avgAdvanceEm)));
}

/**
 * Largest font size (<= maxPx) at which `text` fits within maxLines lines of
 * widthPx, using the same char-width estimate as charsPerLine.
 */
export function fitFontSize(text: string, widthPx: number, maxPx: number, maxLines: number, minPx = 18): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const longest = words.reduce((m, w) => Math.max(m, w.length), 0);
  let size = maxPx;
  while (size > minPx) {
    const cpl = charsPerLine(widthPx, size);
    if (longest <= cpl && estimateLines(words, cpl) <= maxLines) return size;
    size -= 2;
  }
  return minPx;
}

function estimateLines(words: string[], cpl: number): number {
  let lines = 1;
  let cur = 0;
  for (const w of words) {
    const add = cur === 0 ? w.length : cur + 1 + w.length;
    if (add > cpl && cur > 0) {
      lines++;
      cur = w.length;
    } else cur = add;
  }
  return lines;
}

/** Shared text-node style that makes the browser wrap rather than overflow if an estimate is ever off. */
export const WRAP_SAFE: Partial<CSSStyleDeclaration> = {
  overflowWrap: "break-word",
  wordBreak: "normal",
  minWidth: "0",
};
