import { BANNED_PHRASES, FULLPAGE_CAPTURE_DEPTH, type CrawlOutput, type FactLedgerEntry, type JobOptions } from "@sitereel/shared";
import { ICON_NAMES } from "@sitereel/film-runtime";
import { recipeFor, targetSceneCount } from "./recipes.js";

const TEMPLATE_CATALOG = `- KineticHook: opening hook (2-3s). props: { productName, headline }. Use once, first scene.
- LogoReveal: short reveal bumper (1-2s), logo only (asset "logo"). props: { productName }. Optional, at most once.
- HeroRebuild: the reveal — rebuilds the site's hero headline big (2-4s). props: { headline, subheadline }. Optional.
- FeatureTriplet: three grounded facts as cards that take turns in the spotlight (4-5s). props: { features: [{label, icon?}, {label, icon?}, {label, icon?}] } — exactly 3 entries; icon is optional and must be one of these names (pick the one that fits the label): ${ICON_NAMES.join(", ")}.
- SectionShowcase: the real page in a browser window, with a caption (4-6s). When the scene's first cited fact comes from that same page, the camera zooms to that fact on the page and outlines it — so cite the fact the caption is about first. props: { sourcePageUrl (must be the url of one of the ASSETS of type "screenshot"), caption, section? }. Omit section to scroll the page from the top; set section (1 = top of the page, 2 = one screen down, ...) to hold on that part of the page — use it to show the section the caption is about.
- UIFlowCursor: the real page in a browser window with a pointer that moves and clicks (4-6s). props: { sourcePageUrl, caption, section? }. Use instead of SectionShowcase when the facts suggest a workflow/UI.
- StatCounter: one grounded number, counted up big (2-3s). props: { value (the exact number text from a cited "stat" fact, e.g. "10,000+"), label }. Must cite a "stat" fact. Only use if one exists.
- QuoteCard: a verbatim testimonial (3-4s). props: { quote (a run of at most 8 consecutive words copied exactly from a cited "testimonial" fact — pick the strongest phrase, do not paste the whole testimonial), author? }. Must cite a "testimonial" fact. Only use if one exists.
- ChecklistReveal: 2-4 short grounded items checked off in sequence (3-5s). props: { items: string[] } (at least 2 and at most 4 entries, each from a cited fact).
- BigStatement: one line set poster-size, for the differentiator or strongest claim (2-4s). props: { text (3-8 words), highlight? (1-3 consecutive words copied exactly from text, shown in the accent color) }.
- BentoGrid: a lead line on a large accent tile beside three supporting points (4-5s). props: { title (2-6 words), items: [string, string, string] } — exactly 3 items, 2-5 words each, each from a cited fact. Use instead of FeatureTriplet when one idea frames the three.
- ScreenCollage: three parts of the same page at once, as tilted overlapping cards with depth (3-5s). props: { sourcePageUrl (a screenshot asset's url), caption }. Use for breadth ("everything in one place", a tour) — and as the second product scene instead of repeating SectionShowcase.
- DeviceMockup: the site on a device — a laptop in wide video, a phone in vertical — turning slowly while the page scrolls (4-5s). props: { sourcePageUrl, caption }. A strong reveal right after the hook.
- ZoomDetail: a close-up of one element of the page as a big floating card with an outline around it (3-5s). props: { sourcePageUrl, caption }. The close-up is of the scene's first cited fact, so cite the fact the caption is about first, and point sourcePageUrl at the page that fact came from. Use for a specific feature, price or number that is visible on the page.
- SplitCompare: before and after, side by side — the old way in muted ink, then the product's way in the accent (4-5s). props: { left (the problem or old way, 2-7 words), right (the product's answer, 2-7 words), leftLabel?, rightLabel? } (labels default to "Before" / "After"; 1-2 words each). Both sides must come from cited facts; don't invent a "before".
- LogoWall: a wall of name chips — customers, integrations or supported platforms (3-4s). props: { title (2-6 words, e.g. the fact's own heading), names: string[] } (3-10 names, 1-3 words each, every one copied from a cited fact). Only use when the ledger actually lists such names.
- StepByStep: one step of a walkthrough — a big step number and title beside the screen it happens on, with progress dots (4-6s). props: { sourcePageUrl, caption (what the user does or sees, 2-6 words), step (1, 2, 3 ... in order) }. Walkthrough films only; number the steps consecutively.
- KineticType: one strong line set as a full-frame typographic poster, building row by row (2-3s). props: { text (3-7 words) }. Use for the boldest claim, as a hook alternative or a punchline between product scenes. At most once.
- Montage: a fast cut through the product's screens, several per second, with a flash on each cut (2-4s). props: { caption (2-6 words) }. Needs at least three screenshot assets. Use for energy: teasers, or "everything in one place".
- FeatureCallouts: the page with two or three things pointed out on it — labelled outlines appearing one by one on the real elements (4-6s). props: { sourcePageUrl, caption, items: string[] } (2-3 labels, 1-4 words each). items[i] labels the scene's i-th cited fact, so cite one on-page fact per item, in the same order, all from the page shown.
- MetricsRow: two or three numbers counting up side by side (3-4s). props: { metrics: [{ value, label }] } (value is the exact number text from a cited fact, e.g. "40,000+"; label 1-4 words). Use instead of StatCounter when the ledger has several good numbers.
- PhotoShowcase: one image filling the whole frame with the caption on a plate over it (3-5s). props: { sourcePageUrl, caption }. Best for an uploaded photo or a striking screen.
- IsoStack: three parts of a page as layers stacked in 3D, seen at an angle and drifting apart (3-5s). props: { sourcePageUrl, caption }. A showier alternative to ScreenCollage; use one or the other.
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
    if (p.origin === "upload") {
      // One image, not a scrollable page: no sections, and the user chose it — it should be used.
      lines.push(`- [upload-${i}] type=screenshot url=${p.url} — UPLOADED BY THE USER: ${p.label ?? "product image"}. Use it; facts about it cite this url.`);
      return;
    }
    lines.push(`- [screenshot-${i}] type=screenshot url=${p.url} — full screenshot of the ${pageLabel(p.url, i)}`);
    p.sectionScreenshotKeys?.forEach((_, s) => lines.push(`  - [screenshot-${i}-section-${s}] section ${s + 1} of the ${pageLabel(p.url, i)} (scrolled ${s} viewport(s) down)`));
  });
  if (crawlOutput.brand.logoUrl) lines.push(`- [logo] type=logo — the site's logo (${crawlOutput.brand.logoUrl.startsWith("data:") ? "inline SVG" : crawlOutput.brand.logoUrl})`);
  return lines.length > 0 ? lines.join("\n") : "- (no screenshots available — do not use SectionShowcase, UIFlowCursor, ScreenCollage, DeviceMockup, ZoomDetail, StepByStep, Montage, FeatureCallouts, PhotoShowcase or IsoStack)";
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
    // "on-page" = we know where this sits on a screenshot, so a close-up can point the camera at it.
    .map((f) => `- [${f.id}] (${f.kind}${f.rect && f.rect.y + f.rect.h <= FULLPAGE_CAPTURE_DEPTH ? ", on-page" : ""}) ${f.text}`)
    .join("\n");

  const recipe = recipeFor(options.videoType);
  const sceneCount = targetSceneCount(recipe, options.lengthSec);

  const prompt = `RULES
- ${recipe.purpose}
- Total length: ${options.lengthSec}s; the scenes' durationSec must add up to within 20% of it. Shape: ${recipe.shape}.
${recipe.rules.map((r) => `- ${r}`).join("\n")}
- Max 8 words in any one on-screen line — that means every headline, caption, label, item, quote and text prop. Count before you write; a 9-word line is rejected. Reading floor: 0.3s per word of on-screen text, per scene (durationSec >= 0.3 x words).
- Write ${sceneCount} scenes (never fewer than ${Math.max(recipe.minScenes, sceneCount - 1)}). Each narration line is at most 10 words — it must be speakable in under 3 seconds, or the scene sits frozen while the voice finishes.
- One idea per scene. Model the viewer: list what they must understand, one read at a time.
- Narration and on-screen text do different jobs. Narration is one conversational sentence a person would say aloud; on-screen text is the 2-6 word title of that sentence. Never make the narration a read-out of the on-screen text, and never repeat a full sentence in both.
- Narration flows across scenes like one script: each line picks up from the last. No scene is longer than 6s; split a long thought into two scenes with different templates.
- Every number shown or spoken must appear verbatim in a fact cited by that scene's factIds. No rounding, no new numbers. This includes numbers written as words ("over one hundred") — if a fact doesn't give it, don't say it.
- Prefer showing the product in use (UIFlowCursor, SectionShowcase) over describing it.
- Every on-screen line is a complete phrase that reads on its own: never end on a comma or on a word like "and", "to", "of", "with", "on". Shorten by rewriting, not by cutting off.
- Text animates in word by word, so short punchy lines land best: hook headline 3-7 words, feature labels 2-5 words, captions 3-8 words.
- Pacing: never use the same template for two scenes in a row; alternate text scenes with product (screenshot) scenes. There are many ways to show the product (SectionShowcase, UIFlowCursor, ScreenCollage, IsoStack, DeviceMockup, ZoomDetail, FeatureCallouts, PhotoShowcase, Montage) — use a different one each time.
- Each scene may set "emphasis": one or two words copied exactly from that scene's on-screen text — the words that carry its point. They light up in the accent colour as the voice says them, so choose words the narration also says.
- Facts marked "on-page" have a known position on a screenshot. A product scene whose FIRST cited fact is on-page (and from the page it shows) gets a camera move onto that fact; SectionShowcase visits up to three on-page facts in turn. Prefer them for product scenes.
- Each scene after the first may set "transition" (how it cuts in): "zoom" for a reveal or a big number, "push" between parallel points, "wipe" into a screenshot scene, "cut" (hard cut, lands on the beat) for a punchy change, "whip" for a fast energetic jump, "fade" for a calm change of topic, "slide-left"/"slide-up" as gentler alternatives. Vary them; leave it out to let the renderer choose from the tone's own set.
- Screenshot scenes scroll the real page inside a browser window — give them at least 4s, and point two screenshot scenes at two different pages when more than one screenshot asset exists.
- Images marked UPLOADED BY THE USER are what the user most wants shown: give every one of them its own product scene, in the order listed, before reusing a crawled screenshot.
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
then "scenes" (each: id, templateId, durationSec, narration?, onScreenText[], factIds[], props, transition?, emphasis?), then "shareCaption".
Set targetDurationSec=${options.lengthSec}, tone="${options.tone}", language="${options.voiceLanguage}". JSON only.`;

  return { system, prompt };
}
