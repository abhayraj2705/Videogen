import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { clamp01, easeOutCubic, spring } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";
import { layoutFor } from "../util/layout.js";
import { sceneRoot, textBlock, wordsIn, wordsSettle } from "../util/ui.js";

export interface IsoStackProps {
  /** Two or three captures, front (top of the stack) first (R2 URLs by render time). Added by Build. */
  screenshotUrls: string[];
  /** Grounded caption tied to a fact id. */
  caption: string;
}

interface Instance {
  layers: HTMLElement[];
  words: HTMLElement[];
  durationSec: number;
  lift: number;
}

const LAYER_STAGGER = 0.18;
const LAYER_ENTER = 0.9;
const CAPTION_START = 0.5;
const WORD_EACH = 0.05;
const WORD_DUR = 0.5;
const SHOT_ASPECT = 1.6;

const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * Screens as a stack seen from above at an angle: the captures drop in one
 * onto another as layers in 3D space, then drift apart vertically for the
 * rest of the scene so each can be seen — depth, where the collage is flat.
 * The same composition in every format; the stack is sized to the frame.
 */
export function createIsoStack(): SceneTemplate<IsoStackProps> {
  let instance: Instance | undefined;

  return {
    id: "IsoStack",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      const gap = L.pick({ landscape: 30, portrait: 48, square: 26 }) * u;
      sceneRoot(root, L, { gap: `${gap}px`, fontFamily: ctx.fonts.body });

      const caption = textBlock(props.caption, {
        className: "is-caption",
        width: L.safe.width * L.pick({ landscape: 0.84, portrait: 1, square: 0.96 }),
        maxSize: L.pick({ landscape: 54, portrait: 64, square: 48 }) * u,
        minSize: 22 * u,
        maxLines: L.pick({ landscape: 2, portrait: 3, square: 2 }),
        color: ctx.palette.fg,
        family: ctx.fonts.display,
        weight: "700",
        lineHeight: 1.2,
      });

      const stageWidth = L.safe.width;
      const stageHeight = L.safe.height - gap - caption.height - 8 * u;
      const stage = el("div", "is-stage");
      setStyle(stage, { position: "relative", width: `${stageWidth}px`, height: `${stageHeight}px`, flexShrink: "0", perspective: `${2600 * u}px` });

      // Tilted back and turned, a card of width w spans about 0.95w across and 0.6w down; size it so the lifted stack still fits.
      const urls = props.screenshotUrls.slice(0, 3);
      const cardWidth = Math.min(stageWidth / 1.05, stageHeight / (0.6 + 0.17 * (urls.length - 1)));
      const cardHeight = cardWidth / SHOT_ASPECT;
      const lift = cardWidth * 0.2;

      const plane = el("div", "is-plane");
      setStyle(plane, {
        position: "absolute",
        left: `${stageWidth / 2 - cardWidth / 2}px`,
        // Sit the base low, so the layers above it have room to rise.
        top: `${stageHeight / 2 - cardHeight / 2 + (lift * (urls.length - 1)) / 3}px`,
        width: `${cardWidth}px`,
        height: `${cardHeight}px`,
        transformStyle: "preserve-3d",
        transform: "rotateX(56deg) rotateZ(-34deg)",
      });

      // Back of the stack first in the DOM; the first capture ends up on top.
      const layers = urls
        .map((url, i) => {
          const layer = el("div", "is-layer");
          setStyle(layer, {
            position: "absolute",
            inset: "0",
            borderRadius: `${16 * ctx.style.radius * u}px`,
            overflow: "hidden",
            background: ctx.palette.surface,
            boxShadow: `0 0 0 ${Math.max(1, 2 * u)}px ${ctx.palette.border}, ${-30 * u}px ${40 * u}px ${70 * u}px rgba(0,0,0,${ctx.palette.isDark ? 0.6 : 0.3})`,
            opacity: "0",
          });
          const img = el("img");
          img.src = url;
          setStyle(img, { display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" });
          layer.appendChild(img);
          return { layer, order: urls.length - 1 - i };
        })
        .sort((a, b) => a.order - b.order)
        .map(({ layer }) => {
          plane.appendChild(layer);
          return layer;
        });

      stage.appendChild(plane);
      root.appendChild(stage);
      root.appendChild(caption.wrap);
      instance = { layers, words: caption.words, durationSec: ctx.durationSec, lift };
    },

    seek(localT) {
      if (!instance) return;
      const { layers, durationSec, lift } = instance;
      // After landing, the layers keep separating slowly — the stack opens up across the scene.
      const open = 0.55 + 0.45 * easeOutCubic(clamp01(localT / Math.max(0.001, durationSec)));
      layers.forEach((layer, i) => {
        const lin = clamp01((localT - i * LAYER_STAGGER) / LAYER_ENTER);
        const drop = 1 - spring(lin, 0.8, 1);
        layer.style.opacity = String(clamp01(lin * 2.5));
        // Each layer rests `lift` above the one below it, and falls into place from well above that.
        layer.style.transform = `translateZ(${(i * lift * open + drop * lift * 3).toFixed(2)}px)`;
      });
      wordsIn(instance.words, localT, CAPTION_START, WORD_EACH, WORD_DUR);
    },

    marks(props): Mark[] {
      const landed = LAYER_STAGGER * (Math.min(3, props.screenshotUrls?.length ?? 1) - 1) + LAYER_ENTER;
      return [
        { t: 0, type: "start" },
        { t: Math.max(landed, wordsSettle(countWords(props.caption), CAPTION_START, WORD_EACH, WORD_DUR)), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
