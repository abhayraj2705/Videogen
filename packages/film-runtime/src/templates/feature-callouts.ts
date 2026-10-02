import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { clamp01, easeOutCubic, progress } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";
import { layoutFor } from "../util/layout.js";
import type { PageRect } from "../util/browser-frame.js";
import { cueStart, enter, sceneRoot, textBlock, wordsIn, wordsSettle } from "../util/ui.js";

export interface Callout {
  /** Short grounded label, 1-4 words. */
  label: string;
  /** Where on the page the labelled thing sits. Added by Build; absent = the label is listed without a pointer. */
  rect?: PageRect;
}

export interface FeatureCalloutsProps {
  /** Full-page capture of the site (R2 URL by render time). Added by Build. */
  screenshotUrl: string;
  /** Grounded caption tied to a fact id. */
  caption: string;
  /** Two or three things to point out, in order. Storyboards send `items` (labels); Build turns them into callouts. */
  callouts: Callout[];
  /** Seconds from the scene start at which each callout is spoken. Added by Build. */
  cues?: number[];
}

interface Pin {
  ring: HTMLElement | null;
  pill: HTMLElement;
}

interface Instance {
  card: HTMLElement;
  dim: HTMLElement;
  pins: Pin[];
  words: HTMLElement[];
  cues?: number[];
  u: number;
}

const CARD_ENTER = 0.8;
const CAPTION_START = 0.35;
const WORD_EACH = 0.05;
const WORD_DUR = 0.5;
// Quick enough that three callouts are all up within two seconds — the shortest scene a three-label caption allows.
const PIN_FIRST = 0.8;
const PIN_EACH = 0.35;

const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const pinStart = (i: number, cues?: number[]) => PIN_FIRST + cueStart(cues?.map((c) => Math.max(0, c - PIN_FIRST)), i, PIN_EACH);

/**
 * The page with things pointed out on it: the screenshot sits in a card, dims
 * slightly, and two or three labelled outlines appear one after another on
 * the real elements they name (as the voice reaches each, when there is one).
 * Labels whose element has no known position are listed in the card's corner
 * instead, so every label is always on screen.
 */
