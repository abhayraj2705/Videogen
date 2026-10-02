import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeSpring } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";
import { WRAP_SAFE, fitFontSize, layoutFor } from "../util/layout.js";
import { cardStyle, enter, sceneRoot, textBlock, wordsIn } from "../util/ui.js";

export interface BentoGridProps {
  /** The lead line, shown large on the accent tile. */
  title: string;
  /** Exactly three short grounded supporting points, one per tile. */
  items: [string, string, string];
}

interface Instance {
  lead: HTMLElement;
  titleWords: HTMLElement[];
  tiles: HTMLElement[];
  dots: HTMLElement[];
  horizontal: boolean;
  u: number;
}

const TILE_START = 0.35;
const TILE_STAGGER = 0.13;
const TILE_ENTER = 0.7;

const settleFor = (count: number) => TILE_START + (count - 1) * TILE_STAGGER + TILE_ENTER;

/**
 * A bento layout: one large accent tile carrying the lead line next to three
 * smaller tiles for supporting points. The lead tile lands first, its title
 * arrives word by word, then the three tiles spring in beside it.
 * Layouts: 16:9 lead tile on the left, three tiles stacked on the right;
 * 9:16 and 1:1 lead tile on top, three rows beneath.
 */
export function createBentoGrid(): SceneTemplate<BentoGridProps> {
  let instance: Instance | undefined;

  return {
    id: "BentoGrid",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      const row = L.orientation === "landscape";
      const gap = L.pick({ landscape: 28, portrait: 26, square: 18 }) * u;
      const pad = L.pick({ landscape: 48, portrait: 44, square: 30 }) * u;
      sceneRoot(root, L, { fontFamily: ctx.fonts.display });

      const gridWidth = Math.min(L.safe.width, L.pick({ landscape: 1640, portrait: 1000, square: 980 }) * u);
      const gridHeight = L.safe.height * L.pick({ landscape: 0.8, portrait: 0.86, square: 0.94 });
      const grid = el("div", "bg-grid");
      setStyle(grid, {
        display: "grid",
        width: `${gridWidth}px`,
        height: `${gridHeight}px`,
        gap: `${gap}px`,
        gridTemplateColumns: row ? "1.15fr 1fr" : "1fr",
        gridTemplateRows: row ? "repeat(3, 1fr)" : "1.5fr repeat(3, 1fr)",
      });
      root.appendChild(grid);

      const leadWidth = row ? ((gridWidth - gap) * 1.15) / 2.15 : gridWidth;
      const lead = el("div", "bg-lead");
      setStyle(lead, {
        boxSizing: "border-box",
        gridRow: row ? "1 / span 3" : "auto",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: "flex-start",
        padding: `${pad * 1.2}px`,
        borderRadius: `${36 * u}px`,
        background: `linear-gradient(140deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`,
        boxShadow: `0 ${30 * u}px ${80 * u}px -${30 * u}px ${ctx.palette.glow}`,
        minWidth: "0",
        minHeight: "0",
      });
      const title = textBlock(props.title, {
        className: "bg-title",
        width: leadWidth - 2 * pad * 1.2,
        maxSize: L.pick({ landscape: 96, portrait: 92, square: 68 }) * u,
        minSize: 26 * u,
        maxLines: L.pick({ landscape: 5, portrait: 3, square: 3 }),
        color: ctx.palette.onAccent,
        family: ctx.fonts.display,
        weight: "800",
        align: "left",
        lineHeight: 1.06,
        tracking: "-0.035em",
      });
      lead.appendChild(title.wrap);
      grid.appendChild(lead);

      const tileWidth = row ? gridWidth - gap - leadWidth : gridWidth;
      const dot = L.pick({ landscape: 22, portrait: 24, square: 18 }) * u;
      const labelWidth = tileWidth - 2 * pad - dot - pad * 0.6;
      const longest = props.items.reduce((a, s) => (s.length > a.length ? s : a), "");
      const labelSize = fitFontSize(longest, labelWidth, L.pick({ landscape: 46, portrait: 50, square: 38 }) * u, 2, 22 * u);

      const dots: HTMLElement[] = [];
      const tiles = props.items.map((item) => {
        const tile = el("div", "bg-tile");
        setStyle(tile, { ...cardStyle(ctx, u, 30), display: "flex", alignItems: "center", gap: `${pad * 0.6}px`, padding: `0 ${pad}px`, minWidth: "0", minHeight: "0" });

        const dotNode = el("div", "bg-dot");
        setStyle(dotNode, { width: `${dot}px`, height: `${dot}px`, borderRadius: "50%", flexShrink: "0", background: `linear-gradient(135deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})` });
        tile.appendChild(dotNode);
        dots.push(dotNode);

        const label = el("div", "bg-label", item);
        setStyle(label, { ...WRAP_SAFE, fontSize: `${labelSize}px`, fontWeight: "700", color: ctx.palette.fg, lineHeight: "1.2", letterSpacing: "-0.02em", maxWidth: `${labelWidth}px` });
        tile.appendChild(label);

        grid.appendChild(tile);
        return tile;
      });

      instance = { lead, titleWords: title.words, tiles, dots, horizontal: row, u };
    },

    seek(localT) {
      if (!instance) return;
      const { u, horizontal } = instance;
      enter(instance.lead, localT, 0, 0.8, { scale: 0.86, y: 40 * u });
      wordsIn(instance.titleWords, localT, 0.25, 0.06, 0.5);
      instance.tiles.forEach((tile, i) => {
        const start = TILE_START + i * TILE_STAGGER;
        enter(tile, localT, start, TILE_ENTER, horizontal ? { x: 120 * u, scale: 0.94 } : { y: 90 * u, scale: 0.94 });
        const pop = Math.min(1, Math.max(0, (localT - start - 0.25) / 0.45));
        instance!.dots[i]!.style.transform = pop >= 1 ? "none" : `scale(${(0.2 + 0.8 * easeSpring(pop)).toFixed(4)})`;
      });
    },

    marks(props): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: settleFor(props.items.length), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
