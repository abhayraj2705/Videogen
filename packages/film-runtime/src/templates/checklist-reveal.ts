import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutCubic, easeSpring, progress } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";
import { WRAP_SAFE, fitFontSize, layoutFor } from "../util/layout.js";
import { cardStyle, enter, sceneRoot } from "../util/ui.js";

export interface ChecklistRevealProps {
  /** 2-4 short grounded items, each a fact's text (validated upstream). */
  items: string[];
}

interface Row {
  node: HTMLElement;
  check: HTMLElement;
  tick: SVGPathElement | null;
}

interface Instance {
  rows: Row[];
  u: number;
}

const ROW_STAGGER = 0.24;
const ROW_DURATION = 0.7;

/**
 * A short list of claims, each row sliding in as a card and getting ticked
 * off: the badge pops, then the check mark draws itself.
 * Layouts: 16:9 a centered list block (max ~1200u wide); 9:16 full-width
 * rows with larger type and more spacing; 1:1 compact rows.
 */
export function createChecklistReveal(): SceneTemplate<ChecklistRevealProps> {
  let instance: Instance | undefined;

  return {
    id: "ChecklistReveal",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      sceneRoot(root, L);

      const listWidth = Math.min(L.safe.width, L.pick({ landscape: 1240, portrait: 1000, square: 960 }) * u);
      const list = el("div", "cl-list");
      setStyle(list, { display: "flex", flexDirection: "column", alignItems: "stretch", gap: `${L.pick({ landscape: 22, portrait: 30, square: 18 }) * u}px`, width: `${listWidth}px` });
      root.appendChild(list);

      const checkSize = L.pick({ landscape: 60, portrait: 70, square: 52 }) * u;
      const rowGap = 26 * u;
      const padX = L.pick({ landscape: 34, portrait: 34, square: 26 }) * u;
      const padY = L.pick({ landscape: 24, portrait: 30, square: 20 }) * u;
      const labelWidth = listWidth - 2 * padX - checkSize - rowGap;
      const longest = props.items.reduce((a, s) => (s.length > a.length ? s : a), "");
      const labelSize = fitFontSize(longest, labelWidth, L.pick({ landscape: 46, portrait: 54, square: 40 }) * u, 2, 22 * u);

      const rows = props.items.map((item): Row => {
        const node = el("div", "cl-row");
        setStyle(node, { ...cardStyle(ctx, u, 24), display: "flex", alignItems: "center", gap: `${rowGap}px`, padding: `${padY}px ${padX}px` });

        const check = el("div", "cl-check");
        setStyle(check, {
          width: `${checkSize}px`,
          height: `${checkSize}px`,
          minWidth: `${checkSize}px`,
          borderRadius: "50%",
          background: `linear-gradient(135deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        });
        check.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="58%" height="58%" fill="none" stroke="${ctx.palette.onAccent}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.6l4.6 4.6L19 7.6" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg>`;
        node.appendChild(check);

        const label = el("div", "cl-label", item);
        setStyle(label, {
          ...WRAP_SAFE,
          fontSize: `${labelSize}px`,
          fontWeight: "700",
          color: ctx.palette.fg,
          fontFamily: ctx.fonts.display,
          lineHeight: "1.25",
          letterSpacing: "-0.015em",
          maxWidth: `${labelWidth}px`,
        });
        node.appendChild(label);

        list.appendChild(node);
        return { node, check, tick: check.querySelector("path") };
      });

      instance = { rows, u };
    },

    seek(localT) {
      if (!instance) return;
      const { u } = instance;
      instance.rows.forEach(({ node, check, tick }, i) => {
        const start = i * ROW_STAGGER;
        enter(node, localT, start, ROW_DURATION, { x: -90 * u, scale: 0.96 });
        const pop = progress(localT, start + 0.2, start + 0.7, easeSpring);
        check.style.transform = localT >= start + 0.7 ? "none" : `scale(${(0.3 + 0.7 * pop).toFixed(4)})`;
        if (tick) tick.style.strokeDashoffset = (1 - progress(localT, start + 0.4, start + 0.75, easeOutCubic)).toFixed(4);
      });
    },

    marks(props): Mark[] {
      const lastStart = (props.items.length - 1) * ROW_STAGGER;
      return [
        { t: 0, type: "start" },
        { t: lastStart + 0.8, type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
