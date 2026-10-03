import {
  FULLPAGE_CAPTURE_DEPTH,
  READING_SECONDS_PER_WORD,
  EASE_CHOICES,
  SceneDocLlmOutput,
  compactSceneDoc,
  compileTimeline,
  readSecondsFor,
  resolveAnchors,
  textWindows,
  formatValidationErrorsForRetry,
  presetCatalog,
  readableTexts,
  validateStoryboard,
  wordCount,
  type CrawlOutput,
  type JobOptions,
  type SceneDoc,
  type Storyboard,
  type StoryboardScene,
  type ValidationIssue,
} from "@sitereel/shared";
import { costOfError, type LlmProvider } from "@sitereel/llm";
import { ICON_NAMES, stylePackFor } from "@sitereel/film-runtime";
import { deriveSiteLook } from "./site-look.js";
import { screenshotPageUrls } from "./storyboard-fallback.js";

/**
 * The composer: the planner picks what each scene says and shows; this designs how it looks and moves. For
 * every scene of a validated storyboard the model writes an HTML scene (@sitereel/shared scene-core.ts) — its
 * own layout, type and motion for that moment of this product — instead of the template the planner picked.
 * Every design is held to the same validators as the storyboard (grounding, reading time, crawled pages) plus
 * the format's own checks; one that fails twice keeps its template, so a film never fails because of this.
 */

/** Two scenes composed at once: each call is the slowest thing in the job, and providers rate-limit bursts. */
const CONCURRENCY = 2;
/**
 * After a rate-limit failure (the provider's own backoff already gave up), wait this long before the second try:
 * free tiers limit requests per minute, and the script writer has usually just spent part of that minute.
 */
const RATE_LIMIT_PAUSE_MS = 20_000;
const MAX_OUTPUT_TOKENS = 7000;
/** A design may lengthen its scene by this much so its last line holds long enough to read; past it the design is sent back. */
const MAX_STRETCH_SEC = 1.5;

export interface ComposeCall {
  sceneId: string;
  provider: string;
  attempt: number;
  ok: boolean;
  valid: boolean;
  costUsd: number;
  latencyMs: number;
  error?: string;
  rejected?: string[];
}

