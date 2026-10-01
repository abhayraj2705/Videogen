# Phase 5 — Web app end to end

Implements MASTER_IMPLEMENTATION_PLAN.md Phase 5: the actual product UI, wired to the
real backend built in Phases 1-4. Verified with a real browser (Playwright), not just
typecheck/build — see "Verification" below.

## What's here

- **Landing page** (`app/(marketing)/page.tsx`, W1) — hero with a URL box that routes
  straight to `/new?url=...`, how-it-works strip, feature grid, final CTA.
- **Create page** (`app/(app)/new/page.tsx`, W4) — live SSRF-safe URL preview (debounced,
  hits the Phase 2 `/api/url/preview` route), format/length/tone/voice/music option
  cards, consent gate, credit cost. Wrapped in `Suspense` (reads `?url=` via
  `useSearchParams`).
- **Live pipeline / review / result** (`app/(app)/videos/[id]/page.tsx`, W5+W6+W7+W8,
  one route with states per §3.4's decision) — SSE-driven `StageTracker`, an Approve
  button for the review gate, a `needs_input` panel with the actual reason
  (blocked/timeout/empty), a failed-job panel, and — once `status === "done"` — the
  result player.
- **Result player** (`components/player/result-player.tsx`) — a native `<video>` with
  poster + VTT captions + format switch + download, fed by the new backend render
  routes. **Not** the full custom film-runtime-driven scrubber §3.7 specifies; see
  "Scoped down" below.
- **Backend**: `apps/backend/src/routes/renders.ts` — `GET /api/jobs/:id/renders` plus
  per-format video/poster/captions routes, auth'd via either the `Authorization` header
  or a `?token=` query param (media tags can't send custom headers).
- **Dashboard** simplified to a pure job list now that `/new` and `/videos/:id` exist —
  the inline create-job form and live-events panel that used to live there moved to
  their real homes.
- **Two Playwright e2e specs** (`e2e/`), both real signup via magic link (polling
  Mailpit, Supabase local's SMTP catch-all) through to a real pipeline run — no mocked
  pipeline exists, so these hit the actual Phase 2-4 queues:
  - `signup-create-pipeline.spec.ts` — fast path, stops once the live pipeline screen
    shows real progress.
  - `full-pipeline-to-result.spec.ts` — slow path, waits through voice/build/QA/render
    for an actual playable video and working download button.

## A real bug this caught

Supabase's local `additional_redirect_urls` allowlist only had `https://127.0.0.1:3000`
(https, exact match only) — any `emailRedirectTo` not in that list silently falls back
to the bare `site_url`. The magic-link email was landing everyone on `/?code=...`
instead of `/auth/callback?code=...&next=...`, dropping the PKCE exchange entirely.
Fixed by adding wildcard entries (`http://127.0.0.1:3000/**`,
`http://localhost:3000/**`) to `supabase/config.toml`. Only found because the e2e test
drove a real magic link through a real browser instead of asserting against a mock.

## Running the e2e tests

```bash
cd apps/web
pnpm e2e                           # both specs
npx playwright test signup-create-pipeline   # fast one only
```

Needs the full local stack up (`supabase start`, `infra:up`, backend, worker, web) —
these are integration tests against the real stack, not unit tests.

**Don't run `next build` against the same `.next` directory a `next dev` server is
using.** Doing that while chasing a separate verification corrupted the dev server's
webpack cache (`Cannot read properties of undefined (reading 'call')` on every route) —
it even partially self-healed after a recompile, which made the first symptom look like
e2e flakiness under load rather than what it actually was. Fixed by stopping the dev
server, deleting `.next`, and restarting. After that both specs pass back-to-back
reliably (2 passed in 38.8s). If you need both a build and a dev server, use separate
checkouts or always `rm -rf .next` between the two.

## Scoped down from the plan

- **Result player is a native `<video>`**, not the full frame-accurate film-runtime
  scrubber §3.7 describes. That custom player is better justified in the script-review
  editor (Phase 6, W6) where frame-accuracy against the storyboard actually matters;
  here it would mean re-resolving a FilmManifest client-side for no real benefit over
  what `<video controls>` already gives a viewer.
- **No script review editor** (W6) — `/videos/:id`'s review state is a single "Approve &
  render" button, not the three-panel scene-by-scene editor. That's explicitly Phase 6.
- ~~No public share page / email / needs-input upload~~ — added in Wave A: `/v/:shareId`
  (+ `/embed`, OG/twitter player tags), share/revoke + caption copy + rating on the
  result screen, `/videos/:id/needs-input` presigned-upload form, React Email templates
  (`emails/`) sent via `lib/email/send.ts` and `POST /api/internal/email`. The backend
  routes these call (`/share`, `/rating`, `/uploads/presign`, `/resume`, `/api/me`)
  land in parallel/next wave; the UI handles their absence with error states.
- **No Lighthouse audit run** — needs a deployed/staging environment to measure
  meaningfully; the dark-theme tokens and `prefers-reduced-motion` handling from
  Phase 1 are already in place, but the ≥90 score itself is unverified.

## Verified

Both specs pass together reliably (2 passed in 38.8s, after the `.next` cache fix
above). `full-pipeline-to-result.spec.ts` covers sign-up → create → approve → voice →
build → QA → render → encode → playable `<video>` with a working download button — the
plan's actual Phase 5 exit criterion, exercised for real against the live stack, not
asserted against a mock.
