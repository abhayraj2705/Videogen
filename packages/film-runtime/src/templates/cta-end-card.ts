import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { clamp01, easeSpring } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";
import { fitFontSize, layoutFor } from "../util/layout.js";
import { enter, logoMark, sceneRoot, textBlock, wordsIn, wordsSettle } from "../util/ui.js";

export interface CTAEndCardProps {
  /** Grounded product name. */
  productName: string;
  /** Grounded or user-authored CTA line, e.g. "Try it free". */
  ctaText: string;
  /** Grounded domain, shown as the takeaway. */
  domain: string;
  logoUrl?: string;
}

interface Instance {
  logo: HTMLElement;
  words: HTMLElement[];
  button: HTMLElement;
  shine: HTMLElement;
  glow: string;
  buttonStart: number;
  buttonWidth: number;
  u: number;
}

const WORDS_START = 0.2;
const WORD_EACH = 0.07;
const WORD_DUR = 0.5;

const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const buttonStartFor = (words: number) => wordsSettle(words, WORDS_START, WORD_EACH, WORD_DUR) - 0.3;

/**
 * Closing scene (2-4s): logo, the CTA line landing word by word, and the
 * domain as a button that springs in, catches a sweep of light and keeps a
 * slow breathing glow so the last frames still feel alive.
 * Layouts: centered column in all formats; 9:16 scales the logo/CTA up and
 * allows a three-line CTA, 1:1 keeps 16:9 sizes but narrower wrap width.
 */
export function createCTAEndCard(): SceneTemplate<CTAEndCardProps> {
  let instance: Instance | undefined;

  return {
    id: "CTAEndCard",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      sceneRoot(root, L, { gap: `${L.pick({ landscape: 36, portrait: 52, square: 32 }) * u}px`, fontFamily: ctx.fonts.display });

      const logo = logoMark({ className: "cta-logo", size: L.pick({ landscape: 112, portrait: 168, square: 112 }) * u, logoUrl: props.logoUrl, productName: props.productName, ctx });
      root.appendChild(logo);

      const cta = textBlock(props.ctaText, {
        className: "cta-text",
        width: Math.min(L.safe.width, 1440 * u),
        maxSize: L.pick({ landscape: 120, portrait: 128, square: 100 }) * u,
        minSize: 28 * u,
        maxLines: L.pick({ landscape: 2, portrait: 3, square: 2 }),
        color: ctx.palette.fg,
        family: ctx.fonts.display,
        weight: "800",
        lineHeight: 1.08,
        tracking: "-0.035em",
      });
      root.appendChild(cta.wrap);

      // The button never spans more than ~80% of the safe width.
      const padX = L.pick({ landscape: 44, portrait: 52, square: 40 }) * u;
      const arrowSpace = 60 * u;
      const maxButton = L.safe.width * 0.8;
      const domainSize = fitFontSize(props.domain, maxButton - 2 * padX - arrowSpace, L.pick({ landscape: 42, portrait: 50, square: 40 }) * u, 1, 18 * u);
      const button = el("div", "cta-button");
      setStyle(button, {
        position: "relative",
        overflow: "hidden",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: `${18 * u}px`,
        maxWidth: `${maxButton}px`,
        padding: `${L.pick({ landscape: 22, portrait: 28, square: 20 }) * u}px ${padX}px`,
        borderRadius: `${60 * u}px`,
        background: `${ctx.palette.accent} linear-gradient(120deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`,
        flexShrink: "0",
      });
      const domainNode = el("span", "cta-domain", props.domain);
      setStyle(domainNode, { fontSize: `${domainSize}px`, fontWeight: "700", color: ctx.palette.onAccent, letterSpacing: "-0.01em", whiteSpace: "nowrap", fontFamily: ctx.fonts.body });
      button.appendChild(domainNode);
      const arrow = el("span", "cta-arrow", "→");
      setStyle(arrow, { fontSize: `${domainSize}px`, fontWeight: "700", color: ctx.palette.onAccent, lineHeight: "1" });
      button.appendChild(arrow);
      const shine = el("div", "cta-shine");
      setStyle(shine, {
        position: "absolute",
        top: "0",
        bottom: "0",
        left: "0",
        width: `${120 * u}px`,
        background: "linear-gradient(100deg, transparent, rgba(255,255,255,0.45), transparent)",
        opacity: "0",
      });
      button.appendChild(shine);
      root.appendChild(button);

      instance = { logo, words: cta.words, button, shine, glow: ctx.palette.glow, buttonStart: buttonStartFor(cta.words.length), buttonWidth: maxButton, u };
    },

    seek(localT) {
      if (!instance) return;
      const { u, buttonStart } = instance;
      enter(instance.logo, localT, 0, 0.6, { scale: 0.4, rotate: -12, ease: easeSpring });
      wordsIn(instance.words, localT, WORDS_START, WORD_EACH, WORD_DUR);

      enter(instance.button, localT, buttonStart, 0.7, { y: 50 * u, scale: 0.8, ease: easeSpring });
      // Slow breathing glow once the button has landed. The glow pulses rather than the button's
      // scale, so its text stays put (and its transform rests on `none`).
      const breath = Math.sin(Math.max(0, localT - buttonStart - 0.75) * 3.2) ** 2;
      instance.button.style.boxShadow = `0 ${(22 * u).toFixed(2)}px ${((50 + 40 * breath) * u).toFixed(2)}px -${((18 - 10 * breath) * u).toFixed(2)}px ${instance.glow}`;

      const sweep = clamp01((localT - buttonStart - 0.5) / 0.7);
      instance.shine.style.opacity = sweep > 0 && sweep < 1 ? "1" : "0";
      instance.shine.style.transform = `translateX(${(-140 * u + sweep * (instance.buttonWidth + 280 * u)).toFixed(2)}px) skewX(-18deg)`;
    },

    marks(props): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: Math.max(0.8, buttonStartFor(countWords(props.ctaText)) + 0.72), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
