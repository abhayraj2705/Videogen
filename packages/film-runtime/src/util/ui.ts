import type { FilmContext } from "../contract.js";
import { clamp01, easeSpringSoft, spring } from "./easing.js";
import { el, setStyle } from "./dom.js";
import { wrapText } from "./text-fit.js";
import { charsPerLine, fitFontSize, type Layout } from "./layout.js";

/**
 * Shared building blocks for scene templates: the scene root, word-split text
 * blocks, enter/stagger motion, cards and the logo mark. Everything here is a
 * pure function of the time passed in — no timers, no CSS animations.
 *
 * Rule for anything that moves: a finished animation sets `transform: none`,
 * never an identity transform like `scale(1)`. Chromium pixel-snaps an
 * untransformed box but keeps a sub-pixel offset for a transformed one, and
 * which it shows at identity depends on what was painted before — a
 * half-pixel difference between seek paths that fails the purity check.
 */

/** Base style for a scene root: a transparent, safe-padded flex column over the player's backdrop. */
export function sceneRoot(root: HTMLElement, L: Layout, style: Partial<CSSStyleDeclaration> = {}): void {
  setStyle(root, {
    position: "absolute",
    inset: "0",
    boxSizing: "border-box",
    padding: L.safePadding,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    background: "transparent",
    ...style,
  });
}

export interface TextBlockOptions {
  className: string;
  width: number;
  maxSize: number;
  minSize: number;
  maxLines: number;
  color: string;
  family: string;
  weight?: string;
  align?: "center" | "left";
  lineHeight?: number;
  tracking?: string;
}

export interface TextBlock {
  wrap: HTMLElement;
  lines: HTMLElement[];
  /** One node per word, in reading order — the unit text animates by. */
  words: HTMLElement[];
  fontSize: number;
  /** Laid-out height estimate (lines x line-height). */
  height: number;
}

/**
 * Lays text out as pre-wrapped lines of individually animatable words. Font
 * size is fit to `width` x `maxLines` first, so the block never needs the
 * browser to reflow at capture time (lines still flex-wrap if an estimate is off).
 */
export function textBlock(text: string, o: TextBlockOptions): TextBlock {
  const fontSize = fitFontSize(text, o.width, o.maxSize, o.maxLines, o.minSize);
  const lineHeight = o.lineHeight ?? 1.12;
  const left = o.align === "left";
  const wrap = el("div", o.className);
  setStyle(wrap, {
    display: "flex",
    flexDirection: "column",
    alignItems: left ? "flex-start" : "center",
    maxWidth: `${o.width}px`,
    fontSize: `${fontSize}px`,
    fontFamily: o.family,
    fontWeight: o.weight ?? "700",
    color: o.color,
    lineHeight: String(lineHeight),
    letterSpacing: o.tracking ?? "-0.02em",
  });
  const words: HTMLElement[] = [];
  const lines = wrapText(text, charsPerLine(o.width, fontSize), o.maxLines).map((line) => {
    const lineNode = el("div", `${o.className}-line`);
    setStyle(lineNode, { display: "flex", flexWrap: "wrap", justifyContent: left ? "flex-start" : "center", columnGap: "0.26em", maxWidth: `${o.width}px`, minWidth: "0" });
    for (const word of line.split(/\s+/).filter(Boolean)) {
      const node = el("span", `${o.className}-word`, word);
      setStyle(node, { display: "inline-block", position: "relative", isolation: "isolate" });
      lineNode.appendChild(node);
      words.push(node);
    }
    wrap.appendChild(lineNode);
    return lineNode;
  });
  return { wrap, lines, words, fontSize, height: lines.length * fontSize * lineHeight };
}

/** Staggered word entrance: each word springs up from below while fading in. */
export function wordsIn(words: HTMLElement[], t: number, start: number, each = 0.05, dur = 0.5, riseEm = 0.55): void {
  for (let i = 0; i < words.length; i++) {
    const lin = clamp01((t - start - i * each) / dur);
    const s = spring(lin, 0.72, 1.1);
    const w = words[i]!;
    w.style.opacity = String(clamp01(lin * 2.5));
    w.style.transform = lin >= 1 ? "none" : `translateY(${((1 - s) * riseEm).toFixed(4)}em)`;
  }
}

