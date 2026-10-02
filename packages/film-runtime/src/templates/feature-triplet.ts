import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { clamp01, easeOutCubic, progress } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";
import { WRAP_SAFE, fitFontSize, layoutFor } from "../util/layout.js";
import { cardStyle, cueStart, enter, scaleXTo, sceneRoot } from "../util/ui.js";
import { iconSvg } from "../util/icons.js";

export interface Feature {
  /** Grounded fact: short label, e.g. "Sync across 4 devices". Must cite a factId upstream. */
  label: string;
  /** Optional icon: one of the names in util/icons.ts (drawn as a line icon), or any glyph/emoji (shown as text); cards without one show their position number. */
  icon?: string;
}

export interface FeatureTripletProps {
  features: [Feature, Feature, Feature];
  /** Seconds from the scene start at which each feature is spoken; cards arrive and take the spotlight on them. Added by Build. */
  cues?: number[];
}

interface Card {
  node: HTMLElement;
  ring: HTMLElement;
  bar: HTMLElement;
}

interface Instance {
  cards: Card[];
  horizontal: boolean;
  u: number;
  durationSec: number;
  cues?: number[];
}

const CARD_STAGGER = 0.14;
const CARD_ENTER = 0.75;

const settleFor = (count: number, cues?: number[]) => cueStart(cues, count - 1, CARD_STAGGER) + CARD_ENTER;

/**
 * Three grounded feature facts as cards that spring in one after another,
 * then take turns in the spotlight (accent outline + lift) for the rest of
 * the scene, so there is always one thing to look at.
 * Layouts: 16:9 three cards side by side (badge above label); 9:16 and 1:1
 * stack the cards vertically as full-width rows (badge left, label right),
 * sliding in from the side instead of rising.
 */
export function createFeatureTriplet(): SceneTemplate<FeatureTripletProps> {
  let instance: Instance | undefined;

  return {
    id: "FeatureTriplet",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      const row = L.orientation === "landscape";
      const gap = L.pick({ landscape: 40, portrait: 34, square: 22 }) * u;
      sceneRoot(root, L, { flexDirection: row ? "row" : "column", gap: `${gap}px`, fontFamily: ctx.fonts.body });

      const pad = L.pick({ landscape: 44, portrait: 40, square: 28 }) * u;
      const cardWidth = row ? Math.min((L.safe.width - 2 * gap) / 3, 560 * u) : L.safe.width * L.pick({ landscape: 1, portrait: 1, square: 0.94 });
      const badge = L.pick({ landscape: 84, portrait: 88, square: 64 }) * u;
      const labelWidth = row ? cardWidth - 2 * pad : cardWidth - 2 * pad - badge - pad * 0.8;
      const longest = props.features.reduce((a, f) => (f.label.length > a.length ? f.label : a), "");
      const labelSize = fitFontSize(longest, labelWidth, L.pick({ landscape: 60, portrait: 58, square: 44 }) * u, 3, 22 * u);

      const cards = props.features.map((feature, i): Card => {
        const node = el("div", "ft-card");
        setStyle(node, {
          ...cardStyle(ctx, u),
          position: "relative",
          display: "flex",
          flexDirection: row ? "column" : "row",
          alignItems: row ? "flex-start" : "center",
          justifyContent: row ? "center" : "flex-start",
          gap: `${row ? pad * 0.7 : pad * 0.8}px`,
          width: `${cardWidth}px`,
          minHeight: `${L.safe.height * L.pick({ landscape: 0.62, portrait: 0.17, square: 0.2 })}px`,
          padding: `${pad}px`,
        });

        const bar = el("div", "ft-bar");
        setStyle(bar, {
          position: "absolute",
          left: `${pad}px`,
          top: "0",
          width: `${badge}px`,
          height: `${6 * u}px`,
          borderRadius: `0 0 ${4 * u}px ${4 * u}px`,
          background: `linear-gradient(90deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`,
          transformOrigin: "left center",
        });
        node.appendChild(bar);

        const drawn = iconSvg(feature.icon);
        // A plain word that isn't one of our icon names ("tag") is a wrong guess, not a glyph: show the number instead of printing it.
        const glyph = feature.icon && !/^[a-z][a-z -]*$/i.test(feature.icon.trim()) ? feature.icon : undefined;
        const badgeNode = el("div", "ft-icon", drawn ? undefined : (glyph ?? String(i + 1).padStart(2, "0")));
        if (drawn) badgeNode.innerHTML = `<div style="width:56%;height:56%;display:flex">${drawn}</div>`;
        setStyle(badgeNode, {
          width: `${badge}px`,
          height: `${badge}px`,
          flexShrink: "0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: `${badge * 0.3}px`,
          background: ctx.palette.accentSoft,
          color: ctx.palette.accentText,
          fontFamily: ctx.fonts.display,
          fontSize: `${badge * (glyph ? 0.56 : 0.4)}px`,
          fontWeight: "800",
          lineHeight: "1",
          letterSpacing: "-0.02em",
        });
        node.appendChild(badgeNode);

        const label = el("div", "ft-label", feature.label);
        setStyle(label, {
          ...WRAP_SAFE,
          fontSize: `${labelSize}px`,
          fontWeight: "700",
          color: ctx.palette.fg,
          fontFamily: ctx.fonts.display,
          lineHeight: "1.22",
          letterSpacing: "-0.02em",
          maxWidth: `${labelWidth}px`,
          textAlign: "left",
        });
        node.appendChild(label);

        const ring = el("div", "ft-ring");
        setStyle(ring, {
          position: "absolute",
          inset: `${-3 * u}px`,
          borderRadius: `${30 * u}px`,
          border: `${4 * u}px solid ${ctx.palette.accent}`,
          boxShadow: `0 0 ${50 * u}px ${ctx.palette.glow}`,
          opacity: "0",
        });
        node.appendChild(ring);

        root.appendChild(node);
        return { node, ring, bar };
      });

      instance = { cards, horizontal: row, u, durationSec: ctx.durationSec, cues: props.cues };
    },

    seek(localT) {
      if (!instance) return;
      const { horizontal, u, cards, durationSec, cues } = instance;
      const settled = settleFor(cards.length);
      // Spotlight: after the cards land, the rest of the scene is split into one turn per card.
      const turn = Math.max(0.5, (durationSec - settled - 0.5) / cards.length);
      cards.forEach((card, i) => {
        const start = cueStart(cues, i, CARD_STAGGER);
        // With voice cues each card holds the spotlight while its line is spoken.
        const litFrom = cues ? Math.max(start + 0.3, cues[i]!) : settled + 0.1 + i * turn;
        const litFor = cues ? Math.max(0.6, (cues[i + 1] ?? durationSec - 0.5) - litFrom) : turn;
        const local = localT - litFrom;
        const spot = clamp01(local / 0.25) * clamp01((litFor - local) / 0.25);
        card.ring.style.opacity = String(spot);
        const lift = spot > 0 ? `translateY(${(-10 * u * spot).toFixed(2)}px)` : "";
        enter(card.node, localT, start, CARD_ENTER, horizontal ? { y: 90 * u, scale: 0.9, rotate: (i - 1) * 4 } : { x: -110 * u, scale: 0.96 }, lift);
        card.bar.style.transform = scaleXTo(progress(localT, start + 0.3, start + 0.8, easeOutCubic));
      });
    },

    marks(props): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: settleFor(props.features.length, props.cues), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
