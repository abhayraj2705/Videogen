/**
 * HTML scenes: the format, and everything about it that needs no DOM.
 *
 * An HtmlScene is a scene the planner's model designs itself instead of picking a template: a flat list of
 * nodes (layout + content, styled with CSS declarations on the brand's tokens) and a declarative timeline of
 * tweens in GSAP's model — from/to values, eases, stagger, repeat/yoyo — that the film runtime evaluates as a
 * pure function of time. Nothing the model writes is executed: styles go through an allow-list, there is no
 * markup string and no script, so a scene is safe to render and preview, and every part of it is editable.
 *
 * This module is imported by the validators (packages/shared), the browser runtime (packages/film-runtime,
 * via the "@sitereel/shared/scene-core" subpath so the film bundle never pulls in node code) and the web
 * editor. Keep it free of imports.
 */

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

/**
 * What a node is. `box` is a plain container (the only kind with children); the rest are content:
 * `text` a line set word by word; `count` a figure that can count up; `image` a crawled picture or upload;
 * `frame` a crawled page in a browser window (scrolls, camera moves onto a fact); `shot` the same page without
 * the window chrome; `logo` the brand mark; `icon` a line icon; `cursor` a pointer that moves and clicks.
 */
export const SCENE_NODE_KINDS = ["box", "text", "count", "image", "frame", "shot", "logo", "icon", "cursor"] as const;
export type SceneNodeKind = (typeof SCENE_NODE_KINDS)[number];

/** Parent of a top-level node in the title-safe area (the default). */
export const SAFE_LAYER = "";
/** Parent of a top-level node laid over the whole frame, edge to edge (backgrounds, full-bleed pictures). No text here. */
export const FULL_LAYER = "@full";

export interface SceneNode {
  /** Stable id, unique in the scene: what tweens, CSS and the editor refer to it by. */
  id: string;
  /** Id of a `box`, or SAFE_LAYER / FULL_LAYER. Absent = SAFE_LAYER. A parent comes before its children. */
  parent?: string;
  kind: SceneNodeKind;
  /** text: the words shown. */
  text?: string;
  /** count: the figure exactly as a cited fact writes it ("10,000+", "4.9"). */
  value?: string;
  /** frame / shot / image: the crawled page or uploaded image to show (one of the crawl's page urls). */
  page?: string;
  /** frame / shot: id of a cited fact measured on that page — where the camera goes on a `focus` tween. */
  fact?: string;
  /** icon: one of the runtime's icon names. */
  icon?: string;
  /** CSS declarations ("display:flex; gap:24px; color:var(--accent)"). Lengths in px are for a 1080px-short-side frame and scale with it. */
  style?: string;
  /** Declarations applied on top of `style` when the frame is portrait or square. */
  narrow?: string;
  /** text: "read" (the default) is held to the reading floor and checked by QA; "decor" is texture (giant outlined words, tickers). */
  role?: "read" | "decor";
}

/** Which part of a node a tween moves: the node itself, its words, its letters, or its child nodes. */
export const TWEEN_PARTS = ["self", "words", "chars", "children"] as const;
export type TweenPart = (typeof TWEEN_PARTS)[number];

export interface SceneTween {
  /** Node id. */
  target: string;
  part?: TweenPart;
  /** A named motion (see PRESETS) — fills in from/to/duration/ease/part/stagger; anything set here overrides it. */
  preset?: string;
  /** Start values, as declarations of animatable vars ("opacity:0; y:40; scale:.9"). Absent = where the previous tween left it. */
  from?: string;
  /** End values. Absent = where the previous tween left it (so a from-only tween animates back to rest). */
  to?: string;
  /** Seconds from the scene start. With an anchor, where it starts when the anchor can't be resolved (and what the editor shows). */
  at: number;
  /**
   * Ties the start to something only known at build time: "word:<word>" (when the voice says it), "end"
   * (the scene's end), "beat" / "strong" (the first music beat at or after `at`).
   */
  anchor?: string;
  /** Seconds added to a resolved anchor ("end" with offset -0.5 starts half a second before the cut). */
  offset?: number;
  duration?: number;
  ease?: string;
  /** Seconds between consecutive parts (words, letters, children). */
  stagger?: number;
  staggerFrom?: "start" | "center" | "end";
  /** Extra plays after the first (bounded: a film has an end). */
  repeat?: number;
  /** Alternate direction on each repeat. */
  yoyo?: boolean;
  /** A sound fired when the tween starts (a library name, e.g. "click", "pop", "whoosh"). */
  sfx?: string;
}

export interface SceneDoc {
  v: 1;
  nodes: SceneNode[];
  timeline: SceneTween[];
}

export const SCENE_LIMITS = {
  maxNodes: 40,
  maxTweens: 60,
  maxTextChars: 120,
  maxStyleChars: 900,
  maxRepeat: 12,
  maxTweenSec: 12,
} as const;

// ---------------------------------------------------------------------------
// CSS declarations: parse + allow-list
// ---------------------------------------------------------------------------

/** Splits "a: b; c: d" into ordered [prop, value] pairs. Semicolons inside parentheses (gradients) don't split. */
export function parseDeclarations(input: string | undefined): [string, string][] {
  if (!input) return [];
  const out: [string, string][] = [];
  let depth = 0;
  let start = 0;
  const push = (chunk: string) => {
    const i = chunk.indexOf(":");
    if (i <= 0) return;
    const prop = chunk.slice(0, i).trim().toLowerCase();
    const value = chunk.slice(i + 1).trim();
    if (prop && value) out.push([prop, value]);
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) {
      push(input.slice(start, i));
      start = i + 1;
    }
  }
  push(input.slice(start));
  return out;
}

