import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutExpo, progress } from "../util/easing.js";
import { applyReveal, el, setStyle } from "../util/dom.js";
import { WRAP_SAFE, fitFontSize, layoutFor } from "../util/layout.js";

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

/**
 * Big animated count-up for a single grounded stat. One stat per scene.
 * Layouts: value size is fit to the safe width (the counted number never
 * gets wider than the final value, which has the most digits); 9:16 sets
 * value and label larger, 1:1 and 16:9 share sizes. Uses tabular numerals
 * so the counter doesn't jitter horizontally while counting.
 */
export function createStatCounter(): SceneTemplate<StatCounterProps> {
  let instance: Instance | undefined;

  return {
    id: "StatCounter",

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
        gap: `${L.pick({ landscape: 16, portrait: 28, square: 16 }) * u}px`,
        background: ctx.palette.bg,
      });

      const { numeric, prefix, suffix, decimals } = parseStatValue(props.value);
      const finalText = numeric === null ? props.value : `${prefix}${formatCounted(numeric, decimals)}${suffix}`;
      // Numerals are wider than average text — size with a wider advance estimate.
      const maxValue = L.pick({ landscape: 190, portrait: 230, square: 180 }) * u;
      const valueSize = Math.min(maxValue, (L.safe.width * 0.95) / (Math.max(1, finalText.length) * 0.66));

      const valueNode = el("div", "sc-value", numeric === null ? props.value : `${prefix}0${suffix}`);
      setStyle(valueNode, {
        fontSize: `${valueSize}px`,
        fontWeight: "800",
        color: ctx.palette.accentText,
        fontFamily: ctx.fonts.display,
        letterSpacing: "-0.02em",
        lineHeight: "1.05",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        textAlign: "center",
      });
      root.appendChild(valueNode);

      const labelWidth = Math.min(L.safe.width, 1200 * u);
      const labelSize = fitFontSize(props.label, labelWidth, L.pick({ landscape: 42, portrait: 54, square: 40 }) * u, 3, 22 * u);
      const labelNode = el("div", "sc-label", props.label);
      setStyle(labelNode, {
        ...WRAP_SAFE,
        fontSize: `${labelSize}px`,
        color: ctx.palette.fg,
        fontFamily: ctx.fonts.body,
        textAlign: "center",
        lineHeight: "1.3",
        maxWidth: `${labelWidth}px`,
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
        const current = countP >= 1 ? instance.numericTarget : instance.numericTarget * countP;
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
