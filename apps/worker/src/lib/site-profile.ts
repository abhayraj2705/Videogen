import { FULLPAGE_CAPTURE_DEPTH, type CrawlOutput, type TemplateId, type VideoType } from "@sitereel/shared";
import { isQuoteShaped, statParts } from "./storyboard-fallback.js";
import { deriveSiteLook, type SiteLook } from "./site-look.js";

/** What kind of site this is — it decides which scenes suit it, the way an editor would brief differently for a dev tool and a shop. */
export type SiteCategory = "saas" | "devtool" | "ecommerce" | "agency" | "content" | "app" | "other";

export interface SiteEvidence {
  /** Pages we have a screenshot of (crawled and uploaded). */
  screenshotPages: number;
  /** Of those, images the user uploaded. */
  uploads: number;
  /** Pages with two or more section captures (enough for a collage or a 3D stack). */
  multiSectionPages: number;
  /** Facts with a known position on a captured screenshot — things a close-up can point at. */
  onPageFacts: number;
  /** Stat facts that read as a real claim ("40,000+ teams"), not a price or a phone number. */
  stats: number;
  /** Testimonials that read like something a person said (a QuoteCard may show an excerpt of a long one). */
  quotes: number;
  features: number;
  /** Short name-like facts (1-3 words): integrations, customers, platforms — material for a wall of names. */
  names: number;
  /** Logos captured from the site's customer / integration strip. */
  logos: number;
  hasPricingPage: boolean;
  hasLogo: boolean;
}

export type TemplateFit = "strong" | "possible" | "unavailable";

export interface TemplateChoice {
  id: TemplateId;
  fit: TemplateFit;
  /** Why, in words a user can read: shown in the app and given to the planner. */
  reason: string;
}

export interface SiteProfile {
  category: SiteCategory;
  /** The words on the site that decided the category. */
  categorySignals: string[];
  evidence: SiteEvidence;
  /** How the site looks (colours, type, shapes, pictures): see site-look.ts. */
  look: SiteLook;
  templates: TemplateChoice[];
}

/**
 * Scenes that suit a look, with the reason shown to the user. Applied on top of what the site's
 * kind favours: two software sites that say the same things but look different get different films.
 */
function lookFavours(look: SiteLook): Map<TemplateId, string> {
  const out = new Map<TemplateId, string>();
  const add = (reason: string, ...ids: TemplateId[]) => ids.forEach((id) => out.has(id) || out.set(id, reason));
  if (look.recorded) add("the homepage was recorded scrolling, and plays on the device", "DeviceMockup");
  if (look.logos >= 3) add(`${look.logos} logos captured from the site`, "LogoWall");
  if (look.imagery === "rich") add("the site is led by pictures", "PhotoShowcase", "Montage", "ScreenCollage");
  else if (look.imagery === "some") add("the site has pictures worth showing large", "PhotoShowcase");
  if (look.dark) add("bold type and depth read well on a dark site", "KineticType", "IsoStack", "BigStatement");
  if (look.rounded && look.vivid) add("round, colourful cards match the site's own", "BentoGrid", "FeatureTriplet", "Composed");
  if (look.rounded === false) add("sharp, precise framing matches the site's corners", "ZoomDetail", "FeatureCallouts", "SplitCompare");
  if (look.typeface === "serif") add("an editorial typeface carries a line or a quote on its own", "BigStatement", "QuoteCard");
  if (look.typeface === "mono") add("a technical look suits close-ups and labelled detail", "ZoomDetail", "FeatureCallouts");
  if (look.typeface === "display") add("the site's display type makes a poster", "KineticType");
  if (!look.dark && !look.vivid) add("a restrained site is best shown plainly, as it is", "SectionShowcase", "ZoomDetail");
  return out;
}

/**
 * The few scenes this particular film should be built around: best fits for the site, a different handful
 * for each `seed` (the job id) — so two films of one site, or of two similar sites, do not come out as the
 * same sequence. Scenes the look itself calls for come first and are always among them.
 */
