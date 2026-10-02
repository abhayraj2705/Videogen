import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { progress } from "../util/easing.js";
import { layoutFor } from "../util/layout.js";
import { browserFrame, type BrowserFrame, type PageRect } from "../util/browser-frame.js";
import type { ClipSource } from "../util/clip.js";
import { sceneRoot, textBlock, wordsIn, wordsSettle } from "../util/ui.js";

export interface SectionShowcaseProps {
  /** Screenshot captured during crawl, stored in R2; a public/signed URL by render time. */
  screenshotUrl: string;
  /** Grounded caption tied to a fact id, e.g. the section heading. */
  caption: string;
  /** Short display address for the browser toolbar, e.g. "acme.com/pricing". Added by Build. */
  pageLabel?: string;
  /** Where the thing the caption is about sits on the page; the window zooms to it instead of scrolling. Added by Build. */
  focus?: PageRect;
  /** Two or three regions to visit in turn — several shots inside the one scene. Added by Build; takes over from `focus`. */
  focusStops?: PageRect[];
  /** A recording of the page being scrolled; plays in the window instead of a pan over the still. Added by Build. */
  clip?: ClipSource;
}

interface Instance {
  frame: BrowserFrame;
  words: HTMLElement[];
  durationSec: number;
  focus?: PageRect;
  focusStops?: PageRect[];
}

const FRAME_ENTER = 0.9;
const CAPTION_START = 0.4;
const WORD_EACH = 0.05;
const WORD_DUR = 0.5;

const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * The real site in a browser window: the window tilts up into place, then the
 * camera pushes in on the region the caption is about and rings it (or, when
 * the crawl has no position for it, the page scrolls) while the caption lands
 * word by word.
 * Layouts: 16:9 wide window with a one/two-line caption beneath; 9:16 a tall
 * window with a caption of up to three lines; 1:1 a near-square window.
 */
export function createSectionShowcase(): SceneTemplate<SectionShowcaseProps> {
  let instance: Instance | undefined;

  return {
    id: "SectionShowcase",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      const gap = L.pick({ landscape: 34, portrait: 52, square: 30 }) * u;
      sceneRoot(root, L, { gap: `${gap}px`, fontFamily: ctx.fonts.body });

      const caption = textBlock(props.caption, {
        className: "ss-caption",
        width: L.safe.width * L.pick({ landscape: 0.84, portrait: 1, square: 0.96 }),
        maxSize: L.pick({ landscape: 54, portrait: 64, square: 48 }) * u,
        minSize: 22 * u,
        maxLines: L.pick({ landscape: 2, portrait: 3, square: 2 }),
        color: ctx.palette.fg,
        family: ctx.fonts.display,
        weight: "700",
        lineHeight: 1.2,
      });

      const frameWidth = L.safe.width * L.pick({ landscape: 0.86, portrait: 1, square: 0.98 });
      const frameHeight = Math.min(L.safe.height - gap - caption.height - 8 * u, L.pick({ landscape: 0.68, portrait: 0.6, square: 0.64 }) * ctx.height);
      const frame = browserFrame({ className: "ss-frame", width: frameWidth, height: frameHeight, screenshotUrl: props.screenshotUrl, pageLabel: props.pageLabel, clip: props.clip, ctx, u });

      root.appendChild(frame.wrap);
      root.appendChild(caption.wrap);
      instance = { frame, words: caption.words, durationSec: ctx.durationSec, focus: props.focus, focusStops: props.focusStops };
    },

    seek(localT) {
      if (!instance) return;
      instance.frame.enter(localT, 0, FRAME_ENTER);
      // A recording plays through once the window has landed, and holds its last frame to the cut.
      if (instance.frame.play(progress(localT, 0.7, Math.max(1.6, instance.durationSec - 0.4)))) {
        wordsIn(instance.words, localT, CAPTION_START, WORD_EACH, WORD_DUR);
        return;
      }
      // With a focus region: hold the top of the page for a beat, push in on the region, ring it, hold.
      const focusEnd = Math.min(2.3, Math.max(1.6, instance.durationSec - 1.2));
      if (instance.focusStops && instance.frame.tour(instance.focusStops, localT, instance.durationSec)) {
        wordsIn(instance.words, localT, CAPTION_START, WORD_EACH, WORD_DUR);
        return;
      }
      const focused = instance.focus ? instance.frame.focus(instance.focus, progress(localT, 0.9, focusEnd), progress(localT, focusEnd - 0.2, focusEnd + 0.25)) : false;
      if (!focused) instance.frame.scroll(progress(localT, 1.0, Math.max(1.8, instance.durationSec - 0.5)));
      wordsIn(instance.words, localT, CAPTION_START, WORD_EACH, WORD_DUR);
    },

    marks(props): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: Math.max(FRAME_ENTER, wordsSettle(countWords(props.caption), CAPTION_START, WORD_EACH, WORD_DUR)), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
