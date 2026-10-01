import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutBack, easeOutCubic, progress } from "../util/easing.js";
import { applyReveal, el, setStyle } from "../util/dom.js";

export interface ChecklistRevealProps {
  /** 2-4 short grounded items, each a fact's text (validated upstream). */
  items: string[];
}

interface Instance {
  rows: { check: HTMLElement; label: HTMLElement }[];
}

const ROW_STAGGER = 0.22;
const ROW_DURATION = 0.4;

/** A short list of claims, each checked off in sequence — reads as "here's everything you get." */
export function createChecklistReveal(): SceneTemplate<ChecklistRevealProps> {
  let instance: Instance | undefined;

  return {
    id: "ChecklistReveal",

    mount(root, props, ctx: FilmContext) {
      setStyle(root, {
        position: "absolute",
        inset: "0",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: `${ctx.height * 0.028}px`,
        background: ctx.palette.bg,
        padding: `0 ${ctx.width * 0.16}px`,
      });

      const rows = props.items.map((item) => {
        const row = el("div", "cl-row");
        setStyle(row, { display: "flex", alignItems: "center", gap: `${ctx.height * 0.02}px` });

        const check = el("div", "cl-check", "✓");
        const checkSize = ctx.height * 0.045;
        setStyle(check, {
          width: `${checkSize}px`,
          height: `${checkSize}px`,
          minWidth: `${checkSize}px`,
          borderRadius: "50%",
          background: ctx.palette.accent,
          color: ctx.palette.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: `${checkSize * 0.55}px`,
          fontWeight: "700",
        });
        row.appendChild(check);

        const label = el("div", "cl-label", item);
        setStyle(label, {
          fontSize: `${ctx.height * 0.038}px`,
          fontWeight: "600",
          color: ctx.palette.fg,
          fontFamily: ctx.fonts.body,
        });
        row.appendChild(label);

        root.appendChild(row);
        return { check, label };
      });

      instance = { rows };
    },

    seek(localT) {
      if (!instance) return;
      instance.rows.forEach(({ check, label }, i) => {
        const start = i * ROW_STAGGER;
        const checkP = progress(localT, start, start + ROW_DURATION * 0.6, easeOutBack);
        check.style.opacity = String(checkP);
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