export interface ComposeResult {
  storyboard: Storyboard;
  /** Scenes now designed (HtmlScene). */
  composed: string[];
  /** Scenes that kept their template, and why. */
  kept: { sceneId: string; reason: string }[];
  calls: ComposeCall[];
  costUsd: number;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const EXAMPLE_HOOK: SceneDoc = {
  v: 1,
  nodes: [
    { id: "halo", parent: "@full", kind: "box", style: "position:absolute; left:20%; top:-25%; width:60%; height:90%; border-radius:50%; background:radial-gradient(circle, var(--accent-soft), transparent 68%)" },
    { id: "kicker", kind: "text", text: "For teams drowning in invoices", style: "font-family:var(--font-body); font-size:34px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--accent-text)" },
    { id: "line", kind: "text", text: "Close the books in an afternoon", style: "font-size:132px; line-height:1.02; letter-spacing:-0.035em; max-width:1500px", narrow: "font-size:104px" },
  ],
  timeline: [
    { target: "halo", from: "opacity:0; scale:.7", at: 0, duration: 1.6, ease: "power2.out" },
    { target: "line", preset: "mask-up", at: 0.15, stagger: 0.06 },
    { target: "kicker", preset: "fade-in", at: 0.9, duration: 0.4 },
    { target: "line", preset: "push-in", at: 1.2, duration: 2.3 },
  ],
};

const EXAMPLE_PRODUCT: SceneDoc = {
  v: 1,
  nodes: [
    { id: "row", kind: "box", style: "flex-direction:row; align-items:center; gap:64px; width:100%", narrow: "flex-direction:column; gap:36px" },
    { id: "copy", parent: "row", kind: "box", style: "align-items:flex-start; gap:18px; width:34%", narrow: "align-items:center; width:100%" },
    { id: "step", parent: "copy", kind: "text", text: "Step 2", style: "font-family:var(--font-body); font-size:30px; font-weight:700; color:var(--accent-text); letter-spacing:.1em; text-transform:uppercase" },
    { id: "title", parent: "copy", kind: "text", text: "Match every payment automatically", style: "font-size:76px; text-align:left", narrow: "text-align:center; font-size:72px" },
    { id: "app", parent: "row", kind: "frame", page: "https://example.com/product", fact: "f12", style: "flex:1; aspect-ratio:16/10", narrow: "width:100%; flex:none; aspect-ratio:4/5" },
    { id: "pointer", kind: "cursor", style: "left:62%; top:78%" },
  ],
  timeline: [
    { target: "app", preset: "slide-left", at: 0.1, duration: 0.8 },
    { target: "step", preset: "fade-in", at: 0.35, duration: 0.35 },
    { target: "title", preset: "words", at: 0.45 },
    { target: "app", preset: "focus", at: 1.6, anchor: "word:match", offset: -0.2 },
    { target: "pointer", preset: "fade-in", at: 2.2, duration: 0.25 },
    { target: "pointer", preset: "move", to: "el: app", at: 2.3 },
    { target: "pointer", preset: "click", at: 3.15, sfx: "click" },
  ],
};

export function buildComposerSystem(): string {
  return `You are the motion designer of a short product launch film. The planner has decided what one scene says and shows; you design how it looks and moves, as an HTML scene: a flat list of nodes styled with CSS, and a GSAP-style timeline. You design one scene at a time, for this product, at the level of a top studio's launch film: deliberate type, real product on screen, motion with intent.

THE CRAFT (hold every scene to these)
- One idea per scene. One dominant element; everything else supports it. The eye knows where to go in the first 300 ms.
- Fast in, then hold. Entrances are 0.3-0.9 s and start in the first second; then the scene holds still enough to read. Every readable line must be fully on screen and settled for 0.3 s per word (never under 0.8 s) before anything moves it away. Pace comes from motion and cuts, never from pulling text early.
- Things that appear one by one, simulated clicks and pages that move beat static slides. Stagger lists and cards. When the scene is about using the product, show the product page and have the cursor click the thing the line is about.
- Show the real thing. A page from the crawl (frame/shot/image) is the strongest material you have — make it big (55-70% of the frame width in landscape, full width in portrait), and move the camera onto the cited fact with a "focus" tween rather than showing a whole page too small to read.
- Typography: at most three sizes in a scene. Display lines 72-150px, supporting lines 30-44px, labels 26-32px uppercase with letter-spacing. Tight leading (1.0-1.15) and slightly negative tracking on big type. Nothing under 26px.
- Every frame postable: generous negative space, aligned edges (flex/grid, not scattered absolute positions), no clutter, no filler decoration. One soft accent glow or shape on the full layer is plenty.
- Fill the frame with intent: the settled content spans at least 40% of the frame's width or height. A small group floating in an empty frame reads as unfinished — an end card's call to action is 110-160px with the logo 120-180px.
- Colour only through the tokens. Accent is for the one or two things that carry the point, not for everything.
- The voice is heard while the scene plays: the screen says the short title of the idea, not the sentence the voice says. Tie key reveals to the word the voice says with anchor "word:<word>".
- No exits at the end: the film's cut takes the scene away. Only add an exit when content changes mid-scene.
- Never invent claims, numbers, names, logos or quotes. Text comes from the draft's on-screen lines or the scene's cited facts (shortened or re-cased is fine); figures (count nodes) are copied exactly from a cited fact. No emoji. Leave out anything in a fact that reads like a file name, id or hash ("RVyoq7Tt0INoj…") — it is noise from the crawl, not a name.

FORMAT
Output { concept, nodes, timeline }.
concept: one sentence describing the shot.

nodes: flat list, each a parent before its children. Fields: id (lowercase, dashes), parent, kind, plus kind fields, style, narrow, role.
- parent: omit for the title-safe area (a centred flex column — almost everything goes here or in a box inside it), "@full" for the full-frame layer behind it (backgrounds, glows, full-bleed pictures; never readable text), or the id of a box.
- kinds:
  box — a container (flex column, centred, gap 24px by default). The only kind with children.
  text — { text }: one line or short sentence, max 8 words. role "decor" for texture you don't need read (giant outlined type).
  count — { value }: a figure exactly as a cited fact writes it ("10,000+", "4.9"); counts up with preset "count-up".
  frame — { page, fact? }: a crawled page in a browser window. Scrolls ("scroll"), moves the camera onto fact ("focus"), plays its recording ("play"). fact must be one of the scene's cited facts measured on that page.
  shot — { page, fact? }: the same page without the window chrome, cut to the node's box.
  image — { page }: an uploaded image or a picture from the site, cover-fitted to the node's box.
  logo — the brand's logo (or its initial on an accent tile).
  icon — { icon }: a line icon; one of: ${ICON_NAMES.join(", ")}. Draws itself with preset "draw".
  cursor — a pointer (absolutely placed: give it left/top). Moves onto a node with preset "move" and to "el: <node id>", clicks with preset "click".
- style: CSS declarations ("display:flex; gap:32px; font-size:96px; color:var(--accent-text)"). Layout with flex/grid, widths in % or px. px lengths are for a 1920x1080 frame and scale for other formats. No url(), no fixed positioning.
- narrow: declarations applied on top of style when the film is portrait or square (switch rows to columns, shrink type). Always give one to any row layout.
- Tokens: var(--bg) var(--fg) var(--accent) var(--accent-text) (accent that reads as text) var(--on-accent) (text on an accent fill) var(--accent-alt) var(--accent-soft) (translucent accent wash) var(--surface) var(--border) var(--muted) (secondary text) var(--glow) var(--font-display) var(--font-body) var(--radius) var(--shadow) var(--card-bg) var(--card-border) var(--card-shadow) (the film's card recipe: background, border, box-shadow).
- Defaults: text is display font, 64px, bold, centred, var(--fg); count is 160px display; frame/shot are 78% wide 16:10 in landscape.

timeline: tweens, each { target, at, preset?, from?, to?, duration?, ease?, part?, stagger?, staggerFrom?, repeat?, yoyo?, anchor?, offset?, sfx? }.
- at: seconds from the scene start. from/to: declarations of animatable vars: opacity, x, y (px, or % of the node), scale, scaleX, scaleY, rotate, rotateX, rotateY, skewX, skewY, blur, brightness, letterSpacing (em), clip ("top right bottom left" inset in %, e.g. "clip: 0 100 0 0" hides it to the left edge), color/backgroundColor/borderColor (tokens allowed), scroll/focus/ring/play (frames), count (0-1), draw (0-1). GSAP semantics: a from-only tween animates from those values to the node's resting state; a to-only tween from wherever it is.
- part: "words" or "chars" (text nodes), "children" (a box's child nodes, in order), default the node itself. stagger: seconds between parts.
- ease: GSAP names — ${EASE_CHOICES.filter((e) => /\.(out|inOut)$|^none$/.test(e)).join(", ")}, also back.out(1.4)-style parameters.
- anchor: "word:<word>" starts the tween when the voice says that word (+ offset), "end" at the scene's end (+ offset, usually negative), "beat" on the next music beat. at stays the fallback time.
- sfx: "click", "pop", "whoosh", "hit" or "rise" fired as the tween starts — sparingly, on the gestures that would make a sound.
- repeat/yoyo: bounded loops for ambient motion (a float, a pulse).
- presets (a preset fills in from/to/duration/ease/part/stagger; anything you set overrides it):
${presetCatalog()}

MOTION BY TONE
- clean: expo.out / power3.out, mask-up and rise, no overshoot, small distances, quiet ambient push-in.
- playful: back.out and pop, bigger moves, a little rotation (2-6deg), cascades, a float on one element.
- cinematic: blur-in, slow push-in, huge type, long holds, few elements, dark negative space.
- app-store: slide-left, cascade of cards, scale-in, crisp power3.out, everything on a grid.

EXAMPLE — a hook (typographic, 3.5 s)
${JSON.stringify({ concept: "The promise set huge, rising word by word out of a mask over a soft accent glow.", nodes: EXAMPLE_HOOK.nodes, timeline: EXAMPLE_HOOK.timeline })}

EXAMPLE — the product in use (4.5 s)
${JSON.stringify({ concept: "The real page slides in beside the step title, the camera moves onto the matching panel as the voice says it, and the cursor clicks it.", nodes: EXAMPLE_PRODUCT.nodes, timeline: EXAMPLE_PRODUCT.timeline })}

JSON only, matching the schema.`;
}

/** What the scene is for in the film, from the template the planner chose for it. */
function intentOf(templateId: string, index: number, total: number): string {
  if (index === 0 || templateId === "KineticHook") return "the HOOK — the first two seconds decide whether anyone keeps watching: one bold line, instantly readable, and a visual reason to stay";
  if (index === total - 1 || templateId === "CTAEndCard") return "the END CARD — the product name or logo, the call to action and the domain, calm and confident; the film's last frame";
  if (["SectionShowcase", "UIFlowCursor", "DeviceMockup", "ZoomDetail", "StepByStep", "FeatureCallouts", "ScreenCollage", "IsoStack", "PhotoShowcase", "Montage"].includes(templateId)) return "the PRODUCT IN USE — the real page on screen, large, with the camera or the cursor on what the line is about";
  if (["StatCounter", "MetricsRow"].includes(templateId)) return "PROOF in numbers — the figures are the hero, counting up";
  if (templateId === "QuoteCard") return "SOCIAL PROOF — the customer's words, verbatim, with the weight of a pull quote";
  if (templateId === "LogoWall") return "SOCIAL PROOF — the real names, arriving one by one";
  if (templateId === "SplitCompare") return "BEFORE and AFTER — the old way against the product's way";
  if (["LogoReveal", "HeroRebuild"].includes(templateId)) return "the REVEAL — what the product is, straight after the hook";
  return "a FEATURE or CLAIM — one idea, made visual";
}

/** Narration words with rough start times (2.6 words/s after a short lead), for anchoring. */
function wordTimes(narration: string | undefined): string {
  if (!narration?.trim()) return "(no voice in this scene)";
  const words = narration.trim().split(/\s+/);
  return `"${narration.trim()}" — about ${words.map((w, i) => `${w}@${(0.25 + i / 2.6).toFixed(1)}s`).join(" ")}`;
}

function pagesBlock(crawl: CrawlOutput, cited: Set<string>): string {
  const lines = crawl.pages
    .filter((p) => p.screenshotKey)
    .map((p) => {
      const kind = p.origin === "upload" ? `an image the user uploaded${p.label ? ` ("${p.label}")` : ""} — use as image or shot` : p.origin === "image" ? `a picture from the site${p.label ? ` ("${p.label}")` : ""} — use as image` : `a crawled page${p.clip ? " (has a scroll recording: play)" : ""} — use as frame or shot`;
      const onPage = crawl.facts.filter((f) => cited.has(f.id) && f.sourceUrl === p.url && f.rect && f.rect.y + f.rect.h <= FULLPAGE_CAPTURE_DEPTH).map((f) => f.id);
      return `- ${p.url}: ${kind}${onPage.length ? `; cited facts measured on it (camera can focus on them): ${onPage.join(", ")}` : ""}`;
    });
  return lines.length > 0 ? lines.join("\n") : "- (none — this film has no pictures of the product; design with type, figures and icons)";
}

export interface ComposerContext {
  storyboard: Storyboard;
  crawl: CrawlOutput;
  options: JobOptions;
}

export function buildComposerPrompt(scene: StoryboardScene, index: number, ctx: ComposerContext): string {
  const { storyboard, crawl, options } = ctx;
  const total = storyboard.scenes.length;
  const cited = new Set(scene.factIds);
  const facts = crawl.facts.filter((f) => cited.has(f.id));
  const pack = stylePackFor(storyboard.tone);
  const look = deriveSiteLook(crawl);
  const prev = storyboard.scenes[index - 1];
  const next = storyboard.scenes[index + 1];
  const brand = crawl.brand;
  return `SCENE ${index + 1} of ${total} — ${intentOf(scene.templateId, index, total)}.
Length: ${scene.durationSec.toFixed(1)} s (it may be held a little longer if the voice runs over).
Formats this film is rendered in: ${options.formats.join(", ")} (design for 16:9; make it hold up in the others with narrow).

THE PLANNER'S DRAFT OF THIS SHOT
template it would otherwise use: ${scene.templateId}
its content: ${JSON.stringify(scene.props)}
on-screen lines: ${scene.onScreenText.map((t) => `"${t}"`).join(", ") || "(none)"}
${scene.emphasis?.length ? `words that carry the point: ${scene.emphasis.join(", ")}\n` : ""}voice: ${wordTimes(scene.narration)}

CITED FACTS (the only source for claims and figures in this scene)
${facts.map((f) => `- [${f.id}] (${f.kind}) ${f.text}${f.rect ? ` — on ${f.sourceUrl}` : ""}`).join("\n") || "- (none: a framing scene; no claims or figures)"}

PAGES AND PICTURES AVAILABLE (page values must be one of these urls)
${pagesBlock(crawl, cited)}

THE FILM
product: ${crawl.siteBrief.productName} — ${crawl.siteBrief.summary}
domain: ${crawl.domain}
tone: ${storyboard.tone} (cards: ${pack.card}; text reveal: ${pack.reveal}; corner radius x${pack.radius})
the site looks: ${look.summary}
brand: background ${brand.bg}, text ${brand.fg}, accent ${brand.accent} (${look.dark ? "dark" : "light"} brand); display font ${brand.fontDisplay}; body font ${brand.fontBody}; logo: ${brand.logoUrl ? "yes" : "none (logo node shows the initial)"}
before this: ${prev ? `${prev.templateId} — ${prev.onScreenText.join(" / ") || "(no text)"}` : "(this opens the film)"}
after this: ${next ? `${next.templateId} — ${next.onScreenText.join(" / ") || "(no text)"}` : "(this closes the film)"}
Make this scene look like it belongs to the same film as its neighbours, but don't repeat their layout.

Design the scene.`;
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

export interface ComposeOptions {
  /** Called with a short status line per scene (logging). */
  log?: (msg: string) => void;
}

interface Candidate {
  scene: StoryboardScene;
  errors: ValidationIssue[];
}

/** The designed scene that replaces `scene` (a template scene: what it falls back to), checked as a storyboard of its own. */
function candidateFor(scene: StoryboardScene, doc: SceneDoc, concept: string, ctx: ComposerContext): Candidate {
  const texts = readableTexts(doc);
  // The reading floor is arithmetic: a scene that shows more words gets the time to read them.
  const floor = Math.ceil(texts.reduce((n, t) => n + wordCount(t), 0) * READING_SECONDS_PER_WORD * 10) / 10;
  // So is a line that lands late and then holds to the cut: the scene runs until it has been read (a little longer than planned at most).
  const windows = textWindows(doc, compileTimeline(resolveAnchors(doc, { sceneDuration: scene.durationSec })), scene.durationSec);
  const held = Math.max(0, ...windows.filter((w) => w.leaves >= scene.durationSec - 1e-6).map((w) => w.settled + readSecondsFor(w.words)));
  const stretched = Math.ceil(Math.min(held, scene.durationSec + MAX_STRETCH_SEC) * 10) / 10;
  const emphasis = (scene.emphasis ?? []).filter((w) => texts.some((t) => t.toLowerCase().includes(w.toLowerCase())));
  const { emphasis: _drop, ...base } = scene;
  const designed: StoryboardScene = {
    ...base,
    templateId: "HtmlScene",
    durationSec: Math.max(scene.durationSec, floor, stretched),
    onScreenText: texts,
    props: { doc, concept, fallback: { templateId: scene.templateId, props: scene.props } },
    ...(emphasis.length > 0 ? { emphasis } : {}),
  };
  const report = validateStoryboard({ ...ctx.storyboard, scenes: [designed] }, ctx.crawl.facts, { pageUrls: screenshotPageUrls(ctx.crawl), iconNames: ICON_NAMES, cliches: true });
  return { scene: designed, errors: report.issues.filter((i) => i.severity === "error" && (i.sceneId === designed.id || !i.sceneId) && !i.message.startsWith("shareCaption")) };
}

async function composeOne(scene: StoryboardScene, index: number, ctx: ComposerContext, provider: LlmProvider, system: string, brief = ""): Promise<{ scene: StoryboardScene | null; reason: string; calls: ComposeCall[] }> {
  const calls: ComposeCall[] = [];
  const prompt = `${buildComposerPrompt(scene, index, ctx)}${brief}`;
  let retry: { previous: unknown; errors: ValidationIssue[] } | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    const fullPrompt: string = retry
      ? `${prompt}\n\nYour previous design of this scene:\n${JSON.stringify(retry.previous)}\n\nIt had these problems:\n${formatValidationErrorsForRetry({ valid: false, issues: retry.errors })}`
      : prompt;
    try {
      const out = await provider.generateJson<SceneDocLlmOutput>({ system, prompt: fullPrompt, schema: SceneDocLlmOutput, schemaName: "html_scene", maxOutputTokens: MAX_OUTPUT_TOKENS });
      const doc = compactSceneDoc(out.data as unknown as { nodes: Record<string, unknown>[]; timeline: Record<string, unknown>[] });
      const candidate = candidateFor(scene, doc, out.data.concept, ctx);
      const rejected = candidate.errors.map((e) => `${e.code}: ${e.message}`);
      calls.push({ sceneId: scene.id, provider: provider.id, attempt, ok: true, valid: rejected.length === 0, costUsd: out.costUsd, latencyMs: Date.now() - started, ...(rejected.length ? { rejected } : {}) });
      if (rejected.length === 0) return { scene: candidate.scene, reason: "composed", calls };
      retry = { previous: out.data, errors: candidate.errors };
    } catch (err) {
      calls.push({ sceneId: scene.id, provider: provider.id, attempt, ok: false, valid: false, costUsd: costOfError(err), latencyMs: Date.now() - started, error: (err as Error)?.message?.slice(0, 300) });
      // A transport failure is not something feedback fixes; one more plain try (after a rate limit, a later one), then give up.
      if (attempt === 1) {
        if (/\b429\b|quota|rate.?limit/i.test(String((err as Error)?.message))) await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS));
        continue;
      }
    }
  }
  const last = calls[calls.length - 1];
  return { scene: null, reason: last?.rejected?.[0] ?? last?.error ?? "no valid design", calls };
}

