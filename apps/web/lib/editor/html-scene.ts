import {
  FULL_LAYER,
  PRESETS,
  SAFE_LAYER,
  resolveAnchors,
  type SceneDoc,
  type SceneNode,
  type SceneNodeKind,
  type SceneTween,
} from "@sitereel/shared/scene-core";

/**
 * Edits to a designed scene (an HtmlScene's doc), as pure functions: the editor's undo history, the preview and
 * the server's validation all see whole docs, so every operation returns a new one and keeps it consistent —
 * removing a node removes its children and every tween that moves them.
 */

/** Mirror of film-runtime's ICON_NAMES (web may not import film-runtime). */
export const ICON_CHOICES = ["bolt", "shield", "chart", "users", "clock", "globe", "lock", "code", "layers", "check", "star", "rocket", "search", "bell", "card", "cloud", "link", "sparkle", "chat", "calendar", "heart", "gear"];

export const NODE_KIND_LABELS: Record<SceneNodeKind, string> = {
  box: "Group",
  text: "Text",
  count: "Figure",
  image: "Picture",
  frame: "Page in a window",
  shot: "Page",
  logo: "Logo",
  icon: "Icon",
  cursor: "Cursor",
};

export const SFX_CHOICES = ["click", "pop", "whoosh", "hit", "rise"];

export const PRESET_CHOICES = Object.keys(PRESETS);

/** Eases offered in the picker (any GSAP name typed by hand also works). */
export const EASE_PICKS = ["power2.out", "power3.out", "expo.out", "back.out(1.7)", "elastic.out", "sine.inOut", "power2.inOut", "power3.inOut", "expo.inOut", "power2.in", "none"];

export interface NodeRow {
  node: SceneNode;
  depth: number;
}

/** Nodes in tree order with their depth, for the element list. */
export function nodeTree(doc: SceneDoc): NodeRow[] {
  const rows: NodeRow[] = [];
  const walk = (parent: string, depth: number) => {
    for (const node of doc.nodes.filter((n) => (n.parent ?? SAFE_LAYER) === parent)) {
      rows.push({ node, depth });
      if (node.kind === "box") walk(node.id, depth + 1);
    }
  };
  walk(FULL_LAYER, 0);
  walk(SAFE_LAYER, 0);
  // Anything orphaned (a parent id that doesn't exist) still shows, at the top level.
  for (const node of doc.nodes) if (!rows.some((r) => r.node === node)) rows.push({ node, depth: 0 });
  return rows;
}

/** The node and everything inside it. */
export function subtreeIds(doc: SceneDoc, id: string): Set<string> {
  const ids = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const n of doc.nodes) {
      if (n.parent && ids.has(n.parent) && !ids.has(n.id)) {
        ids.add(n.id);
        grew = true;
      }
    }
  }
  return ids;
}

export function updateNode(doc: SceneDoc, id: string, patch: Partial<SceneNode>): SceneDoc {
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === id ? dropEmpty({ ...n, ...patch }) : n)) };
}

/** Removes a node, its children, and every tween that moves any of them. */
export function removeNode(doc: SceneDoc, id: string): SceneDoc {
  const gone = subtreeIds(doc, id);
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => !gone.has(n.id)),
    timeline: doc.timeline.filter((t) => !gone.has(t.target) && !/(^|;)\s*el\s*:\s*([\w-]+)/.exec(t.to ?? "")?.slice(2).some((x) => gone.has(x))),
  };
}

/** Moves a node one place among its siblings (keeping every parent before its children). */
export function moveNode(doc: SceneDoc, id: string, dir: -1 | 1): SceneDoc {
  const node = doc.nodes.find((n) => n.id === id);
  if (!node) return doc;
  const siblings = doc.nodes.filter((n) => (n.parent ?? SAFE_LAYER) === (node.parent ?? SAFE_LAYER));
  const at = siblings.indexOf(node);
  const other = siblings[at + dir];
  if (!other) return doc;
  // Swap the two subtrees' positions in the flat list: rebuild it from the tree with the two siblings swapped.
  const order = (parent: string): SceneNode[] =>
    doc.nodes
      .filter((n) => (n.parent ?? SAFE_LAYER) === parent)
      .map((n) => (n === node ? other : n === other ? node : n))
      .flatMap((n) => [n, ...(n.kind === "box" ? order(n.id) : [])]);
  const rebuilt = [...order(FULL_LAYER), ...order(SAFE_LAYER)];
  const rest = doc.nodes.filter((n) => !rebuilt.includes(n));
  return { ...doc, nodes: [...rebuilt, ...rest] };
}

/** A fresh id for a new node of `kind`. */
export function freshId(doc: SceneDoc, kind: SceneNodeKind): string {
  const taken = new Set(doc.nodes.map((n) => n.id));
  for (let i = 1; ; i++) {
    const id = `${kind}-${i}`;
    if (!taken.has(id)) return id;
  }
}

const STARTER: Record<SceneNodeKind, Partial<SceneNode>> = {
  box: { style: "flex-direction:row; gap:32px" },
  text: { text: "New line", style: "font-size:64px" },
  count: { value: "100" },
  image: {},
  frame: {},
  shot: {},
  logo: {},
  icon: { icon: "sparkle" },
  cursor: { style: "left:50%; top:70%" },
};

/**
 * Adds a node inside `parent` (a box id, or a layer) after its existing children, with a starter style and an
 * entrance so it doesn't just pop on. Returns the doc and the new id.
 */
