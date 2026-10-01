import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutExpo, progress } from "../util/easing.js";
import { applyReveal, el, setStyle } from "../util/dom.js";

export interface StatCounterProps {
  /** The grounded stat fact's text, e.g. "10,000+" or "99.9%" — must come from a FactLedger entry (validated upstream). */
  value: string;
  label: string;
}

interface Instance {
  valueNode: HTMLElement;
  labelNode: HTMLElement;
  numericTarget: number | null;
  prefix: string;
  suffix: string;
  decimals: number;
}

/** Parses "10,000+" -> {numeric: 10000, prefix: "", suffix: "+"} so the number itself can count up; non-numeric values just fade in as-is. */
function parseStatValue(value: string): { numeric: number | null; prefix: string; suffix: string; decimals: number } {
  const match = /^([^\d]*)([\d,]+(?:\.\d+)?)([^\d]*)$/.exec(value.trim());
  if (!match) return { numeric: null, prefix: "", suffix: "", decimals: 0 };
  const [, prefix, numStr, suffix] = match;
  const numeric = Number(numStr!.replace(/,/g, ""));
  if (Number.isNaN(numeric)) return { numeric: null, prefix: "", suffix: "", decimals: 0 };
  const decimals = numStr!.includes(".") ? numStr!.split(".")[1]!.length : 0;
  return { numeric, prefix: prefix ?? "", suffix: suffix ?? "", decimals };
}

function formatCounted(n: number, decimals: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Big animated count-up for a single grounded stat. One stat per scene — the number IS the claim. */
export function createStatCounter(): SceneTemplate<StatCounterProps> {
  let instance: Instance | undefined;

  return {
    id: "StatCounter",

    mount(root, props, ctx: FilmContext) {
      setStyle(root, {
        position: "absolute",
        inset: "0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: `${ctx.height * 0.015}px`,
        background: ctx.palette.bg,
      });

      const { numeric, prefix, suffix, decimals } = parseStatValue(props.value);

      const valueNode = el("div", "sc-value", numeric === null ? props.value : `${prefix}0${suffix}`);
      setStyle(valueNode, {
        fontSize: `${ctx.height * 0.16}px`,
        fontWeight: "800",
        color: ctx.palette.accent,
        fontFamily: ctx.fonts.display,
        letterSpacing: "-0.02em",
      });
      root.appendChild(valueNode);

      const labelNode = el("div", "sc-label", props.label);
      setStyle(labelNode, {
        fontSize: `${ctx.height * 0.034}px`,
        color: ctx.palette.fg,
        fontFamily: ctx.fonts.body,
        textAlign: "center",
      });
      root.appendChild(labelNode);

      instance = { valueNode, labelNode, numericTarget: numeric, prefix, suffix, decimals };
    },

    seek(localT) {
      if (!instance) return;
      const revealP = progress(localT, 0, 0.2, easeOutExpo);
      instance.valueNode.style.opacity = String(revealP);

      if (instance.numericTarget !== null) {
        const countP = progress(localT, 0.1, 0.75, easeOutExpo);
        const current = instance.numericTarget * countP;
        instance.valueNode.textContent = `${instance.prefix}${formatCounted(current, instance.decimals)}${instance.suffix}`;
      }

      applyReveal(instance.labelNode, progress(localT, 0.35, 0.65), 10);
    },

    marks(): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: 0.75, type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