const ALLOWED_CSS = new Set([
  "display", "flex", "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "order",
  "grid-template-columns", "grid-template-rows", "grid-column", "grid-row", "grid-area", "grid-auto-flow",
  "gap", "row-gap", "column-gap", "align-items", "align-content", "align-self", "justify-content", "justify-items", "justify-self", "place-items", "place-content", "place-self",
  "position", "top", "right", "bottom", "left", "inset", "z-index",
  "width", "height", "min-width", "min-height", "max-width", "max-height", "aspect-ratio", "box-sizing",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "overflow", "overflow-x", "overflow-y",
  "background", "background-color", "background-image", "background-size", "background-position", "background-repeat", "background-clip", "-webkit-background-clip", "-webkit-text-fill-color", "-webkit-text-stroke",
  "color", "opacity", "visibility",
  "border", "border-top", "border-right", "border-bottom", "border-left", "border-width", "border-style", "border-color", "border-radius",
  "border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius", "border-bottom-right-radius",
  "outline", "outline-offset", "box-shadow", "text-shadow",
  "font-family", "font-size", "font-weight", "font-style", "font-variant-numeric", "font-feature-settings", "line-height", "letter-spacing", "word-spacing",
  "text-align", "text-transform", "text-decoration", "text-decoration-color", "text-decoration-thickness", "text-underline-offset", "text-wrap", "white-space", "word-break", "overflow-wrap", "vertical-align",
  "transform", "transform-origin", "perspective", "filter", "backdrop-filter", "mix-blend-mode", "isolation", "clip-path", "object-fit", "object-position",
  "pointer-events", "will-change", "user-select",
]);

