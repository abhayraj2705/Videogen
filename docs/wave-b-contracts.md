# Wave B (Phase 6) — shared contracts

Single source of truth for the backend, worker and web agents building Phase 6 in
parallel. Spec: MASTER_IMPLEMENTATION_PLAN.md Phase 6 (W6, W10–W13). All JSON bodies;
errors are `{ error: string, message: string }`. Auth = Supabase bearer (existing
`verifyAuth`). Admin routes require `users.role = 'admin'` → else 403.

## Account

- `GET /api/me` → `{ id, email, plan: "free"|"pro"|"business", credits: number, role: "user"|"admin", createdAt }`
- `PATCH /api/me` `{ displayName?, defaultFormat?, defaultVoiceId?, emailNotifications?: boolean }` → same as GET (store prefs in a `users.settings` jsonb column).
- `DELETE /api/me` → `202 { deletionRequestId }`. Inserts `deletion_requests`, enqueues queue `account-delete` `{ userId, deletionRequestId }`. Worker deletes storage objects under `jobs/{jobId}/**` for all the user's jobs, then DB rows (jobs cascade), marks `completedAt`, and deletes the Supabase auth user via service role.

## Storyboard editing & versioning (W6)

- `GET /api/jobs/:id/storyboard` → `{ version, storyboard: Storyboard, validation: { ok, errors: {code, message, sceneId?}[] }, facts: FactLedger, audio: { sceneId, url, durationMs }[] }` — latest version.
- `GET /api/jobs/:id/storyboard/versions` → `{ versions: { version, createdAt, source: "llm"|"fallback"|"user" }[] }`
- `PUT /api/jobs/:id/storyboard` `{ baseVersion, storyboard }` → `200 { version, validation }` saves as `baseVersion+1` (409 `version_conflict` if baseVersion ≠ latest). Allowed while status ∈ {review, done, failed}. Validates with `validateStoryboard`; invalid storyboards are saved but `approve` is refused (422 `storyboard_invalid`).
- `POST /api/jobs/:id/storyboard/revoice` `{ sceneId }` → `202`. Enqueues `voice` with `{ jobId, storyboardVersion, sceneIds: [sceneId] }`; emits event `stage: "voice"` with `sceneId` when done.
- `POST /api/jobs/:id/approve` (existing) accepts optional `{ version }`.

### Downstream-only re-runs

`stage_runs` rows store an `inputHash` (jsonb `meta.inputHash`). The worker computes, per
stage, a hash of its inputs (voice: per-scene narration+voice+lang; build: storyboard
version + audio hashes; render: build manifest hash + format + watermark). A stage whose
hash matches the previous successful run is skipped (reuses outputs). Re-runs triggered
by an edit start at `voice` and only re-synthesize changed scenes.

## Quick changes (result page)

- `POST /api/jobs/:id/quick-change` `{ voiceId?, tone?, lengthSec?: 15|30|45|60 }` → `202 { version }`.
  - voice only → new storyboard version (same scenes), re-run voice→render.
  - tone/length → re-plan (queue `plan` with `{ jobId, reason: "quick-change", overrides }`), then auto-approve.
  - Costs 0 credits for voice, 1 credit for tone/length (ledger reason `quick_change`).

## Re-run from stage (admin)

- `POST /api/admin/jobs/:id/rerun` `{ fromStage: "crawl"|"plan"|"voice"|"build"|"qa"|"render" }` → `202`.

## Needs-input (W8)

- `POST /api/jobs/:id/uploads/presign` `{ files: { name, type, size }[] }` (≤ 8 files, image/png|jpeg|webp|svg+xml, ≤ 10 MB each) → `{ uploads: { url, key, method: "PUT", headers: Record<string,string> }[] }` — same order as `files`. Keys: `jobs/{jobId}/uploads/{nanoid}.{ext}`. With the local storage driver, `url` points at `PUT /api/uploads/local/:token` on the backend.
- `POST /api/jobs/:id/resume` `{ keys: string[], description?: string, features?: string[], brandColor?: string }` → `202`. Only when status = `needs_input`. Enqueues `crawl` with `{ jobId, url, manual: { keys, description, features, brandColor } }`; the worker builds the FactLedger from the manual input + uploaded screenshots instead of crawling.

