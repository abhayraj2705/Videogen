import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutCubic, progress } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";
import { layoutFor } from "../util/layout.js";
import { cardStyle, enter, scaleXTo, sceneRoot, textBlock, wordsIn, wordsSettle } from "../util/ui.js";

/**
 * One piece of a composed scene. The planner chooses the pieces and their
 * order; the template sets them:
 *  - eyebrow: a short label in small capitals above what follows ("How it works")
 *  - headline: the scene's main line, set large
 *  - body: one supporting line
 *  - pills: 2-5 short items as a row of chips
 *  - stat: a figure with a label beneath it (several in a row sit side by side)
 *  - rule: an accent line that draws itself, to separate two groups
 */
export interface ComposedBlock {
  kind: "eyebrow" | "headline" | "body" | "pills" | "stat" | "rule";
  text?: string;
  items?: string[];
  value?: string;
  label?: string;
}

export interface ComposedProps {
  /** 2-5 blocks, top to bottom. */
  blocks: ComposedBlock[];
  /** Centred (default) or set against the left edge. */
  align?: "center" | "left";
  /** "card" sets the blocks on a panel; "accent" on an accent-filled one. Default: straight on the backdrop. */
  panel?: "none" | "card" | "accent";
}

type Piece =
  | { kind: "words"; words: HTMLElement[]; start: number; each: number; dur: number }
  | { kind: "nodes"; nodes: HTMLElement[]; start: number; stagger: number }
  | { kind: "rule"; node: HTMLElement; start: number };

interface Instance {
  pieces: Piece[];
  panel: HTMLElement | null;
  u: number;
}

const BLOCK_GAP_SEC = 0.28;
const MAX_BLOCKS = 5;

const cleanBlocks = (props: ComposedProps): ComposedBlock[] => (Array.isArray(props.blocks) ? props.blocks : []).slice(0, MAX_BLOCKS);
const countWords = (s: string | undefined) => (s ?? "").trim().split(/\s+/).filter(Boolean).length;

/** When each block starts and when the last has landed: shared by seek() and marks(). */
function schedule(blocks: ComposedBlock[]): { starts: number[]; settle: number } {
  const starts: number[] = [];
  let t = 0.15;
  let settle = 0.6;
  for (const b of blocks) {
    starts.push(t);
    const dur = b.kind === "headline" || b.kind === "body" || b.kind === "eyebrow" ? wordsSettle(countWords(b.text), 0, 0.05, 0.5) : b.kind === "pills" ? 0.6 + Math.max(0, (b.items?.length ?? 1) - 1) * 0.08 : 0.6;
    settle = Math.max(settle, t + dur);
    t += BLOCK_GAP_SEC + (b.kind === "headline" ? 0.2 : 0);
  }
  return { starts, settle };
}

/**
 * A scene composed for one film rather than picked from the catalogue: the
 * planner lists the blocks it wants (a label, a headline, a line, chips,
 * figures) and their order, and the template lays them out in the film's
 * style, sized to fill the frame, each arriving in turn. It gives a film
 * moments that no other film made with the same templates has — without
 * running anything the planner wrote: the blocks are data, the text is set
 * as text, and the layout is this code.
 * Layouts: a centred or left-aligned column in every format; stats sit side
 * by side in 16:9 and 1:1, stacked in 9:16.
 */
