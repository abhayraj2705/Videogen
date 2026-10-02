import {
  computeTimeline,
  createTemplate,
  expandBeatGrid,
  resolveTransition,
  stylePackFor,
  TRANSITION_DURATION,
  type Caption,
  type FilmManifest,
  type ResolvedScene,
} from "@sitereel/film-runtime";
import { FORMAT_DIMENSIONS, type AspectFormat, type CrawlOutput, type Storyboard } from "@sitereel/shared";
import { assetRef } from "../lib/asset-ref.js";
import { phraseCues } from "../lib/vtt.js";
import type { MusicTrack } from "../lib/music.js";
import type { VoiceSceneResult } from "./voice.js";

const SAFE_FONT_STACK = "system-ui, -apple-system, Segoe UI, sans-serif";

/** Crossfade between scenes when a caller forces one length for every cut; by default each cut takes its kind's own length (TRANSITION_DURATION). */
export const TRANSITION_SEC = 0.4;

function withFallback(font: string): string {
  return `${font}, ${SAFE_FONT_STACK}`;
}

/** "https://www.acme.com/pricing/" -> "acme.com/pricing": the address shown in a screenshot scene's browser toolbar. */
export function pageLabel(url: string): string {
  try {
    const u = new URL(url);
    const label = `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`;
    return label.length > 44 ? `${label.slice(0, 43)}…` : label;
  } catch {
    return "";
  }
}

const spokenWords = (text: string): string[] => text.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, "").split(/\s+/).filter(Boolean);

function propStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(propStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(propStrings);
  return [];
}

/** True when every word of the scene's narration is already drawn by the scene itself (titles, labels, product name). */
function repeatsScreenText(scene: Storyboard["scenes"][number]): boolean {
  const spoken = spokenWords(scene.narration ?? "");
  if (spoken.length === 0) return false;
  const shown = new Set([...scene.onScreenText, ...propStrings(scene.props)].flatMap(spokenWords));
  return spoken.every((w) => shown.has(w));
}

/** The list a template reveals item by item, if it has one. */
function listItems(templateId: string, props: Record<string, unknown>): string[] | null {
  if (templateId === "FeatureTriplet" && Array.isArray(props.features)) return (props.features as { label?: unknown }[]).map((f) => String(f.label ?? ""));
  if ((templateId === "ChecklistReveal" || templateId === "BentoGrid") && Array.isArray(props.items)) return (props.items as unknown[]).map(String);
  return null;
}

/**
 * When each list item is spoken, in seconds from the scene's start — so cards
 * land on the voice instead of a fixed stagger. An item's cue is the first
 * narration word (after the previous item's) that it shares; if the narration
 * doesn't name the items, the spoken span is split evenly. Null when there is
 * no usable voice track or the cues would leave the last item under a second on screen.
 */
export function listCues(items: string[], words: { word: string; startSec: number; endSec: number }[], audioOffsetSec: number, sceneDurationSec: number): number[] | null {
  if (items.length === 0 || words.length === 0) return null;
  const spoken = words.map((w) => spokenWords(w.word)[0] ?? "");
  let pointer = 0;
  const matched: number[] = [];
  for (const item of items) {
    const tokens = new Set(spokenWords(item).filter((t) => t.length >= 3));
    const idx = spoken.findIndex((w, i) => i >= pointer && tokens.has(w));
    if (idx < 0) break;
    matched.push(words[idx]!.startSec);
    pointer = idx + 1;
  }
  const first = words[0]!.startSec;
  const span = words[words.length - 1]!.endSec - first;
  const starts = matched.length === items.length ? matched : items.map((_, i) => first + (span * i) / items.length);
  const cues = starts.map((s) => Math.round((audioOffsetSec + s) * 1000) / 1000);
  return cues[cues.length - 1]! <= sceneDurationSec - 1 ? cues : null;
}

