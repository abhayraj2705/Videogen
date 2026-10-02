import type { FilmContext } from "../contract.js";
import { clamp01, easeInCubic, easeOutCubic, easeOutQuint, spring } from "./easing.js";
import { stylePackFor, type StylePack } from "../style.js";
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

interface SceneInfo {
  pack: StylePack;
  /** Local time (s) the scene's content starts leaving, and how long it takes. exitSec 0 = it stays put. */
  exitAt: number;
  exitSec: number;
}

const sceneCache = new WeakMap<HTMLElement, SceneInfo>();

/**
 * What the player stamped on the scene root a mounted node belongs to
 * (`data-style`, `data-exit-at`, `data-exit-sec`), so shared motion helpers
 * pick up the film's look and the scene's exit window without each template
 * threading them through.
 */
function sceneOf(node: HTMLElement): SceneInfo {
  let info = sceneCache.get(node);
  if (!info) {
    const host = node.closest<HTMLElement>("[data-style]");
    info = { pack: stylePackFor(host?.dataset.style), exitAt: Number(host?.dataset.exitAt ?? 0), exitSec: Number(host?.dataset.exitSec ?? 0) };
    // Only cache once attached: before that the lookup would wrongly pin the defaults.
    if (host) sceneCache.set(node, info);
  }
  return info;
}

/**
 * True when the scene this node belongs to is cut into with a match cut: its window is carried in from
 * the previous scene's by the player, so the scene's own entrance (tilting up, swinging in) must not play too.
 */
export function entersMatched(node: HTMLElement): boolean {
  return node.closest<HTMLElement>("[data-style]")?.dataset.matchIn === "1";
}

/** The style pack of the film a mounted node belongs to. */
export function styleOf(node: HTMLElement): StylePack {
  return sceneOf(node).pack;
}

/** 0 before the scene's exit window, easing to 1 across it; `delay` (0-1 of the window) staggers siblings. */
function exitAmount(info: SceneInfo, t: number, delay = 0): number {
  if (info.exitSec <= 0 || t <= info.exitAt) return 0;
  return easeInCubic(clamp01((t - info.exitAt - delay * info.exitSec) / (info.exitSec * (1 - delay))));
}

/**
 * Staggered word entrance in the film's reveal style: rising on a spring
 * (default), wiping up out of a mask, popping in at scale, or resolving out of
 * a blur. Timing is the same for every style, so settle marks don't move.
 */
export function wordsIn(words: HTMLElement[], t: number, start: number, each = 0.05, dur = 0.5, riseEm = 0.55): void {
  if (words.length === 0) return;
  const scene = sceneOf(words[0]!);
  const reveal = scene.pack.reveal;
  for (let i = 0; i < words.length; i++) {
    const lin = clamp01((t - start - i * each) / dur);
    const w = words[i]!;
    const done = lin >= 1;
    w.style.opacity = String(clamp01(lin * 2.5));
    if (reveal === "mask") {
      const e = easeOutQuint(lin);
      w.style.opacity = lin > 0 ? "1" : "0";
      w.style.clipPath = done ? "none" : `inset(0 0 ${((1 - e) * 100).toFixed(2)}% 0)`;
      w.style.transform = done ? "none" : `translateY(${((1 - e) * 0.9).toFixed(4)}em)`;
    } else if (reveal === "pop") {
      const s = spring(lin, 0.5, 1.3);
      w.style.transform = done ? "none" : `scale(${(0.5 + 0.5 * s).toFixed(4)})`;
    } else if (reveal === "blur") {
      const e = easeOutCubic(lin);
      w.style.opacity = String(e);
      w.style.filter = done ? "none" : `blur(${((1 - e) * 0.28).toFixed(4)}em)`;
      w.style.transform = done ? "none" : `translateY(${((1 - e) * 0.18).toFixed(4)}em)`;
    } else {
      const s = spring(lin, 0.72, 1.1);
      w.style.transform = done ? "none" : `translateY(${((1 - s) * riseEm).toFixed(4)}em)`;
    }
    // Exit: as the next scene dissolves in, the words lift away one after another instead of fading as a slab.
    const out = exitAmount(scene, t, (0.4 * i) / words.length);
    if (out > 0) {
      w.style.opacity = String(1 - out);
      w.style.transform = `translateY(${(-0.4 * out).toFixed(4)}em)`;
    }
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
  const scene = sceneOf(node);
  const { damping, freq } = scene.pack.spring;
  const inv = 1 - (o.ease ? o.ease(lin) : spring(lin, damping, freq));
  node.style.opacity = String(clamp01(lin * 2.2));
  if (lin >= 1) {
    // Exit: blocks sink back and fade as the next scene dissolves in.
    const out = exitAmount(scene, t);
    if (out > 0) {
      node.style.opacity = String(1 - out);
      node.style.transform = `translateY(${(-5 * out).toFixed(3)}%) scale(${(1 - 0.05 * out).toFixed(4)}) ${extra}`.trim();
      return;
    }
    node.style.transform = extra || "none";
    return;
  }
  const scale = 1 - (1 - (o.scale ?? 1)) * inv;
  node.style.transform = `translate(${((o.x ?? 0) * inv).toFixed(2)}px, ${((o.y ?? 0) * inv).toFixed(2)}px) scale(${scale.toFixed(4)}) rotate(${((o.rotate ?? 0) * inv).toFixed(3)}deg) ${extra}`.trim();
}

/**
 * When list item `i` should start entering. With voice cues (seconds from the
 * scene start at which each item is spoken, added by Build) an item arrives
 * just ahead of its word; without them, or if a cue would come before the
 * plain stagger, the stagger wins.
 */
export function cueStart(cues: number[] | undefined, i: number, stagger: number, lead = 0.25): number {
  const cue = cues?.[i];
  return cue === undefined ? i * stagger : Math.max(i * stagger, cue - lead);
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
  const p = ctx.palette;
  const base = { boxSizing: "border-box", borderRadius: `${radius * ctx.style.radius * u}px` };
  const hairline = `${Math.max(1, 1.5 * u)}px solid ${p.border}`;
  switch (ctx.style.card) {
    case "outline":
      // Flat panel, strong accent-tinted outline, no shadow.
      return { ...base, background: p.surface, border: `${Math.max(2, 3 * u)}px solid ${p.accentSoft}`, boxShadow: "none" };
    case "glass":
      // The surface with a sheen of the foreground ink across one corner: reads as frosted without backdrop-filter.
      return { ...base, background: `linear-gradient(160deg, ${p.border}, transparent 60%), ${p.surface}`, border: hairline, boxShadow: `0 ${30 * u}px ${80 * u}px -${40 * u}px rgba(0,0,0,${p.isDark ? 0.7 : 0.25})` };
    case "solid":
      // Sticker-like: opaque panel with a hard offset shadow in the accent.
      return { ...base, background: p.surface, border: `${Math.max(2, 3 * u)}px solid ${p.fg}`, boxShadow: `${8 * u}px ${10 * u}px 0 ${p.accent}` };
    default:
      return { ...base, background: p.surface, border: hairline, boxShadow: `0 ${24 * u}px ${60 * u}px -${28 * u}px ${p.glow}, 0 ${2 * u}px ${6 * u}px rgba(0,0,0,${p.isDark ? 0.4 : 0.06})` };
  }
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
