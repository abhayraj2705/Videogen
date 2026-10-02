import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutCubic, progress } from "../util/easing.js";
import { applyReveal, el, setStyle } from "../util/dom.js";
import { WRAP_SAFE, fitFontSize, layoutFor } from "../util/layout.js";

export interface Feature {
  /** Grounded fact: short label, e.g. "Sync across 4 devices". Must cite a factId upstream. */
  label: string;
  /** Optional lucide-style icon glyph rendered as text/emoji placeholder in Phase 0. */
  icon?: string;
}

export interface FeatureTripletProps {
  features: [Feature, Feature, Feature];
}

interface Instance {
  cards: HTMLElement[];
  horizontal: boolean;
}

const CARD_STAGGER = 0.2;
const CARD_RISE_DURATION = 0.4;

/**
 * Three grounded feature facts reveal in sequence, staggered.
 * Layouts: 16:9 three cards side by side (icon above label); 9:16 and 1:1
 * stack the cards vertically as full-width rows (icon left, label right),
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
      const gap = L.pick({ landscape: 48, portrait: 36, square: 24 }) * u;
      setStyle(root, {
        position: "absolute",
        inset: "0",
        boxSizing: "border-box",
        padding: L.safePadding,
        display: "flex",
        flexDirection: row ? "row" : "column",
        alignItems: "center",
        justifyContent: "center",
        gap: `${gap}px`,
        background: ctx.palette.bg,
        fontFamily: ctx.fonts.body,
      });

      const pad = L.pick({ landscape: 40, portrait: 40, square: 28 }) * u;
      const cardWidth = row ? Math.min((L.safe.width - 2 * gap) / 3, 540 * u) : L.safe.width * L.pick({ landscape: 1, portrait: 1, square: 0.92 });
      const iconSize = L.pick({ landscape: 72, portrait: 76, square: 56 }) * u;
      const labelWidth = row ? cardWidth - 2 * pad : cardWidth - 2 * pad - (props.features.some((f) => f.icon) ? iconSize + pad * 0.8 : 0);
      const longest = props.features.reduce((a, f) => (f.label.length > a.length ? f.label : a), "");
      const labelSize = fitFontSize(longest, labelWidth, L.pick({ landscape: 40, portrait: 50, square: 40 }) * u, row ? 3 : 2, 22 * u);

      const cards = props.features.map((feature) => {
        const card = el("div", "ft-card");
        setStyle(card, {
          boxSizing: "border-box",
          display: "flex",
          flexDirection: row ? "column" : "row",
          alignItems: "center",
          justifyContent: row ? "center" : "flex-start",
          gap: `${row ? pad * 0.5 : pad * 0.8}px`,
          width: `${cardWidth}px`,
          minHeight: row ? `${L.safe.height * 0.42}px` : "0",
          padding: `${pad}px`,
          borderRadius: `${20 * u}px`,
          background: ctx.palette.accent,
          textAlign: row ? "center" : "left",
        });

        if (feature.icon) {
          const icon = el("div", "ft-icon", feature.icon);
          setStyle(icon, { fontSize: `${iconSize}px`, lineHeight: "1", flexShrink: "0", width: row ? "auto" : `${iconSize}px`, textAlign: "center" });
          card.appendChild(icon);
        }

        const label = el("div", "ft-label", feature.label);
        setStyle(label, {
          ...WRAP_SAFE,
          fontSize: `${labelSize}px`,
          fontWeight: "600",
          color: ctx.palette.onAccent,
          lineHeight: "1.3",
          maxWidth: `${labelWidth}px`,
        });
        card.appendChild(label);

        root.appendChild(card);
        return card;
      });

      instance = { cards, horizontal: row };
    },

    seek(localT) {
      if (!instance) return;
      const { horizontal } = instance;
      instance.cards.forEach((card, i) => {
        const start = i * CARD_STAGGER;
        const p = progress(localT, start, start + CARD_RISE_DURATION, easeOutCubic);
        if (horizontal) {
          applyReveal(card, p, 20);
        } else {
          card.style.opacity = String(p);
          card.style.transform = `translateX(${(1 - p) * -28}px)`;
        }
      });
    },

    marks(props): Mark[] {
      const lastStart = (props.features.length - 1) * CARD_STAGGER;
      return [
        { t: 0, type: "start" },
        { t: lastStart + CARD_RISE_DURATION, type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
