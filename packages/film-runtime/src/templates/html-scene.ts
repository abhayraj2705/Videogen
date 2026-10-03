import {
  FULL_LAYER,
  SAFE_LAYER,
  compileTimeline,
  lerpNumber,
  parseVars,
  sanitizeDeclarations,
  scalePx,
  settleTime,
  splitWords,
  textWindows,
  trackAt,
  type AnimVar,
  type SceneDoc,
  type SceneNode,
  type SceneTween,
  type Track,
} from "@sitereel/shared/scene-core";
import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { el, setStyle } from "../util/dom.js";
import { layoutFor } from "../util/layout.js";
import { browserFrame, type BrowserFrame, type PageRect } from "../util/browser-frame.js";
import type { ClipSource } from "../util/clip.js";
import { iconSvg } from "../util/icons.js";
import { cardStyle, logoMark } from "../util/ui.js";
import { clamp01, easeInCubic } from "../util/easing.js";
import { formatCounted, parseStatValue } from "./stat-counter.js";

/** Picture and camera material for one node, resolved by Build from the crawl (storage keys → URLs, fact → rect). */
export interface HtmlNodeAsset {
  src?: string;
  pageLabel?: string;
  focus?: PageRect;
  clip?: ClipSource;
}

export interface HtmlSceneProps {
  doc: SceneDoc;
  concept?: string;
  /** Per node id. Absent in an unbuilt storyboard: frames then show an empty window. */
  assets?: Record<string, HtmlNodeAsset>;
  logoUrl?: string;
  productName?: string;
  /** The template scene this one replaced; not drawn. */
  fallback?: unknown;
}

/** Where the cursor's arrow tip sits inside its box, as a share of the box. */
const CURSOR_TIP = { x: 0.18, y: 0.1 };
/** A text that doesn't fit its box is set smaller, a step at a time, down to this share of its size. */
const MIN_FIT = 0.55;

interface Unit {
  node: HTMLElement;
  tracks: Partial<Record<AnimVar, Track>>;
  /** The node's own static transform from its style, kept under the animated one. */
  baseTransform: string;
  /** Component behaviour, when the unit is one. */
  frame?: { api: BrowserFrame; focus?: PageRect };
  count?: { parsed: ReturnType<typeof parseStatValue>; raw: string };
  draw?: SVGPathElement[];
}

interface Instance {
  units: Unit[];
  /** Every word box: reset on each seek (see seek). */
  words: HTMLElement[];
  u: number;
  colors: Map<string, [number, number, number, number]>;
  layers: HTMLElement[];
  exitAt: number;
  exitSec: number;
}

/** Brand tokens every scene may use, as CSS custom properties on the scene root. */
function tokens(ctx: FilmContext, u: number): Record<string, string> {
  const p = ctx.palette;
  // The film's own card recipe (soft, glass, outline or solid, by tone), so designed scenes match the rest of the film.
  const card = cardStyle(ctx, u);
  return {
    "--bg": p.bg,
    "--fg": p.fg,
    "--accent": p.accent,
    "--accent-text": p.accentText,
    "--on-accent": p.onAccent,
    "--accent-alt": p.accentAlt,
    "--accent-soft": p.accentSoft,
    "--surface": p.surface,
    "--border": p.border,
    "--muted": p.muted,
    "--glow": p.glow,
    "--font-display": ctx.fonts.display,
    "--font-body": ctx.fonts.body,
    "--radius": `${(24 * ctx.style.radius * u).toFixed(2)}px`,
    "--card-bg": String(card.background ?? p.surface),
    "--card-border": String(card.border ?? "none"),
    "--card-shadow": String(card.boxShadow ?? "none"),
    "--shadow": `0 ${30 * u}px ${80 * u}px -${36 * u}px ${p.glow}, 0 ${2 * u}px ${8 * u}px rgba(0,0,0,${p.isDark ? 0.4 : 0.08})`,
  };
}

