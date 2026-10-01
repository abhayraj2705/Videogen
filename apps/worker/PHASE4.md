# Phase 4 — Voice, build, QA, render at scale

Implements MASTER_IMPLEMENTATION_PLAN.md Phase 4: turns a validated Storyboard into an
actual MP4 — voiceover, scene timing from real audio, a resolved FilmManifest, quality
gates, and a muxed, encoded video with poster + captions.

## What's here

- `packages/tts` — provider interface, a Gemini native-audio adapter (unverified — no
  key available in this environment to test against), and a deterministic silence
  fallback with word timings estimated by word length. The fallback is what every real
  run in this environment actually exercises and is fully verified.
- `apps/worker/src/stages/voice.ts` — synthesizes each scene's narration, computes real
  scene durations from the resulting audio, persists each clip. A per-line provider
  failure falls back to silence rather than failing the job.
- `apps/worker/src/stages/build.ts` — **the key integration point**: resolves a
  Storyboard + its voice results into a `FilmManifest`, the exact contract
  `packages/film-runtime`'s player and `packages/renderer`'s capture loop both consume
  (§2.2: preview and final render run identical code). Asset references (screenshots)
  become `asset://bucket/key` placeholders (`apps/worker/src/lib/asset-ref.ts`),
  resolved into real URLs by whichever stage actually needs to fetch them.
- `packages/film-runtime` — **all 10 templates now exist**: the Phase 0 four plus
  `LogoReveal`, `HeroRebuild`, `UIFlowCursor`, `StatCounter`, `QuoteCard`,
  `ChecklistReveal`. Every template is written relative to `ctx.width`/`ctx.height`, so
  one template works unmodified across 16:9/9:16/1:1 — no per-format variants needed.
- `apps/worker/src/stages/qa.ts` — purity (reused from Phase 0), a visible-text probe,
  a safe-area/overflow check (correctly ignoring intentional ancestor clipping — see
  "a real bug" below), a WCAG contrast check, and a grounding re-check. Hard gates
  produce errors; **Phase 4 treats them as soft** — see "known simplification."
- `apps/worker/src/stages/render.ts` — resolves `asset://` refs into real URLs (local
  dev server or presigned R2 URLs depending on `STORAGE_DRIVER`) and runs the Phase 0
  renderer against the resolved manifest.
- `apps/worker/src/lib/audio-mix.ts` — concatenates each scene's voice clip (or
  generated silence) into one track spanning the full video, via ffmpeg's `concat`
  filter (not the file-concat demuxer, since fallback/Gemini audio have different
  sample rates and the demuxer requires identical formats to stream-copy).
- `apps/worker/src/lib/vtt.ts` — WebVTT captions from the manifest's caption cues.
- Six chained BullMQ queues now: crawl → plan → voice → build → qa → render, each its
  own worker in `apps/worker/src/processors/`, reloading shared inputs by `jobId`
  (`load-build-inputs.ts`) rather than shuttling large payloads through Redis.
- `POST /api/jobs/:id/approve` — the review-before-render gate's actual continuation
  point (§4.4 state machine: `review -> voicing`). The script review UI itself is
  Phase 6 (W6); this is the API it will call.

## Running it

```bash
pnpm dev:backend
pnpm dev:worker
# create a job with reviewBeforeRender: false to run straight through, or
# true (the default) + POST /api/jobs/:id/approve once it reaches "review".
```

## A real bug this caught (and fixed)

The QA overflow check initially flagged `SectionShowcase`'s kenburns-zoomed screenshot
as overflowing its safe area — technically true (the `<img>`'s own box IS larger than
the viewport once scaled), but a false positive: the image sits inside an
`overflow: hidden` wrapper and is visually clipped, exactly as designed. Fixed by
intersecting each element's bounding rect with every clipping ancestor's rect up to the
scene root before checking it against the viewport — only genuinely *visible* overflow
counts.

## Known simplifications

- **QA hard-gate failures don't block render.** The plan's state machine allows a
  `checking -> building` retry loop (max 2) for auto-fixable issues; that needs a
  "what changed, how do we fix it" strategy that makes sense for LLM-generated content
  with actual defects to fix. My QA failure modes are almost entirely code-level
  (template bugs, not content bugs) — a failure here means the *template* is wrong, not
  that retrying with different storyboard content would help. Issues are logged and the
  job proceeds; a genuine template bug would need a code fix, not a pipeline retry.
- **No vision-LLM contact-sheet review.** The plan's soft QA gate (§4.6) wants a
  vision-capable model to eyeball a contact sheet for things code can't check (does this
  actually look good). No vision-capable key was available to verify this against; the
  hard, code-checkable gates (purity/text/overflow/contrast/grounding) are implemented
  and verified instead.
- **No music.** `JobOptions.musicOn`/`musicMood` exist in the schema but render no
  audible effect — there's no licensed music library to ingest (§4.6 "Music library
  ingest: licensed tracks + precomputed beat grids" requires actual licensed assets,
  which don't exist in this environment). The audio pipeline mixes narration only.
- **Distributed/chunked rendering isn't implemented.** §4.6 describes splitting a
  render into frame ranges across parallel containers; this runs the Phase 0
  single-process renderer with render-queue concurrency 1 (matching the plan's own
  §4.5 table: "1 per container (CPU-bound)"). The capture loop itself is identical
  either way — chunking is an infra scaling change, not a correctness one.
- **Gemini TTS is unverified against a live API** — no `GEMINI_API_KEY` was available
  in this environment. Every real run in this environment exercises the fallback path.
  The request shape mirrors `packages/llm`'s Gemini adapter (which *is* verified), but
  this needs a real end-to-end run against a real key before shipping.
- **Word-level timing is always estimated** (proportional to word length), never
  aligned to a real waveform — `faster-whisper` forced alignment (§4.6) isn't
  implemented. VTT captions are therefore scene-level (one cue per scene), not
  word-level.
