import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { clamp01, easeOutCubic, progress } from "../util/easing.js";
import { applyReveal, el, setStyle } from "../util/dom.js";
import { WRAP_SAFE, layoutFor } from "../util/layout.js";
import { cardStyle, enter, sceneRoot, textBlock } from "../util/ui.js";

export interface QuoteCardProps {
  /** Must be a verbatim testimonial fact's text (validated upstream) — never paraphrased. */
  quote: string;
  author?: string;
}

interface Instance {
  card: HTMLElement;
  markNode: HTMLElement;
  words: HTMLElement[];
  authorNode: HTMLElement;
  u: number;
}

const SWEEP_START = 0.45;
const WORD_FADE = 0.25;

const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
/** Per-word delay of the read-along sweep: the whole quote lights up within ~1.4s however long it is. */
const sweepEach = (count: number) => Math.min(0.09, 1.4 / Math.max(1, count));
const sweepEnd = (count: number) => SWEEP_START + Math.max(0, count - 1) * sweepEach(count) + WORD_FADE;

/**
 * A testimonial on a card: the card springs in, then the quote lights up
 * word by word at reading pace (dim to full), and the author follows.
 * Layouts: 16:9 three centered lines; 9:16 left-aligned with up to five
 * lines (testimonials are long, the tall frame gives them room); 1:1 four lines.
 */
export function createQuoteCard(): SceneTemplate<QuoteCardProps> {
  let instance: Instance | undefined;

  return {
    id: "QuoteCard",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      const portrait = L.orientation === "portrait";
      sceneRoot(root, L);

      const pad = L.pick({ landscape: 64, portrait: 56, square: 44 }) * u;
      const cardWidth = Math.min(L.safe.width, L.pick({ landscape: 1500, portrait: 1000, square: 960 }) * u);
      const textWidth = cardWidth - 2 * pad;

      const card = el("div", "qc-card");
      setStyle(card, {
        ...cardStyle(ctx, u, 36),
        display: "flex",
        flexDirection: "column",
        alignItems: portrait ? "flex-start" : "center",
        gap: `${L.pick({ landscape: 24, portrait: 34, square: 22 }) * u}px`,
        width: `${cardWidth}px`,
        padding: `${pad}px`,
      });
      root.appendChild(card);

      const markSize = L.pick({ landscape: 150, portrait: 190, square: 130 }) * u;
      const markNode = el("div", "qc-mark", "“");
      setStyle(markNode, {
        fontSize: `${markSize}px`,
        lineHeight: "0.8",
        height: `${markSize * 0.46}px`,
        color: ctx.palette.accentText,
        fontFamily: ctx.fonts.display,
        fontWeight: "800",
      });
      card.appendChild(markNode);

      const quote = textBlock(props.quote, {
        className: "qc-quote",
        width: textWidth,
        maxSize: L.pick({ landscape: 62, portrait: 70, square: 52 }) * u,
        minSize: 22 * u,
        maxLines: L.pick({ landscape: 3, portrait: 5, square: 4 }),
        color: ctx.palette.fg,
        family: ctx.fonts.display,
        weight: "700",
        align: portrait ? "left" : "center",
        lineHeight: 1.22,
      });
      card.appendChild(quote.wrap);

      const authorNode = el("div", "qc-author", props.author ? `— ${props.author}` : "");
      setStyle(authorNode, {
        ...WRAP_SAFE,
        fontSize: `${L.pick({ landscape: 32, portrait: 40, square: 30 }) * u}px`,
        fontWeight: "600",
        color: ctx.palette.muted,
        fontFamily: ctx.fonts.body,
        maxWidth: `${textWidth}px`,
        textAlign: portrait ? "left" : "center",
      });
      card.appendChild(authorNode);

      instance = { card, markNode, words: quote.words, authorNode, u };
    },

    seek(localT) {
      if (!instance) return;
      const { words, u } = instance;
      enter(instance.card, localT, 0, 0.8, { y: 70 * u, scale: 0.92 });
      enter(instance.markNode, localT, 0.2, 0.6, { scale: 0.3, rotate: -18 });
      const each = sweepEach(words.length);
      words.forEach((word, i) => {
        const lit = clamp01((localT - SWEEP_START - i * each) / WORD_FADE);
        word.style.opacity = String(0.2 + 0.8 * lit);
      });
      const end = sweepEnd(words.length);
      applyReveal(instance.authorNode, progress(localT, end - 0.1, end + 0.25, easeOutCubic), 12 * u);
    },

    marks(props): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: Math.max(1.2, sweepEnd(countWords(props.quote)) + 0.3), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