export function createComposed(): SceneTemplate<ComposedProps> {
  let instance: Instance | undefined;

  return {
    id: "Composed",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      const blocks = cleanBlocks(props);
      const left = props.align === "left";
      const panelKind = props.panel === "card" || props.panel === "accent" ? props.panel : "none";
      const onAccent = panelKind === "accent";
      const ink = onAccent ? ctx.palette.onAccent : ctx.palette.fg;
      const soft = onAccent ? ctx.palette.onAccent : ctx.palette.muted;
      const accentInk = onAccent ? ctx.palette.onAccent : ctx.palette.accentText;
      sceneRoot(root, L, { fontFamily: ctx.fonts.body, alignItems: left && panelKind === "none" ? "flex-start" : "center" });

      const pad = panelKind === "none" ? 0 : L.pick({ landscape: 70, portrait: 60, square: 50 }) * u;
      const width = Math.min(L.safe.width, L.pick({ landscape: 1500, portrait: 1000, square: 960 }) * u) - 2 * pad;
      const gap = L.pick({ landscape: 34, portrait: 44, square: 28 }) * u;

      const column = el("div", "cp-column");
      setStyle(column, { display: "flex", flexDirection: "column", alignItems: left ? "flex-start" : "center", gap: `${gap}px`, width: `${width}px` });

      const { starts } = schedule(blocks);
      // Fewer blocks get bigger type, so a two-block scene still carries the frame.
      const scale = blocks.length <= 2 ? 1.25 : blocks.length === 3 ? 1.1 : blocks.length >= 5 ? 0.86 : 1;
      const pieces: Piece[] = [];
      // Consecutive stats share one row.
      let statRow: HTMLElement | null = null;

      blocks.forEach((b, i) => {
        const start = starts[i]!;
        if (b.kind !== "stat") statRow = null;
        if (b.kind === "rule") {
          const rule = el("div", "cp-rule");
          setStyle(rule, { width: `${L.pick({ landscape: 140, portrait: 160, square: 120 }) * u}px`, height: `${8 * u}px`, borderRadius: `${4 * u}px`, background: onAccent ? ctx.palette.onAccent : `linear-gradient(90deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`, transformOrigin: left ? "left center" : "center", flexShrink: "0" });
          column.appendChild(rule);
          pieces.push({ kind: "rule", node: rule, start });
          return;
        }
        if (b.kind === "pills") {
          const items = (b.items ?? []).filter((s) => s.trim()).slice(0, 5);
          if (items.length === 0) return;
          const row = el("div", "cp-pills");
          setStyle(row, { display: "flex", flexWrap: "wrap", justifyContent: left ? "flex-start" : "center", gap: `${18 * u}px`, maxWidth: `${width}px` });
          const size = L.pick({ landscape: 40, portrait: 44, square: 34 }) * u * scale;
          const nodes = items.map((item) => {
            const pill = el("div", "cp-pill", item);
            setStyle(pill, {
              ...(onAccent ? { boxSizing: "border-box", borderRadius: `${size}px`, border: `${Math.max(2, 2.5 * u)}px solid ${ctx.palette.onAccent}`, background: "transparent" } : cardStyle(ctx, u, 40)),
              padding: `${size * 0.4}px ${size * 0.8}px`,
              fontFamily: ctx.fonts.display,
              fontSize: `${size}px`,
              fontWeight: "700",
              lineHeight: "1.15",
              letterSpacing: "-0.015em",
              color: ink,
              whiteSpace: "nowrap",
            });
            row.appendChild(pill);
            return pill;
          });
          column.appendChild(row);
          pieces.push({ kind: "nodes", nodes, start, stagger: 0.08 });
          return;
        }
        if (b.kind === "stat") {
          if (!b.value) return;
          if (!statRow) {
            statRow = el("div", "cp-stats");
            setStyle(statRow, { display: "flex", flexDirection: L.orientation === "portrait" ? "column" : "row", alignItems: left ? "flex-start" : "center", justifyContent: left ? "flex-start" : "center", gap: `${L.pick({ landscape: 90, portrait: 40, square: 60 }) * u}px` });
            column.appendChild(statRow);
          }
          const stat = el("div", "cp-stat");
          setStyle(stat, { display: "flex", flexDirection: "column", alignItems: left ? "flex-start" : "center", gap: `${8 * u}px` });
          const value = el("div", "cp-stat-value", b.value);
          setStyle(value, { fontFamily: ctx.fonts.display, fontSize: `${L.pick({ landscape: 150, portrait: 150, square: 116 }) * u * Math.min(scale, 1.1)}px`, fontWeight: "800", lineHeight: "1", letterSpacing: "-0.04em", color: accentInk, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" });
          stat.appendChild(value);
          if (b.label) {
            const label = el("div", "cp-stat-label", b.label);
            setStyle(label, { fontFamily: ctx.fonts.body, fontSize: `${L.pick({ landscape: 44, portrait: 46, square: 36 }) * u}px`, fontWeight: "600", lineHeight: "1.2", color: soft, whiteSpace: "nowrap" });
            stat.appendChild(label);
          }
          statRow.appendChild(stat);
          pieces.push({ kind: "nodes", nodes: [stat], start, stagger: 0 });
          return;
        }
        if (!b.text?.trim()) return;
        const headline = b.kind === "headline";
        const eyebrow = b.kind === "eyebrow";
        const block = textBlock(eyebrow ? b.text.toUpperCase() : b.text, {
          className: `cp-${b.kind}`,
          width,
          maxSize: (headline ? L.pick({ landscape: 124, portrait: 124, square: 98 }) : eyebrow ? L.pick({ landscape: 34, portrait: 38, square: 30 }) : L.pick({ landscape: 52, portrait: 56, square: 44 })) * u * scale,
          minSize: (eyebrow ? 20 : 26) * u,
          maxLines: headline ? L.pick({ landscape: 2, portrait: 4, square: 3 }) : L.pick({ landscape: 2, portrait: 3, square: 2 }),
          color: eyebrow ? accentInk : headline ? ink : soft,
          family: headline ? ctx.fonts.display : ctx.fonts.body,
          weight: headline ? "800" : eyebrow ? "700" : "500",
          align: left ? "left" : "center",
          lineHeight: headline ? 1.05 : 1.25,
          tracking: eyebrow ? "0.14em" : headline ? "-0.035em" : "-0.01em",
        });
        column.appendChild(block.wrap);
        pieces.push({ kind: "words", words: block.words, start, each: 0.05, dur: 0.5 });
      });

      let panel: HTMLElement | null = null;
      if (panelKind === "none") {
        root.appendChild(column);
      } else {
        panel = el("div", "cp-panel");
        setStyle(panel, {
          ...cardStyle(ctx, u, 44),
          // A solid accent under the gradient: QA's contrast probe reads the background colour, not the image.
          ...(onAccent ? { background: "none", backgroundColor: ctx.palette.accent, backgroundImage: `linear-gradient(135deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`, border: "none" } : {}),
          boxSizing: "border-box",
          padding: `${pad}px`,
          display: "flex",
          flexDirection: "column",
          alignItems: left ? "flex-start" : "center",
        });
        panel.appendChild(column);
        root.appendChild(panel);
      }
      instance = { pieces, panel, u };
    },

    seek(localT) {
      if (!instance) return;
      const { u } = instance;
      if (instance.panel) enter(instance.panel, localT, 0, 0.7, { y: 70 * u, scale: 0.92 });
      for (const piece of instance.pieces) {
        if (piece.kind === "words") wordsIn(piece.words, localT, piece.start, piece.each, piece.dur);
        else if (piece.kind === "rule") piece.node.style.transform = scaleXTo(progress(localT, piece.start, piece.start + 0.45, easeOutCubic));
        else piece.nodes.forEach((node, i) => enter(node, localT, piece.start + i * piece.stagger, 0.6, { y: 40 * u, scale: 0.8 }));
      }
    },

    marks(props): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: schedule(cleanBlocks(props)).settle + 0.05, type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