/** Values that could reach outside the scene (network, script, other documents) or break out of the stage. */
const FORBIDDEN_VALUE = /url\s*\(|expression\s*\(|javascript:|@import|image-set\s*\(|element\s*\(|attr\s*\(|[<>\\{}]|\/\*/i;

export interface SanitizedStyle {
  /** Allowed declarations, in order, keys in kebab-case. */
  decls: [string, string][];
  /** Declarations dropped, as "prop: reason". */
  dropped: string[];
}

export function sanitizeDeclarations(input: string | undefined): SanitizedStyle {
  const decls: [string, string][] = [];
  const dropped: string[] = [];
  for (const [prop, rawValue] of parseDeclarations(input)) {
    const value = rawValue.replace(/\s*!important\s*$/i, "");
    if (!ALLOWED_CSS.has(prop)) {
      dropped.push(`${prop}: not an allowed property`);
      continue;
    }
    if (FORBIDDEN_VALUE.test(value) || value.length > 400) {
      dropped.push(`${prop}: value not allowed`);
      continue;
    }
    if (prop === "position" && !/^(static|relative|absolute)$/i.test(value)) {
      // fixed/sticky would escape the scene; absolute is what was meant.
      decls.push([prop, "absolute"]);
      dropped.push(`${prop}: ${value} replaced by absolute`);
      continue;
    }
    decls.push([prop, value]);
  }
  return { decls, dropped };
}

/** Scales every px length for the frame (`u` = short side / 1080): the model designs for one size, films come in three. */
export function scalePx(value: string, u: number): string {
  if (u === 1) return value;
  return value.replace(/(-?\d*\.?\d+)px\b/g, (_, n: string) => `${+(Number(n) * u).toFixed(3)}px`);
}

// ---------------------------------------------------------------------------
// Animatable vars
// ---------------------------------------------------------------------------

/**
 * Everything a tween may move. Transforms and opacity work on any node; `clip` is an inset reveal
 * (top right bottom left, in % of the node: "0 100 0 0" hides it to the left edge); the rest drive components:
 * `scroll` 0-1 down the page in a frame/shot, `focus` 0-1 camera onto the node's fact, `ring` 0-1 the outline
 * around it, `play` 0-1 through the page recording, `count` 0-1 of a count's figure, `draw` 0-1 of an icon's
 * strokes; `el` moves a cursor onto another node (value: that node's id).
 */
export const NUMERIC_VARS = [
  "opacity", "x", "y", "scale", "scaleX", "scaleY", "rotate", "rotateX", "rotateY", "skewX", "skewY", "blur", "brightness", "letterSpacing",
  "clipTop", "clipRight", "clipBottom", "clipLeft", "scroll", "focus", "ring", "play", "count", "draw",
] as const;
export type NumericVar = (typeof NUMERIC_VARS)[number];
export const COLOR_VARS = ["color", "backgroundColor", "borderColor"] as const;
export type ColorVar = (typeof COLOR_VARS)[number];
export type AnimVar = NumericVar | ColorVar | "el";

/** The value a var has when no tween has touched it. */
export const REST: Record<NumericVar, number> = {
  opacity: 1, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, rotateX: 0, rotateY: 0, skewX: 0, skewY: 0, blur: 0, brightness: 1, letterSpacing: 0,
  clipTop: 0, clipRight: 0, clipBottom: 0, clipLeft: 0,
  // Untouched components sit at rest: the page at its top, the camera wide, the figure and strokes complete.
  scroll: 0, focus: 0, ring: 0, play: 0, count: 1, draw: 1,
};

const VAR_ALIASES: Record<string, AnimVar> = {
  opacity: "opacity", alpha: "opacity", autoalpha: "opacity",
  x: "x", y: "y", scale: "scale", scalex: "scaleX", scaley: "scaleY",
  rotate: "rotate", rotation: "rotate", rotatex: "rotateX", rotationx: "rotateX", rotatey: "rotateY", rotationy: "rotateY",
  skewx: "skewX", skewy: "skewY", blur: "blur", brightness: "brightness", letterspacing: "letterSpacing", "letter-spacing": "letterSpacing",
  cliptop: "clipTop", clipright: "clipRight", clipbottom: "clipBottom", clipleft: "clipLeft",
  scroll: "scroll", focus: "focus", ring: "ring", play: "play", count: "count", draw: "draw",
  color: "color", backgroundcolor: "backgroundColor", "background-color": "backgroundColor", background: "backgroundColor", bordercolor: "borderColor", "border-color": "borderColor",
  el: "el",
};

/** A tween value: a number with its unit ("" = the var's natural unit: px for x/y, deg for rotations, em for letterSpacing), a colour, or a node id. */
export type VarValue = { n: number; unit: "" | "%" } | { color: string } | { el: string };

export interface ParsedVars {
  vars: Partial<Record<AnimVar, VarValue>>;
  errors: string[];
}

/** Parses "opacity:0; y:40%; clip: 0 100 0 0; color: var(--accent)" into tween vars. */
export function parseVars(input: string | undefined): ParsedVars {
  const vars: Partial<Record<AnimVar, VarValue>> = {};
  const errors: string[] = [];
  for (const [rawProp, value] of parseDeclarations(input)) {
    if (rawProp === "clip") {
      // "inset(10% 0 0 0)" or "10 0 0 0", in % of the node.
      const nums = value.replace(/^inset\(|\)$/gi, "").split(/[\s,]+/).filter(Boolean).map((s) => Number(s.replace(/%$/, "")));
      if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) {
        errors.push(`clip: expected four numbers (top right bottom left), got "${value}"`);
        continue;
      }
      (["clipTop", "clipRight", "clipBottom", "clipLeft"] as const).forEach((k, i) => (vars[k] = { n: nums[i]!, unit: "" }));
      continue;
    }
    const prop = VAR_ALIASES[rawProp.replace(/[\s_]/g, "")];
    if (!prop) {
      errors.push(`"${rawProp}" is not an animatable var`);
      continue;
    }
    if (prop === "el") {
      vars.el = { el: value.replace(/^@?el:?/i, "").trim() };
      continue;
    }
    if ((COLOR_VARS as readonly string[]).includes(prop)) {
      if (FORBIDDEN_VALUE.test(value)) {
        errors.push(`${rawProp}: value not allowed`);
        continue;
      }
      vars[prop] = { color: value };
      continue;
    }
    const m = /^(-?\d*\.?\d+)\s*(px|%|deg|em)?$/i.exec(value);
    if (!m) {
      errors.push(`${rawProp}: "${value}" is not a number`);
      continue;
    }
    vars[prop] = { n: Number(m[1]), unit: m[2] === "%" ? "%" : "" };
  }
  return { vars, errors };
}

// ---------------------------------------------------------------------------
// Eases (GSAP names)
// ---------------------------------------------------------------------------

export type EaseFn = (t: number) => number;

const clamp01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t);
const powIn = (p: number): EaseFn => (t) => Math.pow(t, p);
const outOf = (f: EaseFn): EaseFn => (t) => 1 - f(1 - t);
const inOutOf = (f: EaseFn): EaseFn => (t) => (t < 0.5 ? f(t * 2) / 2 : 1 - f((1 - t) * 2) / 2);
const backIn = (s: number): EaseFn => (t) => t * t * ((s + 1) * t - s);
const bounceOut: EaseFn = (t) => {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};
const elasticOut =
  (amp: number, period: number): EaseFn =>
  (t) => {
    if (t === 0 || t === 1) return t;
    const a = Math.max(1, amp);
    const s = (period / (2 * Math.PI)) * Math.asin(1 / a);
    return a * Math.pow(2, -10 * t) * Math.sin(((t - s) * 2 * Math.PI) / period) + 1;
  };

const EASE_IN: Record<string, EaseFn> = {
  power1: powIn(2), quad: powIn(2), power2: powIn(3), cubic: powIn(3), power3: powIn(4), quart: powIn(4), power4: powIn(5), quint: powIn(5), strong: powIn(5),
  sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  expo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1))),
  circ: (t) => 1 - Math.sqrt(1 - t * t),
};

/** Every ease name the format accepts (without parameters). Marked pure so the film bundle, which never reads it, drops it. */
export const EASE_NAMES: string[] = /* @__PURE__ */ (() => [
  "none", "linear",
  ...Object.keys(EASE_IN).flatMap((k) => [k, `${k}.in`, `${k}.out`, `${k}.inOut`]),
  "back", "back.in", "back.out", "back.inOut", "elastic", "elastic.out", "elastic.in", "elastic.inOut", "bounce", "bounce.out", "bounce.in", "bounce.inOut",
])();

/**
 * Resolves a GSAP ease name ("power3.out", "back.out(2)", "expo.inOut", "none") to a function on [0, 1].
 * Returns null for a name it doesn't know. A bare family name is its ".out" form, as in GSAP.
 */