export function featuredTemplates(profile: SiteProfile, seed: string, count = 4): TemplateId[] {
  const structural = new Set<string>(["KineticHook", "CTAEndCard", "LogoReveal", "HeroRebuild"]);
  const byLook = lookFavours(profile.look);
  const strong = profile.templates.filter((t) => t.fit === "strong" && !structural.has(t.id)).map((t) => t.id);
  const possible = profile.templates.filter((t) => t.fit === "possible" && !structural.has(t.id)).map((t) => t.id);
  let hash = 2166136261;
  for (const ch of seed) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rotate = <T,>(list: T[]) => (list.length === 0 ? list : [...list.slice(hash % list.length), ...list.slice(0, hash % list.length)]);
  // What the crawl captured from this site and no other — its customers' logos, its own pictures — is always shown:
  // it is the most particular material a film can have.
  const captured: TemplateId[] = [...(profile.look.logos >= 3 ? (["LogoWall"] as const) : []), ...(profile.look.imagery !== "none" ? (["PhotoShowcase"] as const) : [])].filter((id) => strong.includes(id));
  const fromLook = rotate(strong.filter((id) => byLook.has(id) && !captured.includes(id)));
  const rest = rotate(strong.filter((id) => !byLook.has(id)));
  // Then one for the look and one for what the site says (numbers, quotes, features), turn about.
  const mixed: TemplateId[] = [];
  for (let i = 0; i < Math.max(fromLook.length, rest.length); i++) {
    if (fromLook[i]) mixed.push(fromLook[i]!);
    if (rest[i]) mixed.push(rest[i]!);
  }
  return [...new Set([...captured, ...mixed, ...rotate(possible)])].slice(0, count);
}

/** Words that mark each kind of site. Matched as whole words/phrases, case-insensitively, over every fact and page URL. */
const CATEGORY_SIGNALS: Record<Exclude<SiteCategory, "other">, string[]> = {
  devtool: ["api", "sdk", "cli", "developers", "developer", "open source", "github", "deploy", "docs", "documentation", "framework", "npm", "repository", "codebase", "typescript", "infrastructure"],
  ecommerce: ["add to cart", "shop", "cart", "checkout", "shipping", "free delivery", "collection", "bestseller", "best sellers", "sale", "buy now", "in stock", "returns"],
  agency: ["our work", "case study", "case studies", "clients", "studio", "agency", "portfolio", "we design", "we build", "services", "capabilities"],
  content: ["subscribe", "newsletter", "article", "articles", "read more", "published", "editorial", "podcast", "episode", "news"],
  app: ["app store", "google play", "download the app", "ios", "android", "available on", "get the app"],
  saas: ["free trial", "sign up", "pricing", "dashboard", "workflow", "teams", "integrations", "automation", "platform", "book a demo", "get a demo", "workspace"],
};

const CATEGORY_LABEL: Record<SiteCategory, string> = {
  saas: "software product",
  devtool: "developer tool",
  ecommerce: "online shop",
  agency: "agency or studio",
  content: "publication",
  app: "mobile app",
  other: "website",
};

export function categoryLabel(category: SiteCategory): string {
  return CATEGORY_LABEL[category];
}

function classify(crawl: CrawlOutput): { category: SiteCategory; signals: string[] } {
  const text = ` ${[...crawl.facts.map((f) => f.text), ...crawl.pages.map((p) => p.url), crawl.siteBrief.summary].join(" \n ").toLowerCase()} `;
  const hitsFor = (category: Exclude<SiteCategory, "other">) => CATEGORY_SIGNALS[category].filter((w) => new RegExp(`[^a-z]${w.replace(/ /g, "\\s+")}[^a-z]`).test(text));
  // Checked in this order, and a later kind must beat an earlier one outright. Developer-tool words ("API",
  // "docs") sit in the footer of most software sites, so that kind comes last and needs three of them.
  const order: Exclude<SiteCategory, "other">[] = ["ecommerce", "saas", "app", "agency", "content", "devtool"];
  let best: { category: SiteCategory; signals: string[] } = { category: "other", signals: [] };
  for (const category of order) {
    const hits = hitsFor(category);
    // Two distinct signals at least: one stray "shop" or "api" doesn't make a site a shop or a dev tool.
    if (hits.length >= (category === "devtool" ? 3 : 2) && hits.length > best.signals.length) best = { category, signals: hits };
  }
  // A product that is sold like software (pricing, sign-up, teams) is a software product even if it has an API.
  if (best.category === "devtool") {
    const saas = hitsFor("saas");
    if (saas.length >= 2 && saas.length >= best.signals.length - 1) best = { category: "saas", signals: saas };
  }
  return best;
}

