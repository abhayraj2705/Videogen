# Phase 2 — Crawl and extract

Implements MASTER_IMPLEMENTATION_PLAN.md Phase 2: a real Playwright crawl worker that
turns a URL into brand tokens + a FactLedger + a SiteBrief, with a `needs_input` fallback
for sites that can't be crawled.

## What's here

- `packages/shared/src/ssrf.ts` — SSRF-safe fetch: DNS-resolves every hostname (including
  each redirect hop) and rejects private/loopback/link-local/metadata/CGNAT ranges before
  ever opening a connection. Unit tested in `packages/shared/src/ssrf.test.ts`.
- `apps/worker/src/lib/ssrf-route-guard.ts` — the same protection for Playwright, which
  does its own DNS resolution and redirect-following outside of `fetch`.
- `apps/worker/src/lib/brand-extract.ts` — computed-style brand tokens: background,
  foreground, accent (most common non-neutral color across CTA-like elements, not just
  the first match), fonts (mapped to a curated Google Fonts list), logo.
- `apps/worker/src/lib/fact-ledger.ts` — DOM heuristics for the FactLedger: hero copy,
  headings, feature blocks, stats, testimonials, CTAs — each tagged with its source
  selector so nothing downstream can cite a claim that isn't actually on the page.
- `apps/worker/src/lib/site-brief.ts` — one cheap LLM call (Gemini Flash-Lite, via
  `packages/llm`) to summarize the FactLedger into a SiteBrief. Falls back to a
  deterministic, non-LLM brief when `GEMINI_API_KEY` is unset or the call fails — the
  crawl stage never depends on an LLM being configured.
- `apps/worker/src/lib/page-prep.ts` — consent-banner dismissal, a scroll pass for
  lazy-loaded content, and same-origin page discovery (pricing/features/about, scored).
- `apps/worker/src/stages/crawl.ts` — the pure stage function (`runCrawlStage`), reused
  by both the BullMQ worker (`src/index.ts`) and the benchmark script.
- `packages/storage` — local-filesystem storage by default (`STORAGE_DRIVER=local`) so
  Phase 2 doesn't need R2 or a working MinIO container; swap to `STORAGE_DRIVER=s3` when
  assets need to be servable to a browser.
- `packages/llm` — provider interface + a Gemini REST adapter with cost accounting,
  JSON-mode output, and a one-shot retry with the validator's error appended.

## Running it

```bash
pnpm dev:backend
pnpm dev:worker
# create a job as usual (POST /api/jobs, or the dashboard's "Create test job") —
# it now runs the real crawl instead of the Phase 1 "hello" queue.
```

## Benchmark

```bash
pnpm phase2:benchmark
```

Runs `runCrawlStage` directly (no BullMQ/DB — just the pure stage function) against
`benchmark/urls.json` (30 URLs across SaaS/e-commerce/portfolio/agency/Indian SMB/
JS-heavy SPA/bot-protected/one-pager/non-English). Writes a report to
`benchmark/out/report.json` and one JSON fixture per successful crawl to
`benchmark/fixtures/crawls/`. Exit criteria (plan §Phase 2): ≥90% of URLs produce a
FactLedger with ≥3 facts; blocked/empty sites must land in `needs_input`, never in a
generic/empty video.

## Known simplifications (documented, not hidden)

- `inputsHash` on `stage_runs` is a simple hash of the URL, not a full content hash of
  every input that could change the crawl — fine while there's exactly one crawl config
  per URL; revisit once crawl options (viewport, locale, etc.) become user-configurable.
- Screenshots are full-page, not per-section as the plan's §4.6 ideal describes — that
  refinement matters once these screenshots feed the renderer (Phase 4), not before.
- The FactLedger's "feature" kind only fires on class-name heuristics (`*feature*`,
  `*benefit*`); many modern sites (Tailwind/CSS-in-JS, no semantic class names) won't hit
  it, so the benchmark's usability bar is "≥3 facts of any kind," not "≥3 features"
  literally — see the comment in `apps/worker/src/scripts/benchmark.ts`.