export function addNode(doc: SceneDoc, kind: SceneNodeKind, parent: string = SAFE_LAYER, opts: { page?: string; at?: number } = {}): { doc: SceneDoc; id: string } {
  const id = freshId(doc, kind);
  const node: SceneNode = dropEmpty({ id, kind, ...(parent !== SAFE_LAYER ? { parent } : {}), ...STARTER[kind], ...(opts.page && (kind === "frame" || kind === "shot" || kind === "image") ? { page: opts.page } : {}) });
  // After the parent's last descendant, so the flat list keeps parents first.
  const inside = parent === SAFE_LAYER || parent === FULL_LAYER ? doc.nodes.filter((n) => (n.parent ?? SAFE_LAYER) === parent) : [...subtreeIds(doc, parent)].map((x) => doc.nodes.find((n) => n.id === x)!);
  const lastIndex = Math.max(-1, ...inside.map((n) => doc.nodes.indexOf(n)));
  const nodes = [...doc.nodes];
  nodes.splice(lastIndex + 1, 0, node);
  const entrance: SceneTween = { target: id, preset: kind === "text" ? "words" : kind === "count" ? "count-up" : kind === "icon" ? "draw" : kind === "cursor" ? "fade-in" : "rise", at: opts.at ?? 0.3 };
  return { doc: { ...doc, nodes, timeline: [...doc.timeline, entrance] }, id };
}

/** A first design from a scene's lines: the first set big and revealed word by word, the rest smaller after it. */
export function starterDoc(lines: string[]): SceneDoc {
  const texts = (lines.length > 0 ? lines : ["Your line here"]).slice(0, 4);
  return {
    v: 1,
    nodes: texts.map((text, i) => ({ id: i === 0 ? "headline" : `line-${i}`, kind: "text" as const, text, style: i === 0 ? "font-size:104px" : "font-size:40px; font-weight:600; color:var(--muted)" })),
    timeline: texts.map((_, i) => (i === 0 ? { target: "headline", preset: "mask-up", at: 0.15 } : { target: `line-${i}`, preset: "rise", at: round(0.8 + i * 0.25) })),
  };
}

const round = (v: number) => Math.round(v * 100) / 100;

export function updateTween(doc: SceneDoc, index: number, patch: Partial<SceneTween>): SceneDoc {
  return { ...doc, timeline: doc.timeline.map((t, i) => (i === index ? dropEmpty({ ...t, ...patch }) : t)) };
}

export function addTween(doc: SceneDoc, tween: SceneTween): SceneDoc {
  return { ...doc, timeline: [...doc.timeline, tween] };
}

export function removeTween(doc: SceneDoc, index: number): SceneDoc {
  return { ...doc, timeline: doc.timeline.filter((_, i) => i !== index) };
}

export function duplicateTween(doc: SceneDoc, index: number): SceneDoc {
  const t = doc.timeline[index];
  if (!t) return doc;
  const copy = { ...t, at: Math.round((t.at + tweenLength(t)) * 100) / 100 };
  const timeline = [...doc.timeline];
  timeline.splice(index + 1, 0, copy);
  return { ...doc, timeline };
}

/** A tween's length on the timeline (all its parts and repeats), for drawing its bar. */
export function tweenLength(t: SceneTween, partCount = 1): number {
  const p = t.preset ? PRESETS[t.preset] : undefined;
  const duration = t.duration ?? p?.duration ?? 0.6;
  const repeat = t.repeat ?? p?.repeat ?? 0;
  const stagger = t.stagger ?? p?.stagger ?? 0;
  return duration * (repeat + 1) + stagger * Math.max(0, partCount - 1);
}

/** Words of a narration line with an estimated start (the preview has no measured voice): 2.6 words/s after the lead-in. */
export function estimatedWords(narration: string | undefined, leadSec: number): { word: string; t: number }[] {
  return (narration ?? "").trim().split(/\s+/).filter(Boolean).map((word, i) => ({ word, t: leadSec + i / 2.6 }));
}

/** Words the anchor picker offers: the narration's words, once each, in order. */
export function anchorWords(narration: string | undefined): string[] {
  const seen = new Set<string>();
  return (narration ?? "")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}'-]+/gu, ""))
    .filter((w) => w.length >= 3 && !seen.has(w.toLowerCase()) && seen.add(w.toLowerCase()));
}

/**
 * An HtmlScene's props as the live preview draws them: anchors pinned to an estimated voice, pages shown as
 * labelled placeholders (crawled screenshots aren't fetchable from the browser before render), no fallback.
 */
export function previewHtmlProps(props: Record<string, unknown>, opts: { sceneDuration: number; narration?: string; leadSec: number; placeholder: (pageUrl: string) => string; logoUrl?: string | null }): Record<string, unknown> {
  const doc = props.doc as SceneDoc | undefined;
  if (!doc?.nodes) return props;
  const assets: Record<string, { src: string; pageLabel?: string }> = {};
  for (const n of doc.nodes) {
    if (n.page && (n.kind === "frame" || n.kind === "shot" || n.kind === "image")) assets[n.id] = { src: opts.placeholder(n.page), ...(n.kind === "frame" ? { pageLabel: pageHost(n.page) } : {}) };
  }
  // The template it replaced is kept for the editor, never drawn.
  const rest = { ...props };
  delete rest.fallback;
  return {
    ...rest,
    doc: resolveAnchors(doc, { sceneDuration: opts.sceneDuration, words: estimatedWords(opts.narration, opts.leadSec) }),
    assets,
    ...(opts.logoUrl ? { logoUrl: opts.logoUrl } : {}),
  };
}

function pageHost(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

/** Drops fields set to "" or undefined, so clearing a field removes it. */
function dropEmpty<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as T;
}
