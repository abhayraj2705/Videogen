import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutCubic, progress } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";
import { layoutFor } from "../util/layout.js";
import { addMarker, scaleXTo, sceneRoot, textBlock, wordsIn, wordsSettle } from "../util/ui.js";

export interface BigStatementProps {
  /** One grounded line, set as large as the frame allows. */
  text: string;
  /** A phrase inside `text` to emphasise (accent ink + marker swipe). Ignored if it isn't found verbatim. */
  highlight?: string;
}

interface Instance {
  stack: HTMLElement;
  rule: HTMLElement;
  ruleWidth: number;
  words: HTMLElement[];
  markers: HTMLElement[];
  durationSec: number;
}

const WORDS_START = 0.25;
const WORD_EACH = 0.07;
const WORD_DUR = 0.55;

const splitWords = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Index range [start, end) of `highlight`'s words inside `text`'s words, or null. */
export function highlightRange(text: string, highlight: string | undefined): [number, number] | null {
  if (!highlight) return null;
  const words = splitWords(text).map(bare);
  const target = splitWords(highlight).map(bare).filter(Boolean);
  if (target.length === 0) return null;
  for (let i = 0; i + target.length <= words.length; i++) {
    if (target.every((w, k) => words[i + k] === w)) return [i, i + target.length];
  }
  return null;
}

/**
 * A single statement filling the frame: an accent rule draws, the line lands
 * word by word at poster size, and the highlighted phrase takes the accent ink
 * with a marker swipe behind it. The text-only counterpart to a screenshot
 * scene — use it for the differentiator or the strongest claim.
 * Layouts: 16:9 up to three centered lines; 9:16 left-aligned, up to five
 * lines; 1:1 four centered lines.
 */
export function createBigStatement(): SceneTemplate<BigStatementProps> {
  let instance: Instance | undefined;

  return {
    id: "BigStatement",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      const portrait = L.orientation === "portrait";
      sceneRoot(root, L, { alignItems: portrait ? "flex-start" : "center", fontFamily: ctx.fonts.display });

      const stack = el("div", "bs-stack");
      setStyle(stack, {
        display: "flex",
        flexDirection: "column",
        alignItems: portrait ? "flex-start" : "center",
        gap: `${L.pick({ landscape: 40, portrait: 56, square: 36 }) * u}px`,
        transformOrigin: portrait ? "left center" : "center",
      });
      root.appendChild(stack);

      const ruleWidth = L.pick({ landscape: 120, portrait: 150, square: 110 }) * u;
      const rule = el("div", "bs-rule");
      setStyle(rule, { width: `${ruleWidth}px`, height: `${10 * u}px`, borderRadius: `${5 * u}px`, background: `linear-gradient(90deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`, transformOrigin: portrait ? "left center" : "center", flexShrink: "0" });
      stack.appendChild(rule);

      const block = textBlock(props.text, {
        className: "bs-text",
        width: Math.min(L.safe.width, L.pick({ landscape: 1640, portrait: 1000, square: 960 }) * u),
        maxSize: L.pick({ landscape: 150, portrait: 150, square: 118 }) * u,
        minSize: 32 * u,
        maxLines: L.pick({ landscape: 3, portrait: 5, square: 4 }),
        color: ctx.palette.fg,
        family: ctx.fonts.display,
        weight: "800",
        align: portrait ? "left" : "center",
        lineHeight: 1.04,
        tracking: "-0.04em",
      });
      stack.appendChild(block.wrap);

      const range = highlightRange(props.text, props.highlight);
      const markers: HTMLElement[] = [];
      if (range) {
        for (let i = range[0]; i < range[1] && i < block.words.length; i++) {
          const word = block.words[i]!;
          word.style.color = ctx.palette.accentText;
          markers.push(addMarker(word, ctx.palette.accentSoft));
        }
      }

      instance = { stack, rule, ruleWidth, words: block.words, markers, durationSec: ctx.durationSec };
    },

    seek(localT) {
      if (!instance) return;
      instance.rule.style.transform = scaleXTo(progress(localT, 0, 0.45, easeOutCubic));
      wordsIn(instance.words, localT, WORDS_START, WORD_EACH, WORD_DUR, 0.7);
      const landed = wordsSettle(instance.words.length, WORDS_START, WORD_EACH, WORD_DUR);
      instance.markers.forEach((marker, i) => {
        marker.style.transform = scaleXTo(progress(localT, landed - 0.25 + i * 0.08, landed + 0.1 + i * 0.08, easeOutCubic));
      });
      // Slow push-in, stopping short of 1x (text stays inside the safe area; never an identity transform).
      instance.stack.style.transform = `scale(${(0.95 + 0.045 * progress(localT, 0, instance.durationSec, easeOutCubic)).toFixed(4)})`;
    },

    marks(props): Mark[] {
      const count = splitWords(props.text).length;
      const range = highlightRange(props.text, props.highlight);
      const markerTail = range ? 0.1 + (range[1] - range[0] - 1) * 0.08 : 0;
      return [
        { t: 0, type: "start" },
        { t: Math.max(1.1, wordsSettle(count, WORDS_START, WORD_EACH, WORD_DUR) + markerTail + 0.05), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
