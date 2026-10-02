import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutCubic, progress } from "../util/easing.js";
import { applyReveal, el, setStyle } from "../util/dom.js";
import { wrapText } from "../util/text-fit.js";
import { WRAP_SAFE, charsPerLine, fitFontSize, layoutFor } from "../util/layout.js";

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

/**
 * A testimonial, set big with an oversized quotation mark.
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
      const align = portrait ? "flex-start" : "center";
      const textAlign = portrait ? "left" : "center";
      setStyle(root, {
        position: "absolute",
        inset: "0",
        boxSizing: "border-box",
        padding: L.safePadding,
        display: "flex",
        flexDirection: "column",
        alignItems: align,
        justifyContent: "center",
        gap: `${L.pick({ landscape: 20, portrait: 32, square: 20 }) * u}px`,
        background: ctx.palette.bg,
      });

      const markSize = L.pick({ landscape: 140, portrait: 190, square: 130 }) * u;
      const markNode = el("div", "qc-mark", "“");
      setStyle(markNode, {
        fontSize: `${markSize}px`,
        lineHeight: "0.8",
        height: `${markSize * 0.5}px`,
        color: ctx.palette.accentText,
        fontFamily: ctx.fonts.display,
        fontWeight: "800",
      });
      root.appendChild(markNode);

      const textWidth = Math.min(L.safe.width, L.pick({ landscape: 1400, portrait: 1000, square: 940 }) * u);
      const maxLines = L.pick({ landscape: 3, portrait: 5, square: 4 });
      const size = fitFontSize(props.quote, textWidth, L.pick({ landscape: 54, portrait: 66, square: 50 }) * u, maxLines, 22 * u);
      const quoteWrap = el("div", "qc-quote-wrap");
      setStyle(quoteWrap, { display: "flex", flexDirection: "column", alignItems: align, gap: "0.15em", maxWidth: `${textWidth}px` });
      const lineNodes = wrapText(props.quote, charsPerLine(textWidth, size), maxLines).map((line) => {
        const node = el("div", "qc-line", line);
        setStyle(node, { ...WRAP_SAFE, fontSize: `${size}px`, fontWeight: "600", color: ctx.palette.fg, textAlign, lineHeight: "1.25", fontFamily: ctx.fonts.display });
        quoteWrap.appendChild(node);
        return node;
      });
      root.appendChild(quoteWrap);

      const authorNode = el("div", "qc-author", props.author ? `— ${props.author}` : "");
      setStyle(authorNode, {
        ...WRAP_SAFE,
        fontSize: `${L.pick({ landscape: 32, portrait: 40, square: 30 }) * u}px`,
        color: ctx.palette.accentText,
        fontFamily: ctx.fonts.body,
        maxWidth: `${textWidth}px`,
        textAlign,
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
      // 5 lines (9:16): author starts at 0.15+0.6+0.1 = 0.85 and lands 0.3 later.
      return [
        { t: 0, type: "start" },
        { t: 1.2, type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