/** Time at which wordsIn() has fully landed its last word. */
export function wordsSettle(count: number, start: number, each = 0.05, dur = 0.5): number {
  return start + Math.max(0, count - 1) * each + dur;
}

export interface EnterOptions {
  x?: number;
  y?: number;
  /** Starting scale (1 = no scale). */
  scale?: number;
  /** Starting rotation in degrees. */
  rotate?: number;
  ease?: (t: number) => number;
}

/**
 * Springs a node into place from an offset/scale/rotation, fading in over the
 * first half. `extra` is a transform appended after the entrance (a lift, a
 * pulse); omit it whenever it would be an identity so the node rests on `none`.
 */
export function enter(node: HTMLElement, t: number, start: number, dur: number, o: EnterOptions = {}, extra = ""): void {
  const lin = clamp01((t - start) / dur);
  const inv = 1 - (o.ease ?? easeSpringSoft)(lin);
  node.style.opacity = String(clamp01(lin * 2.2));
  if (lin >= 1) {
    node.style.transform = extra || "none";
    return;
  }
  const scale = 1 - (1 - (o.scale ?? 1)) * inv;
  node.style.transform = `translate(${((o.x ?? 0) * inv).toFixed(2)}px, ${((o.y ?? 0) * inv).toFixed(2)}px) scale(${scale.toFixed(4)}) rotate(${((o.rotate ?? 0) * inv).toFixed(3)}deg) ${extra}`.trim();
}

/** `scaleX(p)` for a draw-on element, resting on `none` once fully drawn. */
export function scaleXTo(p: number): string {
  return p >= 1 ? "none" : `scaleX(${p.toFixed(4)})`;
}

/** A marker-pen swipe behind a word; drive it with marker.style.transform = scaleXTo(p). */
export function addMarker(word: HTMLElement, color: string): HTMLElement {
  const marker = el("span", "marker");
  setStyle(marker, {
    position: "absolute",
    // Flush with the word: a marker that overhangs would push a line-edge word past the title-safe area.
    left: "0",
    right: "0",
    top: "0.56em",
    bottom: "0.06em",
    background: color,
    borderRadius: "0.12em",
    transformOrigin: "left center",
    transform: "scaleX(0)",
    zIndex: "-1",
  });
  word.appendChild(marker);
  return marker;
}

/** Card surface used across templates: opaque brand-tinted panel with a hairline and a soft, accent-tinted shadow. */
export function cardStyle(ctx: FilmContext, u: number, radius = 28): Partial<CSSStyleDeclaration> {
  return {
    boxSizing: "border-box",
    background: ctx.palette.surface,
    border: `${Math.max(1, 1.5 * u)}px solid ${ctx.palette.border}`,
    borderRadius: `${radius * u}px`,
    boxShadow: `0 ${24 * u}px ${60 * u}px -${28 * u}px ${ctx.palette.glow}, 0 ${2 * u}px ${6 * u}px rgba(0,0,0,${ctx.palette.isDark ? 0.4 : 0.06})`,
  };
}

/** The brand logo (image) or a lettered accent tile when the crawl found none. */
export function logoMark(opts: { className: string; size: number; logoUrl?: string; productName: string; ctx: FilmContext }): HTMLElement {
  const { size, ctx } = opts;
  const wrap = el("div", opts.className);
  setStyle(wrap, { width: `${size}px`, height: `${size}px`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: "0" });
  if (opts.logoUrl) {
    const img = el("img");
    img.src = opts.logoUrl;
    setStyle(img, { width: "100%", height: "100%", objectFit: "contain" });
    wrap.appendChild(img);
  } else {
    const tile = el("div", `${opts.className}-fallback`, opts.productName.slice(0, 1).toUpperCase());
    setStyle(tile, {
      width: "100%",
      height: "100%",
      borderRadius: "26%",
      background: `linear-gradient(135deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`,
      color: ctx.palette.onAccent,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: `${size * 0.52}px`,
      fontWeight: "800",
      fontFamily: ctx.fonts.display,
      boxShadow: `0 ${size * 0.14}px ${size * 0.4}px -${size * 0.12}px ${ctx.palette.glow}`,
    });
    wrap.appendChild(tile);
  }
  return wrap;
}
