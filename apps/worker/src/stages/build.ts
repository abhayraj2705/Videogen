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
import { FORMAT_DIMENSIONS, FULLPAGE_CAPTURE_DEPTH, type AspectFormat, type CrawlOutput, type FactRect, type Storyboard } from "@sitereel/shared";
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
  if ((templateId === "ChecklistReveal" || templateId === "BentoGrid" || templateId === "FeatureCallouts") && Array.isArray(props.items)) return (props.items as unknown[]).map(String);
  if (templateId === "MetricsRow" && Array.isArray(props.metrics)) return (props.metrics as { label?: unknown }[]).map((m) => String(m.label ?? ""));
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

/** Where to point the camera on a page: the first cited fact measured on that page and inside the captured screenshot. */
function focusRectFor(factIds: string[], crawlOutput: CrawlOutput, pageUrl: string): FactRect | undefined {
  for (const id of factIds) {
    const fact = crawlOutput.facts.find((f) => f.id === id);
    const r = fact?.rect;
    if (r && fact.sourceUrl === pageUrl && r.x >= 0 && r.x + r.w <= 1.001 && r.y + r.h <= FULLPAGE_CAPTURE_DEPTH) return r;
  }
  // An uploaded image's regions were picked by the vision read as "worth a close-up": when the scene
  // cites only the upload's caption, the first of them is still the right place to look.
  if (crawlOutput.pages.find((p) => p.url === pageUrl)?.origin === "upload") {
    return crawlOutput.facts.find((f) => f.sourceUrl === pageUrl && f.rect)?.rect;
  }
  return undefined;
}

/** All the distinct places the cited facts point at on a page, top to bottom — the stops of a camera tour. */
function focusStopsFor(factIds: string[], crawlOutput: CrawlOutput, pageUrl: string): FactRect[] {
  const stops: FactRect[] = [];
  for (const id of factIds) {
    const r = focusRectFor([id], { ...crawlOutput, pages: [] }, pageUrl);
    // Skip a region that overlaps one already on the tour: moving a few pixels is not a new shot.
    if (r && !stops.some((s) => Math.abs(s.y - r.y) < 0.12 && Math.abs(s.x - r.x) < 0.25)) stops.push(r);
  }
  return stops.sort((a, b) => a.y - b.y).slice(0, 3);
}

/**
 * When to stress a scene's emphasis words (seconds from the scene start): as
 * the voice says one of them, or — when the narration never does, or there is
 * no voice — just after the scene's text has landed.
 */
function emphasisMoment(scene: Storyboard["scenes"][number], voice: VoiceSceneResult | undefined, audioOffsetSec: number, sceneDurationSec: number): number {
  const wanted = new Set((scene.emphasis ?? []).flatMap(spokenWords));
  const spoken = voice?.audioKey ? voice.words.find((w) => wanted.has(spokenWords(w.word)[0] ?? "")) : undefined;
  let at: number;
  if (spoken) at = audioOffsetSec + spoken.startSec;
  else {
    let settle = 1;
    try {
      settle = createTemplate(scene.templateId).marks(scene.props).find((m) => m.type === "settle")?.t ?? 1;
    } catch {
      settle = 1;
    }
    at = settle + 0.15;
  }
  return Math.round(Math.max(0.3, Math.min(at, sceneDurationSec - 0.8)) * 1000) / 1000;
}

