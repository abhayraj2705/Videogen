import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutExpo, progress } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";
import { WRAP_SAFE, layoutFor } from "../util/layout.js";
import { cardStyle, cueStart, enter, sceneRoot } from "../util/ui.js";
import { formatCounted, parseStatValue } from "./stat-counter.js";

export interface Metric {
  /** The number as the site states it, e.g. "40,000+" or "99.9%". Grounded. */
  value: string;
  /** What it counts, 1-4 words. */
  label: string;
}

export interface MetricsRowProps {
  /** Two or three grounded numbers. */
  metrics: Metric[];
  /** Seconds from the scene start at which each metric is spoken. Added by Build. */
  cues?: number[];
}

interface Tile {
  node: HTMLElement;
  value: HTMLElement;
  parsed: ReturnType<typeof parseStatValue>;
}

interface Instance {
  tiles: Tile[];
  cues?: number[];
  u: number;
  row: boolean;
}

const TILE_STAGGER = 0.2;
const TILE_ENTER = 0.7;
const COUNT_SEC = 1.0;

const settleFor = (count: number, cues?: number[]) => cueStart(cues, count - 1, TILE_STAGGER) + 0.15 + COUNT_SEC;

/**
 * Several numbers at once: two or three tiles, each counting up to its figure
 * in the accent as it lands, with what it measures beneath. For proof that is
 * a set of numbers rather than one headline stat.
 * Layouts: 16:9 tiles side by side; 9:16 and 1:1 stacked.
 */
export function createMetricsRow(): SceneTemplate<MetricsRowProps> {
  let instance: Instance | undefined;

  return {
    id: "MetricsRow",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      const row = L.orientation === "landscape";
      const gap = L.pick({ landscape: 40, portrait: 36, square: 24 }) * u;
      sceneRoot(root, L, { flexDirection: row ? "row" : "column", gap: `${gap}px`, fontFamily: ctx.fonts.body });

      const metrics = props.metrics.slice(0, 3);
      const n = metrics.length;
      const tileWidth = row ? (L.safe.width - gap * (n - 1)) / n : L.safe.width;
      const tileHeight = row ? L.safe.height * 0.5 : (L.safe.height - gap * (n - 1)) / n;
      const pad = L.pick({ landscape: 40, portrait: 40, square: 26 }) * u;
      const gradient = ctx.palette.accentText === ctx.palette.accent;

      const tiles = metrics.map((m): Tile => {
        const node = el("div", "mr-tile");
        setStyle(node, {
          ...cardStyle(ctx, u, 30),
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: `${pad * 0.35}px`,
          width: `${tileWidth}px`,
          height: `${tileHeight}px`,
          padding: `${pad}px`,
        });

        const parsed = parseStatValue(m.value);
        const finalText = parsed.numeric === null ? m.value : `${parsed.prefix}${formatCounted(parsed.numeric, parsed.decimals)}${parsed.suffix}`;
        // Numerals are wide: size the figure to the tile, never past what its height allows.
        const size = Math.min(tileHeight * 0.42, (tileWidth - 2 * pad) / (Math.max(2, finalText.length) * 0.66));
        const value = el("div", "mr-value", parsed.numeric === null ? m.value : `${parsed.prefix}0${parsed.suffix}`);
        setStyle(value, {
          fontFamily: ctx.fonts.display,
          fontSize: `${size}px`,
          fontWeight: "800",
          lineHeight: "1.05",
          letterSpacing: "-0.04em",
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
          color: ctx.palette.accentText,
          ...(gradient ? { backgroundImage: `linear-gradient(120deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`, backgroundClip: "text", webkitBackgroundClip: "text", webkitTextFillColor: "transparent" } : {}),
        });
        node.appendChild(value);

        const label = el("div", "mr-label", m.label);
        setStyle(label, {
          ...WRAP_SAFE,
          fontFamily: ctx.fonts.display,
          fontSize: `${Math.max(22 * u, Math.min(size * 0.3, L.pick({ landscape: 40, portrait: 46, square: 34 }) * u))}px`,
          fontWeight: "700",
          lineHeight: "1.2",
          color: ctx.palette.fg,
          textAlign: "center",
          maxWidth: `${tileWidth - 2 * pad}px`,
        });
        node.appendChild(label);

        root.appendChild(node);
        return { node, value, parsed };
      });

      instance = { tiles, cues: props.cues, u, row };
    },

    seek(localT) {
      if (!instance) return;
      const { tiles, cues, u, row } = instance;
      tiles.forEach((tile, i) => {
        const start = cueStart(cues, i, TILE_STAGGER);
        enter(tile.node, localT, start, TILE_ENTER, row ? { y: 90 * u, scale: 0.88 } : { x: -110 * u, scale: 0.94 });
        const { numeric, prefix, suffix, decimals } = tile.parsed;
        if (numeric !== null) {
          const p = progress(localT, start + 0.15, start + 0.15 + COUNT_SEC, easeOutExpo);
          tile.value.textContent = `${prefix}${formatCounted(p >= 1 ? numeric : numeric * p, decimals)}${suffix}`;
        }
      });
    },

    marks(props): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: settleFor(Math.min(3, props.metrics?.length ?? 1), props.cues), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