/** Resolves a scene's props for its template, swapping sourcePageUrl references for real asset refs. */
function resolveProps(templateId: string, props: Record<string, unknown>, crawlOutput: CrawlOutput, factIds: string[] = []): Record<string, unknown> {
  if (templateId === "SectionShowcase" || templateId === "UIFlowCursor") {
    const sourcePageUrl = props.sourcePageUrl as string | undefined;
    const page = crawlOutput.pages.find((p) => p.url === sourcePageUrl) ?? crawlOutput.pages[0];
    const { sourcePageUrl: _drop, section, ...rest } = props;
    // `section` (1-based) picks one viewport-height slice of the page; anything else shows the scrolling full page.
    const sectionKey = typeof section === "number" ? page?.sectionScreenshotKeys?.[section - 1] : undefined;
    const key = sectionKey ?? page?.screenshotKey;
    // Full-page shots only: the first cited fact that was measured on this page tells the window where to zoom.
    const focus =
      !sectionKey && page && templateId === "SectionShowcase"
        ? factIds.map((id) => crawlOutput.facts.find((f) => f.id === id)).find((f) => f?.rect && f.sourceUrl === page.url)?.rect
        : undefined;
    return { ...rest, screenshotUrl: key ? assetRef("assets", key) : "", ...(page ? { pageLabel: pageLabel(page.url) } : {}), ...(focus ? { focus } : {}) };
  }
  if (templateId === "ScreenCollage") {
    const page = crawlOutput.pages.find((p) => p.url === props.sourcePageUrl) ?? crawlOutput.pages[0];
    const { sourcePageUrl: _drop, ...rest } = props;
    // Viewport-sized section captures make the cards; a page with fewer than two falls back to its full-page shot.
    const sections = page?.sectionScreenshotKeys ?? [];
    const keys = sections.length >= 2 ? sections.slice(0, 3) : page?.screenshotKey ? [page.screenshotKey] : [];
    return { ...rest, screenshotUrls: keys.map((k) => assetRef("assets", k)) };
  }
  if (templateId === "KineticHook" || templateId === "CTAEndCard" || templateId === "LogoReveal") {
    // brand.logoUrl is already a fully-qualified URL on the crawled site itself
    // (not a storage asset) — pass it straight through, no asset:// wrapping.
    return crawlOutput.brand.logoUrl ? { ...props, logoUrl: crawlOutput.brand.logoUrl } : props;
  }
  return props;
}

/**
 * §4.6 "Build": resolves a validated Storyboard + its voice results into a
 * FilmManifest — the exact contract packages/film-runtime's player and
 * packages/renderer's capture loop both consume (§2.2 decision: preview and
 * final render run identical code). One manifest per requested format; only
 * width/height change, every template lays itself out per orientation.
 *
 * Timing comes from the timing engine (film-runtime timing.ts): scene slots
 * sized from the measured narration, cuts snapped to the music's beat grid
 * when music is on, and crossfade overlaps the player renders. Captions are
 * phrase-level cues from the narration's word timings. Pure function — QA and
 * Render call it again independently and get the identical manifest.
 */