/** Resolves a scene's props for its template, swapping sourcePageUrl references for real asset refs. */
function resolveProps(templateId: string, props: Record<string, unknown>, crawlOutput: CrawlOutput, factIds: string[] = []): Record<string, unknown> {
  if (templateId === "FeatureCallouts") {
    const page = crawlOutput.pages.find((p) => p.url === props.sourcePageUrl) ?? crawlOutput.pages[0];
    const { sourcePageUrl: _drop, items, ...rest } = props;
    // items[i] labels the i-th cited fact; it gets a pointer when that fact has a place on this page's screenshot.
    const callouts = (Array.isArray(items) ? items : []).map((label, i) => {
      const rect = page && factIds[i] ? focusRectFor([factIds[i]!], { ...crawlOutput, pages: [] }, page.url) : undefined;
      return { label: String(label), ...(rect ? { rect } : {}) };
    });
    return { ...rest, callouts, screenshotUrl: page?.screenshotKey ? assetRef("assets", page.screenshotKey) : "" };
  }
  if (templateId === "PhotoShowcase") {
    const page = crawlOutput.pages.find((p) => p.url === props.sourcePageUrl) ?? crawlOutput.pages[0];
    const { sourcePageUrl: _drop, ...rest } = props;
    // A crawled page is shown by its first screenful (sharp, and composed like a hero image); an upload as it is.
    const key = page?.origin === "upload" ? page.screenshotKey : (page?.sectionScreenshotKeys?.[0] ?? page?.screenshotKey);
    return { ...rest, screenshotUrl: key ? assetRef("assets", key) : "" };
  }
  if (templateId === "Montage") {
    // Cut through the product: the user's own uploads first, then the top of every crawled page, then further sections.
    const shot = crawlOutput.pages.filter((p) => p.screenshotKey);
    const tops = shot.map((p) => (p.origin === "upload" ? p.screenshotKey : (p.sectionScreenshotKeys?.[0] ?? p.screenshotKey)));
    const deeper = shot.flatMap((p) => (p.origin === "upload" ? [] : (p.sectionScreenshotKeys ?? []).slice(1)));
    const ordered = [...shot.filter((p) => p.origin === "upload").map((p) => p.screenshotKey), ...tops, ...deeper];
    const keys = ordered.filter((k, i) => ordered.indexOf(k) === i).slice(0, 6);
    return { ...props, screenshotUrls: keys.map((k) => assetRef("assets", k)) };
  }
  if (templateId === "StepByStep") {
    const page = crawlOutput.pages.find((p) => p.url === props.sourcePageUrl) ?? crawlOutput.pages[0];
    const { sourcePageUrl: _drop, ...rest } = props;
    const focus = page ? focusRectFor(factIds, crawlOutput, page.url) : undefined;
    return { ...rest, screenshotUrl: page?.screenshotKey ? assetRef("assets", page.screenshotKey) : "", ...(page ? { pageLabel: pageLabel(page.url) } : {}), ...(focus ? { focus } : {}) };
  }
  if (templateId === "DeviceMockup" || templateId === "ZoomDetail") {
    const page = crawlOutput.pages.find((p) => p.url === props.sourcePageUrl) ?? crawlOutput.pages[0];
    const { sourcePageUrl: _drop, ...rest } = props;
    const focus = templateId === "ZoomDetail" && page ? focusRectFor(factIds, crawlOutput, page.url) : undefined;
    return {
      ...rest,
      screenshotUrl: page?.screenshotKey ? assetRef("assets", page.screenshotKey) : "",
      ...(templateId === "ZoomDetail" && page ? { pageLabel: pageLabel(page.url) } : {}),
      ...(focus ? { focus } : {}),
    };
  }
  if (templateId === "SectionShowcase" || templateId === "UIFlowCursor") {
    const sourcePageUrl = props.sourcePageUrl as string | undefined;
    const page = crawlOutput.pages.find((p) => p.url === sourcePageUrl) ?? crawlOutput.pages[0];
    const { sourcePageUrl: _drop, section, ...rest } = props;
    // `section` (1-based) picks one viewport-height slice of the page; anything else shows the scrolling full page.
    const sectionKey = typeof section === "number" ? page?.sectionScreenshotKeys?.[section - 1] : undefined;
    const key = sectionKey ?? page?.screenshotKey;
    // Full-page shots only: the first cited fact that was measured on this page tells the window where to zoom.
    const focus = !sectionKey && page && templateId === "SectionShowcase" ? focusRectFor(factIds, crawlOutput, page.url) : undefined;
    // The pointer clicks real things: what the scene cites, then the page's own buttons — whatever sits in the first screenful.
    const inFirstScreen = (r: FactRect | undefined): r is FactRect => !!r && r.x >= 0 && r.x + r.w <= 1.001 && r.y + r.h <= 0.5;
    const targets =
      !sectionKey && page && templateId === "UIFlowCursor"
        ? [...factIds.map((id) => crawlOutput.facts.find((f) => f.id === id)), ...crawlOutput.facts.filter((f) => f.kind === "cta")]
            .filter((f) => f?.sourceUrl === page.url)
            .map((f) => f?.rect)
            .filter(inFirstScreen)
            .filter((r, i, all) => all.findIndex((o) => Math.abs(o.x - r.x) < 0.05 && Math.abs(o.y - r.y) < 0.03) === i)
            .slice(0, 2)
        : [];
    // Every further cited fact measured on this page is another stop for the camera (up to three).
    const stops = !sectionKey && page && templateId === "SectionShowcase" ? focusStopsFor(factIds, crawlOutput, page.url) : [];
    return {
      ...rest,
      screenshotUrl: key ? assetRef("assets", key) : "",
      ...(page ? { pageLabel: pageLabel(page.url) } : {}),
      ...(focus ? { focus } : {}),
      ...(stops.length > 1 ? { focusStops: stops } : {}),
      ...(targets.length > 0 ? { cursorTargets: targets } : {}),
    };
  }
  if (templateId === "ScreenCollage" || templateId === "IsoStack") {
    const page = crawlOutput.pages.find((p) => p.url === props.sourcePageUrl) ?? crawlOutput.pages[0];
    const { sourcePageUrl: _drop, ...rest } = props;
    // Viewport-sized section captures make the cards; a page with fewer than two falls back to its full-page shot.
    const sections = page?.sectionScreenshotKeys ?? [];
    let keys = sections.length >= 2 ? sections.slice(0, 3) : page?.screenshotKey ? [page.screenshotKey] : [];
    // A collage of an upload shows it with its neighbouring uploads rather than one image alone.
    if (page?.origin === "upload") {
      const uploads = crawlOutput.pages.filter((p) => p.origin === "upload" && p.screenshotKey);
      const at = uploads.indexOf(page);
      keys = [page, ...uploads.slice(at + 1), ...uploads.slice(0, at)].slice(0, 3).map((p) => p.screenshotKey);
    }
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
      // The next line starts just before its picture arrives.
      audioLeadSec: 0.2,
      // Our own tracks are written in 4/4 from beat 0; a licensed track's detected grid has no known bar phase.
      ...(opts.music?.source === "procedural" ? { beatsPerBar: 4 } : {}),
    },
  );

  const scenes: ResolvedScene[] = storyboard.scenes.map((scene, i) => {
    const slot = timeline.scenes[i]!;
    const items = listItems(scene.templateId, scene.props);
    const voice = voiceBySceneId.get(scene.id);
    const cues = items && voice?.audioKey ? listCues(items, voice.words, slot.audioStart - slot.start, slot.end - slot.start) : null;
    const emphasis = scene.emphasis?.length ? { words: scene.emphasis, at: emphasisMoment(scene, voice, slot.audioStart - slot.start, slot.end - slot.start) } : null;
    return {
      id: scene.id,
      templateId: scene.templateId,
      start: slot.start,
      end: slot.end,
      transitionInSec: slot.transitionInSec,
      ...(i > 0 ? { transition: transitions[i]! } : {}),
      audioStart: slot.audioStart,
      ...(emphasis ? { emphasis } : {}),
      props: {
        ...resolveProps(scene.templateId, scene.props, crawlOutput, scene.factIds),
        ...(cues ? { cues } : {}),
        // Every walkthrough step shows how many steps there are.
        ...(scene.templateId === "StepByStep" ? { total: storyboard.scenes.filter((s) => s.templateId === "StepByStep").length } : {}),
      },
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
