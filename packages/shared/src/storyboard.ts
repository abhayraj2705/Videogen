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

// Phase 0's four templates. Phase 4 adds LogoReveal, HeroRebuild, UIFlowCursor,
// StatCounter, QuoteCard, ChecklistReveal — extend this enum there, not before,
// since the film-runtime registry has to grow in lockstep.
export const TemplateId = z.enum(["KineticHook", "FeatureTriplet", "SectionShowcase", "CTAEndCard"]);
export type TemplateId = z.infer<typeof TemplateId>;

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

/** What the LLM actually returns — no `source` (the caller stamps that on), used to keep the prompt's output contract minimal. */
export const StoryboardLlmOutput = Storyboard.omit({ source: true, version: true });
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