/** Kind defaults, applied before the node's own style. */
function defaults(kind: SceneNode["kind"], landscape: boolean): string {
  switch (kind) {
    case "box":
      return "display:flex; flex-direction:column; align-items:center; justify-content:center; gap:24px; box-sizing:border-box";
    case "text":
      return "font-family:var(--font-display); font-weight:700; font-size:64px; line-height:1.12; letter-spacing:-0.015em; color:var(--fg); text-align:center; text-wrap:balance; max-width:100%; overflow-wrap:break-word";
    case "count":
      return "font-family:var(--font-display); font-weight:800; font-size:160px; line-height:1; letter-spacing:-0.03em; color:var(--accent-text); font-variant-numeric:tabular-nums; white-space:nowrap";
    case "image":
      return `width:100%; ${landscape ? "aspect-ratio:16/10" : "aspect-ratio:4/5"}; border-radius:var(--radius); overflow:hidden; box-shadow:var(--shadow)`;
    case "frame":
    case "shot":
      return landscape ? "width:78%; aspect-ratio:16/10; flex-shrink:0" : "width:100%; aspect-ratio:4/5; flex-shrink:0";
    case "logo":
      return "width:140px; height:140px; flex-shrink:0";
    case "icon":
      return "width:72px; height:72px; color:var(--accent-text); flex-shrink:0";
    case "cursor":
      return "position:absolute; left:50%; top:60%; width:56px; height:56px; z-index:5";
  }
}

function applyDecls(node: HTMLElement, decls: string | undefined, u: number): void {
  for (const [prop, value] of sanitizeDeclarations(decls).decls) node.style.setProperty(prop, scalePx(value, u));
}

/** rgba from any CSS colour (var() resolved against `scope`), via a 1px canvas. */
function colorOf(value: string, scope: HTMLElement, cache: Map<string, [number, number, number, number]>): [number, number, number, number] {
  const hit = cache.get(value);
  if (hit) return hit;
  let css = value.trim();
  const v = /^var\((--[\w-]+)\)$/.exec(css);
  if (v) css = getComputedStyle(scope).getPropertyValue(v[1]!).trim() || "#000";
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const g = c.getContext("2d");
  let out: [number, number, number, number] = [0, 0, 0, 1];
  if (g) {
    g.fillStyle = "#000";
    g.fillStyle = css;
    g.fillRect(0, 0, 1, 1);
    const [r, gg, b, a] = g.getImageData(0, 0, 1, 1).data;
    out = [r!, gg!, b!, (a ?? 255) / 255];
  }
  cache.set(value, out);
  return out;
}

const CURSOR_SVG = `<svg viewBox="0 0 32 32" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><path d="M6 3 L6 26 L12.5 19.5 L17 29 L21 27.2 L16.6 18 L25.5 18 Z" fill="#fff" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg>`;

/** Splits a text node into word boxes (each holding an inner span a mask reveal moves), and letters when asked. */
function buildWords(node: HTMLElement, text: string, masked: boolean, chars: boolean): { words: HTMLElement[]; inners: HTMLElement[]; letters: HTMLElement[] } {
  const words: HTMLElement[] = [];
  const inners: HTMLElement[] = [];
  const letters: HTMLElement[] = [];
  splitWords(text).forEach((word, i) => {
    if (i > 0) node.appendChild(document.createTextNode(" "));
    // "-word" suffix: the player's emphasis finds these (player.ts).
    const outer = el("span", "hs-word");
    setStyle(outer, { display: "inline-block", whiteSpace: "nowrap" });
    if (masked) setStyle(outer, { overflow: "hidden", verticalAlign: "top", padding: "0.08em 0.04em 0.16em", margin: "-0.08em -0.04em -0.16em" });
    const inner = el("span", "hs-wi");
    setStyle(inner, { display: "inline-block" });
    if (chars) {
      for (const ch of Array.from(word)) {
        const letter = el("span", "hs-ch", ch);
        setStyle(letter, { display: "inline-block", whiteSpace: "pre" });
        inner.appendChild(letter);
        letters.push(letter);
      }
    } else {
      inner.textContent = word;
    }
    outer.appendChild(inner);
    node.appendChild(outer);
    words.push(outer);
    inners.push(inner);
  });
  return { words, inners, letters };
}

