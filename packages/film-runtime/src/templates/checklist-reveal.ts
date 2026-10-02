import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutBack, easeOutCubic, progress } from "../util/easing.js";
import { applyReveal, el, setStyle } from "../util/dom.js";
import { WRAP_SAFE, fitFontSize, layoutFor } from "../util/layout.js";

export interface ChecklistRevealProps {
  /** 2-4 short grounded items, each a fact's text (validated upstream). */
  items: string[];
}

interface Instance {
  rows: { check: HTMLElement; label: HTMLElement }[];
}

const ROW_STAGGER = 0.22;
const ROW_DURATION = 0.4;

/**
 * A short list of claims, each checked off in sequence.
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
      });

      const listWidth = Math.min(L.safe.width, L.pick({ landscape: 1200, portrait: 1000, square: 940 }) * u);
      const list = el("div", "cl-list");
      setStyle(list, {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: `${L.pick({ landscape: 30, portrait: 48, square: 26 }) * u}px`,
        width: `${listWidth}px`,
      });
      root.appendChild(list);

      const checkSize = L.pick({ landscape: 52, portrait: 64, square: 48 }) * u;
      const rowGap = 24 * u;
      const labelWidth = listWidth - checkSize - rowGap;
      const longest = props.items.reduce((a, s) => (s.length > a.length ? s : a), "");
      const labelSize = fitFontSize(longest, labelWidth, L.pick({ landscape: 44, portrait: 54, square: 40 }) * u, 2, 22 * u);

      const rows = props.items.map((item) => {
        const row = el("div", "cl-row");
        setStyle(row, { display: "flex", alignItems: "center", gap: `${rowGap}px`, maxWidth: `${listWidth}px` });

        const check = el("div", "cl-check", "✓");
        setStyle(check, {
          width: `${checkSize}px`,
          height: `${checkSize}px`,
          minWidth: `${checkSize}px`,
          borderRadius: "50%",
          background: ctx.palette.accent,
          color: ctx.palette.onAccent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: `${checkSize * 0.55}px`,
          fontWeight: "700",
        });
        row.appendChild(check);

        const label = el("div", "cl-label", item);
        setStyle(label, {
          ...WRAP_SAFE,
          fontSize: `${labelSize}px`,
          fontWeight: "600",
          color: ctx.palette.fg,
          fontFamily: ctx.fonts.body,
          lineHeight: "1.3",
          maxWidth: `${labelWidth}px`,
        });
        row.appendChild(label);

        list.appendChild(row);
        return { check, label };
      });

      instance = { rows };
    },

    seek(localT) {
      if (!instance) return;
      instance.rows.forEach(({ check, label }, i) => {
        const start = i * ROW_STAGGER;
        const checkP = progress(localT, start, start + ROW_DURATION * 0.6, easeOutBack);
        check.style.opacity = String(Math.min(1, checkP));
        check.style.transform = `scale(${0.4 + 0.6 * checkP})`;
        applyReveal(label, progress(localT, start, start + ROW_DURATION, easeOutCubic), 12);
      });
    },

    marks(props): Mark[] {
      const lastStart = (props.items.length - 1) * ROW_STAGGER;
      return [
        { t: 0, type: "start" },
        { t: lastStart + ROW_DURATION, type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
