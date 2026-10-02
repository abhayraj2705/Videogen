import { z } from "zod";
import { Tone } from "./job.js";

/**
 * Storyboard v1 — FROZEN per Phase 3 (§5, Phase 3 task list: "Freeze Storyboard
 * v1 schema ... this unblocks Phase 5"). Breaking changes after this point need
 * a v2 schema alongside v1, not an edit in place — the `storyboards` table keeps
 * every version, and old rows must keep parsing.
 *
 * A Storyboard is the planner's output: template choices, narration and
 * on-screen text, all grounded in FactLedger ids. It is NOT yet a FilmManifest
 * — the Build stage (Phase 4) resolves it into one by attaching real asset
 * URLs, computed timings from actual audio duration, and beat locks. Until
 * then `durationSec` is the planner's estimate and `props` may reference
 * assets only by fact id / role, not by final URL.
 */

/** Full 17-template catalog — must stay in lockstep with film-runtime's TEMPLATE_REGISTRY. */
export const TemplateId = z.enum([
  "KineticHook",
  "FeatureTriplet",
  "SectionShowcase",
  "CTAEndCard",
  "LogoReveal",
  "HeroRebuild",
  "UIFlowCursor",
  "StatCounter",
  "QuoteCard",
  "ChecklistReveal",
  // Added after the v1 freeze. Additive: every stored v1 storyboard still parses.
  "BigStatement",
  "BentoGrid",
  "ScreenCollage",
  "DeviceMockup",
  "ZoomDetail",
  "SplitCompare",
  "LogoWall",
]);
export type TemplateId = z.infer<typeof TemplateId>;

/** How a scene enters over the one before it — must stay in lockstep with film-runtime's TransitionKind. */
export const SceneTransition = z.enum(["fade", "slide-left", "slide-up", "zoom", "cut", "push", "wipe", "whip"]);
export type SceneTransition = z.infer<typeof SceneTransition>;

export const StoryboardScene = z.object({
  id: z.string(),
  templateId: TemplateId,
  durationSec: z.number().positive(),
  /** Spoken line for this scene. Omitted entirely for a no-voiceover job. */
  narration: z.string().optional(),
  /** Every piece of text that appears on screen during this scene, in reading order. */
  onScreenText: z.array(z.string().min(1)),
  /** FactLedger ids grounding every claim in narration + onScreenText. Empty array is valid (pure framing/CTA scenes). */
  factIds: z.array(z.string()),
  /** Template-specific props, validated against that template's own requirements (see validators.ts), not by this schema. */
  props: z.record(z.unknown()),
  /** Cut into this scene. Additive, optional: absent = the player picks one per cut. Ignored on the first scene. */
  transition: SceneTransition.optional(),
});
export type StoryboardScene = z.infer<typeof StoryboardScene>;

export const StoryboardRubric = z.object({
  what: z.string(),
  who: z.string(),
  differentiator: z.string(),
  strongestClaim: z.string(),
  visualHook: z.string(),
  userFlow: z.string(),
  caption: z.string(),
});
export type StoryboardRubric = z.infer<typeof StoryboardRubric>;

export const Storyboard = z.object({
  version: z.number().int().positive().default(1),
  targetDurationSec: z.number().positive(),
  tone: Tone,
  language: z.enum(["en", "hi"]),
  rubric: StoryboardRubric,
  scenes: z.array(StoryboardScene).min(1),
  shareCaption: z.string(),
  source: z.enum(["llm", "llm-escalated", "fallback"]),
});
export type Storyboard = z.infer<typeof Storyboard>;

/**
 * Every prop any template takes, all optional. The LLM's output schema spells
 * them out because structured-output modes (Gemini's responseSchema) return an
 * empty object for a free-form `z.record` — which made every LLM storyboard
 * fail validation. Which props a given template needs is still checked per
 * template by TEMPLATE_PROP_SCHEMAS.
 */
export const LlmSceneProps = z.object({
  productName: z.string().optional(),
  headline: z.string().optional(),
  subheadline: z.string().optional(),
  features: z.array(z.object({ label: z.string(), icon: z.string().optional() })).optional(),
  sourcePageUrl: z.string().optional(),
  caption: z.string().optional(),
  section: z.number().optional(),
  value: z.string().optional(),
  label: z.string().optional(),
  quote: z.string().optional(),
  author: z.string().optional(),
  items: z.array(z.string()).optional(),
  text: z.string().optional(),
  highlight: z.string().optional(),
  title: z.string().optional(),
  ctaText: z.string().optional(),
  domain: z.string().optional(),
  left: z.string().optional(),
  right: z.string().optional(),
  leftLabel: z.string().optional(),
  rightLabel: z.string().optional(),
  names: z.array(z.string()).optional(),
});

/** Drops the props a model left empty (null, "", []), so optional template props stay absent rather than blank. */
export function compactLlmProps(props: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(props).filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)));
}

/** What the LLM actually returns — no `source` (the caller stamps that on), used to keep the prompt's output contract minimal. */
export const StoryboardLlmOutput = Storyboard.omit({ source: true, version: true }).extend({
  scenes: z.array(StoryboardScene.extend({ props: LlmSceneProps })).min(1),
});
export type StoryboardLlmOutput = z.infer<typeof StoryboardLlmOutput>;

export interface ValidationIssue {
  code: string;
  message: string;
  sceneId?: string;
  severity: "error" | "warning";
}

export interface ValidationReport {
  valid: boolean;
  issues: ValidationIssue[];
}