/** Shrinks a text node's font until it fits its box (a model's 96px headline in a narrow portrait column). */
function fitText(node: HTMLElement): void {
  const size = parseFloat(getComputedStyle(node).fontSize);
  if (!size) return;
  for (let k = 1, i = 0; i < 12 && k > MIN_FIT; i++) {
    // Slack of a tenth of the font: a mask reveal's word boxes reach 0.04em past each side of the line (buildWords),
    // which is not overflow — without it every masked headline was shrunk to the floor.
    const slack = 1 + parseFloat(node.style.fontSize || String(size)) * 0.1;
    const overflowing = node.scrollWidth > node.clientWidth + slack || node.scrollHeight > node.clientHeight + slack;
    // An element without an explicit height grows with its text; only width overflow matters there.
    const tooWide = node.scrollWidth > node.clientWidth + slack;
    if (!(node.style.height ? overflowing : tooWide)) return;
    k *= 0.92;
    node.style.fontSize = `${(size * k).toFixed(2)}px`;
  }
}

/** Element size in film pixels (the preview shows the stage scaled; offset sizes ignore transforms). */
const sizeOf = (node: HTMLElement) => ({ w: node.offsetWidth, h: node.offsetHeight });

/**
 * A scene the planner's model designed (see @sitereel/shared scene-core.ts): nodes laid out with CSS on the
 * brand's tokens, moved by a GSAP-style timeline that is compiled once at mount and evaluated as a pure
 * function of time. Text sits in the title-safe area; the full-frame layer is for backgrounds and bleeds.
 */
