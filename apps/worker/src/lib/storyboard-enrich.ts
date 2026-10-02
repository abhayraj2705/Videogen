import { validateStoryboard, wordCount, type CrawlOutput, type FactLedgerEntry, type Storyboard, type StoryboardScene, type TemplateId } from "@sitereel/shared";
import { isQuoteShaped, sanitizeClaimText, screenshotPageUrls, statParts, truncateWords } from "./storyboard-fallback.js";

/**
 * Scenes added by code, from the site's own material, after the planner has
 * done its work.
 *
 * A planner asked to "use the scenes that suit this site" does not always do
 * it — a small model in particular falls back on the same few safe templates,
 * and every film comes out as hook, device, stat, call to action, whatever
 * the site looks like and whatever the crawl found on it. So the scenes chosen
 * for the site (site-profile.ts featuredTemplates) are not left to the model:
 * any that are missing, and that the crawl has the material for, are built
 * here and cut in. They carry no narration — short picture beats between the
 * spoken lines, the way an editor drops in b-roll — so the script is untouched.
 */

type Draft = Pick<StoryboardScene, "templateId" | "props" | "onScreenText" | "factIds">;

interface Material {
  crawl: CrawlOutput;
  /** Fact ids the film already uses: an added scene should say something new. */
  usedFacts: Set<string>;
  /** Page urls the film already shows. */
  usedPages: Set<string>;
  allFactText: string;
}

const short = (f: FactLedgerEntry, max: number) => wordCount(f.text) >= 2 && wordCount(truncateWords(f.text, max)) >= 2;

/** A heading or feature the film has not used yet, optionally from one page, optionally one with a place on its screenshot. */
function freshFact(m: Material, opts: { page?: string; positioned?: boolean; kinds?: string[] } = {}): FactLedgerEntry | undefined {
  const kinds = opts.kinds ?? ["hero", "heading", "feature"];
  return m.crawl.facts.find(
    (f) => !m.usedFacts.has(f.id) && kinds.includes(f.kind) && short(f, 6) && (!opts.page || f.sourceUrl === opts.page) && (!opts.positioned || Boolean(f.rect)) && sanitizeClaimText(f.text, f.text) === f.text.trim(),
  );
}