export function gatherEvidence(crawl: CrawlOutput): SiteEvidence {
  const shot = crawl.pages.filter((p) => p.screenshotKey);
  const shotUrls = new Set(shot.map((p) => p.url));
  const wordsOf = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
  return {
    screenshotPages: shot.length,
    uploads: shot.filter((p) => p.origin === "upload").length,
    multiSectionPages: shot.filter((p) => p.origin !== "upload" && (p.sectionScreenshotKeys?.length ?? 0) >= 2).length,
    onPageFacts: crawl.facts.filter((f) => f.rect && shotUrls.has(f.sourceUrl) && f.rect.x >= 0 && f.rect.x + f.rect.w <= 1.001 && f.rect.y + f.rect.h <= FULLPAGE_CAPTURE_DEPTH).length,
    stats: crawl.facts.filter((f) => f.kind === "stat" && statParts(f.text) !== null).length,
    // A QuoteCard may excerpt a long testimonial, so what matters is that it opens like something a person said.
    quotes: crawl.facts.filter((f) => f.kind === "testimonial" && isQuoteShaped(f.text.trim().split(/s+/).slice(0, 8).join(" "))).length,
    features: crawl.facts.filter((f) => f.kind === "feature").length,
    names: crawl.facts.filter((f) => (f.kind === "feature" || f.kind === "heading") && wordsOf(f.text) <= 3 && /^\p{Lu}/u.test(f.text) && !/\d/.test(f.text)).length,
    logos: crawl.pages.reduce((n, p) => n + (p.logos?.length ?? 0), 0),
    hasPricingPage: crawl.pages.some((p) => /pricing|plans/i.test(p.url)),
    hasLogo: Boolean(crawl.brand.logoUrl),
  };
}

/** Which scene types each kind of site is best told with (beyond what its evidence allows). */
const CATEGORY_FAVOURS: Record<SiteCategory, TemplateId[]> = {
  saas: ["DeviceMockup", "FeatureCallouts", "FeatureTriplet", "MetricsRow", "UIFlowCursor"],
  devtool: ["KineticType", "ZoomDetail", "FeatureCallouts", "MetricsRow", "BigStatement"],
  ecommerce: ["PhotoShowcase", "Montage", "QuoteCard", "IsoStack", "ScreenCollage"],
  agency: ["Montage", "PhotoShowcase", "LogoWall", "QuoteCard", "KineticType"],
  content: ["KineticType", "BigStatement", "Montage", "ScreenCollage"],
  app: ["DeviceMockup", "IsoStack", "FeatureTriplet", "PhotoShowcase"],
  other: ["DeviceMockup", "SectionShowcase", "FeatureTriplet"],
};

/**
 * The site profile: what kind of site this is, what material the crawl
 * actually found, and — from those two — which scene templates this
 * particular film can use and which suit it best.
 *
 * This is the engineering behind "auto template selection". The planner is
 * no longer handed all templates and left to guess: templates the site has no
 * material for are withheld (a StatCounter needs a real stat, a close-up needs
 * a positioned fact, a collage needs several captures), and the ones that
 * fit the site's kind and evidence are put forward with the reason. Pure and
 * deterministic, so the app can show the same reasoning the planner was given.
 */