export function easeByName(name: string | undefined): EaseFn | null {
  const raw = (name ?? "power2.out").trim();
  if (raw === "none" || raw === "linear") return (t) => t;
  const m = /^([a-z]+\d?)(?:\.(in|out|inOut))?(?:\(([\d.,\s]*)\))?$/.exec(raw);
  if (!m) return null;
  const family = m[1]!;
  const dir = (m[2] ?? "out") as "in" | "out" | "inOut";
  // Parameters (back's overshoot, elastic's amplitude/period), kept to a sane range.
  const params = (m[3] ?? "").split(",").map((v) => Number(v.trim())).filter((n) => Number.isFinite(n) && n > 0 && n < 20);
  let base: EaseFn | undefined = EASE_IN[family];
  if (family === "back") base = backIn(params[0] ?? 1.70158);
  if (family === "bounce") base = outOf(bounceOut);
  if (family === "elastic") base = outOf(elasticOut(params[0] ?? 1, params[1] ?? 0.3));
  if (!base) return null;
  const f = base;
  if (dir === "in") return (t) => f(clamp01(t));
  if (dir === "out") return (t) => outOf(f)(clamp01(t));
  return (t) => inOutOf(f)(clamp01(t));
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export interface Preset {
  from?: string;
  to?: string;
  duration: number;
  ease: string;
  part?: TweenPart;
  stagger?: number;
  repeat?: number;
  yoyo?: boolean;
  /** Words are wrapped in a clipping box and their inner span is moved (a mask reveal). */
  mask?: boolean;
  /** Short description for the prompt and the editor. */
  about: string;
}

/** Named motions, so a scene reads like an editor's notes and stays consistent between scenes. */
export const PRESETS: Record<string, Preset> = {
  "fade-in": { from: "opacity:0", duration: 0.5, ease: "power2.out", about: "fades in" },
  "fade-out": { to: "opacity:0", duration: 0.4, ease: "power2.in", about: "fades out (an exit)" },
  rise: { from: "opacity:0; y:48", duration: 0.7, ease: "expo.out", about: "rises into place" },
  drop: { from: "opacity:0; y:-48", duration: 0.7, ease: "expo.out", about: "drops into place" },
  "slide-left": { from: "opacity:0; x:120", duration: 0.75, ease: "expo.out", about: "slides in from the right, moving left" },
  "slide-right": { from: "opacity:0; x:-120", duration: 0.75, ease: "expo.out", about: "slides in from the left, moving right" },
  "scale-in": { from: "opacity:0; scale:0.86", duration: 0.7, ease: "expo.out", about: "grows into place" },
  pop: { from: "opacity:0; scale:0.5", duration: 0.6, ease: "back.out(1.8)", about: "pops in with overshoot" },
  "blur-in": { from: "opacity:0; blur:18; scale:1.04", duration: 0.8, ease: "power3.out", about: "comes into focus" },
  "mask-up": { from: "y:110%", duration: 0.8, ease: "expo.out", part: "words", stagger: 0.07, mask: true, about: "each word rises out of a mask" },
  words: { from: "opacity:0; y:28", duration: 0.55, ease: "power3.out", part: "words", stagger: 0.07, about: "words arrive one after another" },
  type: { from: "opacity:0", duration: 0.01, ease: "none", part: "chars", stagger: 0.04, about: "typed out letter by letter" },
  wipe: { from: "clip: 0 100 0 0", duration: 0.8, ease: "power3.inOut", about: "revealed left to right" },
  "wipe-up": { from: "clip: 100 0 0 0", duration: 0.8, ease: "power3.inOut", about: "revealed bottom to top" },
  cascade: { from: "opacity:0; y:60; scale:0.94", duration: 0.7, ease: "expo.out", part: "children", stagger: 0.12, about: "children arrive one by one" },
  "count-up": { from: "count:0", to: "count:1", duration: 1.3, ease: "power2.out", about: "the figure counts up" },
  draw: { from: "draw:0", to: "draw:1", duration: 1, ease: "power2.inOut", about: "the icon draws itself" },
  scroll: { to: "scroll:1", duration: 3, ease: "power1.inOut", about: "the page scrolls down" },
  focus: { to: "focus:1; ring:1", duration: 1.2, ease: "power3.inOut", about: "the camera moves onto the node's fact and outlines it" },
  play: { from: "play:0", to: "play:1", duration: 3, ease: "none", about: "plays the page recording" },
  float: { to: "y:-14", duration: 1.4, ease: "sine.inOut", repeat: 3, yoyo: true, about: "drifts gently up and down" },
  pulse: { to: "scale:1.06", duration: 0.25, ease: "power2.out", repeat: 1, yoyo: true, about: "a quick pulse" },
  "push-in": { from: "scale:1", to: "scale:1.08", duration: 3, ease: "power1.inOut", about: "a slow camera push in" },
  move: { duration: 0.8, ease: "power3.inOut", about: "cursor travels to the node named in to: \"el: <id>\"" },
  click: { to: "scale:0.82", duration: 0.12, ease: "power2.out", repeat: 1, yoyo: true, about: "cursor clicks" },
  "exit-up": { to: "opacity:0; y:-36", duration: 0.45, ease: "power2.in", about: "leaves upward (an exit)" },
  "exit-down": { to: "opacity:0; y:36", duration: 0.45, ease: "power2.in", about: "leaves downward (an exit)" },
};

// ---------------------------------------------------------------------------
// Doc structure helpers
// ---------------------------------------------------------------------------

/** Words of a text node as the runtime splits them. */
export const splitWords = (text: string): string[] => text.split(/\s+/).filter(Boolean);

export function childrenOf(doc: SceneDoc, id: string): SceneNode[] {
  return doc.nodes.filter((n) => (n.parent ?? SAFE_LAYER) === id);
}

/** Every node from `id` up to its top-level ancestor (inclusive). */
export function ancestry(doc: SceneDoc, id: string): SceneNode[] {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const chain: SceneNode[] = [];
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push(cur);
    cur = cur.parent ? byId.get(cur.parent) : undefined;
  }
  return chain;
}

