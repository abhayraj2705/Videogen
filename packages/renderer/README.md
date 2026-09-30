# @sitereel/renderer — Phase 0

Single-process Playwright + ffmpeg renderer, proving that `packages/film-runtime`
templates driven by hand-written `FilmManifest` JSON produce a video worth shipping,
before any pipeline infrastructure gets built (see `MASTER_IMPLEMENTATION_PLAN.md` §Phase 0).

## Commands

```bash
pnpm install

# Render every fixture in benchmark/fixtures/*.manifest.json to packages/renderer/out/*.mp4
pnpm phase0:render

# Render just one
pnpm --filter @sitereel/renderer run render notely

# Purity test (seek(t) must be pixel-identical every time) for every fixture
pnpm phase0:purity
pnpm --filter @sitereel/renderer run purity notely
```

## Preview in a browser (scrub bar, no capture)

```bash
pnpm --filter @sitereel/renderer exec tsx -e "import('./src/bundle.js').then(m=>m.bundleFilmEntry())"
pnpm --filter @sitereel/renderer exec tsx -e "import('./src/server.js').then(m=>m.startFilmServer('../../benchmark/fixtures'))"
# then open http://127.0.0.1:4100/preview.html?manifest=http://127.0.0.1:4100/notely.manifest.json
```

(A `pnpm phase0:preview` convenience script is a good Phase 1 cleanup item — kept manual here to avoid adding a long-lived process to the Phase 0 script surface.)

## How it fits the plan

- `packages/film-runtime` — the `__film` contract, seeded RNG, easing, text-fit, and
  the 4 Phase 0 templates (`KineticHook`, `FeatureTriplet`, `SectionShowcase`, `CTAEndCard`).
  Shared verbatim by the browser preview and the renderer (§2.2 decision).
- `packages/renderer` — bundles `film-entry.ts` (imports film-runtime) into a browser
  IIFE, serves it plus the job's manifest/assets over a local static server standing in
  for `FILM_HOST`, then drives Chromium frame-by-frame through a virtual clock and pipes
  PNG screenshots into ffmpeg.
- `benchmark/fixtures/*.manifest.json` — 3 hand-written manifests (no LLM), one SaaS,
  one e-commerce, one Indian SMB, per the Phase 0 task list. Their `*.screenshot.svg`
  files stand in for real crawled screenshots so Phase 0 stays fully offline.

## Exit criteria (from the plan)

- [ ] You (+3 outside the team) would post at least 2 of the 3 videos.
- [ ] Purity test passes on all 3.
- [ ] 20s 1080p renders in under 2 minutes on one machine.

Run `pnpm phase0:purity` and `pnpm phase0:render`, then watch the 3 MP4s in
`packages/renderer/out/` to judge the first two; render time is printed per fixture.
