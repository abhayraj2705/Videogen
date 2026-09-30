import type { CrawlOutput, JobOptions, Storyboard, StoryboardScene } from "@sitereel/shared";
import { wordCount, READING_SECONDS_PER_WORD, MAX_WORDS_ON_SCREEN } from "@sitereel/shared";

function truncateWords(text: string, maxWords = MAX_WORDS_ON_SCREEN): string {
  const words = text.trim().split(/\s+/);
  return words.length <= maxWords ? text.trim() : words.slice(0, maxWords).join(" ");
}

/** Never shorter than the reading floor for its own on-screen text, with a small margin. */
function durationFor(texts: string[], floorSec: number): number {
  const words = texts.reduce((s, t) => s + wordCount(t), 0);
  return Math.max(floorSec, words * READING_SECONDS_PER_WORD + 0.4);
}

/**
 * Deterministic, non-LLM storyboard (§4.6 "Plan": "then deterministic fallback
 * storyboard"). Runs when no LLM provider is configured, or every LLM attempt
 * (including escalation) fails validation — the pipeline must always be able
 * to produce *some* valid, grounded storyboard. Every number/claim it uses is
 * taken directly from a fact's own text, so it can never fail the grounding
 * validator by construction.
 */
export function buildFallbackStoryboard(crawlOutput: CrawlOutput, options: JobOptions): Storyboard {
  const { siteBrief, facts, domain, pages } = crawlOutput;
  const productName = siteBrief.productName;

  const hero = facts.find((f) => f.kind === "hero") ?? facts[0];
  const featureFacts = facts.filter((f) => f.kind === "feature" || f.kind === "heading").slice(0, 3);
  while (featureFacts.length < 3 && facts.length > 0) {
    const filler = facts[featureFacts.length % facts.length]!;
    if (!featureFacts.includes(filler)) featureFacts.push(filler);
    else break;
  }
  const cta = facts.find((f) => f.kind === "cta");
  const showcasePage = pages[1] ?? pages[0];
  // Prefer a fact not already used for the hook/features scenes so the video
  // doesn't repeat itself, but any unused fact is fine — the only hard
  // requirement is that this scene's text and its factIds come from the
  // exact same fact object, never siteBrief's own synthesized strings (which
  // have no single traceable source and can silently mismatch).
  const usedIds = new Set([hero?.id, ...featureFacts.map((f) => f.id)].filter(Boolean));
  const showcaseFact = facts.find((f) => !usedIds.has(f.id)) ?? hero ?? facts[0];

  const scenes: StoryboardScene[] = [];

  const headline = truncateWords(hero?.text ?? siteBrief.summary);
  scenes.push({
    id: "hook",
    templateId: "KineticHook",
    durationSec: durationFor([headline], 2.5),
    narration: options.noVoiceover ? undefined : headline,
    onScreenText: [headline],
    factIds: hero ? [hero.id] : [],
    props: { productName, headline },
  });

  if (featureFacts.length === 3) {
    const featureTexts = featureFacts.map((f) => truncateWords(f.text, 6));
    scenes.push({
      id: "features",
      templateId: "FeatureTriplet",
      durationSec: durationFor(featureTexts, 3.5),
      narration: options.noVoiceover ? undefined : featureTexts.join(". "),
      onScreenText: featureTexts,
      factIds: featureFacts.map((f) => f.id),
      props: { features: featureFacts.map((f) => ({ label: truncateWords(f.text, 6) })) },
    });
  }

  if (showcasePage && showcaseFact) {
    const caption = truncateWords(showcaseFact.text);
    scenes.push({
      id: "showcase",
      templateId: "SectionShowcase",
      durationSec: durationFor([caption], 4),
      narration: options.noVoiceover ? undefined : caption,
      onScreenText: [caption],
      factIds: [showcaseFact.id],
      props: { sourcePageUrl: showcasePage.url, caption },
    });
  }

  const ctaText = truncateWords(cta?.text ?? "Try it free", 4);
  scenes.push({
    id: "cta",
    templateId: "CTAEndCard",
    durationSec: durationFor([ctaText, domain], 2.5),
    narration: options.noVoiceover ? undefined : `${productName}. ${ctaText}.`,
    onScreenText: [ctaText],
    factIds: cta ? [cta.id] : [],
    props: { productName, ctaText, domain },
  });

  return {
    version: 1,
    targetDurationSec: options.lengthSec,
    tone: options.tone,
    language: options.voiceLanguage,
    rubric: {
      what: siteBrief.summary,
      who: siteBrief.audience,
      differentiator: siteBrief.differentiator,
      strongestClaim: hero?.text ?? siteBrief.differentiator,
      visualHook: headline,
      userFlow: "hook -> highlights -> product -> CTA",
      caption: siteBrief.summary,
    },
    scenes,
    // Scenes are each sized to their own reading floor, so the sum can
    // legitimately drift from targetDurationSec — validateStoryboard only
    // warns on drift for the fallback path, never fails it.
    shareCaption: `${siteBrief.summary} Try it free →`,
    source: "fallback",
  };
}
