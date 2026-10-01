import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutCubic, progress } from "../util/easing.js";
import { applyReveal, el, setStyle } from "../util/dom.js";
import { wrapText } from "../util/text-fit.js";

export interface QuoteCardProps {
  /** Must be a verbatim testimonial fact's text (validated upstream) — never paraphrased. */
  quote: string;
  author?: string;
}

interface Instance {
  markNode: HTMLElement;
  lineNodes: HTMLElement[];
  authorNode: HTMLElement;
}

/** A testimonial, set big with an oversized quotation mark — social proof gets its own beat. */
export function createQuoteCard(): SceneTemplate<QuoteCardProps> {
  let instance: Instance | undefined;

  return {
    id: "QuoteCard",

    mount(root, props, ctx: FilmContext) {
      setStyle(root, {
        position: "absolute",
        inset: "0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: `${ctx.height * 0.02}px`,
        background: ctx.palette.bg,
        padding: `0 ${ctx.width * 0.12}px`,
      });

      const markNode = el("div", "qc-mark", "“");
      setStyle(markNode, {
        fontSize: `${ctx.height * 0.1}px`,
        lineHeight: "1",
        color: ctx.palette.accent,
        fontFamily: ctx.fonts.display,
        fontWeight: "800",
      });
      root.appendChild(markNode);

      const quoteWrap = el("div", "qc-quote-wrap");
      setStyle(quoteWrap, { display: "flex", flexDirection: "column", alignItems: "center", gap: "0.3em", marginTop: `-${ctx.height * 0.04}px` });
      const lines = wrapText(props.quote, Math.round(ctx.width / 36), 3);
      const lineNodes = lines.map((line) => {
        const node = el("div", "qc-line", line);
        setStyle(node, {
          fontSize: `${ctx.height * 0.044}px`,
          fontWeight: "600",
          color: ctx.palette.fg,
          textAlign: "center",
          lineHeight: "1.25",
          fontFamily: ctx.fonts.display,
        });
        quoteWrap.appendChild(node);
        return node;
      });
      root.appendChild(quoteWrap);

      const authorNode = el("div", "qc-author", props.author ?? "");
      setStyle(authorNode, {
        fontSize: `${ctx.height * 0.026}px`,
        color: ctx.palette.accent,
        fontFamily: ctx.fonts.body,
      });
      root.appendChild(authorNode);

      instance = { markNode, lineNodes, authorNode };
    },

    seek(localT) {
      if (!instance) return;
      applyReveal(instance.markNode, progress(localT, 0, 0.25, easeOutCubic), 8);
      instance.lineNodes.forEach((node, i) => {
        const start = 0.15 + i * 0.12;
        applyReveal(node, progress(localT, start, start + 0.3, easeOutCubic), 10);
      });
      const authorStart = 0.15 + instance.lineNodes.length * 0.12 + 0.1;
      applyReveal(instance.authorNode, progress(localT, authorStart, authorStart + 0.3, easeOutCubic), 8);
    },

    marks(): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: 0.8, type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
