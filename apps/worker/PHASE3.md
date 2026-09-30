# Phase 3 — Plan and validators

Implements MASTER_IMPLEMENTATION_PLAN.md Phase 3: turns a crawl's FactLedger into a
grounded Storyboard, with code validators, a retry-with-errors loop, escalation to a
stronger model, and a deterministic fallback that's always available.

## What's here

- `packages/shared/src/storyboard.ts` — **Storyboard v1, frozen.** Breaking changes need
  a v2 schema alongside it; the `storyboards` table keeps every version.
- `packages/shared/src/storyboard-validators.ts` — `validateStoryboard()`: fact ids must
  exist, every number shown must appear verbatim in a fact the *same scene* cites (not
  just anywhere in the ledger), reading floor (0.3s/word), ≤8 words on screen at once,
  and per-template prop requirements (`TEMPLATE_PROP_SCHEMAS`).
- `packages/llm/src/anthropic.ts` — escalation provider, same `LlmProvider` interface as
  Gemini. Only called after the primary provider's own retries are exhausted.
- `apps/worker/src/lib/planner-prompt.ts` — Appendix C prompt skeleton, filled with the
  job's real FactLedger/SiteBrief/brand/pages.
- `apps/worker/src/lib/storyboard-fallback.ts` — deterministic, non-LLM storyboard.
  Every scene's on-screen text and its `factIds` are derived from the *same* fact object
  (see the bug this specifically fixes, below) — it cannot fail the grounding validator
  by construction, not just by luck.
- `apps/worker/src/stages/plan.ts` — orchestration: primary provider (2 attempts, second
  one gets the first attempt's validator errors appended) → escalation provider (1
  attempt, same error context) → deterministic fallback. Every path returns a valid
  storyboard; `source` and `costUsd` say which one ran.
- `apps/worker/src/processors/{crawl,plan}-processor.ts` — the BullMQ wiring: crawl
  writes a `crawls` row and enqueues `plan`; plan reads it back by `jobId`, writes a
  `storyboards` row, sets `jobs.currentStoryboardId`, and moves the job to `review` or
  `voicing` depending on `options.reviewBeforeRender` (Phase 4 gives `voicing` a worker).

## Running it

Same as Phase 2 — `pnpm dev:backend` + `pnpm dev:worker`, create a job. It now runs
crawl → extract → plan automatically; watch `stage_runs` and `storyboards` fill in.

## Offline eval

```bash
pnpm --filter @sitereel/worker run plan-eval
```

Runs `runPlanStage` directly against every fixture saved by `phase2:benchmark`
(`benchmark/fixtures/crawls/*.json`) — no BullMQ/DB needed. Reports to
`benchmark/out/plan-eval.json`. Exit criteria (plan §Phase 3): 100% of fixtures end
with a *valid* storyboard, 0 ungrounded numbers, median latency < 20s.

**Current result (fallback only, no `GEMINI_API_KEY`/`ANTHROPIC_API_KEY` set): 27/27
valid, 0 ungrounded issues, PASS.** Re-run with real API keys to exercise the LLM +
escalation paths and get a real latency/cost number instead of near-zero fallback time.

## A real bug this caught

The first fallback-builder version sourced a scene's on-screen text from
`siteBrief.differentiator` (a synthesized string with no single traceable origin) but
cited `siteBrief.strongestClaimFactId` (a *different* fact) as its grounding. For
`mercadolibre.com.ar` these diverged: the caption showed a price ("$ 15.000") that
didn't appear in the cited fact's text. `validateStoryboard`'s per-scene grounding check
caught it immediately. Fixed by always deriving a scene's text and its `factIds` from
the exact same fact object — see the comment in `storyboard-fallback.ts`.

## Known simplifications

- `TEMPLATE_PROP_SCHEMAS` covers the 4 Phase 0 templates only; extend it in lockstep
  with the film-runtime registry when Phase 4 adds the other 6.
- The escalation provider is only exercised when `ANTHROPIC_API_KEY` is set — untested
  against real Claude output in this environment (no key available). The code path is
  identical in shape to the Gemini path, which *is* verified working end to end.
- `inputsHash` for the plan stage keys off `tone` + `lengthSec` only, not every option
  that could change a storyboard (voice, music mood, etc. don't affect the storyboard
  itself, only the later voice/build stages) — revisit if that assumption stops holding.