export function createFeatureCallouts(): SceneTemplate<FeatureCalloutsProps> {
  let instance: Instance | undefined;

  return {
    id: "FeatureCallouts",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      const gap = L.pick({ landscape: 34, portrait: 50, square: 30 }) * u;
      sceneRoot(root, L, { gap: `${gap}px`, fontFamily: ctx.fonts.body });

      const caption = textBlock(props.caption, {
        className: "fc-caption",
        width: L.safe.width * L.pick({ landscape: 0.84, portrait: 1, square: 0.96 }),
        maxSize: L.pick({ landscape: 54, portrait: 64, square: 48 }) * u,
        minSize: 22 * u,
        maxLines: L.pick({ landscape: 2, portrait: 3, square: 2 }),
        color: ctx.palette.fg,
        family: ctx.fonts.display,
        weight: "700",
        lineHeight: 1.2,
      });

      const cardWidth = L.safe.width * L.pick({ landscape: 0.84, portrait: 1, square: 0.98 });
      const cardHeight = Math.min(L.safe.height - gap - caption.height - 8 * u, cardWidth * L.pick({ landscape: 0.5, portrait: 1.0, square: 0.66 }));
      const card = el("div", "fc-card");
      setStyle(card, {
        position: "relative",
        width: `${cardWidth}px`,
        height: `${cardHeight}px`,
        flexShrink: "0",
        overflow: "hidden",
        borderRadius: `${22 * ctx.style.radius * u}px`,
        background: ctx.palette.surface,
        boxShadow: `0 ${50 * u}px ${110 * u}px -${40 * u}px ${ctx.palette.glow}, 0 ${30 * u}px ${60 * u}px -${30 * u}px rgba(0,0,0,${ctx.palette.isDark ? 0.7 : 0.35}), 0 0 0 ${Math.max(1, 1.5 * u)}px ${ctx.palette.border}`,
      });

      // The page is shown at the card's width; slide it up so the pointed-at elements sit mid-card.
      const callouts = (props.callouts ?? []).slice(0, 3);
      const placed = callouts.map((c) => c.rect).filter((r): r is PageRect => !!r);
      // Elements too far apart to share the card: frame the first one (the others are then listed without a pointer).
      const together = placed.length > 0 && (Math.max(...placed.map((r) => r.y + r.h)) - Math.min(...placed.map((r) => r.y))) * cardWidth <= cardHeight * 0.8;
      const framed = together ? placed : placed.slice(0, 1);
      const spanTop = framed.length ? Math.min(...framed.map((r) => r.y)) * cardWidth : 0;
      const spanBottom = framed.length ? Math.max(...framed.map((r) => r.y + r.h)) * cardWidth : cardHeight;
      const offset = Math.max(0, (spanTop + spanBottom) / 2 - cardHeight / 2);

      const image = el("img");
      image.src = props.screenshotUrl;
      setStyle(image, { position: "absolute", left: "0", top: `${-offset}px`, width: "100%", height: "auto" });
      card.appendChild(image);

      const dim = el("div", "fc-dim");
      setStyle(dim, { position: "absolute", inset: "0", background: ctx.palette.isDark ? "rgb(0,0,0)" : "rgb(20,20,30)", opacity: "0" });
      card.appendChild(dim);

      const fontSize = L.pick({ landscape: 30, portrait: 34, square: 26 }) * u;
      const pillHeight = fontSize * 1.9;
      const pad = 10 * u;
      let unplaced = 0;
      const pins = callouts.map((c, i): Pin => {
        const pill = el("div", "fc-pill", c.label);
        setStyle(pill, {
          position: "absolute",
          boxSizing: "border-box",
          height: `${pillHeight}px`,
          padding: `0 ${fontSize * 0.7}px`,
          display: "flex",
          alignItems: "center",
          borderRadius: `${pillHeight / 2}px`,
          background: ctx.palette.accent,
          color: ctx.palette.onAccent,
          fontFamily: ctx.fonts.display,
          fontSize: `${fontSize}px`,
          fontWeight: "700",
          letterSpacing: "-0.01em",
          whiteSpace: "nowrap",
          boxShadow: `0 ${8 * u}px ${24 * u}px -${8 * u}px rgba(0,0,0,0.5)`,
          transformOrigin: "left center",
        });
        const pillWidth = c.label.length * fontSize * 0.6 + fontSize * 1.4;
        const r = c.rect ? { x: c.rect.x * cardWidth, y: c.rect.y * cardWidth - offset, w: c.rect.w * cardWidth, h: c.rect.h * cardWidth } : null;
        // An element that would land outside the card (far down a long page) is treated as having no position.
        const visible = r && r.y > pad && r.y + r.h < cardHeight - pad;
        if (!r || !visible) {
          // No pointer: stack these labels up from the card's bottom-left corner.
          setStyle(pill, { left: `${16 * u}px`, bottom: `${16 * u + unplaced * (pillHeight + 10 * u)}px` });
          unplaced++;
          card.appendChild(pill);
          return { ring: null, pill };
        }
        const ring = el("div", "fc-ring");
        setStyle(ring, {
          position: "absolute",
          boxSizing: "border-box",
          left: `${r.x - pad}px`,
          top: `${r.y - pad}px`,
          width: `${r.w + 2 * pad}px`,
          height: `${r.h + 2 * pad}px`,
          border: `${4 * u}px solid ${ctx.palette.accent}`,
          borderRadius: `${14 * u}px`,
          boxShadow: `0 0 0 ${6 * u}px ${ctx.palette.accentSoft}, 0 0 ${36 * u}px ${ctx.palette.glow}`,
          opacity: "0",
        });
        card.appendChild(ring);
        // The label sits just above its outline (below, when there is no room), kept inside the card; alternate sides so neighbours don't collide.
        const above = r.y - pad - pillHeight - 8 * u;
        const top = above > 6 * u ? above : Math.min(cardHeight - pillHeight - 6 * u, r.y + r.h + pad + 8 * u);
        const left = Math.max(8 * u, Math.min(cardWidth - pillWidth - 8 * u, i % 2 === 0 ? r.x - pad : r.x + r.w + pad - pillWidth));
        setStyle(pill, { left: `${left}px`, top: `${top}px` });
        card.appendChild(pill);
        return { ring, pill };
      });

      root.appendChild(card);
      root.appendChild(caption.wrap);
      instance = { card, dim, pins, words: caption.words, cues: props.cues, u };
    },

    seek(localT) {
      if (!instance) return;
      const { card, dim, pins, cues, u } = instance;
      enter(card, localT, 0, CARD_ENTER, { y: 80 * u, scale: 0.9 });
      wordsIn(instance.words, localT, CAPTION_START, WORD_EACH, WORD_DUR);
      dim.style.opacity = String(0.28 * progress(localT, PIN_FIRST - 0.3, PIN_FIRST + 0.2, easeOutCubic));
      pins.forEach((pin, i) => {
        const start = pinStart(i, cues);
        if (pin.ring) {
          const p = progress(localT, start, start + 0.4, easeOutCubic);
          pin.ring.style.opacity = String(p);
          pin.ring.style.transform = p >= 1 ? "none" : `scale(${(1.15 - 0.15 * p).toFixed(4)})`;
        }
        const pp = clamp01((localT - start - 0.12) / 0.35);
        pin.pill.style.opacity = String(clamp01(pp * 2.5));
        pin.pill.style.transform = pp >= 1 ? "none" : `scale(${(0.6 + 0.4 * easeOutCubic(pp)).toFixed(4)})`;
      });
    },

    marks(props): Mark[] {
      const last = pinStart(Math.max(0, Math.min(3, props.callouts?.length ?? 0) - 1), props.cues) + 0.5;
      return [
        { t: 0, type: "start" },
        { t: Math.max(last, wordsSettle(countWords(props.caption), CAPTION_START, WORD_EACH, WORD_DUR)), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
