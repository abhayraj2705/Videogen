import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutCubic, progress } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";
import { layoutFor } from "../util/layout.js";
import { browserFrame, type BrowserFrame, type PageRect } from "../util/browser-frame.js";
import { enter, sceneRoot, textBlock, wordsIn, wordsSettle } from "../util/ui.js";

export interface StepByStepProps {
  /** Capture of the screen this step happens on (R2 URL by render time). Added by Build. */
  screenshotUrl: string;
  /** What the user does or sees in this step. Grounded. */
  caption: string;
  /** 1-based position of this step in the walkthrough. */
  step: number;
  /** How many steps the walkthrough has. Added by Build. */
  total?: number;
  /** Where on the screen this step happens. Added by Build; absent = the page scrolls instead. */
  focus?: PageRect;
  pageLabel?: string;
}

interface Instance {
  badge: HTMLElement;
  dots: HTMLElement[];
  step: number;
  frame: BrowserFrame;
  words: HTMLElement[];
  focus?: PageRect;
  durationSec: number;
  u: number;
  side: boolean;
}

const FRAME_START = 0.15;
const FRAME_ENTER = 0.9;
const CAPTION_START = 0.35;
const WORD_EACH = 0.05;
const WORD_DUR = 0.5;

const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * One step of a walkthrough: a large step number and the step's title beside
 * (16:9) or above (9:16, 1:1) the screen it happens on, with progress dots
 * showing where in the flow we are. The screen arrives a beat after the
 * number, then the camera pushes in on the part of it the step is about.
 */
export function createStepByStep(): SceneTemplate<StepByStepProps> {
  let instance: Instance | undefined;

  return {
    id: "StepByStep",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      const side = L.orientation === "landscape";
      const gap = L.pick({ landscape: 64, portrait: 48, square: 30 }) * u;
      sceneRoot(root, L, { flexDirection: side ? "row" : "column", gap: `${gap}px`, fontFamily: ctx.fonts.body });

      const panelWidth = side ? L.safe.width * 0.3 : L.safe.width;
      const panel = el("div", "sb-panel");
      setStyle(panel, { display: "flex", flexDirection: "column", alignItems: side ? "flex-start" : "center", gap: `${L.pick({ landscape: 26, portrait: 22, square: 14 }) * u}px`, width: `${panelWidth}px`, flexShrink: "0" });

      const step = Math.max(1, Math.round(props.step || 1));
      const badgeSize = L.pick({ landscape: 190, portrait: 150, square: 104 }) * u;
      const badge = el("div", "sb-step", String(step).padStart(2, "0"));
      const gradient = ctx.palette.accentText === ctx.palette.accent;
      setStyle(badge, {
        fontFamily: ctx.fonts.display,
        fontSize: `${badgeSize}px`,
        fontWeight: "800",
        lineHeight: "0.95",
        letterSpacing: "-0.05em",
        color: ctx.palette.accentText,
        fontVariantNumeric: "tabular-nums",
        ...(gradient ? { backgroundImage: `linear-gradient(120deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`, backgroundClip: "text", webkitBackgroundClip: "text", webkitTextFillColor: "transparent" } : {}),
      });
      panel.appendChild(badge);

      const caption = textBlock(props.caption, {
        className: "sb-caption",
        width: panelWidth,
        maxSize: L.pick({ landscape: 62, portrait: 64, square: 46 }) * u,
        minSize: 24 * u,
        maxLines: L.pick({ landscape: 5, portrait: 2, square: 2 }),
        color: ctx.palette.fg,
        family: ctx.fonts.display,
        weight: "800",
        align: side ? "left" : "center",
        lineHeight: 1.1,
      });
      panel.appendChild(caption.wrap);

      // Progress: one dot per step, this one (and those before it) filled.
      const total = Math.max(step, Math.min(8, Math.round(props.total ?? step)));
      const dotRow = el("div", "sb-dots");
      const dot = L.pick({ landscape: 16, portrait: 16, square: 12 }) * u;
      setStyle(dotRow, { display: "flex", gap: `${dot * 0.7}px`, marginTop: `${6 * u}px` });
      const dots = Array.from({ length: total }, (_, i) => {
        const node = el("div", "sb-dot");
        setStyle(node, { width: `${i === step - 1 ? dot * 2.6 : dot}px`, height: `${dot}px`, borderRadius: `${dot}px`, background: i < step ? ctx.palette.accent : ctx.palette.border });
        dotRow.appendChild(node);
        return node;
      });
      if (total > 1) panel.appendChild(dotRow);

      const frameWidth = side ? L.safe.width - panelWidth - gap : L.safe.width;
      const panelHeight = badgeSize * 0.95 + caption.height + (total > 1 ? dot + 30 * u : 0) + 2 * L.pick({ landscape: 26, portrait: 22, square: 14 }) * u;
      // Stacked: the window takes what the panel leaves, less a margin for the estimate (text can wrap one line more than planned).
      const frameHeight = side ? Math.min(L.safe.height * 0.82, frameWidth * 0.68) : Math.max(120 * u, L.safe.height - gap - panelHeight - 70 * u);
      const frame = browserFrame({ className: "sb-frame", width: frameWidth, height: frameHeight, screenshotUrl: props.screenshotUrl, pageLabel: props.pageLabel, ctx, u });

      root.appendChild(panel);
      root.appendChild(frame.wrap);
      instance = { badge, dots, step, frame, words: caption.words, focus: props.focus, durationSec: ctx.durationSec, u, side };
    },

    seek(localT) {
      if (!instance) return;
      const { badge, dots, step, frame, focus, durationSec, u, side } = instance;
      enter(badge, localT, 0, 0.7, side ? { x: -80 * u, scale: 0.7 } : { y: -60 * u, scale: 0.7 });
      wordsIn(instance.words, localT, CAPTION_START, WORD_EACH, WORD_DUR);
      // The current step's dot draws itself in; earlier ones are already filled.
      const current = dots[step - 1];
      if (current) {
        const p = progress(localT, 0.4, 0.9, easeOutCubic);
        current.style.transformOrigin = "left center";
        current.style.transform = p >= 1 ? "none" : `scaleX(${Math.max(0.38, p).toFixed(4)})`;
      }

      frame.enter(localT, FRAME_START, FRAME_ENTER);
      const focusEnd = Math.min(2.6, Math.max(1.9, durationSec - 1.2));
      const focused = focus ? frame.focus(focus, progress(localT, 1.2, focusEnd), progress(localT, focusEnd - 0.2, focusEnd + 0.25)) : false;
      if (!focused) frame.scroll(progress(localT, 1.3, Math.max(2.1, durationSec - 0.5)));
    },

    marks(props): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: Math.max(FRAME_START + FRAME_ENTER, wordsSettle(countWords(props.caption), CAPTION_START, WORD_EACH, WORD_DUR)), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
