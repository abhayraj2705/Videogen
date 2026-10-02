import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { clamp01, easeOutCubic, easeOutExpo, easeSpring, progress } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";
import { layoutFor } from "../util/layout.js";
import { enter, sceneRoot, textBlock, wordsIn } from "../util/ui.js";

export interface StatCounterProps {
  /** The grounded stat fact's text, e.g. "10,000+" or "99.9%" — must come from a FactLedger entry (validated upstream). */
  value: string;
  label: string;
}

interface Instance {
  halo: HTMLElement;
  valueNode: HTMLElement;
  bar: HTMLElement;
  barWidth: number;
  labelWords: HTMLElement[];
  numericTarget: number | null;
  prefix: string;
  suffix: string;
  decimals: number;
}

const COUNT_START = 0.15;
const COUNT_END = 1.2;
const LABEL_START = 0.55;

/** Parses "10,000+" -> {numeric: 10000, prefix: "", suffix: "+"} so the number itself can count up; non-numeric values just fade in as-is. */
export function parseStatValue(value: string): { numeric: number | null; prefix: string; suffix: string; decimals: number } {
  const match = /^([^\d]*)([\d,]+(?:\.\d+)?)([^\d]*)$/.exec(value.trim());
  if (!match) return { numeric: null, prefix: "", suffix: "", decimals: 0 };
  const [, prefix, numStr, suffix] = match;
  const numeric = Number(numStr!.replace(/,/g, ""));
  if (Number.isNaN(numeric)) return { numeric: null, prefix: "", suffix: "", decimals: 0 };
  const decimals = numStr!.includes(".") ? numStr!.split(".")[1]!.length : 0;
  return { numeric, prefix: prefix ?? "", suffix: suffix ?? "", decimals };
}

export function formatCounted(n: number, decimals: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * One grounded stat, set huge: the number springs in and counts up over an
 * accent halo, an accent rule draws beneath it, then the label lands.
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
      sceneRoot(root, L, { gap: `${L.pick({ landscape: 22, portrait: 34, square: 20 }) * u}px` });

      const haloSize = L.pick({ landscape: 820, portrait: 900, square: 760 }) * u;
      const halo = el("div", "sc-halo");
      setStyle(halo, {
        position: "absolute",
        left: `${ctx.width / 2 - haloSize / 2}px`,
        top: `${(L.safe.top + L.safe.bottom) / 2 - haloSize / 2}px`,
        width: `${haloSize}px`,
        height: `${haloSize}px`,
        borderRadius: "50%",
        background: `radial-gradient(closest-side, ${ctx.palette.accentSoft}, transparent)`,
      });
      root.appendChild(halo);

      const { numeric, prefix, suffix, decimals } = parseStatValue(props.value);
      const finalText = numeric === null ? props.value : `${prefix}${formatCounted(numeric, decimals)}${suffix}`;
      // Numerals are wider than average text — size with a wider advance estimate.
      const maxValue = L.pick({ landscape: 300, portrait: 320, square: 260 }) * u;
      const valueSize = Math.min(maxValue, (L.safe.width * 0.92) / (Math.max(1, finalText.length) * 0.66));

      const gradient = ctx.palette.accentText === ctx.palette.accent;
      const valueNode = el("div", "sc-value", numeric === null ? props.value : `${prefix}0${suffix}`);
      setStyle(valueNode, {
        position: "relative",
        fontSize: `${valueSize}px`,
        fontWeight: "800",
        color: ctx.palette.accentText,
        fontFamily: ctx.fonts.display,
        letterSpacing: "-0.04em",
        lineHeight: "1.05",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        textAlign: "center",
        ...(gradient
          ? { backgroundImage: `linear-gradient(120deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`, backgroundClip: "text", webkitBackgroundClip: "text", webkitTextFillColor: "transparent" }
          : {}),
      });
      root.appendChild(valueNode);

      const barWidth = L.pick({ landscape: 140, portrait: 170, square: 130 }) * u;
      const bar = el("div", "sc-bar");
      setStyle(bar, { position: "relative", width: "0px", height: `${8 * u}px`, borderRadius: `${4 * u}px`, background: ctx.palette.accent, flexShrink: "0" });
      root.appendChild(bar);

      const label = textBlock(props.label, {
        className: "sc-label",
        width: Math.min(L.safe.width, 1200 * u),
        maxSize: L.pick({ landscape: 54, portrait: 62, square: 48 }) * u,
        minSize: 22 * u,
        maxLines: 3,
        color: ctx.palette.fg,
        family: ctx.fonts.display,
        weight: "700",
        lineHeight: 1.2,
      });
      label.wrap.style.position = "relative";
      root.appendChild(label.wrap);

      instance = { halo, valueNode, bar, barWidth, labelWords: label.words, numericTarget: numeric, prefix, suffix, decimals };
    },

    seek(localT) {
      if (!instance) return;
      enter(instance.valueNode, localT, 0, 0.8, { scale: 0.55, ease: easeSpring });
      const haloP = progress(localT, 0, 1.1, easeOutCubic);
      instance.halo.style.opacity = String(clamp01(localT / 0.4));
      instance.halo.style.transform = haloP >= 1 ? "none" : `scale(${(0.4 + 0.6 * haloP).toFixed(4)})`;

      if (instance.numericTarget !== null) {
        const countP = progress(localT, COUNT_START, COUNT_END, easeOutExpo);
        const current = countP >= 1 ? instance.numericTarget : instance.numericTarget * countP;
        instance.valueNode.textContent = `${instance.prefix}${formatCounted(current, instance.decimals)}${instance.suffix}`;
      }

      instance.bar.style.width = `${(progress(localT, 0.4, 0.9, easeOutCubic) * instance.barWidth).toFixed(2)}px`;
      wordsIn(instance.labelWords, localT, LABEL_START, 0.05, 0.45);
    },

    marks(): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: 1.3, type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
