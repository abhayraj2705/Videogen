import type { FilmManifest, ResolvedScene } from "@sitereel/film-runtime";
import { FORMAT_DIMENSIONS, type AspectFormat, type CrawlOutput, type Storyboard } from "@sitereel/shared";
import { assetRef } from "../lib/asset-ref.js";
import type { VoiceSceneResult } from "./voice.js";

const SAFE_FONT_STACK = "system-ui, -apple-system, Segoe UI, sans-serif";

function withFallback(font: string): string {
  return `${font}, ${SAFE_FONT_STACK}`;
}

/** Resolves a scene's props for its template, swapping sourcePageUrl references for real asset refs. */
function resolveProps(templateId: string, props: Record<string, unknown>, crawlOutput: CrawlOutput): Record<string, unknown> {
  if (templateId === "SectionShowcase" || templateId === "UIFlowCursor") {
    const sourcePageUrl = props.sourcePageUrl as string | undefined;
    const page = crawlOutput.pages.find((p) => p.url === sourcePageUrl) ?? crawlOutput.pages[0];
    const { sourcePageUrl: _drop, ...rest } = props;
    return { ...rest, screenshotUrl: page ? assetRef("assets", page.screenshotKey) : "" };
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
 * width/height change, every template is already written relative to
 * ctx.width/ctx.height so no per-format scene logic is needed.
 */
export function buildFilmManifest(opts: {
  storyboard: Storyboard;
  crawlOutput: CrawlOutput;
  voiceScenes: VoiceSceneResult[];
  format: AspectFormat;
}): FilmManifest {
  const { storyboard, crawlOutput, voiceScenes, format } = opts;
  const { width, height } = FORMAT_DIMENSIONS[format];
  const voiceBySceneId = new Map(voiceScenes.map((v) => [v.sceneId, v]));

  let cursor = 0;
  const scenes: ResolvedScene[] = storyboard.scenes.map((scene) => {
    const voice = voiceBySceneId.get(scene.id);
    const durationSec = voice?.durationSec ?? scene.durationSec;
    const start = cursor;
    const end = cursor + durationSec;
    cursor = end;

    return {
      id: scene.id,
      templateId: scene.templateId,
      start,
      end,
      props: resolveProps(scene.templateId, scene.props, crawlOutput),
    };
  });

  const captions = storyboard.scenes
    .map((scene, i) => {
      const resolved = scenes[i]!;
      const text = scene.narration ?? scene.onScreenText.join(" ");
      return text ? { t0: resolved.start, t1: resolved.end, text } : null;
    })
    .filter((c): c is { t0: number; t1: number; text: string } => c !== null);

  return {
    width,
    height,
    fps: 30,
    duration: cursor,
    palette: { bg: crawlOutput.brand.bg, fg: crawlOutput.brand.fg, accent: crawlOutput.brand.accent },
    fonts: { display: withFallback(crawlOutput.brand.fontDisplay), body: withFallback(crawlOutput.brand.fontBody) },
    scenes,
    captions,
  };
}