export function createHtmlScene(): SceneTemplate<HtmlSceneProps> {
  let instance: Instance | undefined;

  return {
    id: "HtmlScene",

    mount(root, props, ctx) {
      const L = layoutFor(ctx);
      const u = L.u;
      const landscape = L.orientation === "landscape";
      const doc = props.doc;
      const assets = props.assets ?? {};
      setStyle(root, { position: "relative", width: `${ctx.width}px`, height: `${ctx.height}px`, overflow: "hidden", fontFamily: ctx.fonts.body, color: ctx.palette.fg });
      for (const [k, v] of Object.entries(tokens(ctx, u))) root.style.setProperty(k, v);

      const full = el("div", "hs-full");
      setStyle(full, { position: "absolute", inset: "0", overflow: "hidden" });
      const safe = el("div", "hs-safe");
      setStyle(safe, {
        position: "absolute",
        left: `${L.safe.left}px`,
        top: `${L.safe.top}px`,
        width: `${L.safe.width}px`,
        height: `${L.safe.height}px`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: `${28 * u}px`,
        boxSizing: "border-box",
      });
      // The safe area's content sits in one box that is scaled down as a whole when a layout is too big for
      // this format (a stacked column that fits 9:16 but not 1:1), so nothing ever leaves the title-safe area.
      const fit = el("div", "hs-fit");
      setStyle(fit, { position: "relative", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: `${28 * u}px`, flexShrink: "0", transformOrigin: "50% 50%" });
      safe.appendChild(fit);
      root.appendChild(full);
      root.appendChild(safe);

      const compiledOnce = compileTimeline(doc);
      const nodes = new Map<string, HTMLElement>();
      const wordsOf = new Map<string, ReturnType<typeof buildWords>>();
      const components: { id: string; node: SceneNode; slot: HTMLElement }[] = [];
      const counts = new Map<string, Unit["count"]>();
      const drawPaths = new Map<string, SVGPathElement[]>();

      for (const n of doc.nodes) {
        const parentId = n.parent ?? SAFE_LAYER;
        const parent = parentId === SAFE_LAYER ? fit : parentId === FULL_LAYER ? full : nodes.get(parentId);
        if (!parent) continue;
        const node = el("div", `hs-${n.kind}`);
        node.dataset.el = n.id;
        applyDecls(node, defaults(n.kind, landscape), u);
        applyDecls(node, n.style, u);
        if (!landscape) applyDecls(node, n.narrow, u);
        parent.appendChild(node);
        nodes.set(n.id, node);

        if (n.kind === "text") {
          wordsOf.set(n.id, buildWords(node, n.text ?? "", compiledOnce.masked.has(n.id), compiledOnce.charNodes.has(n.id)));
        } else if (n.kind === "count") {
          const raw = (n.value ?? "").trim();
          node.textContent = raw;
          counts.set(n.id, { parsed: parseStatValue(raw), raw });
        } else if (n.kind === "image") {
          const src = assets[n.id]?.src;
          if (src) {
            const img = el("img");
            img.src = src;
            setStyle(img, { display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" });
            node.appendChild(img);
          }
        } else if (n.kind === "icon") {
          const svg = iconSvg(n.icon);
          if (svg) {
            node.innerHTML = svg; // our own markup (util/icons.ts), never the model's
            const paths = Array.from(node.querySelectorAll("path"));
            for (const p of paths) p.setAttribute("pathLength", "1");
            drawPaths.set(n.id, paths);
          }
        } else if (n.kind === "cursor") {
          node.innerHTML = CURSOR_SVG;
          node.style.pointerEvents = "none";
        } else if (n.kind === "frame" || n.kind === "shot" || n.kind === "logo") {
          components.push({ id: n.id, node: n, slot: node });
        }
      }

      // Text that is too big for its box gets smaller, now that the layout exists. (A node whose parent is
      // missing — a hand edit — was never built: skip it.)
      for (const n of doc.nodes) {
        const node = nodes.get(n.id);
        if (n.kind === "text" && node) fitText(node);
        // Pictures are redrawn at a fixed size once loaded (player.ts stabilizeImage): a scaled photo otherwise
        // comes out differently depending on what was drawn before.
        const img = n.kind === "image" ? node?.querySelector("img") : null;
        if (img && node && node.offsetWidth > 0 && node.offsetHeight > 0) {
          img.dataset.stable = `${node.offsetWidth}x${node.offsetHeight}`;
          img.dataset.stableFit = "cover";
        }
      }

      // Components need their laid-out size.
      const frames = new Map<string, Unit["frame"]>();
      for (const { id, node: n, slot } of components) {
        let { w, h } = sizeOf(slot);
        if (w < 8 || h < 8) {
          w = L.safe.width * 0.7;
          h = w * 0.62;
          setStyle(slot, { width: `${w}px`, height: `${h}px` });
        }
        if (n.kind === "logo") {
          const size = Math.min(w, h);
          slot.appendChild(logoMark({ className: "hs-logo", size, ...(props.logoUrl ? { logoUrl: props.logoUrl } : {}), productName: props.productName ?? "", ctx }));
          continue;
        }
        const asset = assets[id] ?? {};
        const shot = n.kind === "shot";
        const bar = Math.round(46 * u);
        const api = browserFrame({ className: "hs-browser", width: w, height: shot ? h + bar : h, screenshotUrl: asset.src ?? "", ...(asset.pageLabel && !shot ? { pageLabel: asset.pageLabel } : {}), ...(asset.clip ? { clip: asset.clip } : {}), ctx, u });
        if (shot) {
          // The same window without its toolbar: just the page, cut to the slot.
          (api.wrap.firstElementChild as HTMLElement).style.display = "none";
          api.wrap.style.height = `${h}px`;
        }
        slot.appendChild(api.wrap);
        // The page is redrawn once at the width the deepest camera move needs (browser-frame.ts caps zoom at 2.6x),
        // so zooming into it gives the same pixels whatever was drawn before (player.ts stabilizePage).
        api.image.dataset.stablePage = String(Math.round(w * 2.6));
        frames.set(id, { api, ...(asset.focus ? { focus: asset.focus } : {}) });
      }

      // Fit the layout, and every state the timeline takes it to: an element scaled up (a push-in) must still
      // keep its edges inside the safe area, so the fit leaves room for its largest scale.
      const stageScale = root.getBoundingClientRect().width / Math.max(1, root.offsetWidth) || 1;
      const safeBox = safe.getBoundingClientRect();
      const cx = safeBox.left + safeBox.width / 2;
      const cy = safeBox.top + safeBox.height / 2;
      let fitScale = Math.min(1, L.safe.height / Math.max(1, fit.offsetHeight), L.safe.width / Math.max(1, fit.scrollWidth));
      const biggest = new Map<string, number>();
      for (const track of compiledOnce.tracks) {
        if (track.unit.includes("/") || !["scale", "scaleX", "scaleY"].includes(track.prop)) continue;
        const most = Math.max(...track.segments.flatMap((s) => [s.from, s.to]).map((v) => ("n" in v ? v.n : 1)));
        biggest.set(track.unit, Math.max(biggest.get(track.unit) ?? 1, most));
      }
      for (const [id, s] of biggest) {
        const node = nodes.get(id);
        if (s <= 1 || !node || !safe.contains(node)) continue;
        const r = node.getBoundingClientRect();
        const ex = (Math.abs(r.left + r.width / 2 - cx) + (r.width / 2) * s) / stageScale;
        const ey = (Math.abs(r.top + r.height / 2 - cy) + (r.height / 2) * s) / stageScale;
        fitScale = Math.min(fitScale, L.safe.width / 2 / Math.max(1, ex), L.safe.height / 2 / Math.max(1, ey));
      }
      if (fitScale < 0.999) fit.style.transform = `scale(${fitScale.toFixed(4)})`;

      // Cursor moves name the node to land on: measured now, before anything moves, turned into x/y
      // (in the cursor's own units: film pixels / u, inside the fitted box).
      const k = stageScale * fitScale;
      const resolved: SceneTween[] = doc.timeline.map((tw) => {
        const toEl = parseVars(tw.to).vars.el;
        const cursor = nodes.get(tw.target);
        if (!toEl || !("el" in toEl) || !cursor) return tw;
        const target = nodes.get(toEl.el);
        if (!target) return tw;
        const c = cursor.getBoundingClientRect();
        const t = target.getBoundingClientRect();
        const dx = (t.left + t.width / 2 - (c.left + c.width * CURSOR_TIP.x)) / k / u;
        const dy = (t.top + t.height / 2 - (c.top + c.height * CURSOR_TIP.y)) / k / u;
        const rest = (tw.to ?? "").replace(/(^|;)\s*el\s*:[^;]*/i, "$1");
        return { ...tw, to: `${rest}; x:${dx.toFixed(2)}; y:${dy.toFixed(2)}` };
      });
      const compiled = compileTimeline({ ...doc, timeline: resolved });

      // Unit keys → elements.
      const elementFor = (key: string): HTMLElement | undefined => {
        const [id, part] = key.split("/");
        if (!part) return nodes.get(id!);
        const w = wordsOf.get(id!);
        const i = Number(part.slice(1));
        if (part[0] === "w") return w?.words[i];
        if (part[0] === "m") return w?.inners[i];
        if (part[0] === "c") return w?.letters[i];
        return undefined;
      };
      const unitsByNode = new Map<HTMLElement, Unit>();
      for (const track of compiled.tracks) {
        const node = elementFor(track.unit);
        if (!node) continue;
        let unit = unitsByNode.get(node);
        if (!unit) {
          const id = track.unit.includes("/") ? undefined : track.unit;
          unit = {
            node,
            tracks: {},
            baseTransform: node.style.transform && node.style.transform !== "none" ? node.style.transform : "",
            ...(id && frames.get(id) ? { frame: frames.get(id)! } : {}),
            ...(id && counts.get(id) ? { count: counts.get(id)! } : {}),
            ...(id && drawPaths.get(id) ? { draw: drawPaths.get(id)! } : {}),
          };
          unitsByNode.set(node, unit);
        }
        unit.tracks[track.prop] = track;
      }

      instance = {
        units: [...unitsByNode.values()],
        words: [...wordsOf.values()].flatMap((w) => w.words),
        u,
        colors: new Map(),
        layers: [full, safe],
        exitAt: Number(root.dataset.exitAt ?? "NaN"),
        exitSec: Number(root.dataset.exitSec ?? "0"),
      };
      // Colours resolve against this scene's tokens.
      for (const unit of instance.units) {
        for (const prop of ["color", "backgroundColor", "borderColor"] as const) {
          for (const seg of unit.tracks[prop]?.segments ?? []) {
            for (const v of [seg.from, seg.to]) if ("color" in v) colorOf(v.color, root, instance.colors);
          }
        }
      }
    },

    seek(localT) {
      if (!instance) return;
      const { u, colors } = instance;
      // The player lifts emphasised words after this seek and only while the pulse lasts (player.ts), counting on the
      // scene to put them back each frame — without this a word kept whatever lift was last drawn: pixels that
      // depend on what was shown before. Word boxes a tween moves are set again below.
      for (const word of instance.words) word.style.transform = "";
      const num = (unit: Unit, prop: AnimVar): { n: number; unit: "" | "%" } | null => {
        const track = unit.tracks[prop];
        if (!track) return null;
        const { seg, p } = trackAt(track, localT);
        return lerpNumber(seg.from, seg.to, p);
      };
      const colorAt = (unit: Unit, prop: AnimVar): string | null => {
        const track = unit.tracks[prop];
        if (!track) return null;
        const { seg, p } = trackAt(track, localT);
        const a = "color" in seg.from ? colors.get(seg.from.color) : undefined;
        const b = "color" in seg.to ? colors.get(seg.to.color) : undefined;
        if (!a || !b) return null;
        const m = (i: number) => a[i]! + (b[i]! - a[i]!) * p;
        return `rgba(${Math.round(m(0))}, ${Math.round(m(1))}, ${Math.round(m(2))}, ${m(3).toFixed(3)})`;
      };
      const len = (v: { n: number; unit: "" | "%" }) => (v.unit === "%" ? `${v.n.toFixed(3)}%` : `${(v.n * u).toFixed(2)}px`);

      for (const unit of instance.units) {
        const s = unit.node.style;
        const x = num(unit, "x");
        const y = num(unit, "y");
        const scale = num(unit, "scale")?.n ?? 1;
        const sx = (num(unit, "scaleX")?.n ?? 1) * scale;
        const sy = (num(unit, "scaleY")?.n ?? 1) * scale;
        const rot = num(unit, "rotate")?.n ?? 0;
        const rx = num(unit, "rotateX")?.n ?? 0;
        const ry = num(unit, "rotateY")?.n ?? 0;
        const kx = num(unit, "skewX")?.n ?? 0;
        const ky = num(unit, "skewY")?.n ?? 0;
        const moves =
          unit.tracks.x || unit.tracks.y || unit.tracks.scale || unit.tracks.scaleX || unit.tracks.scaleY || unit.tracks.rotate || unit.tracks.rotateX || unit.tracks.rotateY || unit.tracks.skewX || unit.tracks.skewY;
        if (moves) {
          const parts: string[] = [];
          if (rx !== 0 || ry !== 0) parts.push(`perspective(${(1400 * u).toFixed(1)}px)`);
          if ((x && x.n !== 0) || (y && y.n !== 0)) parts.push(`translate(${x ? len(x) : "0px"}, ${y ? len(y) : "0px"})`);
          if (rot !== 0) parts.push(`rotate(${rot.toFixed(3)}deg)`);
          if (rx !== 0) parts.push(`rotateX(${rx.toFixed(3)}deg)`);
          if (ry !== 0) parts.push(`rotateY(${ry.toFixed(3)}deg)`);
          if (kx !== 0 || ky !== 0) parts.push(`skew(${kx.toFixed(3)}deg, ${ky.toFixed(3)}deg)`);
          if (sx !== 1 || sy !== 1) parts.push(`scale(${sx.toFixed(5)}, ${sy.toFixed(5)})`);
          if (unit.baseTransform) parts.push(unit.baseTransform);
          // "none" at rest, not an identity transform: Chromium pixel-snaps the two differently (util/ui.ts).
          s.transform = parts.length > 0 ? parts.join(" ") : "none";
        }
        const opacity = num(unit, "opacity");
        if (opacity) s.opacity = String(clamp01(opacity.n));
        if (unit.tracks.blur || unit.tracks.brightness) {
          const blur = num(unit, "blur")?.n ?? 0;
          const bright = num(unit, "brightness")?.n ?? 1;
          const f = [blur > 0.01 ? `blur(${(blur * u).toFixed(2)}px)` : "", bright !== 1 ? `brightness(${bright.toFixed(3)})` : ""].filter(Boolean).join(" ");
          s.filter = f || "none";
        }
        if (unit.tracks.clipTop || unit.tracks.clipRight || unit.tracks.clipBottom || unit.tracks.clipLeft) {
          const c = (p: AnimVar) => Math.min(100, Math.max(0, num(unit, p)?.n ?? 0)).toFixed(3);
          const [t, r, b, l] = [c("clipTop"), c("clipRight"), c("clipBottom"), c("clipLeft")];
          s.clipPath = t === "0.000" && r === "0.000" && b === "0.000" && l === "0.000" ? "none" : `inset(${t}% ${r}% ${b}% ${l}%)`;
        }
        const ls = num(unit, "letterSpacing");
        if (ls) s.letterSpacing = `${ls.n.toFixed(4)}em`;
        for (const [prop, css] of [["color", "color"], ["backgroundColor", "backgroundColor"], ["borderColor", "borderColor"]] as const) {
          const c = colorAt(unit, prop);
          if (c) s[css] = c;
        }
        if (unit.frame) {
          const { api, focus } = unit.frame;
          const f = num(unit, "focus")?.n ?? 0;
          const ring = num(unit, "ring")?.n ?? 0;
          const play = num(unit, "play")?.n ?? 0;
          // The recording is the picture while it plays; else the camera is on the fact; else the page scrolls.
          const playing = !!unit.tracks.play && api.play(play);
          const focused = !playing && !!focus && (f > 0 || ring > 0) && api.focus(focus, f, ring);
          if (!playing && !focused) api.scroll(num(unit, "scroll")?.n ?? 0);
        }
        if (unit.count) {
          const p = clamp01(num(unit, "count")?.n ?? 1);
          const { parsed, raw } = unit.count;
          unit.node.textContent = p >= 1 || parsed.numeric === null ? raw : `${parsed.prefix}${formatCounted(parsed.numeric * p, parsed.decimals)}${parsed.suffix}`;
        }
        if (unit.draw) {
          const d = clamp01(num(unit, "draw")?.n ?? 1);
          for (const path of unit.draw) {
            path.style.strokeDasharray = "1";
            path.style.strokeDashoffset = (1 - d).toFixed(4);
          }
        }
      }

      // The scene clears out ahead of a dissolving cut (player.ts sets the window), so two layouts never overlap.
      if (Number.isFinite(instance.exitAt) && instance.exitSec > 0) {
        const e = easeInCubic(clamp01((localT - instance.exitAt) / instance.exitSec));
        for (const layer of instance.layers) {
          layer.style.opacity = e > 0 ? String(1 - e) : "";
          layer.style.transform = e > 0 ? `translateY(${(-18 * u * e).toFixed(2)}px)` : "";
        }
      }
    },

    marks(props): Mark[] {
      const compiled = compileTimeline(props.doc);
      const end = Math.max(1, ...compiled.tracks.flatMap((t) => t.segments.map((s) => s.start + s.duration * (s.repeat + 1))));
      return [
        { t: 0, type: "start" },
        { t: settleTime(textWindows(props.doc, compiled, end), compiled), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
