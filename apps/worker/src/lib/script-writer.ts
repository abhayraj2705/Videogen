import { z } from "zod";
import {
  BANNED_PHRASES,
  CLICHE_PHRASES,
  findBannedPhrases,
  findCliches,
  isNumberGrounded,
  numbersIn,
  wordCount,
  type CrawlOutput,
  type FactLedgerEntry,
  type JobOptions,
} from "@sitereel/shared";
import { costOfError, type LlmProvider } from "@sitereel/llm";
import { recipeFor, targetSceneCount } from "./recipes.js";
import { buildSiteProfile, categoryLabel } from "./site-profile.js";

/**
 * The film's argument, decided before a word of voiceover is written: who is
 * watching, what bothers them, what the product promises, and the few facts
 * that prove it — in the order they should be told.
 */
export const ScriptStrategy = z.object({
  audience: z.string(),
  /** The viewer's problem, in their words. */
  pain: z.string(),
  /** What changes for them with this product. */
  promise: z.string(),
  /** The strongest facts, strongest first, each with why it persuades this audience. */
  proofs: z.array(z.object({ factId: z.string(), why: z.string() })).min(1).max(6),
  /** Opening lines to choose from: each names the pain or the boldest grounded claim. */
  hooks: z.array(z.string()).min(1).max(3),
  cta: z.string(),
});
export type ScriptStrategy = z.infer<typeof ScriptStrategy>;

export const ScriptLine = z.object({
  /** One spoken sentence. */
  line: z.string().min(1),
  /** The facts this sentence rests on; empty for framing lines that claim nothing. */
  factIds: z.array(z.string()),
});
export type ScriptLine = z.infer<typeof ScriptLine>;

export const ScriptDraft = z.object({
  /** Which of the strategy's hooks opens the film (0-based). */
  hookIndex: z.number().int().min(0).max(2),
  lines: z.array(ScriptLine).min(2).max(20),
});
export type ScriptDraft = z.infer<typeof ScriptDraft>;

export const ScriptCritique = z.object({
  /** Would the first line stop this audience scrolling? */
  hook: z.number().min(1).max(5),
  /** Does it say things only this product could say? */
  specificity: z.number().min(1).max(5),
  /** Does it build — problem, answer, proof, ask — instead of listing features? */
  arc: z.number().min(1).max(5),
  /** Does it sound like a person talking? */
  spoken: z.number().min(1).max(5),
  /** What to change, most important first. */
  notes: z.array(z.string()).max(5),
});
export type ScriptCritique = z.infer<typeof ScriptCritique>;

export interface FilmScript {
  strategy: ScriptStrategy;
  hook: string;
  lines: ScriptLine[];
  critique: ScriptCritique | null;
  /** True when the first draft was sent back and rewritten. */
  rewritten: boolean;
}

export interface ScriptCall {
  provider: string;
  step: "strategy" | "voiceover" | "critique" | "rewrite";
  ok: boolean;
  costUsd: number;
  latencyMs: number;
  error?: string;
}

/** Every score at least this, and the mean at least CRITIQUE_MEAN, or the draft goes back once. */
const CRITIQUE_FLOOR = 3;
const CRITIQUE_MEAN = 3.75;
/**
 * Words of voiceover a second of film has room for. Synthesized voices speak about two words a second,
 * and every scene needs a beat of air around its line, so the film fits fewer words than a read-through does.
 * (Measured: a 52-word script made a 38-second film.)
 */
const WORDS_PER_SECOND = 1.8;
const MAX_WORDS_PER_LINE = 12;
/** A line is about this long; with the word budget it decides how many lines (and so scenes) the film has. */
const WORDS_PER_LINE = 7;

/** How many lines a script for this film has: as many as its word budget fills, within the recipe's scene range. */
export function scriptLineCount(options: Pick<JobOptions, "videoType" | "lengthSec">): number {
  const recipe = recipeFor(options.videoType);
  return Math.max(recipe.minScenes, Math.min(targetSceneCount(recipe, options.lengthSec), Math.round((options.lengthSec * WORDS_PER_SECOND) / WORDS_PER_LINE)));
}
const MAX_FACTS = 60;

const KIND_ORDER: Record<string, number> = { stat: 0, testimonial: 1, hero: 2, feature: 3, cta: 4, heading: 5, other: 6 };