/** Runs `fn` over `items` with at most `limit` in flight, keeping order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!, i);
    }),
  );
  return out;
}

/**
 * Designs every scene of a validated storyboard. Scenes are composed in parallel (each sees its neighbours'
 * drafts, not their designs: the film's look, tokens and tone keep them coherent). The result always
 * validates: each scene is either a design that passed every check or the template scene it started as.
 */
export async function composeStoryboard(storyboard: Storyboard, crawl: CrawlOutput, options: JobOptions, provider: LlmProvider, opts: ComposeOptions = {}): Promise<ComposeResult> {
  const system = buildComposerSystem();
  const ctx: ComposerContext = { storyboard, crawl, options };
  const results = await mapLimit(storyboard.scenes, CONCURRENCY, async (scene, i) => {
    // Already designed (an edited storyboard sent back through planning): leave it.
    if (scene.templateId === "HtmlScene") return { scene, reason: "already designed", calls: [] as ComposeCall[] };
    const r = await composeOne(scene, i, ctx, provider, system);
    opts.log?.(`scene ${scene.id} (${scene.templateId}): ${r.scene ? "designed" : `kept template — ${r.reason}`}`);
    return r;
  });
  const scenes = storyboard.scenes.map((s, i) => results[i]!.scene ?? s);
  const calls = results.flatMap((r) => r.calls);
  return {
    storyboard: { ...storyboard, scenes },
    composed: storyboard.scenes.filter((s, i) => s.templateId !== "HtmlScene" && results[i]!.scene).map((s) => s.id),
    kept: storyboard.scenes.flatMap((s, i) => (results[i]!.scene || s.templateId === "HtmlScene" ? [] : [{ sceneId: s.id, reason: results[i]!.reason }])),
    calls,
    costUsd: calls.reduce((n, c) => n + c.costUsd, 0),
  };
}

