import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { clamp01, easeInOutCubic, easeOutCubic, lerp, progress } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";
import { layoutFor } from "../util/layout.js";
import { browserFrame, type BrowserFrame, type PageRect } from "../util/browser-frame.js";
import { sceneRoot, textBlock, wordsIn, wordsSettle } from "../util/ui.js";

export interface UIFlowCursorProps {
  screenshotUrl: string;
  caption: string;
  /** Normalized (0-1) waypoints the cursor visits and clicks, e.g. [[0.3,0.4],[0.7,0.6]]. Defaults to a gentle diagonal sweep. */
  cursorPath?: [number, number][];
  /** Real things to click near the top of the page (buttons, the cited element), as page regions. Added by Build; takes over from cursorPath, and the page then stays put so the clicks land on them. */
  cursorTargets?: PageRect[];
  /** Short display address for the browser toolbar. Added by Build. */
  pageLabel?: string;
}

interface Instance {
  frame: BrowserFrame;
  cursor: HTMLElement;
  ripples: HTMLElement[];
  words: HTMLElement[];
  path: [number, number][];
  durationSec: number;
  /** True when the pointer is aimed at real page elements, so the page must not scroll. */
  pinned: boolean;
}

const DEFAULT_PATH: [number, number][] = [
  [0.25, 0.35],
  [0.6, 0.5],
  [0.45, 0.7],
];

const FRAME_ENTER = 0.8;
const CAPTION_START = 0.35;
const WORD_EACH = 0.05;
const WORD_DUR = 0.5;
const CURSOR_START = 0.7;
/** Seconds to travel to each waypoint; the click lands on arrival. */
const LEG_SEC = 0.85;

/** When the pointer clicks (seconds from the scene start), for the sound design. */
export function cursorClickTimes(props: Pick<UIFlowCursorProps, "cursorPath" | "cursorTargets">): number[] {
  const stops = props.cursorTargets?.length || props.cursorPath?.length || DEFAULT_PATH.length;
  return Array.from({ length: stops }, (_, i) => CURSOR_START + (i + 1) * LEG_SEC);
}

const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

const CURSOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%"><path d="M4 2.5l15.5 9.2-6.6 1.5 3.9 7.2-2.9 1.6-3.9-7.3-4.9 4.7z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';

/**
 * The real site in a browser window with a pointer that travels to each
 * waypoint and clicks (press + ripple), while the page scrolls beneath it.
 * Layouts: 16:9 wide window + caption below; 9:16 caption *above* a tall
 * window (reads first on phones, keeps the bottom UI zone clear); 1:1 square-ish.
 */