/** Text a viewer must read, in document order. */
export function readableTexts(doc: SceneDoc): string[] {
  return doc.nodes.filter((n) => n.kind === "text" && n.role !== "decor" && n.text?.trim()).map((n) => n.text!.trim());
}

/** Every string in a scene that makes a claim: its words and its figures (checked for grounding like any on-screen text). */
export function claimStrings(doc: SceneDoc): string[] {
  return doc.nodes.flatMap((n) => [n.text ?? "", n.value ?? ""]).filter((s) => s.trim().length > 0);
}

/** Pages a scene shows. */
export function pagesShown(doc: SceneDoc): string[] {
  return doc.nodes.filter((n) => n.page && (n.kind === "frame" || n.kind === "shot" || n.kind === "image")).map((n) => n.page!);
}

// ---------------------------------------------------------------------------
// Timeline compilation (pure)
// ---------------------------------------------------------------------------

/**
 * Something a tween moves, by key: "<id>" a node, "<id>/w<i>" its i-th word box, "<id>/m<i>" the inner span of
 * that word (moved by mask reveals), "<id>/c<i>" its i-th letter (counted across the node, spaces excluded).
 * A `children` tween moves the child nodes themselves, so they are plain node keys.
 */
export type UnitKey = string;

export interface Segment {
  start: number;
  duration: number;
  from: VarValue;
  to: VarValue;
  ease: EaseFn;
  repeat: number;
  yoyo: boolean;
  /** Index of the tween in doc.timeline this came from. */
  tween: number;
}

export interface Track {
  unit: UnitKey;
  prop: AnimVar;
  segments: Segment[];
}

export interface CompiledTimeline {
  tracks: Track[];
  /** Units whose words are wrapped for a mask reveal. */
  masked: Set<string>;
  /** Node ids whose letters are animated (the runtime only splits these into letter spans). */
  charNodes: Set<string>;
  /** Fire times of tweens with sfx, for the audio mix. */
  sfx: { t: number; sfx: string }[];
  errors: string[];
}

export interface CompileOptions {
  /** Resolves a tween's start (anchors): defaults to its `at`. */
  startOf?: (tween: SceneTween, index: number) => number;
}

/** A tween with its preset applied. */
export function withPreset(tween: SceneTween): SceneTween & { duration: number; ease: string; mask: boolean } {
  const p = tween.preset ? PRESETS[tween.preset] : undefined;
  return {
    ...tween,
    part: tween.part ?? p?.part ?? "self",
    from: tween.from ?? p?.from,
    to: tween.to ?? p?.to,
    duration: tween.duration ?? p?.duration ?? 0.6,
    ease: tween.ease ?? p?.ease ?? "power2.out",
    stagger: tween.stagger ?? p?.stagger,
    repeat: tween.repeat ?? p?.repeat,
    yoyo: tween.yoyo ?? p?.yoyo,
    mask: !!p?.mask,
  };
}

/** The units a tween's part resolves to, in order. */
export function unitsFor(doc: SceneDoc, tween: SceneTween, mask: boolean): UnitKey[] {
  const node = doc.nodes.find((n) => n.id === tween.target);
  if (!node) return [];
  const part = tween.part ?? "self";
  if (part === "children") return childrenOf(doc, node.id).map((c) => c.id);
  if (part === "words") return splitWords(node.text ?? "").map((_, i) => `${node.id}/${mask ? "m" : "w"}${i}`);
  if (part === "chars") {
    const count = splitWords(node.text ?? "").join("").length;
    return Array.from({ length: count }, (_, i) => `${node.id}/c${i}`);
  }
  return [node.id];
}

function staggerOffsets(count: number, each: number, from: SceneTween["staggerFrom"]): number[] {
  return Array.from({ length: count }, (_, i) => {
    if (from === "end") return (count - 1 - i) * each;
    if (from === "center") return Math.abs(i - (count - 1) / 2) * each;
    return i * each;
  });
}

const restValue = (prop: AnimVar): VarValue | null => (prop === "el" || (COLOR_VARS as readonly string[]).includes(prop) ? null : { n: REST[prop as NumericVar], unit: "" });

/**
 * Turns the doc's timeline into per-unit, per-var tracks of segments, chained the way GSAP chains tweens on the
 * same property: a tween without a `from` starts where the previous one ended, one without a `to` ends there,
 * and before its first tween a property already shows that tween's start (GSAP's immediateRender for from()).
 */
