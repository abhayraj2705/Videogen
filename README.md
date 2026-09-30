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

## Running it

```bash
pnpm dev:backend   # http://localhost:8787
pnpm dev:worker
pnpm dev:web       # http://localhost:3000
```

Open http://localhost:3000, sign in with a magic link (opens in the local Inbucket
inbox at http://127.0.0.1:54324 since there's no real mail server in dev), land on
`/dashboard`, click **Create test job**. That exercises the whole Phase 1 slice:
web → backend → Postgres + BullMQ → worker → Postgres → Redis pub/sub → SSE → web.

Google sign-in needs a real Google OAuth app registered against your Supabase
project — skip it in local dev and use the magic link instead.

## Phase 0 (film-runtime / renderer)

See `packages/renderer/README.md`.