/**
 * Re-designs one scene the way the editor asked ("make it punchier", "show the pricing page instead"). A designed
 * scene is re-composed from its current design (keeping what the instruction doesn't touch); a template scene is
 * designed for the first time. Same checks and one retry as composing; null when no valid design came back.
 */
export async function redesignScene(storyboard: Storyboard, sceneId: string, instruction: string, crawl: CrawlOutput, options: JobOptions, provider: LlmProvider): Promise<{ storyboard: Storyboard | null; reason: string; calls: ComposeCall[] }> {
  const index = storyboard.scenes.findIndex((s) => s.id === sceneId);
  const current = storyboard.scenes[index];
  if (!current) return { storyboard: null, reason: `no scene "${sceneId}"`, calls: [] };
  const designed = current.templateId === "HtmlScene" ? (current.props as { doc?: SceneDoc; fallback?: { templateId: string; props: Record<string, unknown> } }) : null;
  // Composed in its template form (the planner's draft carries the scene's intent and content); the design so far rides along.
  const base: StoryboardScene = designed?.fallback ? { ...current, templateId: designed.fallback.templateId as StoryboardScene["templateId"], props: designed.fallback.props } : current;
  const brief = [
    designed?.doc ? `\n\nTHE CURRENT DESIGN OF THIS SCENE (start from it; change what the editor asks, keep the rest):\n${JSON.stringify({ nodes: designed.doc.nodes, timeline: designed.doc.timeline })}` : "",
    `\n\nTHE EDITOR ASKS: ${instruction.trim() || "Design this scene again, better."}`,
  ].join("");
  const r = await composeOne(base, index, { storyboard, crawl, options }, provider, buildComposerSystem(), brief);
  if (!r.scene) return { storyboard: null, reason: r.reason, calls: r.calls };
  // A scene drawn by hand from a blank design has no template behind it: keep it that way.
  const scene = designed && !designed.fallback ? { ...r.scene, props: { ...(r.scene.props as Record<string, unknown>), fallback: undefined } } : r.scene;
  return { storyboard: { ...storyboard, scenes: storyboard.scenes.map((s, i) => (i === index ? scene : s)) }, reason: "redesigned", calls: r.calls };
}

/** The example designs the prompt teaches with — exported so a test can hold them to the format's own checks. */
export const COMPOSER_EXAMPLES = { hook: EXAMPLE_HOOK, product: EXAMPLE_PRODUCT };