## Brand kits (W10)

- `GET /api/brand-kits` → `{ kits: BrandKit[] }`
- `POST /api/brand-kits` `{ name, colors, fonts, logoKey?, sourceUrl? }` → `201 BrandKit`
- `PATCH /api/brand-kits/:id`, `DELETE /api/brand-kits/:id`, `POST /api/brand-kits/:id/default`
- `POST /api/brand-kits/:id/logo/presign` `{ type, size }` → `{ url, key, method, headers }`
- `BrandKit = { id, name, colors: { primary, secondary?, background, foreground, accent? }, fonts: { heading, body }, logoUrl: string|null, sourceUrl: string|null, isDefault, createdAt, updatedAt }`
- Auto-create: after a successful crawl, the worker inserts a kit from `crawls.brand` (name = site hostname) if the user has no kit for that hostname.
- `POST /api/jobs` accepts optional `brandKitId`; the worker's build stage overrides crawl brand tokens with the kit.

## Billing (W11)

- `GET /api/billing` → `{ plan, credits, ledger: { id, delta, reason, jobId?, createdAt }[] (last 50), payments: { id, provider, amount, currency, credits, status, createdAt, invoiceUrl? }[] }`
- `GET /api/billing/catalog` → `{ plans: { id: "pro"|"business", name, priceMonthly: {INR, USD}, creditsPerMonth }[], packs: { id, credits, price: {INR, USD} }[] }` (single source in `packages/shared/src/billing.ts`).
- `POST /api/billing/checkout` `{ kind: "pack"|"plan", id, provider: "razorpay"|"stripe" }` →
  - stripe: `{ provider: "stripe", url }` (Checkout Session redirect)
  - razorpay: `{ provider: "razorpay", orderId, keyId, amount, currency }` (client opens Razorpay Checkout.js)
- `POST /api/webhooks/stripe`, `POST /api/webhooks/razorpay` — raw-body signature verification; idempotent via `webhook_events (provider, eventId)`; credit grant = `payments` row upsert + `credit_ledger` row in one transaction; duplicates and retries are no-ops returning 200.
- Refunds on system failure: worker calls `refundJobCredits(db, jobId)` when a job ends `failed` for a system reason (not `needs_input`, not user cancel).
- Watermark: free plan → watermark on; any paid plan or a job created while on a paid plan → off.
- Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Missing keys → checkout returns 503 `billing_unavailable`.

## Cancel

- `POST /api/jobs/:id/cancel` → `202`; status → `cancelled`, removes pending BullMQ jobs, refunds credits if no render completed.

## Admin (W13)

- `GET /api/admin/jobs?status=&q=&cursor=` → `{ jobs: AdminJobRow[], nextCursor }` where `AdminJobRow = { id, url, status, userEmail, createdAt, failedStage?, errorCode? }`
- `GET /api/admin/jobs/:id` → `{ job, user: { id, email, plan }, stageRuns: { stage, status, startedAt, finishedAt, durationMs, costUsd, error?, meta }[], crawl: { pages, facts, brand, screenshots: url[] } | null, storyboards: { version, source, validation }[], renders: RenderInfo & { qa }[], events: JobEvent[] (replay buffer) , logsHint: string }`
- `GET /api/admin/benchmark` → latest `benchmark/out/*.json` reports (read from storage key `benchmark/latest/*.json`) → `{ runs: { name, createdAt, summary }[] }`

## Emails

Worker → web: `POST {WEB_URL}/api/internal/email` header `x-internal-secret: INTERNAL_API_SECRET`,
body `{ template: "video-ready"|"needs-input", to, data: { jobId, title, url, reason? } }`.
Sent on `done` and on `needs_input` if the user's `emailNotifications` pref is not false.
