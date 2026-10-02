import type { AspectFormat, Storyboard } from "@sitereel/shared";
import { FORMAT_DIMENSIONS } from "@/lib/formats";

/**
 * Client-side Storyboard → FilmManifest for the editor's live preview.
 *
 * The real resolver is the worker's Build stage (apps/worker/src/stages/build.ts),
 * which needs crawl output + measured audio + beat grids we don't have in the
 * browser. This mirrors its shape closely enough to preview *edits* instantly:
 * same templates (the same film-bundle.js runs in the iframe), slots sized from
 * the larger of the planner estimate and the voiced line, the same 0.4 s
 * crossfades, and narration captions. Screenshots are swapped for labelled
 * placeholders (storage keys aren't browser-fetchable before Render resolves them).
 *
 * The manifest type is declared locally (structurally identical to
 * film-runtime's FilmManifest) because the web app may only import *types* from
 * workspace packages and film-runtime isn't a web dependency.
 */
export interface PreviewScene {
  id: string;
  templateId: string;
  start: number;
  end: number;
  props: Record<string, unknown>;
  transitionInSec?: number;
  transition?: "fade" | "slide-left" | "slide-up" | "zoom" | "cut" | "push" | "wipe" | "whip";
  audioStart?: number;
}

export interface PreviewManifest {
  width: number;
  height: number;
  fps: 30;
  duration: number;
  palette: { bg: string; fg: string; accent: string };
  fonts: { display: string; body: string };
  scenes: PreviewScene[];
  captions: { t0: number; t1: number; text: string }[];
  /** Brand font stylesheets the player links before mounting (the render embeds the same families). */
  fontCssUrls?: string[];
  /** Style pack id — the storyboard's tone, as in the render. */
  style?: string;
}

export interface PreviewBrand {
  bg: string;
  fg: string;
  accent: string;
  fontDisplay?: string;
  fontBody?: string;
  logoUrl?: string | null;
}

export const TRANSITION_SEC = 0.4;
/** Narration starts a beat after the cut, like the timing engine's lead-in. */
export const AUDIO_LEAD_SEC = 0.15;
const SAFE_FONT_STACK = "system-ui, -apple-system, Segoe UI, sans-serif";

export const DEFAULT_PREVIEW_BRAND: PreviewBrand = { bg: "#101014", fg: "#f4f4f6", accent: "#8b5cf6" };

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** Labelled placeholder used where the render will show a crawled screenshot. */
export function screenshotPlaceholder(label: string, brand: PreviewBrand): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900"><rect width="1440" height="900" fill="${escapeXml(brand.bg)}"/><rect x="0" y="0" width="1440" height="64" fill="${escapeXml(brand.fg)}" fill-opacity="0.08"/><circle cx="40" cy="32" r="9" fill="${escapeXml(brand.accent)}"/><rect x="120" y="180" width="760" height="56" rx="10" fill="${escapeXml(brand.fg)}" fill-opacity="0.85"/><rect x="120" y="270" width="560" height="28" rx="8" fill="${escapeXml(brand.fg)}" fill-opacity="0.35"/><rect x="120" y="340" width="220" height="64" rx="32" fill="${escapeXml(brand.accent)}"/><rect x="120" y="500" width="380" height="260" rx="18" fill="${escapeXml(brand.fg)}" fill-opacity="0.08"/><rect x="530" y="500" width="380" height="260" rx="18" fill="${escapeXml(brand.fg)}" fill-opacity="0.08"/><rect x="940" y="500" width="380" height="260" rx="18" fill="${escapeXml(brand.fg)}" fill-opacity="0.08"/><text x="1320" y="860" text-anchor="end" font-family="system-ui,sans-serif" font-size="28" fill="${escapeXml(brand.fg)}" fill-opacity="0.5">Screenshot of ${escapeXml(label)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function pageLabel(url: unknown): string {
  if (typeof url !== "string" || !url) return "your site";
  try {
    const u = new URL(url);
    return u.pathname && u.pathname !== "/" ? u.pathname : u.hostname;
  } catch {
    return url;
  }
}

