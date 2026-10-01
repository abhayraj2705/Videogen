# SiteReel

Paste a website URL, get a narrated motion-graphics video. See `MASTER_IMPLEMENTATION_PLAN.md`
for the full product/build plan — this file is just "how do I run it locally."

## Layout

```
apps/
  web/       Next.js frontend only — no business logic, talks to apps/backend over HTTP
  backend/   Fastify API server — owns Postgres, Redis/BullMQ, R2/S3, auth verification
  worker/    BullMQ worker(s) — the actual pipeline stages run here
packages/
  shared/        zod schemas shared by web, backend, worker
  db/             Drizzle schema, migrations, RLS policies
  film-runtime/   the __film contract + scene templates (Phase 0)
  renderer/       Playwright + ffmpeg renderer + purity test (Phase 0)
infra/
  docker/compose.yml   Redis + MinIO (R2 stand-in) for local dev
```

`apps/web` and `apps/backend` are deliberately separate apps (not Next.js API routes)
so the frontend and backend can be developed, deployed and reasoned about independently.

## First-time setup

```bash
pnpm install

# 1. Local Postgres + Auth (Supabase CLI, needs Docker running)
pnpm supabase:start
pnpm supabase:status   # confirm the printed anon/service keys match apps/web/.env.local
                        # and apps/backend/.env.local — copy from *.env.example if they differ

# 2. Local Redis + MinIO
pnpm infra:up

# 3. Env files
cp apps/web/.env.example apps/web/.env.local
cp apps/backend/.env.example apps/backend/.env.local
cp apps/worker/.env.example apps/worker/.env.local
cp packages/db/.env.example packages/db/.env

# 4. Schema + RLS + auth trigger
pnpm db:migrate
```

**Storage note:** `STORAGE_LOCAL_DIR` (worker + backend `.env`) must be the exact same
absolute path in both files — each process otherwise resolves the default
`./.data/storage` relative to its own cwd, so backend silently 404s on every render the
worker actually wrote. See the comment in `apps/worker/.env.example`.

**Auth redirect note:** if magic links land you on `/?code=...` instead of
`/auth/callback?code=...`, `supabase/config.toml`'s `auth.additional_redirect_urls`
doesn't include your dev origin — Supabase silently falls back to `site_url` (the bare
root) for any `emailRedirectTo` not on that allowlist. It already includes
`http://127.0.0.1:3000/**` and `http://localhost:3000/**`; add your own if you're
running on a different host/port, then `pnpm supabase:stop && pnpm supabase:start` to
reload the config.

## Running it

```bash
pnpm dev:backend   # http://localhost:8787
pnpm dev:worker
pnpm dev:web       # http://localhost:3000
```

Open http://localhost:3000, sign in with a magic link (opens in the local Mailpit/
Inbucket inbox at http://127.0.0.1:54324 since there's no real mail server in dev),
click **+ New video**, paste a URL, and submit. That runs the full pipeline for real:
crawl → extract → plan → voice → build → QA → render → encode, landing you on a
playable result once it's done (or "review" first if review-before-render is checked —
click **Approve & render** there to continue).

Google sign-in needs a real Google OAuth app registered against your Supabase
project — skip it in local dev and use the magic link instead.

## Phase 0 (film-runtime / renderer)

See `packages/renderer/README.md`.

## End-to-end tests

```bash
cd apps/web
pnpm e2e
```

Real browser tests against the live stack (signup via a real magic link, through to a
playable rendered video) — not mocks. See `apps/web/PHASE5.md`.
