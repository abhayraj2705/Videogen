# HTML + GSAP scene generation — audit and implementation plan

Status: **implemented** (see §0) · Branch it was written against: `quality-audit-fixes` (803342b)
Compared against: [latent-spaces/brag](https://github.com/latent-spaces/brag) (cloned at HEAD, Oct 2026)

---

## 0. What was built

| Piece | Where |
|---|---|
| Scene format, CSS allow-list, GSAP-style eases/presets, timeline compiler (from/to chaining, stagger, repeat/yoyo), anchors, reading-time analysis, structural checks — pure, no imports | `packages/shared/src/scene-core.ts` (subpath export `@sitereel/shared/scene-core`) |
| zod schemas, `HtmlScene` template id, validator integration (grounds only text and figures, never CSS) | `packages/shared/src/scene-doc.ts`, `storyboard.ts`, `storyboard-validators.ts` |
| Runtime: nodes → DOM (no model markup, no model script), frame-scaled styles, brand + card-recipe tokens, components (browser frame/shot with camera focus, scroll and recording; logo; icons that draw; counts; cursor that moves onto an element and clicks), auto-fit to the safe area, exit window | `packages/film-runtime/src/templates/html-scene.ts` |
| Composer: brag's craft rules + format + presets + two worked examples; per-scene prompt with role, draft, cited facts with positions, pages, voice timing, film look; full validation, one retry with the validator's words, template fallback per scene | `apps/worker/src/lib/scene-composer.ts`, wired at the end of `stages/plan.ts` |
| Build: per-node screenshots, page labels, camera targets, recordings; anchors pinned to measured voice words, beats and slot length; match cuts between window scenes | `apps/worker/src/stages/build.ts` |
| Editorial QA and SFX understand designed scenes (tween `sfx`, click/count-up implied) | `apps/worker/src/lib/editorial-qa.ts`, `sfx.ts` |
| AI redesign of one scene ("make it punchier") as a new version | `POST /api/jobs/:id/storyboard/redesign` → plan queue `reason: "redesign"` → `processRedesign` |
| Editor: element tree, click-to-select in the preview with a live outline, element inspector (content, page, camera target, CSS, portrait overrides), draggable timeline, motion inspector (preset, ease, from/to, sync to a spoken word / beat / end, sound), live checks, "use the template instead", design-from-blank, Ask-AI box | `apps/web/components/editor/html-scene-editor.tsx`, `lib/editor/html-scene.ts`, `scene-inspector.tsx`, `review-editor.tsx`, `film-preview.tsx`, `public/film/host.html` |
| Switch | `SITEREEL_HTML_SCENES=off` cuts films from templates alone; the design model is `GEMINI_SCRIPT_MODEL`, else Anthropic, else the primary |

**Deviation from §4: no GSAP library.** GSAP's standard licence prohibits use "in tools that allow users to build
visual animations without code" without written consent — which the timeline editor is. The format is GSAP's
model (tweens, from/to, eases by GSAP name, stagger, repeat/yoyo, chaining) evaluated by our own seek engine in
`scene-core.ts`, which is also smaller and deterministic by construction. Swapping real GSAP in is one driver if
legal clears it.

**Verified end to end** on a live crawl of cal.com (`pnpm pipeline run`, 20 s launch film, 16:9 + 9:16, voice off,
`GEMINI_SCRIPT_MODEL=gemini-3.5-flash`): 7/7 scenes designed and validated, browser QA passed in both formats with
0 blocking issues, vision review 4.5/5 (product 5, copy 5, legibility 4, composition 4), rendered 27.9 s films.
Fixed along the way, each with a test: Gemini rejects `maxItems` on rich object arrays (the model-facing schema
has none; limits are re-checked after); the composer paces itself and falls through to the primary model on a rate
limit; page screenshots and pictures in designed scenes are redrawn to canvas so camera zooms are frame-exact; the
runtime resets word boxes every seek (the player's emphasis lift otherwise survived into later frames); the
safe-area fit accounts for each element's largest animated scale; hashed logo file names are no longer taken as
customer names.

Not done from this plan: DOM-fragment capture of the live site (§5, phase 4), licensed music cue presets and the
CC0 SFX library (§5.5), contrast as a blocking error and mid-transition stills in QA (§5.4), a version-restore UI.

---

## 1. TL;DR

- **brag is not a platform.** It is an agent skill: a long prompt, a set of creative rules, a CC0 sound
  library, music with beat-cue presets, and a handoff to [Hyperframes](https://github.com/heygen-com/hyperframes)
  (HTML + GSAP compositions rendered by seeking headless Chrome). Its quality comes from **a frontier model
  writing bespoke HTML/CSS/GSAP for every video**, reusing the site's real markup, and a strict pre-render gate.
- **Our runtime is already the same architecture as Hyperframes.** `film-runtime` mounts DOM once and is driven
  purely by `seek(t)`; the renderer freezes time, seeks, screenshots, and encodes in parallel chunks with resume;
  QA proves purity pixel-for-pixel. What differs is *who writes the scene*: we have 25 hand-coded templates and
  the LLM only fills props. That is the creative ceiling, not the renderer.
- **Recommendation: keep our pipeline, replace the scene layer.** Add a new scene kind, `composed-html`, whose
  content is an LLM-authored **Scene Document**: sanitized HTML + scoped CSS on brand tokens + a **declarative
  JSON timeline** compiled to a paused GSAP timeline. Declarative motion is what makes the output editable
  (timeline bars, element inspector, AI patch edits), safe (no model-written JS), validatable (reading time is
  computable) and deterministic.
- Keep the template library as the fallback scene kind, so every film still ships if composition fails.
- Do **not** copy brag's agent-loop architecture (unbounded tool calls, free-form JS, re-prompt to edit). It is
  right for a one-off CLI run and wrong for a multi-tenant product with an editor.

---

## 2. What brag actually is

| Piece | What it does | Where |
|---|---|---|
| `skills/brag/SKILL.md` | Workflow: inspect → plan → compose brief → Hyperframes → render → poster → share copy | prompt only |
| `references/step-1..4`, `tones.md`, `audio.md` | 9-question rubric, storyboard format, 7 tones, readability floor, grounding rule, audio rules | prompt only |
| `skills/brag-slim/SKILL.md` | Same rules, no Hyperframes: the model builds and renders the whole video itself (Opus 5.5) | prompt only |
| `assets/music/*.mp3` + `cues/*.music-cues.json` | 5 licensed tracks with precomputed `beats[]` and `strongCues[]` | data |
| `assets/sfx/**` + `sfx-analysis.json` | ~300 CC0 SFX (Kenney, keypress pack) ranked by high-frequency risk | data |
| `scripts/analyze_music_cues.py` | Beat/strong-cue detection for any track | Python |
| Hyperframes | HTML with `data-composition-id`, `data-start`, `data-duration`, `data-track-index`; GSAP timelines registered on `window.__timelines` and seeked per frame; `lint`/`check`/`preview`/`render`/`snapshot`; Apache-2.0; has a Studio editor | external |

### Where brag's quality comes from

1. **Bespoke composition per video.** No catalog. Layout, typography and motion are designed for the product.
2. **Show the real thing** (slim): render the project's real components/markup/CSS and animate them instead of
   panning over flat screenshots. Prefer the product *in use* (entry → key action → result) over its marketing.
3. **Creative laws** applied as a contract: hook first, 15–25 s, "fast-in then hold", ~0.3 s/word reading floor
   counted from when the whole line is settled, never flash text on a fast beat (every other beat for text),
   one idea per scene, every frozen frame postable, no generic SaaS copy.
4. **Transitions that don't muddy:** old content out, then new in, or dip through the background — never a
   crossfade of two busy layouts. Stills are checked **mid-transition**, not just at rest.
5. **Audio treated as part of the edit:** real music, 1–3 major reveals locked to strong cues (±0.15 s),
   sequential items on the beat grid (±0.10 s), SFX aligned to the *start* of the motion, chosen by gesture
   (card sounds for cards, keys for typing), low HF-risk sounds for repeated hits, subtle RMS-reactive glow.
6. **A hard gate before render:** `hyperframes check` — layout overflow and WCAG contrast are errors, each
   contrast failure ships a suggested compliant colour.
7. **Poster = the strongest settled beat**, baked in as frame 0.

### Where brag is weak (for a product like ours)

- Single-shot, non-deterministic, minutes of agent time and many tool calls per video; no cost ceiling.
- Editing means re-prompting the agent. There is no structured model of the video to edit.
- Model-written JS runs unsandboxed; fine on a developer's laptop, not in a multi-tenant renderer.
- Grounding is a checklist the agent reads, not a validator. No fact ledger.
- No voiceover by default (Kokoro when asked), no captions, no formats pipeline, no QA beyond `check`.
- Depends on the strongest model available (slim is explicitly tuned for Opus 5.5).

---

## 3. Audit of our platform (SiteReel)

### Strong — keep as-is

| Area | What we have | Files |
|---|---|---|
| Crawl | Multi-page Playwright crawl, SSRF guard, section screenshots, scroll recordings, logos, uploads | `apps/worker/src/stages/crawl.ts`, `lib/page-capture.ts` |
| Grounding | Fact ledger with on-page rects; validators reject ungrounded numbers/claims | `packages/shared/src/storyboard-validators.ts`, `lib/fact-ledger.ts` |
| Script | Strategy + voiceover written first, critic pass, then storyboard cut to it | `lib/script-writer.ts`, `stages/plan.ts` |
| Voice | TTS with word timings, caching, fallback chain | `packages/tts`, `stages/voice.ts` |
| Timing | Scene slots from measured narration, beat-snapped cuts, transition overlaps | `film-runtime/src/timing.ts` |
| Runtime contract | Mount once, `seek(t)` only, seeded RNG, no wall-clock | `film-runtime/src/contract.ts`, `player.ts` |
| Renderer | Virtual clock, chunked parallel lanes, segment cache/resume in object storage, poster bake, motion blur, watermark | `packages/renderer/src/render.ts`, `virtual-clock.ts` |
| QA | Purity (re-seek + fresh load), text visible at settle, overflow, safe area, clipping, contrast, fill, contact sheet, vision rubric, editorial checks | `packages/renderer/src/qa.ts`, `stages/qa.ts` |
| Product | Jobs, SSE progress, billing, shares, brand kits, versioned storyboards, undo/redo, re-voice | `apps/backend`, `apps/web` |

This is far more than brag has. None of it needs to be thrown away.

### Weak — what blocks "very high quality"

1. **Creative ceiling = the template catalog.** 25 imperative templates (~120–230 lines each, hand-written
   easing math per element). The LLM picks an id and fills props (`planner-prompt.ts` `TEMPLATE_CATALOG`).
   Every film is a rearrangement of the same 25 shots; `docs/known-weak-points.md` already notes two different
   sites can get the same film. Four style packs is the only variation in look.
2. **Screenshots, not the site.** The crawl stores screenshots, rects and text — never DOM or CSS
   (`CrawledPage` in `packages/shared/src/site.ts`). Text inside screenshots is small on a phone
   (known weak point), zooms get soft, and nothing on the page can be animated individually.
3. **Motion is expensive to add.** A new shot = a new template + validator + planner docs + editor label +
   fallback logic. That is why the catalog grew slowly and why the "Composed" block template exists.
4. **Editing is text-and-props only, and the preview isn't the render.** The editor edits `onScreenText`,
   narration and props; the preview uses **placeholder SVG screenshots and estimated timing**
   (`apps/web/lib/editor/preview-manifest.ts`, banner in `review-editor.tsx`). There is no element selection,
   no timeline, no way to change *how* something moves, no "make this scene punchier".
5. **Audio placeholders.** Music is synthesized, SFX are synthesized, drop-landing is untested on real music
   (known weak points). brag's licensed tracks + cue presets + CC0 SFX analysis are exactly this gap.
6. **Length overruns** when code adds scenes; nothing trims back.
7. **Contrast is a warning**, not a gate (brag/Hyperframes treat it as an error with a fix suggestion).
8. **Poster** is always the first scene's settle, not the strongest moment.
9. **Preview iframe is not sandboxed** (`apps/web/public/film/host.html`, `film-preview.tsx`). Harmless with
   our own templates; must be fixed before running model-authored HTML.

### Side-by-side

| Dimension | brag | SiteReel today | SiteReel with this plan |
|---|---|---|---|
| Who designs the shot | Frontier model, free-form | Engineers (templates); LLM fills props | LLM authors constrained Scene Docs; templates as fallback |
| Motion | GSAP, free JS | Hand-written seek math | GSAP compiled from declarative JSON timeline |
| Real site material | Real markup/CSS (slim) | Screenshots | Captured DOM fragments + screenshots |
| Grounding | Checklist | Validators on fact ledger | Same validators, run on every text node |
| Determinism | Hyperframes seek | Virtual clock + purity QA | Unchanged (GSAP paused + `tl.seek`) |
| Gate | `hyperframes check` | Purity/overflow/safe-area/clip; contrast warn | + timeline lint, reading-time, mid-transition stills, contrast as error, repair loop |
| Editing | Re-prompt agent | Text/props, placeholder preview | Element inspector, timeline panel, AI patch edits, real preview |
| Audio | Licensed music + cues, CC0 SFX, RMS-reactive | Synth music/SFX, beat snap | brag-style cue presets, SFX bound to tweens, RMS vars |
| Cost/latency | Unbounded agent loop | Bounded LLM calls | Bounded: 1 look call + N parallel scene calls + ≤1 repair per scene |

---

## 4. Target architecture

```
crawl ─► facts + screenshots + DOM fragments (new) ─► script ─► director (storyboard v2: intent, copy, facts)
                                                                     │
                                         look doc (new, 1 call) ─────┤
                                                                     ▼
                                      composer (new, 1 call per scene, parallel) ─► Scene Docs
                                                                     │
                     lint + sanitize + grounding + reading-time ─────┤  fail ×2 ─► template fallback
                                                                     ▼
                     review (editor: inspector, timeline, AI edit) ─► voice ─► build (resolve anchors/assets)
                                                                     ▼
                     QA (existing probes + stills incl. mid-transition + vision) ─► repair ≤1 ─► render (unchanged)
```

### 4.1 The Scene Document (the core decision)

A scene is data, not code. Stored inside the storyboard JSON, so versions/undo/conflicts keep working.

```ts
// packages/shared/src/scene-doc.ts  (new)
SceneDoc = {
  version: 1,
  /** Sanitized markup as a tree (hast-like), not a string: the editor edits nodes, the compiler emits HTML. */
  tree: Node,                       // allowed tags + our components only; every node has a stable `el` id
  /** Scoped to [data-scene="<id>"]; only brand/look tokens (var(--…)) for colour, font, radius, shadow. */
  css: string,
  timeline: Tween[],
  /** Derived, not authored: which nodes are text/image/colour slots the editor exposes. */
}

Tween = {
  id: string,
  target: string,                   // "@el:headline" | "@el:headline .word" | "@el:cards > *"
  preset?: PresetName,              // "rise" | "typewriter" | "maskReveal" | "countUp" | "drawPath"
                                    // | "cursorClick" | "pageScroll" | "cameraTo" | "pop" | "marquee" …
  from?: AnimVars, to?: AnimVars,   // allow-listed props: x y scale rotate opacity clipPath filter(blur) color…
  at: number | Anchor,              // seconds from scene start, or an anchor resolved at build
  duration: number,
  ease?: EaseName,                  // allow-listed GSAP eases
  stagger?: number | { each: number, from?: "start" | "center" | "end" },
  sfx?: SfxRef,                     // fired at `at` (brag rule: sound on the start of the motion)
}

Anchor = { word: string, offset?: number }          // when the narration says this word
       | { beat: "next" | "strong", offset?: number } // music grid / strong cue
       | { after: TweenId, offset?: number }          // relative to another tween
```

Why declarative instead of model-written GSAP JS:

- **Editable**: a tween is a bar on a timeline; changing `at`/`duration`/`ease`/`preset` is a form field.
- **Safe**: no model-written JS ever executes, in the renderer or in a user's browser.
- **Computable**: when every text node is fully visible, and for how long, is arithmetic → the reading floor,
  "fast-in then hold" and "settle" marks are validated before any pixel is rendered.
- **Retimable**: anchors re-resolve when the voice is re-recorded or the music changes; brag hard-codes seconds.
- **Exportable**: compiles 1:1 to a Hyperframes composition (`data-start`/`data-duration`, `window.__timelines`)
  if we ever want their Studio or Lambda renderer.

### 4.2 Components the model composes with (not reinvents)

Hard things stay engineered. They become custom elements the composer places, each exposing GSAP-animatable
properties and presets. Most are lifted from code we already have:

| Component | Reuses | Animatable |
|---|---|---|
| `<sr-browser page=… >` | `util/browser-frame.ts` | `scroll`, `cameraTo(factRect)`, `highlight(factRect)` |
| `<sr-device kind=laptop|phone>` | `device-mockup.ts` | `turn`, `scroll`, plays page `clip` |
| `<sr-shot src=… focus=…>` | `zoom-detail.ts` | `cameraTo`, `kenBurns` |
| `<sr-cursor>` | `ui-flow-cursor.ts` | `moveTo(@el / factRect)`, `click` |
| `<sr-text>` | `util/text-fit.ts`, `textBlock` word spans | `.word`/`.char` split targets, auto-fit to box |
| `<sr-count value=…>` | `stat-counter.ts` | `countUp` (value must be a cited fact) |
| `<sr-logo>` | brand logo + `stabilizeImage` | continuity with the film-level brand mark |
| `<sr-icon name=…>` | `util/icons.ts` | `drawPath` |
| `<sr-fragment ref=…>` | **new** captured site DOM (phase 4) | any child by `el` id |

The film-level layers in `player.ts` (backdrop, brand mark continuity, grain, captions, camera drift, cut
styles incl. match cuts) stay owned by the player, not by scenes.

### 4.3 The Look Doc (coherence across scenes)

One LLM call per film, before composing scenes, from `site-look.ts` + brand extraction + tone:
CSS custom properties (type scale, weights, tracking, radii, surface/border/shadow recipes, accent gradient)
and a **motion personality** (default eases, durations, stagger, overshoot allowed or not, transition set).
Every scene's CSS may only use these tokens. Switching tone in the editor = swapping the Look Doc; no scene
is regenerated. Replaces the 4 fixed style packs (`film-runtime/src/style.ts` becomes the fallback look).

### 4.4 Runtime integration (`film-runtime`)

- New template `composed-html` implementing the existing `SceneTemplate` contract:
  `mount()` compiles tree → DOM under the scene root, injects scoped CSS, splits text, builds one
  `gsap.timeline({ paused: true })` from the tweens; `seek(localT)` → `tl.seek(localT, false)`;
  `marks()` → `settle` = end of the last text-entering tween (computed, not guessed).
- Determinism rules enforced by the compiler: no `repeat: -1` (bounded repeats only), no ScrollTrigger,
  no `gsap.utils.random` (replaced by `ctx.rng`), `gsap.ticker.lagSmoothing(0)` and ticker unused,
  all fonts loaded before `SplitText`. The existing purity QA is the proof.
- GSAP bundled into `film-bundle.js` by `packages/renderer/src/bundle.ts` (esbuild); no CDN at render time.
- The player keeps owning cuts, so the brag lesson "no muddy double exposure" stays enforced in one place.

### 4.5 Security

- Server-side sanitize on every write (composer output, editor saves, AI edits): tag/attribute allow-list,
  no `<script>`, no `on*`, no `style` attributes with `url()` except `asset://` refs, CSS parsed with
  `css-tree` and filtered (no `@import`, no external `url()`, no `position: fixed` escaping the stage).
- Renderer and QA pages: route-intercept and block every request that isn't the film server/asset store.
- Preview iframe: add `sandbox="allow-scripts"` (no same-origin) and a strict CSP in `host.html`.

---

## 5. Generation pipeline changes

### 5.1 Director (replaces template picking in `stages/plan.ts`)

Same grounding, same script-first flow, same retry/salvage/fallback chain. Output changes: each scene gets an
**intent** (`hook | reveal | flow-step | proof | feature | punchline | cta`), a **shot idea** in one sentence
("cursor clicks 'Generate', three clips drop in"), copy, facts, assets to use, and an optional
`fallbackTemplateId`. Storyboard v2 is additive per the v1 freeze note: `scene.kind: "template" | "composed"`,
`scene.doc?: SceneDoc`, `film.look?: LookDoc`. Every stored v1 storyboard still parses.

Prompt gets brag's rules verbatim where they're better than ours: the flow-over-marketing bias
(`step-2-plan.md` "Bias the storyboard toward the user flow"), sequential text on every other beat,
"at most one stat/headline block as a frame around the flow", tone→scene-count/transition table.

### 5.2 Composer (new `stages/compose.ts`, `lib/composer-prompt.ts`, `lib/look-doc.ts`)

- One call per scene, in parallel, strongest model available (`packages/llm` already has Anthropic; use
  prompt caching for the shared system block: rules, component docs, Look Doc, presets, examples).
- Input: scene intent + copy + cited facts (with rects), the Look Doc, assets with pixel sizes, format,
  slot duration estimate, neighbouring scenes' summaries (for match cuts and variety).
- Output: Scene Doc via structured output, then: sanitize → schema → lint → grounding (every text node must
  pass the same validators `onScreenText` passes today) → reading floor from the timeline → safe-area estimate.
- On failure: one retry with the issues (same pattern as `tryOnce`/`withErrors`); then the scene's
  `fallbackTemplateId` (existing template). A film can mix both kinds.
- Few-shot library: hand-author ~15 excellent Scene Docs (port the best existing templates into Scene Docs —
  this also proves the format covers them) and retrieve 2–3 by intent + look.

### 5.3 Build (`stages/build.ts`)

Resolve anchors against voice word timings (generalizes today's `listCues`/`emphasisMoment`), beats and strong
cues; resolve `asset://` refs (existing `resolveProps` logic moves into component attribute resolution);
derive `posterTime` from the scene the director marked as the strongest beat (brag), not always scene 1;
**trim to target length** by shortening holds above the reading floor (fixes the overrun weak point).

### 5.4 QA + repair loop (`stages/qa.ts`, `packages/renderer/src/qa.ts`)

Add to existing probes:
- stills at **mid-transition** for every cut, into the contact sheet (brag-slim);
- contrast becomes an **error** with a suggested token adjustment (Hyperframes `check`);
- per-tween readability: text visible ≥ 0.3 s/word before its exit (from the compiled timeline);
- **one targeted repair**: failing scene + its stills + issues → composer returns a JSON Patch to the Scene Doc;
  re-probe only that scene. Second failure → template fallback for that scene.

### 5.5 Audio (borrow brag's model)

- Music library with cue presets in the same shape as brag's `*.music-cues.json` (`beats[]`, `strongCues[]`);
  license real tracks (verify ende.app terms before reuse; do not copy brag's MP3s by default).
- SFX: Kenney and the keypress pack are CC0 — import a curated set with an HF-risk table like
  `sfx-analysis.json`; tweens carry `sfx`, so `lib/audio-mix.ts` receives exact event times.
- Lock 1–3 major reveals to strong cues (±0.15 s), sequential non-text items to the grid (±0.10 s), text items
  every other beat. Anchors make this a build-time solve, not a prompt hope.
- Precompute per-frame RMS/bass into the manifest; expose as `--rms`/`--bass` CSS vars the Look Doc may use
  for subtle glow/presence only.

---

## 6. Editor ("proper editing")

Principle: **every edit is an operation on the Scene Doc**, so manual and AI edits share undo, versions,
validation and preview.

1. **Preview = render.** New backend route returns the build-resolved manifest for the saved version
   (signed asset URLs, real word timings, real music grid). Retire placeholder screenshots in
   `preview-manifest.ts`; keep it only for instant feedback between debounced server rebuilds.
2. **Click to select on the canvas.** The host iframe reports the `el` id under the pointer; an overlay draws
   the box. Inspector shows the node's slots: text (with fact badges — reuse `fact-badge.tsx`/`grounding.ts`),
   image (asset picker incl. uploads), colour token, size step on the type scale, alignment, hide.
   Free x/y dragging is **not** offered in v1: layout stays in flex/grid so all formats keep working.
3. **Timeline panel.** Tracks per element, bars per tween; drag to move/resize, ease and preset pickers,
   anchors shown as pins on the narration words and beat ticks; snap to words/beats. Scene boundaries and
   cut types on a film-level ruler.
4. **AI edits, scoped.** "Make this punchier", "show pricing instead", "slower reveal" → composer returns a
   JSON Patch against one Scene Doc; shown as a diff (before/after stills), applied as one undo step.
   Film-level prompts ("more playful") edit the Look Doc.
5. **Regenerate scene / variations:** 3 alternatives for one scene, pick one.
6. **Live validation** in the client: schema, grounding, reading floor, a fast in-iframe safe-area probe;
   server QA still gates approval (`approveVersion` unchanged).
7. History store (`lib/editor/history-store.ts`) gets patch-based entries with coalescing for drags.

---

## 7. Phased delivery

Estimates are rough engineering weeks for one or two people; re-estimate after Phase 0.

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Spike** (~1 wk) | GSAP in `film-bundle.js`; minimal `composed-html` template taking hand-written tree/CSS/timeline; 3 hand-authored scenes in a fixture film; `pnpm phase0:render` + `phase0:purity` | Purity passes at 30 and 60 fps; chunked render time per frame within ~20% of templates; **GSAP license cleared** (see risks) |
| **1. Format** (~2 wks) | `scene-doc.ts` schemas, compiler, sanitizer (shared, isomorphic), lint, timeline readability, components wrapping existing utils, Storyboard v2 additive, build anchors, QA settle marks from timeline; port 5 templates to Scene Docs as fixtures | All v1 storyboards parse; ported scenes visually match their templates; sanitizer fuzz tests |
| **2. Composer** (~2–3 wks) | Look Doc, director intents, composer + retry + fallback, few-shot library, mid-transition stills, contrast-as-error, repair loop, length trim, strongest-beat poster; feature flag in `lib/features.ts` | On `benchmark/urls.json`: higher vision rubric than templates, ≥ 90% films pass QA without fallback scenes, cost and latency per film recorded in `plan-eval` |
| **3. Editor** (~3 wks) | Server-resolved preview, iframe sandbox + CSP, element select + inspector, timeline panel, scoped AI patch edits, variations | Editor e2e (`apps/web/e2e`) covers select→edit→save→approve; preview frame matches render frame at same t |
| **4. Real material + audio** (~2–3 wks) | DOM fragment capture in crawl (`lib/fragment-capture.ts`: serialize key sections with computed styles, rehost images/fonts, screenshot fallback), `<sr-fragment>`; licensed music + cues; CC0 SFX + HF table; SFX on tweens; RMS vars | Fragments render crisp at 2× zoom on phone formats; real-music films land 1–3 strong-cue locks |
| **5. Rollout** | % rollout by plan/tier, dashboards (fallback rate, repair rate, QA fails, cost), human rating sheet filled, templates become fallback-only; optional Hyperframes export | Rated better than template films by eval panel; fallback rate stable |

---

## 8. File-level change map

| Area | Change |
|---|---|
| `packages/shared/src/scene-doc.ts` | **new**: SceneDoc, Tween, Anchor, LookDoc schemas + sanitizer allow-lists |
| `packages/shared/src/storyboard.ts` | additive v2 fields (`kind`, `doc`, `look`, `intent`, `fallbackTemplateId`) |
| `packages/shared/src/storyboard-validators.ts` | ground every text node of a doc; timeline reading floor; lint codes |
| `packages/film-runtime/src/composed/` | **new**: compiler, gsap driver, presets (`gsap.registerEffect`), components |
| `packages/film-runtime/src/registry.ts`, `player.ts` | register `composed-html`; settle/poster from timeline |
| `packages/renderer/src/bundle.ts`, `render.ts`, `qa.ts` | bundle GSAP; network lockdown; mid-transition stills; contrast error; readability probe |
| `apps/worker/src/stages/compose.ts` + `lib/composer-prompt.ts`, `lib/look-doc.ts` | **new** |
| `apps/worker/src/stages/plan.ts`, `lib/planner-prompt.ts` | director intents; brag rules; drop catalog dump for composed scenes |
| `apps/worker/src/stages/build.ts` | anchor resolution, component asset resolution, length trim, poster choice |
| `apps/worker/src/stages/qa.ts` | repair loop + per-scene fallback |
| `apps/worker/src/lib/fragment-capture.ts` | **new** (phase 4) |
| `apps/worker/src/lib/music.ts`, `sfx.ts`, `audio-mix.ts`, `assets/` | cue presets, CC0 SFX, tween-driven SFX events, RMS export |
| `apps/backend/src/routes/storyboards.ts` | preview-manifest route, scene AI-edit route (patch), variations |
| `apps/web/components/editor/*`, `apps/web/public/film/host.html` | canvas selection overlay, inspector slots, `timeline-panel.tsx`, AI edit dialog, sandbox/CSP |

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| **GSAP license.** GSAP is free (incl. plugins) under its own standard license, which has restrictions on certain competing products. We ship a video generator with a visual editor. | Legal review of the current GSAP license text in Phase 0, before any other work. If it doesn't fit: the Scene Doc is engine-agnostic — compile tweens to our own easing/seek code (we already have `util/easing.ts`) or to anime.js. This is a second reason to keep motion declarative. |
| LLM layouts break (overflow, collisions) | Components carry the hard layouts; auto-fit text; existing probes; repair loop; template fallback per scene |
| Cost / latency up | Parallel scene calls, prompt caching, one repair max; measure in Phase 2 against current plan-stage cost before rollout |
| Determinism regressions | Compiler forbids non-seekable features; purity QA unchanged and blocking |
| Model-authored markup as an attack surface | Sanitize on every write, no JS from the model, sandboxed preview, network-locked renderer |
| Weak default model gives generic scenes (already seen with flash-lite) | Composer requires a strong model tier; below it, use templates (flag per tier) |
| Editor scope creep | v1 has no free positioning; layout edits go through tokens/AI edits |

---

## 10. What we deliberately don't take from brag

- The agent loop as the production path (unbounded, non-deterministic, uneditable).
- Free-form GSAP/JS written by the model.
- Hyperframes as a runtime dependency in workers: our renderer already does seek-capture with chunking,
  resume and QA they don't need to replace. We keep the HTML contract compatible so export stays possible.
- brag's bundled MP3s (licence is the track author's, not the repo's) — license our own; the CC0 SFX are fine.