export function previewProps(templateId: string, props: Record<string, unknown>, brand: PreviewBrand): Record<string, unknown> {
  if (templateId === "SectionShowcase" || templateId === "UIFlowCursor") {
    const { sourcePageUrl, ...rest } = props;
    const existing = typeof props.screenshotUrl === "string" && /^(https?:|data:)/.test(props.screenshotUrl) ? props.screenshotUrl : null;
    return { ...rest, screenshotUrl: existing ?? screenshotPlaceholder(pageLabel(sourcePageUrl), brand) };
  }
  if (templateId === "ScreenCollage") {
    const { sourcePageUrl, ...rest } = props;
    const placeholder = screenshotPlaceholder(pageLabel(sourcePageUrl), brand);
    return { ...rest, screenshotUrls: [placeholder, placeholder, placeholder] };
  }
  if ((templateId === "KineticHook" || templateId === "CTAEndCard" || templateId === "LogoReveal") && brand.logoUrl) {
    return { ...props, logoUrl: brand.logoUrl };
  }
  return props;
}

/** Slot length per scene: the planner's estimate, stretched to fit the voiced line when there is one. */
export function sceneSlots(storyboard: Storyboard, audioMsBySceneId: ReadonlyMap<string, number>): { id: string; start: number; duration: number }[] {
  let t = 0;
  return storyboard.scenes.map((scene) => {
    const voiced = audioMsBySceneId.get(scene.id);
    const duration = Math.max(scene.durationSec, voiced ? voiced / 1000 + AUDIO_LEAD_SEC + 0.35 : 0);
    const slot = { id: scene.id, start: round3(t), duration: round3(duration) };
    t += duration;
    return slot;
  });
}

/** One Google Fonts css2 URL covering the brand's families (crawl maps brand fonts onto Google Fonts names). */
export function googleFontsCssUrl(families: string[]): string {
  const unique = [...new Set(families.map((f) => f.trim()).filter(Boolean))];
  return `https://fonts.googleapis.com/css2?${unique.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;500;600;700;800`).join("&")}&display=swap`;
}

export function buildPreviewManifest(
  storyboard: Storyboard,
  opts: { format: AspectFormat; brand?: PreviewBrand; audio?: { sceneId: string; durationMs: number }[] },
): PreviewManifest {
  const brand = opts.brand ?? DEFAULT_PREVIEW_BRAND;
  const { width, height } = FORMAT_DIMENSIONS[opts.format];
  const audioMs = new Map((opts.audio ?? []).map((a) => [a.sceneId, a.durationMs]));
  const slots = sceneSlots(storyboard, audioMs);
  const last = slots.at(-1);
  const duration = last ? round3(last.start + last.duration) : 0;
  const n = storyboard.scenes.length;

  const scenes: PreviewScene[] = storyboard.scenes.map((scene, i) => {
    const slot = slots[i]!;
    // Crossfade: each scene after the first fades in over the tail of the previous one,
    // which stays mounted TRANSITION_SEC past its slot (as in the timing engine).
    return {
      id: scene.id,
      templateId: scene.templateId,
      start: slot.start,
      end: round3(Math.min(duration, slot.start + slot.duration + (i < n - 1 ? TRANSITION_SEC : 0))),
      transitionInSec: i > 0 ? TRANSITION_SEC : 0,
      ...(i > 0 && scene.transition ? { transition: scene.transition } : {}),
      audioStart: round3(slot.start + AUDIO_LEAD_SEC),
      props: previewProps(scene.templateId, scene.props, brand),
    };
  });

  const captions = storyboard.scenes.flatMap((scene, i) => {
    const slot = slots[i]!;
    const text = (scene.narration ?? scene.onScreenText.join(" ")).trim();
    return text ? [{ t0: slot.start, t1: round3(slot.start + slot.duration), text }] : [];
  });

  return {
    width,
    height,
    fps: 30,
    duration,
    palette: { bg: brand.bg, fg: brand.fg, accent: brand.accent },
    fonts: {
      display: `${brand.fontDisplay ?? "Inter"}, ${SAFE_FONT_STACK}`,
      body: `${brand.fontBody ?? "Inter"}, ${SAFE_FONT_STACK}`,
    },
    scenes,
    captions,
    style: storyboard.tone,
    fontCssUrls: [googleFontsCssUrl([brand.fontDisplay ?? "Inter", brand.fontBody ?? "Inter"])],
  };
}

/** Index of the scene whose slot contains `t` (last scene for t ≥ duration). */
export function sceneIndexAt(slots: { start: number; duration: number }[], t: number): number {
  for (let i = slots.length - 1; i >= 0; i--) if (t >= slots[i]!.start) return i;
  return 0;
}

export function formatTimecode(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}