export function buildFilmManifest(opts: {
  storyboard: Storyboard;
  crawlOutput: CrawlOutput;
  voiceScenes: VoiceSceneResult[];
  format: AspectFormat;
  music?: MusicTrack | null;
  transitionSec?: number;
  /** Draw word-synced captions into the picture. Default: on whenever the film has narration. */
  burnCaptions?: boolean;
}): FilmManifest {
  const { storyboard, crawlOutput, voiceScenes, format } = opts;
  const { width, height } = FORMAT_DIMENSIONS[format];
  const voiceBySceneId = new Map(voiceScenes.map((v) => [v.sceneId, v]));

  // The cut into each scene: its own choice, else the style pack's cycle. Decided here (not in
  // the player) because the timing engine sizes each overlap from the kind of cut.
  const style = stylePackFor(storyboard.tone);
  const transitions = storyboard.scenes.map((scene, i) => resolveTransition(style, i, scene.transition));

  const timeline = computeTimeline(
    storyboard.scenes.map((scene) => {
      const voice = voiceBySceneId.get(scene.id);
      return {
        id: scene.id,
        minDurationSec: scene.durationSec,
        voiceDurationSec: voice?.audioKey ? (voice.audioDurationSec ?? Math.max(0, voice.durationSec - 0.5)) : null,
      };
    }),
    {
      fps: 30,
      ...(opts.transitionSec !== undefined ? { transitionSec: opts.transitionSec } : { transitionSecs: transitions.map((k) => TRANSITION_DURATION[k]) }),
      beatGrid: opts.music?.beatGrid ?? null,
      loopSec: opts.music?.loopSec ?? null,
    },
  );

  const scenes: ResolvedScene[] = storyboard.scenes.map((scene, i) => {
    const slot = timeline.scenes[i]!;
    const items = listItems(scene.templateId, scene.props);
    const voice = voiceBySceneId.get(scene.id);
    const cues = items && voice?.audioKey ? listCues(items, voice.words, slot.audioStart - slot.start, slot.end - slot.start) : null;
    return {
      id: scene.id,
      templateId: scene.templateId,
      start: slot.start,
      end: slot.end,
      transitionInSec: slot.transitionInSec,
      ...(i > 0 ? { transition: transitions[i]! } : {}),
      audioStart: slot.audioStart,
      props: { ...resolveProps(scene.templateId, scene.props, crawlOutput, scene.factIds), ...(cues ? { cues } : {}) },
    };
  });

  // Phrase-level captions from word timings; scenes without narration fall
  // back to their on-screen text across the slot (silent videos still get captions).
  const captions: Caption[] = storyboard.scenes.flatMap((scene, i) => {
    const slot = timeline.scenes[i]!;
    const voice = voiceBySceneId.get(scene.id);
    if (voice?.audioKey && voice.words.length > 0) {
      const cues = phraseCues(voice.words.map((w) => ({ word: w.word, startSec: slot.audioStart + w.startSec, endSec: slot.audioStart + w.endSec })));
      // A line that only reads the scene's own titles aloud would put the same words on screen twice.
      return repeatsScreenText(scene) ? cues.map((c) => ({ ...c, burn: false })) : cues;
    }
    const text = scene.narration ?? scene.onScreenText.join(" ");
    return text ? [{ t0: slot.slotStart, t1: slot.slotEnd, text }] : [];
  });

  // Real speech only: the silent TTS fallback still produces a clip + estimated words, but there is nothing to read along to.
  const hasNarration = voiceScenes.some((v) => v.audioKey && v.words.length > 0 && !v.provider.startsWith("fallback"));
  const beats = opts.music?.beatGrid?.length
    ? expandBeatGrid(opts.music.beatGrid, opts.music.loopSec, timeline.duration).map((b) => Math.round(b * 1000) / 1000)
    : [];

  // Poster = the first scene's settled frame (renderer bakes it into frame 0).
  let posterTime: number | undefined;
  const first = scenes[0];
  if (first) {
    try {
      const settle = createTemplate(first.templateId).marks(first.props).find((m) => m.type === "settle")?.t;
      if (settle !== undefined) posterTime = Math.min(first.start + settle + 0.1, first.end - 0.1);
    } catch {
      posterTime = undefined;
    }
  }

  return {
    width,
    height,
    fps: 30,
    duration: timeline.duration,
    style: style.id,
    palette: { bg: crawlOutput.brand.bg, fg: crawlOutput.brand.fg, accent: crawlOutput.brand.accent },
    fonts: { display: withFallback(crawlOutput.brand.fontDisplay), body: withFallback(crawlOutput.brand.fontBody) },
    scenes,
    captions,
    posterTime,
    // Captions that only repeat on-screen text (silent films) stay in the .vtt.
    ...((opts.burnCaptions ?? (hasNarration && captions.some((c) => c.burn !== false))) ? { captionStyle: "burned" as const } : {}),
    ...(beats.length > 0 ? { beats } : {}),
  };
}