/** The facts worth arguing from: claims and proof first, page furniture last, capped so the prompt stays short. */
function factsForScript(facts: FactLedgerEntry[]): FactLedgerEntry[] {
  return facts
    .filter((f) => findBannedPhrases(f.text).length === 0)
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (KIND_ORDER[a.f.kind] ?? 9) - (KIND_ORDER[b.f.kind] ?? 9) || a.i - b.i)
    .slice(0, MAX_FACTS)
    .map(({ f }) => f);
}

const factLines = (facts: FactLedgerEntry[]) => facts.map((f) => `- [${f.id}] (${f.kind}) ${f.text}`).join("\n");

const STRATEGY_SYSTEM =
  "You are a creative director planning a short product film. You decide the argument before anyone writes: who is watching, " +
  "what bothers them, what this product promises, and which facts prove it. You never invent facts: every proof is a fact id " +
  "from the FACTS list, and any number you write must appear in one of those facts. JSON only.";

const SCRIPT_SYSTEM =
  "You write voiceover for short product films: plain spoken English a person would actually say, one thought per sentence, " +
  "no marketing filler. You never invent facts: any claim or number in a line must come from the facts that line cites. JSON only.";

const CRITIC_SYSTEM =
  "You are a demanding advertising script editor. You score voiceover drafts strictly — most first drafts earn a 2 or 3 — and say exactly what to change. JSON only.";

function strategyPrompt(crawl: CrawlOutput, options: JobOptions, facts: FactLedgerEntry[]): string {
  const recipe = recipeFor(options.videoType);
  const profile = buildSiteProfile(crawl, options.videoType);
  return `A ${options.lengthSec}-second film. ${recipe.purpose}
Product: ${crawl.siteBrief.productName} — ${crawl.siteBrief.summary}
Kind of site: ${categoryLabel(profile.category)}. Stated audience: ${crawl.siteBrief.audience}. Stated differentiator: ${crawl.siteBrief.differentiator}
Language: ${options.voiceLanguage}. Tone: ${options.tone}.

FACTS
${factLines(facts)}

Decide:
- audience: the one kind of person this film speaks to, specifically (their role and situation).
- pain: the problem they feel, in words they would use. Infer it from what the product fixes; state no numbers the facts don't give.
- promise: what changes for them, in one plain sentence.
- proofs: the 3 to 5 facts that best prove the promise to THIS audience, strongest first, each with why it persuades. Prefer a number, a named customer, a quote, or something concrete the product does over a slogan. ${recipe.id === "feature" ? "All proofs are about the single strongest feature." : ""}
- hooks: three different opening lines of 4 to 9 words. One names the pain, one states the boldest grounded claim, one asks a question the viewer would answer yes to. Not a greeting, not the product name alone.
- cta: what to ask the viewer to do, in the site's own words if it has a call to action.`;
}

function voiceoverPrompt(crawl: CrawlOutput, options: JobOptions, facts: FactLedgerEntry[], strategy: ScriptStrategy, feedback?: { previous: ScriptLine[]; notes: string[] }): string {
  const recipe = recipeFor(options.videoType);
  const lines = scriptLineCount(options);
  const budget = Math.round(options.lengthSec * WORDS_PER_SECOND);
  return `Write the voiceover for a ${options.lengthSec}-second film about ${crawl.siteBrief.productName} (${crawl.domain}).
${recipe.purpose} Shape: ${recipe.shape}.

STRATEGY
audience: ${strategy.audience}
pain: ${strategy.pain}
promise: ${strategy.promise}
proofs, strongest first:
${strategy.proofs.map((p) => `- [${p.factId}] ${p.why}`).join("\n")}
hooks to choose from:
${strategy.hooks.map((h, i) => `${i}. ${h}`).join("\n")}
call to action: ${strategy.cta}

FACTS (cite by id)
${factLines(facts)}

RULES
- ${lines} lines (one per scene), ${budget} words in total at most — count them. The film is ${options.lengthSec} seconds and a voice says under two words a second, so every extra word makes it run long. No line over ${MAX_WORDS_PER_LINE} words.
- It is ONE script: each line picks up from the one before, the way a person tells a story. Read it aloud in your head; if two lines could swap places without anyone noticing, the script is a list — rewrite it.
- Line 1 is the hook you chose (hookIndex), reworded only if needed to flow. The last line is the call to action and names ${crawl.domain.replace(/^www\./, "")} or the product.
- The middle earns the ask: the answer to the pain, then the proofs in the order that builds, each said concretely (what it does, for whom, with what result).
- Every claim and every number comes from the facts that line cites, copied exactly (no rounding, no numbers in words that the fact doesn't give). Framing lines that claim nothing cite no facts.
- Say what this product does, not what any product could say. Never use: ${[...BANNED_PHRASES, ...CLICHE_PHRASES].map((p) => `"${p}"`).join(", ")}.
- Language: ${options.voiceLanguage}. Tone: ${options.tone}. Contractions and short sentences are good. No exclamation marks, no rhetorical "Imagine...".
${recipe.rules.map((r) => `- ${r}`).join("\n")}

EXAMPLE of the register and the arc, written for a different, invented product — never reuse its words or its facts:
${recipe.example.map((l) => `  ${l}`).join("\n")}
${
  feedback
    ? `
YOUR PREVIOUS DRAFT
${feedback.previous.map((l, i) => `${i + 1}. ${l.line}`).join("\n")}

AN EDITOR SENT IT BACK WITH THESE NOTES — fix every one, and keep what already works:
${feedback.notes.map((n) => `- ${n}`).join("\n")}`
    : ""
}`;
}

