import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { el, setStyle } from "../util/dom.js";
import { layoutFor } from "../util/layout.js";
import { enter, sceneRoot, textBlock, wordsIn, wordsSettle } from "../util/ui.js";

export interface ScreenCollageProps {
  /** Two or three viewport-sized captures of one page, top to bottom (R2 URLs by render time). Added by Build. */
  screenshotUrls: string[];
  /** Grounded caption tied to a fact id. */
  caption: string;
}

interface Shot {
  node: HTMLElement;
  /** Resting pose, appended after the entrance transform. */
  rest: (drift: number) => string;
  start: number;
  from: { x?: number; y?: number; scale: number; rotate: number };
}

interface Instance {
  shots: Shot[];
  words: HTMLElement[];
  durationSec: number;
}

const SHOT_STAGGER = 0.14;
const SHOT_ENTER = 0.8;
const CAPTION_START = 0.45;
const WORD_EACH = 0.05;
const WORD_DUR = 0.5;
/** Width / height of a section capture (the crawl's 1280x800 viewport). */
const SHOT_ASPECT = 1.6;

const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * Several parts of the same page at once: the captures fan out as tilted
 * cards with depth — the first one largest and on top — and drift slowly
 * apart for the rest of the scene while the caption lands word by word.
 * Layouts: 16:9 a centre card flanked by two smaller ones behind it; 9:16
 * three cards stacked down the frame, alternately offset and tilted; 1:1 the
 * same stack with two cards, so each stays large enough to read.
 */
export function createScreenCollage(): SceneTemplate<ScreenCollageProps> {
  let instance: Instance | undefined;

  return {
    id: "ScreenCollage",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      const gap = L.pick({ landscape: 36, portrait: 48, square: 30 }) * u;
      sceneRoot(root, L, { gap: `${gap}px`, fontFamily: ctx.fonts.body });

      const caption = textBlock(props.caption, {
        className: "sg-caption",
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
      const stage = el("div", "sg-stage");
      setStyle(stage, { position: "relative", width: `${stageWidth}px`, height: `${stageHeight}px`, flexShrink: "0" });

      const stacked = L.orientation !== "landscape";
      const urls = props.screenshotUrls.slice(0, L.orientation === "square" ? 2 : 3);
      // The lead card's size: as large as the stage allows next to (or between) its neighbours.
      const leadWidth = stacked ? Math.min(stageWidth * 0.86, (stageHeight / (1 + 0.72 * (urls.length - 1))) * SHOT_ASPECT) : Math.min(stageWidth * 0.45, stageHeight * 0.94 * SHOT_ASPECT);
      const leadHeight = leadWidth / SHOT_ASPECT;

      const shots = urls.map((url, i): Shot => {
        // Slot 0 is the lead (centre / top); 1 and 2 sit either side of it (or below, when stacked).
        const side = i === 0 ? 0 : i === 1 ? -1 : 1;
        const scale = stacked || i === 0 ? 1 : 0.8;
        const width = leadWidth * scale;
        const height = leadHeight * scale;
        const cx = stacked ? stageWidth / 2 + (i % 2 === 0 ? -1 : 1) * stageWidth * 0.05 : stageWidth / 2 + side * leadWidth * 0.66;
        const cy = stacked ? leadHeight / 2 + i * leadHeight * 0.72 + (stageHeight - leadHeight * (1 + 0.72 * (urls.length - 1))) / 2 : stageHeight / 2;
        const tilt = stacked ? (i % 2 === 0 ? -2.5 : 2.5) : side * 5;

        const node = el("div", "sg-shot");
        setStyle(node, {
          position: "absolute",
          left: `${cx - width / 2}px`,
          top: `${cy - height / 2}px`,
          width: `${width}px`,
          height: `${height}px`,
          borderRadius: `${18 * ctx.style.radius * u}px`,
          overflow: "hidden",
          background: ctx.palette.surface,
          boxShadow: `0 ${40 * u}px ${90 * u}px -${36 * u}px ${ctx.palette.glow}, 0 ${24 * u}px ${50 * u}px -${24 * u}px rgba(0,0,0,${ctx.palette.isDark ? 0.7 : 0.35}), 0 0 0 ${Math.max(1, 1.5 * u)}px ${ctx.palette.border}`,
          // The lead card overlaps its neighbours.
          zIndex: String(i === 0 ? 3 : 1),
        });
        const img = el("img");
        img.src = url;
        setStyle(img, { display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" });
        node.appendChild(img);
        stage.appendChild(node);

        const driftAxis = stacked ? "translateX" : "translateY";
        const driftSign = i === 0 ? -1 : 1;
        return {
          node,
          rest: (drift) => `${driftAxis}(${(drift * driftSign * 22 * u).toFixed(2)}px) rotate(${tilt}deg)`,
          // Neighbours first, the lead card last so it lands on top.
          start: i === 0 ? SHOT_STAGGER * (urls.length - 1) : SHOT_STAGGER * (i - 1),
          from: stacked ? { x: (i % 2 === 0 ? -1 : 1) * 160 * u, scale: 0.86, rotate: tilt * 2 } : { y: 140 * u, scale: 0.8, rotate: side * 8 },
        };
      });

      root.appendChild(stage);
      root.appendChild(caption.wrap);
      instance = { shots, words: caption.words, durationSec: ctx.durationSec };
    },

    seek(localT) {
      if (!instance) return;
      const drift = Math.min(1, Math.max(0, localT / Math.max(0.001, instance.durationSec)));
      for (const shot of instance.shots) enter(shot.node, localT, shot.start, SHOT_ENTER, shot.from, shot.rest(drift));
      wordsIn(instance.words, localT, CAPTION_START, WORD_EACH, WORD_DUR);
    },

    marks(props): Mark[] {
      const shotsLanded = SHOT_STAGGER * (Math.min(3, props.screenshotUrls?.length ?? 1) - 1) + SHOT_ENTER;
      return [
        { t: 0, type: "start" },
        { t: Math.max(shotsLanded, wordsSettle(countWords(props.caption), CAPTION_START, WORD_EACH, WORD_DUR)), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