export function buildSiteProfile(crawl: CrawlOutput, videoType: VideoType = "launch"): SiteProfile {
  const { category, signals } = classify(crawl);
  const e = gatherEvidence(crawl);
  const favoured = new Set(CATEGORY_FAVOURS[category]);
  const kind = CATEGORY_LABEL[category];
  const look = deriveSiteLook(crawl);
  const byLook = lookFavours(look);
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const hasShots = e.screenshotPages > 0;
  const noShots = "no screenshot of the site was captured";

  /** needs: a reason when the material is missing (-> unavailable); otherwise strong when `strong` holds or the category favours it. */
  const rate = (id: TemplateId, missing: string | null, strong: string | null, possible: string): TemplateChoice => {
    if (missing) return { id, fit: "unavailable", reason: missing };
    if (strong) return { id, fit: "strong", reason: strong };
    // How the site looks counts before what kind of site it says it is.
    const lookReason = byLook.get(id);
    if (lookReason) return { id, fit: "strong", reason: lookReason };
    if (favoured.has(id)) return { id, fit: "strong", reason: `suits a ${kind}` };
    return { id, fit: "possible", reason: possible };
  };

  const templates: TemplateChoice[] = [
    rate("KineticHook", null, "opens every film", "opening"),
    rate("CTAEndCard", null, "closes every film", "closing"),
    rate("DeviceMockup", hasShots ? null : noShots, e.uploads > 0 ? `shows your ${plural(e.uploads, "uploaded screen")} on a device` : null, "the site on a laptop or phone"),
    rate("SectionShowcase", hasShots ? null : noShots, e.onPageFacts >= 3 ? `${e.onPageFacts} elements on the page the camera can visit` : null, "the page in a browser window"),
    rate("UIFlowCursor", hasShots ? null : noShots, null, "the page with a pointer clicking through it"),
    rate("ZoomDetail", !hasShots ? noShots : e.onPageFacts === 0 ? "no element positions were measured on the screenshots" : null, e.onPageFacts >= 5 ? `${e.onPageFacts} positioned elements to close in on` : null, "a close-up of one element"),
    rate(
      "FeatureCallouts",
      !hasShots ? noShots : e.onPageFacts < 2 ? "needs two positioned elements on one page to point at" : null,
      e.onPageFacts >= 6 ? "enough positioned elements to label several on one page" : null,
      "labels pointing at real elements",
    ),
    rate("ScreenCollage", e.multiSectionPages > 0 || e.uploads >= 2 ? null : "needs a page with several captured sections", null, "several parts of a page at once"),
    rate("IsoStack", e.multiSectionPages > 0 || e.uploads >= 2 ? null : "needs a page with several captured sections", null, "page sections as a 3D stack"),
    rate("Montage", e.screenshotPages + e.multiSectionPages >= 3 ? null : "needs at least three captures to cut between", videoType === "teaser" ? "fast cuts suit a teaser" : null, "a fast cut through the screens"),
    rate("PhotoShowcase", hasShots ? null : noShots, e.uploads > 0 ? "your uploads deserve the whole frame" : null, "one image filling the frame"),
    rate("StepByStep", !hasShots ? noShots : videoType !== "walkthrough" ? "only walkthrough videos are told in numbered steps" : null, `${plural(e.screenshotPages, "screen")} to walk through in order`, "a numbered walkthrough step"),
    rate("StatCounter", e.stats >= 1 ? null : "the site states no number that reads as a claim", e.stats === 1 ? "the site has one strong number" : null, "one number, counted up"),
    rate("MetricsRow", e.stats >= 2 ? null : "needs at least two numbers the site states", e.stats >= 2 ? `the site states ${plural(e.stats, "number")}` : null, "several numbers side by side"),
    rate("QuoteCard", e.quotes >= 1 ? null : "no testimonial that reads like a quote", e.quotes >= 1 ? `${plural(e.quotes, "quotable testimonial")} found` : null, "a customer quote"),
    rate("LogoWall", e.names >= 3 || e.logos >= 3 ? null : "needs at least three short names (customers, integrations)", e.logos >= 3 ? `${e.logos} logos captured from the site` : null, "a wall of names"),
    rate("FeatureTriplet", e.features >= 3 ? null : "needs three feature facts", e.features >= 6 ? `${e.features} features to choose three from` : null, "three features as cards"),
    rate("BentoGrid", e.features >= 3 ? null : "needs three feature facts", null, "one idea framing three points"),
    rate("ChecklistReveal", null, videoType === "walkthrough" ? "recaps the steps of a walkthrough" : null, "a short list, ticked off"),
    rate("SplitCompare", null, null, "before and after"),
    rate("BigStatement", null, null, "one line, poster-size"),
    rate("Composed", null, null, "a scene designed for this film from blocks"),
    rate("KineticType", null, videoType === "teaser" ? "type-led openings suit a teaser" : null, "one line as a full-frame poster"),
    rate("HeroRebuild", null, hasShots ? null : "stands in for the product reveal when there is no screenshot", "the site's headline rebuilt large"),
    rate("LogoReveal", e.hasLogo ? null : "no logo was found on the site", null, "a short logo bumper"),
  ];

  return { category, categorySignals: signals.slice(0, 5), evidence: e, look, templates };
}

/** The profile reduced to what the app shows while it works: what we found, and the scenes that fit. */
export function profileSummary(profile: SiteProfile): { category: string; signals: string[]; look: string; style: { tone: string; reason: string }; found: string[]; fits: { template: string; reason: string }[]; ruledOut: { template: string; reason: string }[] } {
  const e = profile.evidence;
  const found = [
    e.screenshotPages > 0 ? `${e.screenshotPages} ${e.screenshotPages === 1 ? "page" : "pages"} captured` : "no screenshots",
    ...(e.uploads > 0 ? [`${e.uploads} of your uploads`] : []),
    ...(e.onPageFacts > 0 ? [`${e.onPageFacts} elements located`] : []),
    ...(e.stats > 0 ? [`${e.stats} ${e.stats === 1 ? "number" : "numbers"}`] : []),
    ...(e.quotes > 0 ? [`${e.quotes} ${e.quotes === 1 ? "testimonial" : "testimonials"}`] : []),
    ...(e.features > 0 ? [`${e.features} features`] : []),
    ...(e.hasPricingPage ? ["pricing page"] : []),
    ...(e.hasLogo ? ["logo"] : []),
  ];
  const structural = new Set<string>(["KineticHook", "CTAEndCard"]);
  return {
    category: CATEGORY_LABEL[profile.category],
    signals: profile.categorySignals,
    look: profile.look.summary,
    style: { tone: profile.look.tone, reason: profile.look.toneReason },
    found,
    fits: profile.templates.filter((t) => t.fit === "strong" && !structural.has(t.id)).map((t) => ({ template: t.id, reason: t.reason })),
    ruledOut: profile.templates.filter((t) => t.fit === "unavailable").map((t) => ({ template: t.id, reason: t.reason })),
  };
}
