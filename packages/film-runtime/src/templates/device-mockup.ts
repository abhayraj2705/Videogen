import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { clamp01, easeInOutCubic, spring } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";
import { layoutFor } from "../util/layout.js";
import { sceneRoot, textBlock, wordsIn, wordsSettle } from "../util/ui.js";

export interface DeviceMockupProps {
  /** Full-page capture of the site (R2 URL by render time). Added by Build. */
  screenshotUrl: string;
  /** Grounded caption tied to a fact id. */
  caption: string;
}

interface Instance {
  device: HTMLElement;
  image: HTMLImageElement;
  screenWidth: number;
  screenHeight: number;
  imageWidth: number;
  words: HTMLElement[];
  durationSec: number;
  u: number;
}

const DEVICE_ENTER = 1.0;
const CAPTION_START = 0.5;
const WORD_EACH = 0.05;
const WORD_DUR = 0.5;

const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * The product on a device: a laptop in 16:9, a phone in 9:16 and 1:1. The
 * device swings up out of perspective, then keeps turning a few degrees for
 * the rest of the scene while the page scrolls on its screen and the caption
 * lands word by word.
 * The phone shows the left part of the desktop capture enlarged (a 1280px
 * page shrunk to a phone's width would be unreadable).
 */
export function createDeviceMockup(): SceneTemplate<DeviceMockupProps> {
  let instance: Instance | undefined;

  return {
    id: "DeviceMockup",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      const gap = L.pick({ landscape: 40, portrait: 56, square: 32 }) * u;
      sceneRoot(root, L, { gap: `${gap}px`, fontFamily: ctx.fonts.body });

      const caption = textBlock(props.caption, {
        className: "dm-caption",
        width: L.safe.width * L.pick({ landscape: 0.84, portrait: 1, square: 0.96 }),
        maxSize: L.pick({ landscape: 54, portrait: 64, square: 48 }) * u,
        minSize: 22 * u,
        maxLines: L.pick({ landscape: 2, portrait: 3, square: 2 }),
        color: ctx.palette.fg,
        family: ctx.fonts.display,
        weight: "700",
        lineHeight: 1.2,
      });

      const laptop = L.orientation === "landscape";
      const room = L.safe.height - gap - caption.height - 8 * u;
      const bezel = (laptop ? 16 : 14) * u;
      const baseHeight = laptop ? 26 * u : 0;
      // Laptop screens are 16:10; the phone is 9:19.
      const screenHeight = laptop ? Math.min(room - 2 * bezel - baseHeight, (L.safe.width * 0.72) / 1.6) : Math.min(room - 2 * bezel, (L.safe.width * 0.6 * 19) / 9);
      const screenWidth = laptop ? screenHeight * 1.6 : (screenHeight * 9) / 19;
      const shell = ctx.palette.isDark ? "rgb(38, 38, 42)" : "rgb(24, 24, 28)";

      const device = el("div", "dm-device");
      setStyle(device, { position: "relative", flexShrink: "0", display: "flex", flexDirection: "column", alignItems: "center", transformOrigin: "50% 60%" });

      const body = el("div", "dm-body");
      setStyle(body, {
        boxSizing: "content-box",
        width: `${screenWidth}px`,
        height: `${screenHeight}px`,
        padding: `${bezel}px`,
        borderRadius: `${(laptop ? 22 : 54) * u}px`,
        background: shell,
        boxShadow: `0 ${50 * u}px ${110 * u}px -${40 * u}px ${ctx.palette.glow}, 0 ${30 * u}px ${70 * u}px -${30 * u}px rgba(0,0,0,${ctx.palette.isDark ? 0.75 : 0.4}), inset 0 0 0 ${Math.max(1, 1.5 * u)}px rgba(255,255,255,0.14)`,
      });
      const screen = el("div", "dm-screen");
      setStyle(screen, { position: "relative", width: "100%", height: "100%", overflow: "hidden", borderRadius: `${(laptop ? 8 : 40) * u}px`, background: ctx.palette.surface });
      const imageWidth = laptop ? screenWidth : screenWidth * 2.3;
      const image = el("img");
      image.src = props.screenshotUrl;
      setStyle(image, { display: "block", width: `${imageWidth}px`, maxWidth: "none", height: "auto" });
      screen.appendChild(image);
      if (!laptop) {
        const island = el("div", "dm-island");
        setStyle(island, { position: "absolute", left: "50%", top: `${12 * u}px`, width: `${screenWidth * 0.3}px`, height: `${24 * u}px`, marginLeft: `${-screenWidth * 0.15}px`, borderRadius: `${12 * u}px`, background: shell });
        screen.appendChild(island);
      }
      body.appendChild(screen);
      device.appendChild(body);
      if (laptop) {
        const base = el("div", "dm-base");
        setStyle(base, { width: `${(screenWidth + 2 * bezel) * 1.16}px`, height: `${baseHeight}px`, borderRadius: `${4 * u}px ${4 * u}px ${18 * u}px ${18 * u}px`, background: `linear-gradient(${shell}, rgb(60, 60, 66))` });
        device.appendChild(base);
      }

      root.appendChild(device);
      root.appendChild(caption.wrap);
      instance = { device, image, screenWidth, screenHeight, imageWidth, words: caption.words, durationSec: ctx.durationSec, u };
    },

    seek(localT) {
      if (!instance) return;
      const { device, image, screenHeight, imageWidth, durationSec, u } = instance;
      // Entrance swings the device up; after that it keeps turning slowly, so it never rests flat.
      const lin = clamp01(localT / DEVICE_ENTER);
      const inv = 1 - spring(lin, 0.82, 1);
      const turn = -7 + 14 * clamp01(localT / Math.max(0.001, durationSec));
      device.style.opacity = String(clamp01(lin * 2.4));
      device.style.transform = `perspective(${1800 * u}px) translateY(${(90 * u * inv).toFixed(2)}px) rotateX(${(4 + 14 * inv).toFixed(3)}deg) rotateY(${(turn - 16 * inv).toFixed(3)}deg) scale(${(1 - 0.1 * inv).toFixed(4)})`;

      // naturalWidth is known by the time the player signals ready (it awaits every image's decode()).
      const pageHeight = image.naturalWidth > 0 ? (imageWidth * image.naturalHeight) / image.naturalWidth : screenHeight;
      const travel = Math.min(Math.max(0, pageHeight - screenHeight), screenHeight * 0.8);
      const offset = travel * easeInOutCubic(clamp01((localT - 1.1) / Math.max(0.8, durationSec - 1.6)));
      image.style.transform = offset < 0.005 ? "none" : `translateY(${(-offset).toFixed(2)}px)`;

      wordsIn(instance.words, localT, CAPTION_START, WORD_EACH, WORD_DUR);
    },

    marks(props): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: Math.max(DEVICE_ENTER, wordsSettle(countWords(props.caption), CAPTION_START, WORD_EACH, WORD_DUR)), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
