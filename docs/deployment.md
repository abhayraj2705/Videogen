# Deployment (Phase 7)

How SiteReel runs in production, what is in the repo to support it, and what
still has to be done by hand in each provider's console. Follows
`MASTER_IMPLEMENTATION_PLAN.md` Part 7.

## Topology

| Piece | Where | From |
|---|---|---|
| Web app (Next.js) | Vercel | `apps/web` (Vercel project, `main` = production) |
| API | Worker VM, behind a TLS reverse proxy | `infra/docker/backend.Dockerfile` |
| General worker (crawl, plan, voice, build, QA, housekeeping) | Worker VM, 1 instance | `infra/docker/worker.Dockerfile`, `WORKER_ROLE=general` |
| Render workers | Worker VM, N instances | same image, `WORKER_ROLE=render` |
| Audio sidecar | Worker VM | `services/audio-sidecar/Dockerfile` |
| ClamAV (upload scanning) | Worker VM | `clamav/clamav:stable` |
| Postgres + auth | Supabase (production project) | managed |
| Redis | Managed Redis | managed |
| Object storage | Cloudflare R2: `assets`, `renders` buckets | managed |

Nothing stateful lives on the worker VM, so it can be rebuilt or replaced at any time.

## First deploy

1. **Managed services** (consoles, not in this repo): create the production
   Supabase project, a managed Redis, and two R2 buckets. Put a CDN domain in
   front of the `renders` bucket.
2. **Migrations**: `DATABASE_URL=<prod> pnpm db:migrate`. Migrations always run
   before the code that needs them and must be backward compatible.
3. **Secrets**: copy `infra/docker/.env.prod.example` to
   `infra/docker/.env.prod` on the VM and fill it in (or render it from your
   secret manager). It is git-ignored.
4. **Start**:
   ```bash
   docker compose -f infra/docker/compose.prod.yml --env-file infra/docker/.env.prod up -d --build
   docker compose -f infra/docker/compose.prod.yml --env-file infra/docker/.env.prod up -d --scale worker-render=4
   ```
5. **Reverse proxy**: terminate TLS in front of `127.0.0.1:8787` (Caddy, nginx
   or a load balancer). Proxy buffering must be off for `/api/jobs/*/events`
   (server-sent events). The API already sends HSTS, CSP and frame headers.
6. **Web**: set the Vercel production env (API URL, Supabase keys,
   `INTERNAL_API_SECRET`) and deploy `main`.
7. **Webhooks**: point the Stripe live webhook at
   `https://<api>/api/webhooks/stripe` and Razorpay's at
   `https://<api>/api/webhooks/razorpay`, and set their signing secrets.

### Sizing render workers

A render fans out across cores inside one container (`RENDER_CONCURRENCY`,
default half the cores it can see), and each render worker takes one render
at a time. On an 8-vCPU VM start with `--scale worker-render=2` and
`RENDER_CONCURRENCY=3`; more containers than that just contend for the same
cores. Scale out by adding VMs that run only `worker-render`.

## Rolling deploys

```bash
IMAGE_TAG=<git sha> docker compose -f infra/docker/compose.prod.yml --env-file infra/docker/.env.prod up -d --build
```

Workers get `SIGTERM`, stop taking jobs and finish what is in flight
(`stop_grace_period: 2m`). A render cut off mid-job is safe: finished chunks
are in object storage and the retry renders only the missing ones.

## Retention and backups

- **Postgres**: enable Point-in-Time Recovery on the Supabase production
  project (console). Do one restore drill into a scratch project before launch
  and note the date in the launch checklist.
- **Crawl artifacts**: the general worker runs a daily retention sweep that
  deletes each finished job's `crawl/`, `uploads/` and `render/` work files
  `RETENTION_CRAWL_DAYS` (default 30) after the job ended. Finished videos,
  voice takes and QA reports are kept. After the sweep, an admin re-run of
  that job must start from `crawl`.
- **R2 lifecycle**: `infra/r2/lifecycle.json` is a backstop (stale multipart
  uploads, old benchmark reports). Apply it once per bucket; the command is in
  the file.
- **Account deletion** removes everything for a user immediately (existing
  Phase 6 job).

## Alerts

Every 5 minutes the general worker computes the ops metrics and posts to
`ALERT_WEBHOOK_URL` (Slack or Discord incoming webhook) when:

| Alert | Condition | Setting |
|---|---|---|
| Success rate | below 90% over 15 min, with at least 5 finished jobs | `ALERT_MIN_SUCCESS_RATE` |
| Queue wait | oldest waiting job in any queue older than 5 min | `ALERT_MAX_QUEUE_WAIT_SEC` |
| Cost per video | 24 h average above 2x the baseline | `ALERT_COST_BASELINE_USD` (0 = off) |

A firing alert repeats at most every 30 minutes. The same numbers are
available on demand at `GET /api/admin/ops` (admin only). Error spikes go to
Sentry; add an external uptime check on `GET /health`.

Not covered here: payment-webhook failure alerts (use the Stripe/Razorpay
dashboards' own alerting) and a public status page.

## Load test

```bash
pnpm loadtest --api https://api.staging.example --tokens tokens.txt --jobs 50 --out benchmark/out/load-report.json
```

`tokens.txt` holds one Supabase access token per test user. The API limits
each user to `MAX_ACTIVE_JOBS_PER_USER` jobs in flight and each target domain
to `DOMAIN_THROTTLE_MAX` jobs per window, so for 50 concurrent jobs either use
25+ test users or raise those two limits on the staging backend for the run.
Every test user needs credits for its share of the jobs. The script exits
non-zero unless at least 95% of the jobs that entered the pipeline finish and
the median time is under 5 minutes. Attach the JSON report to the launch
checklist.

## Security checks

- CI (`.github/workflows/security.yml`): gitleaks over the full history,
  `pnpm audit --prod --audit-level high`, and a build of both images.
- Dependabot (`.github/dependabot.yml`): weekly grouped updates.
- Uploads are virus-scanned by the general worker when `CLAMAV_HOST` is set
  (the compose file sets it). Infected files are dropped; if ClamAV is
  unreachable the job retries rather than using unscanned files.
- Crawler isolation: the crawl stage refuses private and metadata addresses in
  code (SSRF guard). The plan also calls for network-level isolation of crawl
  workers; in this single-VM layout that means a host firewall rule blocking
  the worker containers' egress to RFC 1918 ranges and `169.254.169.254`.
  That rule is not created by anything in this repo.

## Launch checklist status

| Item (plan §7.6) | State |
|---|---|
| Security headers, HSTS | In code (API: helmet; web: Next config) |
| Rate limits and per-user concurrency caps | In code (Phase 5/6) |
| Payment webhooks verified in live mode; refund path | Code tested in sandbox; live verification is manual |
| Backups (PITR) enabled and restore tested | Manual (Supabase console + one drill) |
| Alerts | In code (above); webhook URL to be set |
| Status page | Not done |
| Legal pages live; takedown email monitored | Pages in code; have them reviewed by a lawyer |
| Music licenses on file | Manual |
| Data retention jobs scheduled | In code (above) |
| Load test report attached | Script in repo; run it against staging |
| Runbooks reviewed | `docs/runbooks.md` |
