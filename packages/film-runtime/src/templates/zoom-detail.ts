import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { clamp01, easeOutCubic, progress } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";
import { layoutFor } from "../util/layout.js";
import type { PageRect } from "../util/browser-frame.js";
import { enter, sceneRoot, textBlock, wordsIn, wordsSettle } from "../util/ui.js";

export interface ZoomDetailProps {
  /** Full-page capture of the site (R2 URL by render time). Added by Build. */
  screenshotUrl: string;
  /** Grounded caption tied to a fact id. */
  caption: string;
  /** Where the thing the caption is about sits on the page. Added by Build; absent = the top of the page. */
  focus?: PageRect;
  /** Short display address shown on the card's tag, e.g. "acme.com/pricing". Added by Build. */
  pageLabel?: string;
}

interface Instance {
  card: HTMLElement;
  image: HTMLImageElement;
  ring: HTMLElement;
  tag: HTMLElement | null;
  words: HTMLElement[];
  durationSec: number;
  u: number;
}

const CARD_ENTER = 0.8;
const CAPTION_START = 0.4;
const WORD_EACH = 0.05;
const WORD_DUR = 0.5;
/** With no measured region, show the top-left of the page — where a site's headline sits. */
const DEFAULT_FOCUS: PageRect = { x: 0.04, y: 0.08, w: 0.5, h: 0.18 };

const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * A close-up: one region of the page cut out as a large floating card — no
 * browser chrome, just the detail — with an accent ring around the exact
 * element and a slow push-in, while the caption lands word by word.
 * Layouts: 16:9 a wide card above the caption; 9:16 a tall card filling the
 * width; 1:1 a near-square card.
 */
export function createZoomDetail(): SceneTemplate<ZoomDetailProps> {
  let instance: Instance | undefined;

  return {
    id: "ZoomDetail",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      const gap = L.pick({ landscape: 36, portrait: 52, square: 30 }) * u;
      sceneRoot(root, L, { gap: `${gap}px`, fontFamily: ctx.fonts.body });

      const caption = textBlock(props.caption, {
        className: "zd-caption",
        width: L.safe.width * L.pick({ landscape: 0.84, portrait: 1, square: 0.96 }),
        maxSize: L.pick({ landscape: 56, portrait: 66, square: 50 }) * u,
        minSize: 22 * u,
        maxLines: L.pick({ landscape: 2, portrait: 3, square: 2 }),
        color: ctx.palette.fg,
        family: ctx.fonts.display,
        weight: "700",
        lineHeight: 1.2,
      });

      const cardWidth = L.safe.width * L.pick({ landscape: 0.8, portrait: 1, square: 0.96 });
      const cardHeight = Math.min(L.safe.height - gap - caption.height - 8 * u, cardWidth * L.pick({ landscape: 0.46, portrait: 0.9, square: 0.62 }));
      const focus = props.focus ?? DEFAULT_FOCUS;
      // The region plus breathing room fills the card's width; never show less than a third of the page (soft pixels).
      const shownFraction = Math.max(focus.w * 1.35, (focus.h * 1.6 * cardWidth) / cardHeight, 0.34);
      const imageWidth = cardWidth / Math.min(1, shownFraction);
      const cx = (focus.x + focus.w / 2) * imageWidth;
      const cy = (focus.y + focus.h / 2) * imageWidth;
      const left = Math.min(0, Math.max(cardWidth - imageWidth, cardWidth / 2 - cx));
      const top = Math.min(0, cardHeight / 2 - cy);

      const card = el("div", "zd-card");
      setStyle(card, {
        position: "relative",
        width: `${cardWidth}px`,
        height: `${cardHeight}px`,
        flexShrink: "0",
        overflow: "hidden",
        borderRadius: `${26 * ctx.style.radius * u}px`,
        background: ctx.palette.surface,
        boxShadow: `0 ${50 * u}px ${110 * u}px -${40 * u}px ${ctx.palette.glow}, 0 ${30 * u}px ${60 * u}px -${30 * u}px rgba(0,0,0,${ctx.palette.isDark ? 0.7 : 0.35}), 0 0 0 ${Math.max(1, 1.5 * u)}px ${ctx.palette.border}`,
      });

      const image = el("img");
      image.src = props.screenshotUrl;
      setStyle(image, { position: "absolute", left: `${left}px`, top: `${top}px`, width: `${imageWidth}px`, maxWidth: "none", height: "auto", transformOrigin: `${cx}px ${cy}px` });
      card.appendChild(image);

      const pad = 12 * u;
      const ring = el("div", "zd-ring");
      setStyle(ring, {
        position: "absolute",
        boxSizing: "border-box",
        left: `${left + focus.x * imageWidth - pad}px`,
        top: `${top + focus.y * imageWidth - pad}px`,
        width: `${focus.w * imageWidth + 2 * pad}px`,
        height: `${focus.h * imageWidth + 2 * pad}px`,
        border: `${4 * u}px solid ${ctx.palette.accent}`,
        borderRadius: `${14 * u}px`,
        boxShadow: `0 0 0 ${6 * u}px ${ctx.palette.accentSoft}, 0 0 ${40 * u}px ${ctx.palette.glow}`,
        opacity: "0",
        transformOrigin: "50% 50%",
      });
      // Without a measured region there is nothing specific to point at.
      if (props.focus) card.appendChild(ring);

      let tag: HTMLElement | null = null;
      if (props.pageLabel) {
        tag = el("div", "zd-tag", props.pageLabel);
        setStyle(tag, {
          position: "absolute",
          left: `${20 * u}px`,
          bottom: `${20 * u}px`,
          padding: `${7 * u}px ${18 * u}px`,
          borderRadius: `${20 * u}px`,
          background: ctx.palette.fg,
          color: ctx.palette.bg,
          fontFamily: ctx.fonts.body,
          fontSize: `${20 * u}px`,
          fontWeight: "600",
          whiteSpace: "nowrap",
        });
        card.appendChild(tag);
      }

      root.appendChild(card);
      root.appendChild(caption.wrap);
      instance = { card, image, ring, tag, words: caption.words, durationSec: ctx.durationSec, u };
    },

    seek(localT) {
      if (!instance) return;
      const { card, image, ring, tag, durationSec, u } = instance;
      enter(card, localT, 0, CARD_ENTER, { y: 90 * u, scale: 0.86 });
      // Slow push toward the region for the whole scene; starts just above 1x so it never rests on an identity.
      image.style.transform = `scale(${(1.001 + 0.07 * clamp01(localT / Math.max(0.001, durationSec))).toFixed(4)})`;
      const ringP = progress(localT, 0.7, 1.15, easeOutCubic);
      ring.style.opacity = String(ringP);
      ring.style.transform = ringP >= 1 ? "none" : `scale(${(1.12 - 0.12 * ringP).toFixed(4)})`;
      if (tag) tag.style.opacity = String(progress(localT, 0.6, 1.0));
      wordsIn(instance.words, localT, CAPTION_START, WORD_EACH, WORD_DUR);
    },

    marks(props): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: Math.max(1.15, wordsSettle(countWords(props.caption), CAPTION_START, WORD_EACH, WORD_DUR)), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
