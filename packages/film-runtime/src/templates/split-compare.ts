import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { clamp01, easeOutCubic, easeSpring, progress } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";
import { layoutFor } from "../util/layout.js";
import { cardStyle, enter, sceneRoot, textBlock, wordsIn, wordsSettle, type TextBlock } from "../util/ui.js";

export interface SplitCompareProps {
  /** The "before" / problem side. Grounded. */
  left: string;
  /** The "after" / with-the-product side. Grounded. */
  right: string;
  /** Chip above each side. Defaults: "Before" / "After". */
  leftLabel?: string;
  rightLabel?: string;
}

interface Instance {
  leftCard: HTMLElement;
  rightCard: HTMLElement;
  arrow: HTMLElement;
  left: TextBlock;
  right: TextBlock;
  u: number;
  horizontal: boolean;
}

const LEFT_WORDS = 0.3;
const RIGHT_START = 1.1;
const WORD_EACH = 0.05;
const WORD_DUR = 0.45;

const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const rightSettle = (props: SplitCompareProps) => wordsSettle(countWords(props.right), RIGHT_START + 0.3, WORD_EACH, WORD_DUR);

/**
 * Two states side by side: the "before" card lands first in muted ink, then
 * the "after" card springs in beside it in the accent, an arrow pops between
 * them and the "before" side dims — the eye ends on the product's answer.
 * Layouts: 16:9 two cards side by side; 9:16 and 1:1 stacked, before on top.
 */
export function createSplitCompare(): SceneTemplate<SplitCompareProps> {
  let instance: Instance | undefined;

  return {
    id: "SplitCompare",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      const row = L.orientation === "landscape";
      const gap = L.pick({ landscape: 56, portrait: 60, square: 44 }) * u;
      sceneRoot(root, L, { flexDirection: row ? "row" : "column", gap: `${gap}px`, fontFamily: ctx.fonts.body });

      const pad = L.pick({ landscape: 52, portrait: 48, square: 36 }) * u;
      const cardWidth = row ? (L.safe.width - gap) / 2 : L.safe.width;
      const cardHeight = row ? L.safe.height * 0.68 : (L.safe.height - gap) / 2;

      const side = (text: string, label: string, accent: boolean): { card: HTMLElement; block: TextBlock } => {
        const card = el("div", accent ? "sp-after" : "sp-before");
        setStyle(card, {
          ...cardStyle(ctx, u, 32),
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          gap: `${pad * 0.5}px`,
          width: `${cardWidth}px`,
          height: `${cardHeight}px`,
          padding: `${pad}px`,
          ...(accent ? { background: `${ctx.palette.accent} linear-gradient(140deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`, border: "none" } : {}),
        });
        const chip = el("div", "sp-chip", label);
        setStyle(chip, {
          padding: `${8 * u}px ${22 * u}px`,
          borderRadius: `${24 * u}px`,
          background: accent ? ctx.palette.onAccent : ctx.palette.accentSoft,
          color: accent ? ctx.palette.accent : ctx.palette.muted,
          fontFamily: ctx.fonts.body,
          fontSize: `${L.pick({ landscape: 26, portrait: 30, square: 24 }) * u}px`,
          fontWeight: "700",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        });
        card.appendChild(chip);
        const block = textBlock(text, {
          className: accent ? "sp-after-text" : "sp-before-text",
          width: cardWidth - 2 * pad,
          maxSize: L.pick({ landscape: 88, portrait: 84, square: 64 }) * u,
          minSize: 24 * u,
          maxLines: 4,
          color: accent ? ctx.palette.onAccent : ctx.palette.muted,
          family: ctx.fonts.display,
          weight: "800",
          align: "left",
          lineHeight: 1.12,
        });
        card.appendChild(block.wrap);
        root.appendChild(card);
        return { card, block };
      };

      const before = side(props.left, props.leftLabel ?? "Before", false);
      const after = side(props.right, props.rightLabel ?? "After", true);

      const arrowSize = L.pick({ landscape: 84, portrait: 92, square: 72 }) * u;
      const arrow = el("div", "sp-arrow", row ? "→" : "↓");
      setStyle(arrow, {
        position: "absolute",
        left: `${ctx.width / 2 - arrowSize / 2}px`,
        top: `${(L.safe.top + L.safe.bottom) / 2 - arrowSize / 2}px`,
        width: `${arrowSize}px`,
        height: `${arrowSize}px`,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: ctx.palette.fg,
        color: ctx.palette.bg,
        fontSize: `${arrowSize * 0.5}px`,
        fontWeight: "800",
        lineHeight: "1",
        boxShadow: `0 ${10 * u}px ${30 * u}px -${10 * u}px rgba(0,0,0,0.5)`,
        zIndex: "2",
      });
      root.appendChild(arrow);

      instance = { leftCard: before.card, rightCard: after.card, arrow, left: before.block, right: after.block, u, horizontal: row };
    },

    seek(localT) {
      if (!instance) return;
      const { leftCard, rightCard, arrow, left, right, u, horizontal } = instance;
      enter(leftCard, localT, 0, 0.75, horizontal ? { x: -120 * u, scale: 0.94 } : { y: -100 * u, scale: 0.94 });
      wordsIn(left.words, localT, LEFT_WORDS, WORD_EACH, WORD_DUR);
      enter(rightCard, localT, RIGHT_START, 0.8, horizontal ? { x: 160 * u, scale: 0.9 } : { y: 140 * u, scale: 0.9 });
      wordsIn(right.words, localT, RIGHT_START + 0.3, WORD_EACH, WORD_DUR);

      // Once the answer is in, the "before" side steps back (applied to its text so the card's own entrance/exit stays in charge of the card).
      const dim = progress(localT, RIGHT_START + 0.2, RIGHT_START + 0.8, easeOutCubic);
      left.wrap.style.opacity = String(1 - 0.45 * dim);

      const pop = clamp01((localT - RIGHT_START - 0.25) / 0.5);
      arrow.style.opacity = String(clamp01(pop * 3));
      arrow.style.transform = pop >= 1 ? "none" : `scale(${(0.3 + 0.7 * easeSpring(pop)).toFixed(4)})`;
    },

    marks(props): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: Math.max(RIGHT_START + 0.8, rightSettle(props)), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
