import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutBack, easeOutCubic, progress } from "../util/easing.js";
import { applyReveal, el, setStyle } from "../util/dom.js";
import { wrapText } from "../util/text-fit.js";
import { WRAP_SAFE, charsPerLine, fitFontSize, layoutFor } from "../util/layout.js";

export interface KineticHookProps {
  /** Grounded product name, from the FactLedger. */
  productName: string;
  /** Grounded headline/tagline, from the FactLedger. */
  headline: string;
  /** Optional logo image URL (SVG/PNG), from brand extraction. */
  logoUrl?: string;
}

interface Instance {
  logoWrap: HTMLElement;
  lineNodes: HTMLElement[];
}

/**
 * Opening scene (2-3s per the planner rubric): logo pops in, headline wipes in.
 * Layouts: 16:9 two-line headline; 9:16 bigger logo + up to four stacked
 * lines filling the tall frame; 1:1 three lines at a slightly smaller size.
 */
export function createKineticHook(): SceneTemplate<KineticHookProps> {
  let instance: Instance | undefined;

  return {
    id: "KineticHook",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      setStyle(root, {
        position: "absolute",
        inset: "0",
        boxSizing: "border-box",
        padding: L.safePadding,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: ctx.palette.bg,
        fontFamily: ctx.fonts.display,
      });

      const logoSize = L.pick({ landscape: 150, portrait: 220, square: 150 }) * u;
      const logoWrap = el("div", "kh-logo");
      setStyle(logoWrap, {
        width: `${logoSize}px`,
        height: `${logoSize}px`,
        marginBottom: `${L.pick({ landscape: 44, portrait: 72, square: 40 }) * u}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: "0",
      });
      if (props.logoUrl) {
        const img = el("img");
        img.src = props.logoUrl;
        setStyle(img, { width: "100%", height: "100%", objectFit: "contain" });
        logoWrap.appendChild(img);
      } else {
        const fallback = el("div", "kh-logo-fallback", props.productName.slice(0, 1).toUpperCase());
        setStyle(fallback, {
          width: "100%",
          height: "100%",
          borderRadius: "20%",
          background: ctx.palette.accent,
          color: ctx.palette.onAccent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: `${logoSize * 0.55}px`,
          fontWeight: "700",
        });
        logoWrap.appendChild(fallback);
      }
      root.appendChild(logoWrap);

      const textWidth = Math.min(L.safe.width, L.pick({ landscape: 1500, portrait: 1000, square: 960 }) * u);
      const maxLines = L.pick({ landscape: 2, portrait: 4, square: 3 });
      const fontSize = fitFontSize(props.headline, textWidth, L.pick({ landscape: 84, portrait: 104, square: 80 }) * u, maxLines, 28 * u);

      const headlineWrap = el("div", "kh-headline");
      setStyle(headlineWrap, {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.12em",
        maxWidth: `${textWidth}px`,
      });
      const lines = wrapText(props.headline, charsPerLine(textWidth, fontSize), maxLines);
      const lineNodes = lines.map((line) => {
        const p = el("div", "kh-line", line);
        setStyle(p, {
          ...WRAP_SAFE,
          fontSize: `${fontSize}px`,
          fontWeight: "700",
          color: ctx.palette.fg,
          textAlign: "center",
          letterSpacing: "-0.01em",
          lineHeight: "1.15",
          maxWidth: `${textWidth}px`,
        });
        headlineWrap.appendChild(p);
        return p;
      });
      root.appendChild(headlineWrap);

      instance = { logoWrap, lineNodes };
    },

    seek(localT) {
      if (!instance) return;
      const logoP = progress(localT, 0, 0.5, easeOutBack);
      instance.logoWrap.style.opacity = String(Math.min(1, logoP));
      instance.logoWrap.style.transform = `scale(${0.6 + 0.4 * logoP})`;

      instance.lineNodes.forEach((node, i) => {
        const start = 0.35 + i * 0.18;
        const p = progress(localT, start, start + 0.35, easeOutCubic);
        applyReveal(node, p, 16);
      });
    },

    marks(props): Mark[] {
      const words = props.headline.trim().split(/\s+/).length;
      return [
        { t: 0, type: "start" },
        { t: 0.35, type: "headline-begin" },
        { t: Math.max(1.25, 0.35 + words * 0.05 + 0.4), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
