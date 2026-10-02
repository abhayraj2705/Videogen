import { computeTimeline, createTemplate, expandBeatGrid, type Caption, type FilmManifest, type ResolvedScene } from "@sitereel/film-runtime";
import { FORMAT_DIMENSIONS, type AspectFormat, type CrawlOutput, type Storyboard } from "@sitereel/shared";
import { assetRef } from "../lib/asset-ref.js";
import { phraseCues } from "../lib/vtt.js";
import type { MusicTrack } from "../lib/music.js";
import type { VoiceSceneResult } from "./voice.js";

const SAFE_FONT_STACK = "system-ui, -apple-system, Segoe UI, sans-serif";

/** Crossfade between scenes (timing engine). 0.4s reads as a deliberate dissolve without slowing the edit. */
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

/** Resolves a scene's props for its template, swapping sourcePageUrl references for real asset refs. */
function resolveProps(templateId: string, props: Record<string, unknown>, crawlOutput: CrawlOutput): Record<string, unknown> {
  if (templateId === "SectionShowcase" || templateId === "UIFlowCursor") {
    const sourcePageUrl = props.sourcePageUrl as string | undefined;
    const page = crawlOutput.pages.find((p) => p.url === sourcePageUrl) ?? crawlOutput.pages[0];
    const { sourcePageUrl: _drop, section, ...rest } = props;
    // `section` (1-based) picks one viewport-height slice of the page; anything else shows the scrolling full page.
    const sectionKey = typeof section === "number" ? page?.sectionScreenshotKeys?.[section - 1] : undefined;
    const key = sectionKey ?? page?.screenshotKey;
    return { ...rest, screenshotUrl: key ? assetRef("assets", key) : "", ...(page ? { pageLabel: pageLabel(page.url) } : {}) };
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
      transitionSec: opts.transitionSec ?? TRANSITION_SEC,
      beatGrid: opts.music?.beatGrid ?? null,
      loopSec: opts.music?.loopSec ?? null,
    },
  );

  const scenes: ResolvedScene[] = storyboard.scenes.map((scene, i) => {
    const slot = timeline.scenes[i]!;
    return {
      id: scene.id,
      templateId: scene.templateId,
      start: slot.start,
      end: slot.end,
      transitionInSec: slot.transitionInSec,
      ...(i > 0 && scene.transition ? { transition: scene.transition } : {}),
      audioStart: slot.audioStart,
      props: resolveProps(scene.templateId, scene.props, crawlOutput),
    };
  });

  // Phrase-level captions from word timings; scenes without narration fall
  // back to their on-screen text across the slot (silent videos still get captions).
  const captions: Caption[] = storyboard.scenes.flatMap((scene, i) => {
    const slot = timeline.scenes[i]!;
    const voice = voiceBySceneId.get(scene.id);
    if (voice?.audioKey && voice.words.length > 0) {
      return phraseCues(voice.words.map((w) => ({ word: w.word, startSec: slot.audioStart + w.startSec, endSec: slot.audioStart + w.endSec })));
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
    palette: { bg: crawlOutput.brand.bg, fg: crawlOutput.brand.fg, accent: crawlOutput.brand.accent },
    fonts: { display: withFallback(crawlOutput.brand.fontDisplay), body: withFallback(crawlOutput.brand.fontBody) },
    scenes,
    captions,
    posterTime,
    // Captions that only repeat on-screen text (silent films) stay in the .vtt.
    ...((opts.burnCaptions ?? hasNarration) ? { captionStyle: "burned" as const } : {}),
    ...(beats.length > 0 ? { beats } : {}),
  };
}
