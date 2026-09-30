import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutCubic, progress } from "../util/easing.js";
import { applyReveal, el, setStyle } from "../util/dom.js";

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
}

const CARD_STAGGER = 0.2;
const CARD_RISE_DURATION = 0.4;

/**
 * Three grounded feature facts reveal in sequence, staggered. Highlights section
 * of the planner rubric (2-3 scenes of this shape per storyboard).
 */
export function createFeatureTriplet(): SceneTemplate<FeatureTripletProps> {
  let instance: Instance | undefined;

  return {
    id: "FeatureTriplet",

    mount(root, props, ctx: FilmContext) {
      setStyle(root, {
        position: "absolute",
        inset: "0",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: `${ctx.width * 0.03}px`,
        background: ctx.palette.bg,
        fontFamily: ctx.fonts.body,
      });

      const cards = props.features.map((feature) => {
        const card = el("div", "ft-card");
        setStyle(card, {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.5em",
          width: `${ctx.width * 0.24}px`,
          padding: `${ctx.height * 0.03}px`,
          borderRadius: "16px",
          background: ctx.palette.accent,
          textAlign: "center",
        });

        if (feature.icon) {
          const icon = el("div", "ft-icon", feature.icon);
          setStyle(icon, { fontSize: `${ctx.height * 0.06}px` });
          card.appendChild(icon);
        }

        const label = el("div", "ft-label", feature.label);
        setStyle(label, {
          fontSize: `${ctx.height * 0.032}px`,
          fontWeight: "600",
          color: ctx.palette.fg,
          lineHeight: "1.3",
        });
        card.appendChild(label);

        root.appendChild(card);
        return card;
      });

      instance = { cards };
    },

    seek(localT) {
      if (!instance) return;
      instance.cards.forEach((card, i) => {
        const start = i * CARD_STAGGER;
        const p = progress(localT, start, start + CARD_RISE_DURATION, easeOutCubic);
        applyReveal(card, p, 20);
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
