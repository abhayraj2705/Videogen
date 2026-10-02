import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { clamp01 } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";
import { layoutFor } from "../util/layout.js";
import { cardStyle, enter, sceneRoot, textBlock, wordsIn, wordsSettle } from "../util/ui.js";

export interface PhotoShowcaseProps {
  /** The image to feature — an upload or a page capture (R2 URL by render time). Added by Build. */
  screenshotUrl: string;
  /** Grounded caption tied to a fact id. */
  caption: string;
}

interface Instance {
  frame: HTMLElement;
  image: HTMLImageElement;
  plate: HTMLElement;
  words: HTMLElement[];
  durationSec: number;
  u: number;
}

const FRAME_ENTER = 0.9;
const PLATE_START = 0.5;
const CAPTION_START = 0.7;
const WORD_EACH = 0.05;
const WORD_DUR = 0.5;

const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * One image given the whole frame: it fills the title-safe area edge to edge
 * (cropped to fit) and drifts slowly, while the caption rides on a plate that
 * slides in over its lower-left corner. For photos and for any screen that
 * deserves to be seen large, without browser chrome around it.
 */
export function createPhotoShowcase(): SceneTemplate<PhotoShowcaseProps> {
  let instance: Instance | undefined;

  return {
    id: "PhotoShowcase",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      sceneRoot(root, L);

      const frame = el("div", "ps-frame");
      setStyle(frame, {
        position: "relative",
        width: `${L.safe.width}px`,
        height: `${L.safe.height}px`,
        overflow: "hidden",
        borderRadius: `${30 * ctx.style.radius * u}px`,
        background: ctx.palette.surface,
        boxShadow: `0 ${50 * u}px ${110 * u}px -${40 * u}px ${ctx.palette.glow}, 0 0 0 ${Math.max(1, 1.5 * u)}px ${ctx.palette.border}`,
      });
      const image = el("img");
      image.src = props.screenshotUrl;
      setStyle(image, { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", transformOrigin: "50% 30%" });
      frame.appendChild(image);

      const pad = L.pick({ landscape: 34, portrait: 36, square: 26 }) * u;
      const plateWidth = Math.min(L.safe.width - 2 * pad, L.pick({ landscape: 900, portrait: 900, square: 800 }) * u);
      const caption = textBlock(props.caption, {
        className: "ps-caption",
        width: plateWidth - 2 * pad,
        maxSize: L.pick({ landscape: 60, portrait: 66, square: 50 }) * u,
        minSize: 24 * u,
        maxLines: 3,
        color: ctx.palette.fg,
        family: ctx.fonts.display,
        weight: "800",
        align: "left",
        lineHeight: 1.12,
      });
      // A solid plate, not text on the photo: it stays readable whatever the image is.
      const plate = el("div", "ps-plate");
      setStyle(plate, { ...cardStyle(ctx, u, 24), position: "absolute", left: `${pad}px`, bottom: `${pad}px`, padding: `${pad * 0.8}px ${pad}px`, maxWidth: `${plateWidth}px` });
      plate.appendChild(caption.wrap);
      frame.appendChild(plate);

      root.appendChild(frame);
      instance = { frame, image, plate, words: caption.words, durationSec: ctx.durationSec, u };
    },

    seek(localT) {
      if (!instance) return;
      const { frame, image, plate, durationSec, u } = instance;
      enter(frame, localT, 0, FRAME_ENTER, { scale: 0.9, y: 60 * u });
      // Slow drift for the whole scene; starts just over 1x so it never rests on an identity.
      image.style.transform = `scale(${(1.08 - 0.07 * clamp01(localT / Math.max(0.001, durationSec))).toFixed(4)})`;
      enter(plate, localT, PLATE_START, 0.7, { x: -80 * u, scale: 0.96 });
      wordsIn(instance.words, localT, CAPTION_START, WORD_EACH, WORD_DUR);
    },

    marks(props): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: Math.max(PLATE_START + 0.7, wordsSettle(countWords(props.caption), CAPTION_START, WORD_EACH, WORD_DUR)), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
