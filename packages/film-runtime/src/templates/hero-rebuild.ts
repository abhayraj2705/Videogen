import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutCubic, progress } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";
import { layoutFor } from "../util/layout.js";
import { sceneRoot, textBlock, wordsIn, wordsSettle } from "../util/ui.js";

export interface HeroRebuildProps {
  headline: string;
  subheadline: string;
}

interface Instance {
  stack: HTMLElement;
  headWords: HTMLElement[];
  subWords: HTMLElement[];
  accentBar: HTMLElement;
  barWidth: number;
  durationSec: number;
}

const HEAD_START = 0.2;
const HEAD_EACH = 0.055;
const SUB_EACH = 0.022;
const WORD_DUR = 0.5;

const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const subStartFor = (headWords: number) => HEAD_START + Math.max(0, headWords - 1) * HEAD_EACH + 0.25;

/**
 * Recreates the site's hero moment in-brand: an accent bar draws, the
 * headline lands word by word, then the subheadline ripples in beneath it.
 * Layouts: 16:9 two-line headline centered; 9:16 left-aligned editorial
 * stack with up to four headline lines; 1:1 three centered lines.
 */
export function createHeroRebuild(): SceneTemplate<HeroRebuildProps> {
  let instance: Instance | undefined;

  return {
    id: "HeroRebuild",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      const portrait = L.orientation === "portrait";
      const align = portrait ? "left" : "center";
      sceneRoot(root, L, { alignItems: portrait ? "flex-start" : "center", fontFamily: ctx.fonts.display });

      const stack = el("div", "hr-stack");
      setStyle(stack, {
        display: "flex",
        flexDirection: "column",
        alignItems: portrait ? "flex-start" : "center",
        gap: `${L.pick({ landscape: 30, portrait: 44, square: 26 }) * u}px`,
        transformOrigin: portrait ? "left center" : "center",
      });
      root.appendChild(stack);

      const barWidth = L.pick({ landscape: 96, portrait: 120, square: 88 }) * u;
      const accentBar = el("div", "hr-accent");
      setStyle(accentBar, {
        width: "0px",
        height: `${8 * u}px`,
        background: `linear-gradient(90deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`,
        borderRadius: `${4 * u}px`,
        flexShrink: "0",
      });
      stack.appendChild(accentBar);

      const headline = textBlock(props.headline, {
        className: "hr-headline",
        width: Math.min(L.safe.width, L.pick({ landscape: 1560, portrait: 1000, square: 960 }) * u),
        maxSize: L.pick({ landscape: 100, portrait: 112, square: 88 }) * u,
        minSize: 28 * u,
        maxLines: L.pick({ landscape: 2, portrait: 4, square: 3 }),
        color: ctx.palette.fg,
        family: ctx.fonts.display,
        weight: "800",
        align,
        lineHeight: 1.08,
        tracking: "-0.03em",
      });
      stack.appendChild(headline.wrap);

      const sub = textBlock(props.subheadline, {
        className: "hr-sub",
        width: Math.min(L.safe.width, L.pick({ landscape: 1200, portrait: 1000, square: 900 }) * u),
        maxSize: L.pick({ landscape: 40, portrait: 48, square: 36 }) * u,
        minSize: 20 * u,
        maxLines: 3,
        color: ctx.palette.muted,
        family: ctx.fonts.body,
        weight: "500",
        align,
        lineHeight: 1.35,
        tracking: "-0.005em",
      });
      stack.appendChild(sub.wrap);

      instance = { stack, headWords: headline.words, subWords: sub.words, accentBar, barWidth, durationSec: ctx.durationSec };
    },

    seek(localT) {
      if (!instance) return;
      instance.accentBar.style.width = `${(progress(localT, 0, 0.45, easeOutCubic) * instance.barWidth).toFixed(2)}px`;
      wordsIn(instance.headWords, localT, HEAD_START, HEAD_EACH, WORD_DUR);
      wordsIn(instance.subWords, localT, subStartFor(instance.headWords.length), SUB_EACH, WORD_DUR, 0.4);
      instance.stack.style.transform = `scale(${(0.96 + 0.035 * progress(localT, 0, instance.durationSec, easeOutCubic)).toFixed(4)})`;
    },

    marks(props): Mark[] {
      const settle = wordsSettle(countWords(props.subheadline), subStartFor(countWords(props.headline)), SUB_EACH, WORD_DUR);
      return [
        { t: 0, type: "start" },
        { t: Math.max(1.3, settle + 0.05), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
