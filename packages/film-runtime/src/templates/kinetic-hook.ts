import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutCubic, easeSpring, progress } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";
import { layoutFor } from "../util/layout.js";
import { addMarker, enter, logoMark, scaleXTo, sceneRoot, textBlock, wordsIn, wordsSettle } from "../util/ui.js";

export interface KineticHookProps {
  /** Grounded product name, from the FactLedger. */
  productName: string;
  /** Grounded headline/tagline, from the FactLedger. */
  headline: string;
  /** Optional logo image URL (SVG/PNG), from brand extraction. */
  logoUrl?: string;
}

interface Instance {
  stack: HTMLElement;
  logo: HTMLElement;
  words: HTMLElement[];
  marker: HTMLElement | null;
  durationSec: number;
}

const WORDS_START = 0.3;
const WORD_EACH = 0.06;
const WORD_DUR = 0.55;

const wordCountOf = (headline: string) => headline.trim().split(/\s+/).filter(Boolean).length;

/**
 * Opening scene (2-3s per the planner rubric): the logo springs in, the
 * headline lands word by word, a marker swipes under its last word, and the
 * whole composition pushes in slowly for the rest of the scene.
 * Layouts: 16:9 two-line headline; 9:16 bigger logo + up to four stacked
 * lines filling the tall frame; 1:1 three lines at a slightly smaller size.
 */
export function createKineticHook(): SceneTemplate<KineticHookProps> {
  let instance: Instance | undefined;

  return {
    id: "KineticHook",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      sceneRoot(root, L, { fontFamily: ctx.fonts.display });

      const stack = el("div", "kh-stack");
      setStyle(stack, { display: "flex", flexDirection: "column", alignItems: "center", gap: `${L.pick({ landscape: 48, portrait: 76, square: 44 }) * u}px` });
      root.appendChild(stack);

      const logo = logoMark({ className: "kh-logo", size: L.pick({ landscape: 132, portrait: 200, square: 132 }) * u, logoUrl: props.logoUrl, productName: props.productName, ctx });
      stack.appendChild(logo);

      const headline = textBlock(props.headline, {
        className: "kh-headline",
        width: Math.min(L.safe.width, L.pick({ landscape: 1560, portrait: 1000, square: 960 }) * u),
        maxSize: L.pick({ landscape: 112, portrait: 124, square: 96 }) * u,
        minSize: 28 * u,
        maxLines: L.pick({ landscape: 2, portrait: 4, square: 3 }),
        color: ctx.palette.fg,
        family: ctx.fonts.display,
        weight: "800",
        lineHeight: 1.08,
        tracking: "-0.03em",
      });
      stack.appendChild(headline.wrap);

      const last = headline.words[headline.words.length - 1];
      const marker = last && headline.words.length >= 3 ? addMarker(last, ctx.palette.accentSoft) : null;

      instance = { stack, logo, words: headline.words, marker, durationSec: ctx.durationSec };
    },

    seek(localT) {
      if (!instance) return;
      enter(instance.logo, localT, 0, 0.65, { scale: 0.35, rotate: -14, ease: easeSpring });
      wordsIn(instance.words, localT, WORDS_START, WORD_EACH, WORD_DUR);
      if (instance.marker) {
        const landed = wordsSettle(instance.words.length, WORDS_START, WORD_EACH, WORD_DUR);
        instance.marker.style.transform = scaleXTo(progress(localT, landed - 0.3, landed + 0.1, easeOutCubic));
      }
      // Slow push-in that stops just short of 1x: text never grows past the safe area, and the
      // transform never becomes an identity (see util/ui.ts).
      instance.stack.style.transform = `scale(${(0.955 + 0.04 * progress(localT, 0, instance.durationSec, easeOutCubic)).toFixed(4)})`;
    },

    marks(props): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: WORDS_START, type: "headline-begin" },
        { t: Math.max(1.25, wordsSettle(wordCountOf(props.headline), WORDS_START, WORD_EACH, WORD_DUR) + 0.1), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
