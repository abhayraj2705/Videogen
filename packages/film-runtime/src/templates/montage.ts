import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { clamp01 } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";
import { layoutFor } from "../util/layout.js";
import { enter, sceneRoot, textBlock, wordsIn, wordsSettle } from "../util/ui.js";

export interface MontageProps {
  /** Two to six captures to cut through, in order (R2 URLs by render time). Added by Build. */
  screenshotUrls: string[];
  /** Grounded caption that holds under the whole montage. */
  caption: string;
}

interface Instance {
  card: HTMLElement;
  shots: HTMLImageElement[];
  flash: HTMLElement;
  cuts: number[];
  words: HTMLElement[];
  durationSec: number;
  u: number;
}

const CARD_ENTER = 0.5;
const CAPTION_START = 0.2;
const WORD_EACH = 0.05;
const WORD_DUR = 0.45;

const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * When each image of a montage cuts in (seconds from the scene start; the
 * first is on screen from the start). Shared with the sound design, which
 * puts a hit on every cut.
 */
export function montageCuts(count: number, durationSec: number): number[] {
  const n = Math.max(1, Math.min(6, count));
  const per = Math.max(0.42, (durationSec - 0.7) / n);
  return Array.from({ length: n }, (_, i) => Math.round((i === 0 ? 0 : 0.25 + i * per) * 1000) / 1000);
}

/**
 * A fast cut through the product's screens: one card, hard-cutting from
 * capture to capture several times a second, each with a quick flash on the
 * cut and a slow drift while it holds; the caption sits under all of it.
 * Layouts: 16:9 and 1:1 a wide card; 9:16 a tall card cropped to the top of each page.
 */
export function createMontage(): SceneTemplate<MontageProps> {
  let instance: Instance | undefined;

  return {
    id: "Montage",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      const gap = L.pick({ landscape: 36, portrait: 52, square: 30 }) * u;
      sceneRoot(root, L, { gap: `${gap}px`, fontFamily: ctx.fonts.body });

      const caption = textBlock(props.caption, {
        className: "mg-caption",
        width: L.safe.width * L.pick({ landscape: 0.84, portrait: 1, square: 0.96 }),
        maxSize: L.pick({ landscape: 58, portrait: 68, square: 50 }) * u,
        minSize: 22 * u,
        maxLines: L.pick({ landscape: 2, portrait: 3, square: 2 }),
        color: ctx.palette.fg,
        family: ctx.fonts.display,
        weight: "800",
        lineHeight: 1.15,
      });

      const room = L.safe.height - gap - caption.height - 8 * u;
      const width = Math.min(L.safe.width * L.pick({ landscape: 0.82, portrait: 1, square: 0.98 }), room * L.pick({ landscape: 1.7, portrait: 0.85, square: 1.5 }));
      const height = Math.min(room, width / L.pick({ landscape: 1.7, portrait: 0.85, square: 1.5 }));

      const card = el("div", "mg-card");
      setStyle(card, {
        position: "relative",
        width: `${width}px`,
        height: `${height}px`,
        flexShrink: "0",
        overflow: "hidden",
        borderRadius: `${26 * ctx.style.radius * u}px`,
        background: ctx.palette.surface,
        boxShadow: `0 ${50 * u}px ${110 * u}px -${40 * u}px ${ctx.palette.glow}, 0 ${30 * u}px ${60 * u}px -${30 * u}px rgba(0,0,0,${ctx.palette.isDark ? 0.7 : 0.35}), 0 0 0 ${Math.max(1, 1.5 * u)}px ${ctx.palette.border}`,
      });
      const shots = props.screenshotUrls.slice(0, 6).map((url) => {
        const img = el("img");
        img.src = url;
        setStyle(img, { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", opacity: "0", transformOrigin: "50% 40%" });
        card.appendChild(img);
        return img;
      });
      const flash = el("div", "mg-flash");
      setStyle(flash, { position: "absolute", inset: "0", background: ctx.palette.isDark ? "rgb(255,255,255)" : ctx.palette.accent, opacity: "0", pointerEvents: "none" });
      card.appendChild(flash);

      root.appendChild(card);
      root.appendChild(caption.wrap);
      instance = { card, shots, flash, cuts: montageCuts(shots.length, ctx.durationSec), words: caption.words, durationSec: ctx.durationSec, u };
    },

    seek(localT) {
      if (!instance) return;
      const { card, shots, flash, cuts, durationSec, u } = instance;
      enter(card, localT, 0, CARD_ENTER, { y: 70 * u, scale: 0.9 });

      // The image on screen is the last one whose cut time has passed.
      let current = 0;
      for (let i = 0; i < cuts.length; i++) if (localT >= cuts[i]!) current = i;
      const since = localT - cuts[current]!;
      const hold = (cuts[current + 1] ?? durationSec) - cuts[current]!;
      shots.forEach((img, i) => {
        img.style.opacity = i === current ? "1" : "0";
        if (i !== current) return;
        // Each shot settles from slightly over-scale, alternately leaning left and right; never rests on an identity.
        const p = clamp01(since / Math.max(0.001, hold));
        img.style.transform = `scale(${(1.1 - 0.07 * p).toFixed(4)}) translateX(${((i % 2 === 0 ? 1 : -1) * (1 - p) * 1.2).toFixed(3)}%)`;
      });
      // A flash on every cut but the opening one.
      flash.style.opacity = current > 0 ? String(0.55 * clamp01(1 - since / 0.14)) : "0";

      wordsIn(instance.words, localT, CAPTION_START, WORD_EACH, WORD_DUR);
    },

    marks(props): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: Math.max(CARD_ENTER, wordsSettle(countWords(props.caption), CAPTION_START, WORD_EACH, WORD_DUR)), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