export function compileTimeline(doc: SceneDoc, opts: CompileOptions = {}): CompiledTimeline {
  const errors: string[] = [];
  const masked = new Set<string>();
  const charNodes = new Set<string>();
  const sfx: CompiledTimeline["sfx"] = [];
  type Raw = { unit: UnitKey; prop: AnimVar; start: number; duration: number; from?: VarValue; to?: VarValue; ease: EaseFn; repeat: number; yoyo: boolean; tween: number };
  const raws: Raw[] = [];

  doc.timeline.forEach((original, index) => {
    const tw = withPreset(original);
    const label = `tween ${index + 1} (${tw.target}${tw.preset ? `, ${tw.preset}` : ""})`;
    const ease = easeByName(tw.ease);
    if (!ease) errors.push(`${label}: unknown ease "${tw.ease}"`);
    const from = parseVars(tw.from);
    const to = parseVars(tw.to);
    for (const e of [...from.errors, ...to.errors]) errors.push(`${label}: ${e}`);
    const props = new Set<AnimVar>([...(Object.keys(from.vars) as AnimVar[]), ...(Object.keys(to.vars) as AnimVar[])]);
    if (props.size === 0) {
      errors.push(`${label}: moves nothing (no from/to values and no preset that sets them)`);
      return;
    }
    const units = unitsFor(doc, tw, tw.mask);
    if (units.length === 0) {
      errors.push(`${label}: target "${tw.target}" ${doc.nodes.some((n) => n.id === tw.target) ? `has no ${tw.part}` : "is not a node"}`);
      return;
    }
    if (tw.part === "chars") charNodes.add(tw.target);
    if (tw.mask) masked.add(tw.target);
    const start = opts.startOf ? opts.startOf(original, index) : tw.at;
    const duration = Math.max(0, Math.min(SCENE_LIMITS.maxTweenSec, tw.duration));
    const repeat = Math.max(0, Math.min(SCENE_LIMITS.maxRepeat, Math.floor(tw.repeat ?? 0)));
    const offsets = staggerOffsets(units.length, Math.max(0, tw.stagger ?? 0), tw.staggerFrom);
    if (tw.sfx) sfx.push({ t: start, sfx: tw.sfx });
    units.forEach((unit, i) => {
      for (const prop of props) {
        raws.push({ unit, prop, start: start + offsets[i]!, duration, from: from.vars[prop], to: to.vars[prop], ease: ease ?? ((t) => t), repeat, yoyo: !!tw.yoyo, tween: index });
      }
    });
  });

  const byTrack = new Map<string, Raw[]>();
  for (const r of raws) {
    const key = `${r.unit}|${r.prop}`;
    const list = byTrack.get(key) ?? [];
    list.push(r);
    byTrack.set(key, list);
  }
  const tracks: Track[] = [];
  for (const list of byTrack.values()) {
    // Stable: tweens starting together keep timeline order, the later one winning (as in GSAP).
    const sorted = list.map((r, i) => ({ r, i })).sort((a, b) => a.r.start - b.r.start || a.i - b.i).map((x) => x.r);
    const { unit, prop } = sorted[0]!;
    let prevEnd: VarValue | null = restValue(prop);
    const segments: Segment[] = [];
    for (const r of sorted) {
      const from = r.from ?? prevEnd;
      const to = r.to ?? prevEnd;
      if (!from || !to) {
        // A colour or cursor move with only one end and nothing before it: nothing to interpolate from.
        if (r.to && !r.from) segments.push({ start: r.start, duration: r.duration, from: r.to, to: r.to, ease: r.ease, repeat: 0, yoyo: false, tween: r.tween });
        prevEnd = r.to ?? r.from ?? prevEnd;
        continue;
      }
      segments.push({ start: r.start, duration: r.duration, from, to, ease: r.ease, repeat: r.repeat, yoyo: r.yoyo, tween: r.tween });
      prevEnd = r.yoyo && r.repeat % 2 === 1 ? from : to;
    }
    if (segments.length > 0) tracks.push({ unit, prop, segments });
  }
  return { tracks, masked, charNodes, sfx, errors };
}

/** Where a segment is at time t: the eased progress 0-1 between its from and to, or null before it starts. */
export function segmentProgress(seg: Segment, t: number): number | null {
  if (t < seg.start) return null;
  const cycles = seg.repeat + 1;
  const total = seg.duration * cycles;
  if (seg.duration <= 0 || t >= seg.start + total) {
    const lastReversed = seg.yoyo && (cycles - 1) % 2 === 1;
    return lastReversed ? 0 : 1;
  }
  const local = (t - seg.start) / seg.duration;
  const cycle = Math.floor(local);
  let p = local - cycle;
  if (seg.yoyo && cycle % 2 === 1) p = 1 - p;
  return seg.ease(p);
}

/**
 * A track's value at time t as [segment, progress]: the latest segment that has started, or — before any has —
 * the first one at progress 0 (its start value shows from the beginning of the scene).
 */
export function trackAt(track: Track, t: number): { seg: Segment; p: number } {
  let active: Segment | null = null;
  for (const seg of track.segments) {
    if (seg.start <= t) active = seg;
    else break;
  }
  if (!active) return { seg: track.segments[0]!, p: 0 };
  return { seg: active, p: segmentProgress(active, t) ?? 0 };
}

