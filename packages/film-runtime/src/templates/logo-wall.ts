import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { el, setStyle } from "../util/dom.js";
import { layoutFor } from "../util/layout.js";
import { cardStyle, enter, sceneRoot, textBlock, wordsIn } from "../util/ui.js";

export interface LogoWallProps {
  /** The line above the wall, e.g. "Trusted by teams at". */
  title: string;
  /** 3-10 short grounded names: customers, integrations, platforms. */
  names: string[];
  /** Logo images for some of the names, as captured from the site. Added by Build; a name without one is set as type. */
  logos?: { name: string; url: string }[];
}

interface Instance {
  titleWords: HTMLElement[];
  chips: HTMLElement[];
  u: number;
}

const CHIPS_START = 0.5;
const CHIP_STAGGER = 0.08;
const CHIP_ENTER = 0.6;

const settleFor = (count: number) => CHIPS_START + Math.max(0, count - 1) * CHIP_STAGGER + CHIP_ENTER;

/**
 * Social proof as a wall of names: the title lands word by word, then the
 * name chips pop in one after another, alternately tilted, into a centred
 * wrapping wall. A name the crawl captured a logo for is shown as that logo; the rest are set as type.
 * Layouts: 16:9 up to five chips per row; 9:16 two per row at a larger size;
 * 1:1 three per row.
 */
export function createLogoWall(): SceneTemplate<LogoWallProps> {
  let instance: Instance | undefined;

  return {
    id: "LogoWall",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      sceneRoot(root, L, { gap: `${L.pick({ landscape: 56, portrait: 72, square: 44 }) * u}px`, fontFamily: ctx.fonts.body });

      const title = textBlock(props.title, {
        className: "lw-title",
        width: L.safe.width * L.pick({ landscape: 0.8, portrait: 1, square: 0.96 }),
        maxSize: L.pick({ landscape: 92, portrait: 88, square: 68 }) * u,
        minSize: 24 * u,
        maxLines: L.pick({ landscape: 2, portrait: 3, square: 2 }),
        color: ctx.palette.fg,
        family: ctx.fonts.display,
        weight: "800",
        lineHeight: 1.12,
      });
      root.appendChild(title.wrap);

      const names = props.names.slice(0, 10);
      const chipGap = L.pick({ landscape: 22, portrait: 24, square: 18 }) * u;
      const wall = el("div", "lw-wall");
      setStyle(wall, { display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `${chipGap}px`, maxWidth: `${L.safe.width * L.pick({ landscape: 0.9, portrait: 1, square: 1 })}px` });
      // Fewer names get bigger chips, so the wall always carries weight in the frame.
      const size = L.pick({ landscape: 58, portrait: 56, square: 44 }) * u * (names.length <= 4 ? 1.45 : names.length <= 6 ? 1.2 : 1);
      const logoFor = new Map((props.logos ?? []).map((l) => [l.name.toLowerCase(), l.url]));
      const chips = names.map((name) => {
        const logoUrl = logoFor.get(name.toLowerCase());
        const chip = el("div", "lw-chip", logoUrl ? undefined : name);
        if (logoUrl) {
          // The logo as the site shows it, at the height the name would have had; its own background comes with it.
          const img = el("img");
          img.src = logoUrl;
          img.alt = name;
          setStyle(img, { display: "block", height: `${size * 1.25}px`, width: "auto", maxWidth: `${size * 5.2}px`, objectFit: "contain", borderRadius: `${8 * u}px` });
          chip.appendChild(img);
        }
        setStyle(chip, {
          ...cardStyle(ctx, u, 22),
          padding: logoUrl ? `${size * 0.36}px ${size * 0.6}px` : `${size * 0.42}px ${size * 0.8}px`,
          fontFamily: ctx.fonts.display,
          fontSize: `${size}px`,
          fontWeight: "700",
          letterSpacing: "-0.02em",
          lineHeight: "1.1",
          color: ctx.palette.fg,
          whiteSpace: "nowrap",
        });
        wall.appendChild(chip);
        return chip;
      });
      root.appendChild(wall);

      instance = { titleWords: title.words, chips, u };
    },

    seek(localT) {
      if (!instance) return;
      const { u } = instance;
      wordsIn(instance.titleWords, localT, 0.15, 0.06, 0.5);
      instance.chips.forEach((chip, i) => {
        enter(chip, localT, CHIPS_START + i * CHIP_STAGGER, CHIP_ENTER, { y: 50 * u, scale: 0.6, rotate: i % 2 === 0 ? -6 : 6 });
      });
    },

    marks(props): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: settleFor(Math.min(10, props.names?.length ?? 0)), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