export function createUIFlowCursor(): SceneTemplate<UIFlowCursorProps> {
  let instance: Instance | undefined;

  return {
    id: "UIFlowCursor",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      const gap = L.pick({ landscape: 34, portrait: 48, square: 30 }) * u;
      sceneRoot(root, L, { flexDirection: L.orientation === "portrait" ? "column-reverse" : "column", gap: `${gap}px`, fontFamily: ctx.fonts.body });

      const caption = textBlock(props.caption, {
        className: "uf-caption",
        width: L.safe.width * L.pick({ landscape: 0.84, portrait: 1, square: 0.96 }),
        maxSize: L.pick({ landscape: 52, portrait: 62, square: 46 }) * u,
        minSize: 22 * u,
        maxLines: L.pick({ landscape: 2, portrait: 3, square: 2 }),
        color: ctx.palette.fg,
        family: ctx.fonts.display,
        weight: "700",
        lineHeight: 1.2,
      });

      const width = L.safe.width * L.pick({ landscape: 0.84, portrait: 1, square: 0.98 });
      const height = Math.min(L.safe.height - gap - caption.height - 8 * u, L.pick({ landscape: 0.66, portrait: 0.58, square: 0.62 }) * ctx.height);
      const frame = browserFrame({ className: "uf-frame", width, height, screenshotUrl: props.screenshotUrl, pageLabel: props.pageLabel, ctx, u });

      // Targets are page regions (fractions of the page width); the window shows the top of the page at full width.
      const targetPath = (props.cursorTargets ?? [])
        .map((r): [number, number] => [r.x + r.w / 2, ((r.y + r.h / 2) * frame.viewportWidth) / frame.viewportHeight])
        .filter(([x, y]) => x > 0.02 && x < 0.98 && y > 0.04 && y < 0.94);
      const path = targetPath.length > 0 ? targetPath : props.cursorPath && props.cursorPath.length > 0 ? props.cursorPath : DEFAULT_PATH;
      const rippleSize = 96 * u;
      const ripples = path.map(() => {
        const ripple = el("div", "uf-ripple");
        setStyle(ripple, {
          position: "absolute",
          left: `${-rippleSize / 2}px`,
          top: `${-rippleSize / 2}px`,
          width: `${rippleSize}px`,
          height: `${rippleSize}px`,
          borderRadius: "50%",
          border: `${5 * u}px solid ${ctx.palette.accent}`,
          background: ctx.palette.accentSoft,
          boxSizing: "border-box",
          opacity: "0",
        });
        frame.viewport.appendChild(ripple);
        return ripple;
      });

      const cursorSize = 46 * u;
      const cursor = el("div", "uf-cursor");
      setStyle(cursor, { position: "absolute", left: "0", top: "0", width: `${cursorSize}px`, height: `${cursorSize}px`, transformOrigin: "15% 10%", filter: `drop-shadow(0 ${4 * u}px ${6 * u}px rgba(0,0,0,0.35))` });
      cursor.innerHTML = CURSOR_SVG;
      frame.viewport.appendChild(cursor);

      root.appendChild(frame.wrap);
      root.appendChild(caption.wrap);
      instance = { frame, cursor, ripples, words: caption.words, path, durationSec: ctx.durationSec, pinned: targetPath.length > 0 };
    },

    seek(localT) {
      if (!instance) return;
      const { frame, cursor, ripples, path } = instance;
      frame.enter(localT, 0, FRAME_ENTER);
      wordsIn(instance.words, localT, CAPTION_START, WORD_EACH, WORD_DUR);
      // With real click targets the page holds still (a scroll would slide them out from under the pointer).
      if (!instance.pinned) frame.scroll(progress(localT, CURSOR_START + LEG_SEC + 0.3, Math.max(2.4, instance.durationSec - 0.6)), 0.45);

      // The pointer starts off the bottom-right corner and visits each waypoint in turn.
      const w = frame.viewportWidth;
      const h = frame.viewportHeight;
      const leg = Math.max(0, (localT - CURSOR_START) / LEG_SEC);
      const idx = Math.min(path.length - 1, Math.floor(leg));
      const from: [number, number] = idx === 0 ? [0.92, 1.05] : path[idx - 1]!;
      const to = path[idx]!;
      const f = easeInOutCubic(clamp01(leg - idx));
      const x = lerp(from[0], to[0], f) * w;
      const y = lerp(from[1], to[1], f) * h;

      // Press: a quick dip in scale right as each leg completes.
      let press = 0;
      path.forEach((point, i) => {
        const since = localT - (CURSOR_START + (i + 1) * LEG_SEC);
        press = Math.max(press, clamp01(1 - Math.abs(since - 0.06) / 0.12));
        const ripple = ripples[i]!;
        const rp = clamp01(since / 0.55);
        ripple.style.opacity = since <= 0 ? "0" : String((1 - rp) * 0.9);
        ripple.style.transform = `translate(${(point[0] * w).toFixed(2)}px, ${(point[1] * h).toFixed(2)}px) scale(${(0.3 + 1.1 * easeOutCubic(rp)).toFixed(4)})`;
      });
      cursor.style.opacity = String(clamp01((localT - CURSOR_START) / 0.2));
      cursor.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${(1 - 0.18 * press).toFixed(4)})`;
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