function critiquePrompt(crawl: CrawlOutput, options: JobOptions, strategy: ScriptStrategy, lines: ScriptLine[]): string {
  return `A ${options.lengthSec}-second ${options.videoType ?? "launch"} film for ${crawl.siteBrief.productName}. Audience: ${strategy.audience}. Their problem: ${strategy.pain}.

THE VOICEOVER
${lines.map((l, i) => `${i + 1}. ${l.line}`).join("\n")}

Score each 1-5 (5 = a senior copywriter would ship it unchanged; 3 = acceptable; 2 = generic or flat):
- hook: would line 1 make this audience keep watching?
- specificity: does it say things only this product could say, with concrete detail, or could the lines sit on any product's site?
- arc: does it build from problem to answer to proof to ask, each line following from the last?
- spoken: does it sound like a person talking, not a feature list read aloud?
Then give up to 5 notes, most important first. Each note names the line number and says what to change — not "make it punchier". You do not know the product's facts beyond what the script says, so never suggest adding a number, a name, a feature or a customer: suggest cutting, reordering, or saying the same claim more plainly.`;
}

/**
 * What code can check about a draft without a model: lines that are too long,
 * ungrounded numbers, unknown fact ids, stock phrases, and a script far off
 * its word budget. Each comes back as a note the rewrite must fix.
 */
export function scriptProblems(lines: ScriptLine[], facts: FactLedgerEntry[], lengthSec: number): string[] {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const notes: string[] = [];
  lines.forEach((l, i) => {
    const n = i + 1;
    if (wordCount(l.line) > MAX_WORDS_PER_LINE) notes.push(`Line ${n} is ${wordCount(l.line)} words; cut it to ${MAX_WORDS_PER_LINE} or fewer, or split the thought.`);
    const unknown = l.factIds.filter((id) => !byId.has(id));
    if (unknown.length > 0) notes.push(`Line ${n} cites fact ids that do not exist (${unknown.join(", ")}); cite real ones.`);
    const cited = l.factIds.map((id) => byId.get(id)?.text ?? "").join(" \n ");
    for (const num of numbersIn(l.line)) {
      if (!isNumberGrounded(num, cited)) notes.push(`Line ${n} says "${num.raw}", which is not in the facts it cites; use the fact's exact number or drop it.`);
    }
    for (const phrase of [...findBannedPhrases(l.line), ...findCliches(l.line)]) notes.push(`Line ${n} uses the stock phrase "${phrase}"; say the specific thing instead.`);
  });
  const total = lines.reduce((s, l) => s + wordCount(l.line), 0);
  const budget = Math.round(lengthSec * WORDS_PER_SECOND);
  if (total > budget * 1.15) notes.push(`The script is ${total} words; it must fit ${budget}. Cut the weakest line or tighten each one.`);
  return notes;
}

function passes(c: ScriptCritique): boolean {
  const scores = [c.hook, c.specificity, c.arc, c.spoken];
  return Math.min(...scores) >= CRITIQUE_FLOOR && scores.reduce((a, b) => a + b, 0) / scores.length >= CRITIQUE_MEAN;
}