const BUILDERS: Partial<Record<TemplateId, (m: Material) => Draft | null>> = {
  LogoWall(m) {
    const logos = m.crawl.pages.flatMap((p) => p.logos ?? []);
    const fact = m.crawl.facts.find((f) => f.selector === "logo-strip");
    if (logos.length < 3 || !fact) return null;
    // The line above the wall is the site's own, when it has one ("Trusted by teams at"); otherwise a plain one that claims nothing.
    const heading = m.crawl.facts.find((f) => /trusted|used by|loved by|teams at|companies|customers|works with|integrat|partners/i.test(f.text) && wordCount(f.text) <= 7 && sanitizeClaimText(f.text, "") === f.text.trim());
    const title = heading ? truncateWords(heading.text, 6) : "As seen on the site";
    return { templateId: "LogoWall", props: { title, names: logos.slice(0, 8).map((l) => l.name) }, onScreenText: [title], factIds: [fact.id, ...(heading ? [heading.id] : [])] };
  },
  PhotoShowcase(m) {
    const page = m.crawl.pages.find((p) => p.origin === "image" && p.screenshotKey && p.label && !m.usedPages.has(p.url));
    if (!page?.label) return null;
    const caption = truncateWords(sanitizeClaimText(page.label, m.allFactText), 7);
    if (wordCount(caption) < 2) return null;
    return { templateId: "PhotoShowcase", props: { sourcePageUrl: page.url, caption }, onScreenText: [caption], factIds: [] };
  },
  QuoteCard(m) {
    for (const f of m.crawl.facts) {
      if (f.kind !== "testimonial" || m.usedFacts.has(f.id)) continue;
      const quote = truncateWords(f.text.replace(/^[“"'‘]+/, ""), 8).replace(/[”"'’]+$/, "");
      if (isQuoteShaped(quote)) return { templateId: "QuoteCard", props: { quote }, onScreenText: [quote], factIds: [f.id] };
    }
    return null;
  },
  MetricsRow(m) {
    const stats = m.crawl.facts.filter((f) => f.kind === "stat" && !m.usedFacts.has(f.id) && statParts(f.text)).slice(0, 3);
    if (stats.length < 2) return null;
    const metrics = stats.map((f) => statParts(f.text)!);
    return { templateId: "MetricsRow", props: { metrics }, onScreenText: metrics.map((x) => x.label), factIds: stats.map((f) => f.id) };
  },
  StatCounter(m) {
    const f = m.crawl.facts.find((x) => x.kind === "stat" && !m.usedFacts.has(x.id) && statParts(x.text));
    if (!f) return null;
    const { value, label } = statParts(f.text)!;
    return { templateId: "StatCounter", props: { value, label }, onScreenText: [label], factIds: [f.id] };
  },
  ZoomDetail(m) {
    const page = m.crawl.pages.find((p) => p.screenshotKey && (p.origin ?? "crawl") === "crawl" && freshFact(m, { page: p.url, positioned: true }));
    const f = page && freshFact(m, { page: page.url, positioned: true });
    if (!page || !f) return null;
    const caption = truncateWords(f.text, 6);
    return { templateId: "ZoomDetail", props: { sourcePageUrl: page.url, caption }, onScreenText: [caption], factIds: [f.id] };
  },
  SectionShowcase(m) {
    // A page the film has not shown yet.
    const page = m.crawl.pages.find((p) => p.screenshotKey && (p.origin ?? "crawl") === "crawl" && !m.usedPages.has(p.url) && freshFact(m, { page: p.url }));
    const f = page && freshFact(m, { page: page.url });
    if (!page || !f) return null;
    const caption = truncateWords(f.text, 6);
    return { templateId: "SectionShowcase", props: { sourcePageUrl: page.url, caption }, onScreenText: [caption], factIds: [f.id] };
  },
  ScreenCollage: (m) => stackOf(m, "ScreenCollage"),
  IsoStack: (m) => stackOf(m, "IsoStack"),
  Montage(m) {
    const shots = m.crawl.pages.filter((p) => p.screenshotKey);
    const f = freshFact(m);
    if (shots.length + shots.filter((p) => (p.sectionScreenshotKeys?.length ?? 0) >= 2).length < 3 || !f) return null;
    const caption = truncateWords(f.text, 6);
    return { templateId: "Montage", props: { caption }, onScreenText: [caption], factIds: [f.id] };
  },
  KineticType(m) {
    const f = m.crawl.facts.find((x) => !m.usedFacts.has(x.id) && ["hero", "heading"].includes(x.kind) && wordCount(x.text) >= 3 && wordCount(x.text) <= 7 && sanitizeClaimText(x.text, x.text) === x.text.trim());
    return f ? { templateId: "KineticType", props: { text: f.text.trim() }, onScreenText: [f.text.trim()], factIds: [f.id] } : null;
  },
  BigStatement(m) {
    const f = m.crawl.facts.find((x) => !m.usedFacts.has(x.id) && ["hero", "heading"].includes(x.kind) && wordCount(x.text) >= 3 && wordCount(x.text) <= 8 && sanitizeClaimText(x.text, x.text) === x.text.trim());
    return f ? { templateId: "BigStatement", props: { text: f.text.trim() }, onScreenText: [f.text.trim()], factIds: [f.id] } : null;
  },
  FeatureTriplet(m) {
    const seen = new Set<string>();
    const picked: FactLedgerEntry[] = [];
    for (const f of m.crawl.facts) {
      if (f.kind !== "feature" || m.usedFacts.has(f.id) || wordCount(f.text) > 5 || wordCount(f.text) < 1 || sanitizeClaimText(f.text, f.text) !== f.text.trim()) continue;
      if (seen.has(f.text.toLowerCase())) continue;
      seen.add(f.text.toLowerCase());
      picked.push(f);
      if (picked.length === 3) break;
    }
    if (picked.length < 3) return null;
    const labels = picked.map((f) => f.text.trim());
    return { templateId: "FeatureTriplet", props: { features: labels.map((label) => ({ label })) }, onScreenText: labels, factIds: picked.map((f) => f.id) };
  },
};

function stackOf(m: Material, templateId: "ScreenCollage" | "IsoStack"): Draft | null {
  const page = m.crawl.pages.find((p) => p.screenshotKey && (p.origin ?? "crawl") === "crawl" && (p.sectionScreenshotKeys?.length ?? 0) >= 2 && freshFact(m, { page: p.url }));
  const f = page && freshFact(m, { page: page.url });
  if (!page || !f) return null;
  const caption = truncateWords(f.text, 6);
  return { templateId, props: { sourcePageUrl: page.url, caption }, onScreenText: [caption], factIds: [f.id] };
}

/** Seconds an added scene holds: long enough to read, short enough to stay a beat. */
const ADDED_SCENE_SEC = 2.8;

export interface EnrichResult {
  storyboard: Storyboard;
  /** Template ids of the scenes that were added, in film order. */
  added: TemplateId[];
}

/**
 * Cuts in scenes for the featured templates the storyboard does not use, while
 * the film is short of its scene count or uses fewer than two of them. Added
 * scenes go into the middle (never first or last), never beside a scene of the
 * same template, and only if they validate against the fact ledger like any
 * other scene. A storyboard that already does the job is returned unchanged.
 */
export function enrichStoryboard(storyboard: Storyboard, crawl: CrawlOutput, opts: { featured: TemplateId[]; targetScenes: number; maxAdded?: number; alsoConsider?: TemplateId[] }): EnrichResult {
  const maxAdded = opts.maxAdded ?? 2;
  let scenes = [...storyboard.scenes];
  const added: TemplateId[] = [];
  if (scenes.length < 2 || opts.featured.length === 0) return { storyboard, added };

  const pageUrls = screenshotPageUrls(crawl);
  const allFactText = crawl.facts.map((f) => f.text).join(" \n ");
  const hits = () => opts.featured.filter((t) => scenes.some((s) => s.templateId === t)).length;

  // The featured scenes first; then, if the film is still short of its scene count, the site's other good fits.
  for (const templateId of [...opts.featured, ...(opts.alsoConsider ?? []).filter((t) => !opts.featured.includes(t))]) {
    if (added.length >= maxAdded) break;
    if (!(scenes.length < opts.targetScenes || hits() < Math.min(2, opts.featured.length))) break;
    if (scenes.some((s) => s.templateId === templateId)) continue;
    const material: Material = {
      crawl,
      usedFacts: new Set(scenes.flatMap((s) => s.factIds)),
      usedPages: new Set(scenes.map((s) => (s.props as { sourcePageUrl?: unknown }).sourcePageUrl).filter((u): u is string => typeof u === "string")),
      allFactText,
    };
    const draft = BUILDERS[templateId]?.(material);
    if (!draft) continue;
    let id = `added-${templateId.toLowerCase()}`;
    while (scenes.some((s) => s.id === id)) id += "-x";
    const scene: StoryboardScene = { id, durationSec: ADDED_SCENE_SEC, ...draft };
    const check = validateStoryboard({ ...storyboard, scenes: [scene] }, crawl.facts, { pageUrls });
    if (check.issues.some((i) => i.severity === "error" && i.sceneId === id)) continue;

    // Into the middle, spread out: the first addition after the midpoint, the next just before the close.
    const wanted = added.length === 0 ? Math.ceil(scenes.length / 2) : scenes.length - 1;
    const slots = [wanted, ...Array.from({ length: scenes.length - 1 }, (_, i) => i + 1).filter((i) => i !== wanted)];
    const at = slots.find((i) => scenes[i - 1]?.templateId !== templateId && scenes[i]?.templateId !== templateId && !scenes[i - 1]?.id.startsWith("added-") && !scenes[i]?.id.startsWith("added-"));
    if (at === undefined) continue;
    scenes = [...scenes.slice(0, at), scene, ...scenes.slice(at)];
    added.push(templateId);
  }

  if (added.length === 0) return { storyboard, added };
  const enriched: Storyboard = { ...storyboard, scenes };
  // Whatever was added, the film as a whole must still validate; if not, the planner's own cut stands.
  return validateStoryboard(enriched, crawl.facts, { pageUrls }).valid ? { storyboard: enriched, added } : { storyboard, added: [] };
}