/** Interpolates two numeric values (a zero adopts the other's unit, so "y:110%" → rest works). */
export function lerpNumber(a: VarValue, b: VarValue, p: number): { n: number; unit: "" | "%" } {
  const an = "n" in a ? a : { n: 0, unit: "" as const };
  const bn = "n" in b ? b : { n: 0, unit: "" as const };
  const unit = an.unit === bn.unit ? an.unit : an.n === 0 ? bn.unit : an.unit;
  return { n: an.n + (bn.n - an.n) * p, unit };
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

export interface AnchorContext {
  /** The scene's length on the final timeline. */
  sceneDuration: number;
  /** Narration words with their start time from the scene start. */
  words?: { word: string; t: number }[];
  /** Music beats from the scene start. */
  beats?: number[];
}

const wordKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Pins every anchored tween to a time: "word:<w>" to when the voice says it (plus `at`), "end" to the scene's
 * end (plus a negative `at`), "beat"/"strong" to the first beat at or after `at` (within 0.6 s). An anchor that
 * can't be resolved — no voice, a word never said — keeps its authored `at`, clamped into the scene.
 * Returns a doc without anchors: what the runtime, QA and the audio mix all see.
 */
export function resolveAnchors(doc: SceneDoc, ctx: AnchorContext): SceneDoc {
  const spoken = (ctx.words ?? []).map((w) => ({ key: wordKey(w.word), t: w.t }));
  const timeline = doc.timeline.map((tw) => {
    if (!tw.anchor) return tw;
    const { anchor, offset = 0, ...rest } = tw;
    let at = tw.at;
    if (anchor === "end") at = ctx.sceneDuration + (tw.offset ?? -0.5);
    else if (anchor.startsWith("word:")) {
      const want = wordKey(anchor.slice(5));
      const hit = want ? (spoken.find((w) => w.key === want) ?? spoken.find((w) => w.key.length >= 4 && (w.key.startsWith(want) || want.startsWith(w.key)))) : undefined;
      if (hit) at = hit.t + offset;
    } else if (anchor === "beat" || anchor === "strong") {
      const next = (ctx.beats ?? []).find((b) => b >= tw.at - 0.05);
      if (next !== undefined && next - tw.at <= 0.6) at = next + offset;
    }
    return { ...rest, at: Math.round(Math.max(0, Math.min(at, ctx.sceneDuration - 0.05)) * 1000) / 1000 };
  });
  return { ...doc, timeline };
}

// ---------------------------------------------------------------------------
// Analysis: when text is readable, when the scene settles
// ---------------------------------------------------------------------------

export interface TextWindow {
  nodeId: string;
  text: string;
  words: number;
  /** When the whole line is on screen and still (every entrance on it or its ancestors finished). */
  settled: number;
  /** When it starts leaving (the first exit on it or its ancestors), or the scene end. */
  leaves: number;
}

/** True when a segment ends invisible (opacity 0, or clipped away completely). */
function isExit(track: Track, seg: Segment): boolean {
  const end = seg.yoyo && seg.repeat % 2 === 1 ? seg.from : seg.to;
  if (!("n" in end)) return false;
  if (track.prop === "opacity") return end.n <= 0.01;
  if (track.prop === "clipTop" || track.prop === "clipBottom" || track.prop === "clipLeft" || track.prop === "clipRight") return end.n >= 99;
  return false;
}

const VISUAL_PROPS = new Set<AnimVar>(["opacity", "x", "y", "scale", "scaleX", "scaleY", "rotate", "rotateX", "rotateY", "skewX", "skewY", "blur", "clipTop", "clipRight", "clipBottom", "clipLeft", "letterSpacing"]);

/**
 * For every readable text node: when it has fully arrived and when it starts to leave. A text is "in" once
 * every movement on it, its words/letters and its ancestors that began before it settles has finished — repeats
 * that keep going (a float) don't hold it up. `sceneDuration` closes texts that never leave.
 */
export function textWindows(doc: SceneDoc, compiled: CompiledTimeline, sceneDuration: number): TextWindow[] {
  const out: TextWindow[] = [];
  for (const node of doc.nodes) {
    if (node.kind !== "text" || node.role === "decor" || !node.text?.trim()) continue;
    const owners = new Set(ancestry(doc, node.id).map((n) => n.id));
    const tracks = compiled.tracks.filter((tr) => {
      if (!VISUAL_PROPS.has(tr.prop)) return false;
      const base = tr.unit.split("/")[0]!;
      return base === node.id || (owners.has(base) && !tr.unit.includes("/"));
    });
    let settled = 0;
    let leaves = sceneDuration;
    for (const tr of tracks) {
      for (const seg of tr.segments) {
        if (isExit(tr, seg)) leaves = Math.min(leaves, seg.start);
      }
    }
    for (const tr of tracks) {
      for (const seg of tr.segments) {
        if (isExit(tr, seg) || seg.start >= leaves) continue;
        // A long ambient move (a slow push-in, a float) doesn't stop a line from being readable; only entrances count.
        const ambient = seg.repeat > 0 || seg.duration > 2;
        if (!ambient) settled = Math.max(settled, seg.start + seg.duration * (seg.repeat + 1));
      }
    }
    out.push({ nodeId: node.id, text: node.text.trim(), words: splitWords(node.text).length, settled, leaves });
  }
  return out;
}

/** Seconds a line needs on screen, settled: 0.3 s a word, never under 0.8 s. */
export const readSecondsFor = (words: number): number => Math.max(0.8, 0.3 * words);

/**
 * The scene's settle mark — the poster moment, and when QA reads the scene: everything has arrived. That is its
 * last readable line, and every other entrance too (a figure counting up, a camera move), but not ambient
 * motion (repeats, long drifts) or exits. 0.6 s in for a scene with nothing timed.
 */
export function settleTime(windows: TextWindow[], compiled?: CompiledTimeline): number {
  let t = windows.length > 0 ? Math.max(...windows.map((w) => w.settled)) : 0;
  for (const track of compiled?.tracks ?? []) {
    for (const seg of track.segments) {
      if (seg.repeat > 0 || seg.duration > 2 || isExit(track, seg)) continue;
      t = Math.max(t, seg.start + seg.duration);
    }
  }
  return t > 0 ? t : 0.6;
}

// ---------------------------------------------------------------------------
// Structural checks (no grounding — that is the storyboard validator's job)
// ---------------------------------------------------------------------------

export interface SceneDocIssue {
  code: string;
  message: string;
}

const ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
const ANCHOR_RE = /^(word:.+|end|beat|strong)$/;

export interface CheckSceneDocOptions {
  /** Scene length the timeline must fit (planner estimate). */
  durationSec: number;
  /** Icon names the runtime draws. */
  iconNames?: readonly string[];
  /** Crawled page urls a frame/shot/image may show (omit to skip). */
  pageUrls?: readonly string[];
  /** Fact ids this scene cites (a frame's `fact` must be one). */
  factIds?: readonly string[];
}

/** Everything wrong with a doc that would make it unrenderable, unreadable or unsafe. */
export function checkSceneDoc(doc: SceneDoc, opts: CheckSceneDocOptions): SceneDocIssue[] {
  const issues: SceneDocIssue[] = [];
  const add = (code: string, message: string) => issues.push({ code, message });
  if (doc.nodes.length === 0) add("html_empty", "the scene has no nodes");
  if (doc.nodes.length > SCENE_LIMITS.maxNodes) add("html_too_big", `${doc.nodes.length} nodes; at most ${SCENE_LIMITS.maxNodes}`);
  if (doc.timeline.length > SCENE_LIMITS.maxTweens) add("html_too_big", `${doc.timeline.length} tweens; at most ${SCENE_LIMITS.maxTweens}`);

  const seen = new Map<string, SceneNode>();
  for (const node of doc.nodes) {
    const label = `node "${node.id}"`;
    if (!ID_RE.test(node.id)) add("html_node", `${label}: id must be lowercase letters, digits and dashes, starting with a letter`);
    if (seen.has(node.id)) add("html_node", `${label}: id used twice`);
    const parent = node.parent ?? SAFE_LAYER;
    if (parent !== SAFE_LAYER && parent !== FULL_LAYER) {
      const p = seen.get(parent);
      if (!p) add("html_node", `${label}: parent "${parent}" is not a box listed before it`);
      else if (p.kind !== "box") add("html_node", `${label}: parent "${parent}" is a ${p.kind}; only a box holds other nodes`);
    }
    seen.set(node.id, node);
    if ((node.style?.length ?? 0) + (node.narrow?.length ?? 0) > SCENE_LIMITS.maxStyleChars) add("html_node", `${label}: style is too long`);
    // An unknown property is just dropped (the runtime ignores it); a value that could reach outside the scene is an error.
    for (const d of [...sanitizeDeclarations(node.style).dropped, ...sanitizeDeclarations(node.narrow).dropped]) {
      if (d.endsWith("value not allowed")) add("html_style", `${label}: ${d}`);
    }
    switch (node.kind) {
      case "text":
        if (!node.text?.trim()) add("html_node", `${label}: a text node needs text`);
        else if (node.text.length > SCENE_LIMITS.maxTextChars) add("html_node", `${label}: text is longer than ${SCENE_LIMITS.maxTextChars} characters`);
        break;
      case "count":
        if (!node.value || !/\d/.test(node.value)) add("html_node", `${label}: a count needs a value with a number in it`);
        break;
      case "frame":
      case "shot":
      case "image":
        if (!node.page) add("html_node", `${label}: a ${node.kind} needs a page`);
        else if (opts.pageUrls && !opts.pageUrls.map(normalizeUrl).includes(normalizeUrl(node.page))) add("html_page", `${label}: page "${node.page}" is not one of the crawled pages or uploads`);
        if (node.fact && opts.factIds && !opts.factIds.includes(node.fact)) add("html_node", `${label}: fact "${node.fact}" is not one this scene cites`);
        break;
      case "icon":
        if (!node.icon || (opts.iconNames && !opts.iconNames.includes(node.icon.trim().toLowerCase()))) add("html_node", `${label}: icon must be one of: ${(opts.iconNames ?? []).join(", ")}`);
        break;
    }
    if (parent === FULL_LAYER && node.kind === "text" && node.role !== "decor") add("html_layout", `${label}: readable text belongs in the title-safe area, not the full-frame layer`);
  }

  doc.timeline.forEach((tw, i) => {
    const label = `tween ${i + 1} (${tw.target})`;
    if (tw.preset && !PRESETS[tw.preset]) add("html_tween", `${label}: unknown preset "${tw.preset}"`);
    if (tw.anchor && !ANCHOR_RE.test(tw.anchor)) add("html_tween", `${label}: anchor must be "word:<word>", "end", "beat" or "strong"`);
    if (!Number.isFinite(tw.at)) add("html_tween", `${label}: at must be a number`);
    else if (tw.at < 0 || tw.at > opts.durationSec) add("html_tween", `${label}: starts at ${tw.at}s, outside the ${opts.durationSec}s scene`);
    const node = seen.get(tw.target);
    const part = tw.part ?? (tw.preset ? PRESETS[tw.preset]?.part : undefined) ?? "self";
    if (node && (part === "words" || part === "chars") && node.kind !== "text") add("html_tween", `${label}: only a text node has ${part}`);
    if (node && part === "children" && node.kind !== "box") add("html_tween", `${label}: only a box has children`);
    const toEl = parseVars(withPreset(tw).to).vars.el;
    if (toEl && "el" in toEl && !seen.has(toEl.el)) add("html_tween", `${label}: moves to "${toEl.el}", which is not a node`);
  });

  // Checked at the planned length with anchors as written (words at their authored time; "end" at the end).
  const compiled = compileTimeline(resolveAnchors(doc, { sceneDuration: opts.durationSec }));
  for (const e of compiled.errors) add("html_tween", e);

  // Brag's law, held per line: fast in, then hold long enough to read.
  for (const w of textWindows(doc, compiled, opts.durationSec)) {
    const held = w.leaves - w.settled;
    const need = readSecondsFor(w.words);
    if (held + 1e-6 < need) {
      add("html_read_time", `"${w.text}" is settled on screen for ${Math.max(0, held).toFixed(1)}s (from ${w.settled.toFixed(1)}s to ${w.leaves.toFixed(1)}s) but needs ${need.toFixed(1)}s to read — start it earlier, move it faster or leave it later`);
    }
  }

  const visual = doc.nodes.some((n) => n.kind !== "box");
  if (!visual) add("html_empty", "the scene shows nothing: add text, a figure, a page or an image");
  return issues;
}

function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return u;
  }
}
