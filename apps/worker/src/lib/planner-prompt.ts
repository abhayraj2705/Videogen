import { BANNED_PHRASES, type CrawlOutput, type FactLedgerEntry, type JobOptions } from "@sitereel/shared";

const TEMPLATE_CATALOG = `- KineticHook: opening hook (2-3s). props: { productName, headline }. Use once, first scene.
- LogoReveal: short reveal bumper (1-2s), logo only (asset "logo"). props: { productName }. Optional, at most once.
- HeroRebuild: the reveal — rebuilds the site's hero headline big (2-4s). props: { headline, subheadline }. Optional.
- FeatureTriplet: three grounded facts side by side (3-5s). props: { features: [{label, icon?}, {label, icon?}, {label, icon?}] } — exactly 3 entries.
- SectionShowcase: a real screenshot asset of the product with a caption (3-6s). props: { sourcePageUrl (must be the url of one of the ASSETS of type "screenshot"), caption }.
- UIFlowCursor: a real screenshot with an animated cursor implying interactivity (4-6s). props: { sourcePageUrl, caption }. Use instead of SectionShowcase when the facts suggest a workflow/UI.
- StatCounter: one grounded number, counted up big (2-3s). props: { value (the exact number text from a cited "stat" fact, e.g. "10,000+"), label }. Must cite a "stat" fact. Only use if one exists.
- QuoteCard: a verbatim testimonial (3-4s). props: { quote (exact text copied from a cited "testimonial" fact), author? }. Must cite a "testimonial" fact. Only use if one exists.
- ChecklistReveal: 2-4 short grounded items checked off in sequence (3-5s). props: { items: string[] } (2-4 entries, each from a cited fact).
- CTAEndCard: closing scene (2-4s). props: { productName, ctaText, domain }. Use once, last scene.`;

const KIND_PRIORITY: Record<string, number> = { hero: 0, feature: 1, stat: 2, testimonial: 3, cta: 4, heading: 5, other: 6 };
/** Large ledgers (news sites list hundreds of headings) are capped so the prompt stays cheap; strongest kinds first. */
const MAX_FACTS_IN_PROMPT = 150;

function selectFactsForPrompt(facts: FactLedgerEntry[]): FactLedgerEntry[] {
  if (facts.length <= MAX_FACTS_IN_PROMPT) return facts;
  return facts
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (KIND_PRIORITY[a.f.kind] ?? 9) - (KIND_PRIORITY[b.f.kind] ?? 9) || a.i - b.i)
    .slice(0, MAX_FACTS_IN_PROMPT)
    .sort((a, b) => a.i - b.i)
    .map(({ f }) => f);
}

function pageLabel(url: string, index: number): string {
  if (index === 0) return "homepage";
  try {
    const path = new URL(url).pathname.replace(/\/$/, "");
    return path ? `${path.split("/").pop()} page` : "page";
  } catch {
    return "page";
  }
}

/** Assets the planner may reference: page screenshots (by page url) and the logo. */
export function buildAssetList(crawlOutput: CrawlOutput): string {
  const lines: string[] = [];
  crawlOutput.pages.forEach((p, i) => {
    if (!p.screenshotKey) return;
    lines.push(`- [screenshot-${i}] type=screenshot url=${p.url} — full screenshot of the ${pageLabel(p.url, i)}`);
    p.sectionScreenshotKeys?.forEach((_, s) => lines.push(`  - [screenshot-${i}-section-${s}] section ${s + 1} of the ${pageLabel(p.url, i)} (scrolled ${s} viewport(s) down)`));
  });
  if (crawlOutput.brand.logoUrl) lines.push(`- [logo] type=logo — the site's logo (${crawlOutput.brand.logoUrl.startsWith("data:") ? "inline SVG" : crawlOutput.brand.logoUrl})`);
  return lines.length > 0 ? lines.join("\n") : "- (no screenshots available — do not use SectionShowcase or UIFlowCursor)";
}

export function buildBrandBlock(crawlOutput: CrawlOutput): string {
  const b = crawlOutput.brand;
  return [`background: ${b.bg}`, `text: ${b.fg}`, `accent: ${b.accent}`, `display font: ${b.fontDisplay}`, `body font: ${b.fontBody}`, `logo: ${b.logoUrl ? "yes" : "none"}`].join("\n");
}

/** Appendix C skeleton, filled in with this job's real crawl material. */
export function buildPlannerPrompt(opts: { crawlOutput: CrawlOutput; options: JobOptions }): { system: string; prompt: string } {
  const { crawlOutput, options } = opts;
  const { siteBrief, facts, domain } = crawlOutput;

  const system =
    "You are a motion-video director for short product launch videos. You write a storyboard as JSON that " +
    "matches the provided schema exactly. You never invent facts: every claim on screen or in narration must " +
    "cite fact ids from the FACT LEDGER, and every number you show or say (including inside template props) must " +
    "appear verbatim in one of the facts that same scene cites. You may invent framing, hooks and transitions.";

  const factList = selectFactsForPrompt(facts)
    .map((f) => `- [${f.id}] (${f.kind}) ${f.text}`)
    .join("\n");

  const prompt = `RULES
- Total length: ${options.lengthSec}s. Shape: hook (2-3s) -> reveal (2-4s) -> 2-3 highlights -> CTA (2-4s).
- The reveal shows the product itself right after the hook: SectionShowcase/UIFlowCursor on the homepage screenshot, or HeroRebuild/LogoReveal when there is no screenshot.
- Max 8 words on screen at once. Reading floor: 0.3s per word of on-screen text, per scene (durationSec >= 0.3 x words).
- One idea per scene. Model the viewer: list what they must understand, one read at a time.
- Every number shown or spoken must appear verbatim in a fact cited by that scene's factIds. No rounding, no new numbers.
- Prefer showing the product in use (UIFlowCursor, SectionShowcase) over describing it.
- Use only these templates:
${TEMPLATE_CATALOG}
- Banned phrases (never use, in any form): ${BANNED_PHRASES.map((p) => `"${p}"`).join(", ")}.
- Tone: ${options.tone}. Language: ${options.voiceLanguage}.
${options.noVoiceover ? "- No voiceover: omit narration, rely on on-screen text and captions only.\n" : ""}
INPUT
SITE BRIEF
productName: ${siteBrief.productName}
summary: ${siteBrief.summary}
audience: ${siteBrief.audience}
differentiator: ${siteBrief.differentiator}
${siteBrief.strongestClaimFactId ? `strongest claim fact: ${siteBrief.strongestClaimFactId}` : ""}

FACT LEDGER
${factList}

ASSETS (ids and descriptions; screenshot scenes must use one of these screenshot urls as sourcePageUrl)
${buildAssetList(crawlOutput)}

BRAND
${buildBrandBlock(crawlOutput)}

DOMAIN: ${domain}

OUTPUT
First fill "rubric" (what, who, differentiator, strongest grounded claim, visual hook, user flow, caption),
then "scenes" (each: id, templateId, durationSec, narration?, onScreenText[], factIds[], props), then "shareCaption".
Set targetDurationSec=${options.lengthSec}, tone="${options.tone}", language="${options.voiceLanguage}". JSON only.`;

  return { system, prompt };
}
