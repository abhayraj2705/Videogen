import type { CrawlOutput, JobOptions } from "@sitereel/shared";

const TEMPLATE_CATALOG = `- KineticHook: opening scene (2-3s). props: { productName, headline }. Use once, first scene.
- LogoReveal: short bumper (1-2s), logo only. props: { productName }. Optional, at most once.
- HeroRebuild: a second, bigger headline moment (3-4s). props: { headline, subheadline }. Optional.
- FeatureTriplet: three grounded facts side by side (3-5s). props: { features: [{label, icon?}, {label, icon?}, {label, icon?}] } — exactly 3 entries.
- SectionShowcase: a real screenshot of the product with a caption (4-6s). props: { sourcePageUrl (must be one of the crawled page URLs below), caption }.
- UIFlowCursor: a real screenshot with an animated cursor implying interactivity (4-6s). props: { sourcePageUrl, caption }. Use instead of SectionShowcase when the facts suggest a workflow/UI, not just a static page.
- StatCounter: one grounded number, counted up big (2-3s). props: { value (must be the exact number text from a stat fact), label }. Only use if a "stat" kind fact exists.
- QuoteCard: a verbatim testimonial (3-4s). props: { quote (must be the exact text of a testimonial fact), author? }. Only use if a "testimonial" kind fact exists.
- ChecklistReveal: 2-4 short grounded items checked off in sequence (3-5s). props: { items: string[] } (2-4 entries, each from a fact).
- CTAEndCard: closing scene (2-4s). props: { productName, ctaText, domain }. Use once, last scene.`;

const BANNED_PHRASES = ["streamline your workflow", "supercharge", "unlock", "elevate"];

/** Appendix C skeleton, filled in with this job's real crawl material. */
export function buildPlannerPrompt(opts: { crawlOutput: CrawlOutput; options: JobOptions }): { system: string; prompt: string } {
  const { crawlOutput, options } = opts;
  const { siteBrief, facts, pages, domain } = crawlOutput;

  const system =
    "You are a motion-video director for short product launch videos. You write a storyboard as JSON that " +
    "matches the schema described in the prompt exactly. You never invent facts: every claim on screen or in " +
    "narration must cite fact ids from the FACT LEDGER, and every number you show must appear verbatim in one " +
    "of the facts you cite. You may invent framing, hooks and transitions. Output JSON only.";

  const factList = facts.map((f) => `- [${f.id}] (${f.kind}) ${f.text}`).join("\n");
  const pageList = pages.map((p) => p.url).join("\n");

  const prompt = `RULES
- Total length: ${options.lengthSec}s. Shape: hook (2-3s) -> 2-3 highlights -> CTA (2-4s).
- Max 8 words on screen at once. Reading floor: 0.3s per word of on-screen text, per scene.
- One idea per scene. Every number shown must appear verbatim in a fact you cite for that scene.
- Prefer showing the product (SectionShowcase) over only describing it.
- Use only these templates:
${TEMPLATE_CATALOG}
- Banned phrases: ${BANNED_PHRASES.map((p) => `"${p}"`).join(", ")}.
- Tone: ${options.tone}. Language: ${options.voiceLanguage}.
${options.noVoiceover ? "- No voiceover: omit narration, rely on on-screen text and captions only." : ""}

SITE BRIEF
productName: ${siteBrief.productName}
summary: ${siteBrief.summary}
audience: ${siteBrief.audience}
differentiator: ${siteBrief.differentiator}

FACT LEDGER
${factList}

CRAWLED PAGES (use one of these exact URLs for any SectionShowcase.sourcePageUrl)
${pageList}

DOMAIN: ${domain}

OUTPUT
Return a JSON object matching exactly:
{
  "targetDurationSec": number,
  "tone": string,
  "language": "en" | "hi",
  "rubric": { "what": string, "who": string, "differentiator": string, "strongestClaim": string, "visualHook": string, "userFlow": string, "caption": string },
  "scenes": [ { "id": string, "templateId": string, "durationSec": number, "narration"?: string, "onScreenText": string[], "factIds": string[], "props": object } ],
  "shareCaption": string
}
First fill "rubric", then "scenes". JSON only, no markdown fences.`;

  return { system, prompt };
}