/** Drops fact ids that don't exist, so a line's citations can be trusted downstream. */
function cleanLines(lines: ScriptLine[], facts: FactLedgerEntry[]): ScriptLine[] {
  const ids = new Set(facts.map((f) => f.id));
  return lines.map((l) => ({ line: l.line.trim(), factIds: l.factIds.filter((id) => ids.has(id)) })).filter((l) => l.line.length > 0);
}

/**
 * Writes the film's script before any storyboard exists: a strategy call, a
 * voiceover call, then an editor's critique — and when the draft falls short
 * of the bar (or breaks a rule code can check), one rewrite carrying the
 * notes. Returns null when the strategy or the first draft can't be produced;
 * the planner then works the old way, straight from the facts.
 *
 * `critic` may be a different (cheaper) model than `writer`; a model grading
 * its own draft is lenient, so when both are configured the other one grades.
 */
export async function writeFilmScript(
  crawl: CrawlOutput,
  options: JobOptions,
  deps: { writer: LlmProvider; critic?: LlmProvider | null },
): Promise<{ script: FilmScript | null; calls: ScriptCall[] }> {
  const calls: ScriptCall[] = [];
  const facts = factsForScript(crawl.facts);
  if (facts.length === 0) return { script: null, calls };

  async function call<T>(provider: LlmProvider, step: ScriptCall["step"], system: string, prompt: string, schema: z.ZodType<T>, schemaName: string, maxOutputTokens: number): Promise<T | null> {
    const started = Date.now();
    try {
      const r = await provider.generateJson({ system, prompt, schema, schemaName, maxOutputTokens });
      // Providers validate against the schema; checked again here so nothing malformed reaches the planner.
      const parsed = schema.safeParse(r.data);
      calls.push({ provider: provider.id, step, ok: parsed.success, costUsd: r.costUsd, latencyMs: Date.now() - started, ...(parsed.success ? {} : { error: "output did not match the schema" }) });
      return parsed.success ? parsed.data : null;
    } catch (err) {
      calls.push({ provider: provider.id, step, ok: false, costUsd: costOfError(err), latencyMs: Date.now() - started, error: (err as Error)?.message });
      return null;
    }
  }

  const strategyRaw = await call(deps.writer, "strategy", STRATEGY_SYSTEM, strategyPrompt(crawl, options, facts), ScriptStrategy, "film_strategy", 900);
  if (!strategyRaw) return { script: null, calls };
  const factIds = new Set(facts.map((f) => f.id));
  const proofs = strategyRaw.proofs.filter((p) => factIds.has(p.factId));
  const strategy: ScriptStrategy = { ...strategyRaw, proofs: proofs.length > 0 ? proofs : strategyRaw.proofs };

  const first = await call(deps.writer, "voiceover", SCRIPT_SYSTEM, voiceoverPrompt(crawl, options, facts, strategy), ScriptDraft, "film_voiceover", 1400);
  if (!first) return { script: null, calls };
  let draft = { ...first, lines: cleanLines(first.lines, crawl.facts) };
  if (draft.lines.length < 2) return { script: null, calls };

  const critique = await call(deps.critic ?? deps.writer, "critique", CRITIC_SYSTEM, critiquePrompt(crawl, options, strategy, draft.lines), ScriptCritique, "script_critique", 600);
  const problems = scriptProblems(draft.lines, crawl.facts, options.lengthSec);
  let rewritten = false;
  if (problems.length > 0 || (critique && !passes(critique))) {
    const notes = [...problems, ...(critique && !passes(critique) ? critique.notes : [])].slice(0, 8);
    const second = await call(deps.writer, "rewrite", SCRIPT_SYSTEM, voiceoverPrompt(crawl, options, facts, strategy, { previous: draft.lines, notes }), ScriptDraft, "film_voiceover", 1400);
    const lines = second ? cleanLines(second.lines, crawl.facts) : [];
    // The rewrite replaces the draft unless it breaks more rules than the draft did.
    if (second && lines.length >= 2 && scriptProblems(lines, crawl.facts, options.lengthSec).length <= problems.length) {
      draft = { ...second, lines };
      rewritten = true;
    }
  }

  return {
    script: { strategy, hook: strategy.hooks[Math.min(draft.hookIndex, strategy.hooks.length - 1)] ?? strategy.hooks[0]!, lines: draft.lines, critique, rewritten },
    calls,
  };
}
