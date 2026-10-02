# Runbooks

What to do when an alert fires or a user reports a problem. Each one starts
from the same two views:

- `GET /api/admin/ops` — success rate over the last 15 minutes, top error
  codes, queue depth and oldest-waiting age per queue, cost per video.
- The admin job inspector (`/api/admin/jobs`, filter `status=failed`) — the
  failed stage, its error, and every stage run of a job.

Commands assume the beta stack in `infra/docker/compose.prod.yml`:

```bash
alias dc='docker compose -f infra/docker/compose.prod.yml --env-file infra/docker/.env.prod'
dc ps
dc logs --since 15m worker-general | grep -i error
```

## Success rate drop

Alert: "Success rate N% over the last 15 min".

1. Read the top error codes in the alert (or `/api/admin/ops`).
2. Find which stage is failing: admin jobs list, `status=failed`.
3. By stage:
   - **crawl**: many `needs_input` is not a failure (sites blocking us). Real
     crawl failures: check the general worker can reach the internet and that
     Chromium starts (`dc logs worker-general`).
   - **plan**: the LLM provider. See "LLM provider outage".
   - **voice**: never fails a job — a TTS outage produces silent videos. Check
     for `TTS provider failed for a line` warnings.
   - **qa** (`qa_failed`): a template is producing overflow, clipped text or a
     non-deterministic frame. Open the job's QA report in the inspector. If it
     started with a deploy, roll back the worker image.
   - **render**: see "Render failures".
4. Jobs that failed from a system fault are refunded automatically. Once
   fixed, re-run them from the failed stage in the inspector.

## LLM provider outage

Symptoms: plan stage slow or failing; storyboards with `source: fallback`.

1. Confirm on the provider's status page.
2. Jobs still complete: after one failed attempt and one escalation attempt
   the planner uses the deterministic fallback storyboard. Quality drops, jobs
   do not fail.
3. To stop waiting on a dead provider, switch the primary: set `LLM_PRIMARY`
   (`gemini` or `deepseek`) in `.env.prod`, then `dc up -d worker-general`.
4. Switch back when the provider recovers.

## TTS outage

Symptoms: videos with no voice; `fallback:silence` as the voice provider.

Jobs complete with silent narration and captions in the `.vtt`. Nothing to do
during the outage. Affected users can re-voice from the result page afterwards
(only the voice and later stages re-run).

## Queue backlog

Alert: "render queue: oldest job has waited N min".

1. `dc ps` — are the render workers up? Restart any that exited.
2. If they are all busy, add capacity: `dc up -d --scale worker-render=<n+2>`,
   or start `worker-render` on another VM with the same `.env.prod`.
3. If the VM is CPU-saturated, more containers will not help — lower
   `RENDER_CONCURRENCY` or add a VM.
4. Backlog on another queue (crawl, plan, qa) means the general worker is
   stuck: `dc logs worker-general`, then `dc restart worker-general`.
   In-flight jobs are retried by the queue.

## Render failures

1. A single job: open it in the inspector. Chunk-level failures retry once
   automatically and resume from finished chunks.
2. Many jobs after a deploy: roll back
   (`IMAGE_TAG=<previous sha> dc up -d worker-render worker-general`).
3. Out-of-memory kills (`dc ps` shows restarts): lower `RENDER_CONCURRENCY`;
   each parallel browser needs roughly 1 GB.

## Cost spike

Alert: "Cost per video $X (baseline $Y)".

1. In the inspector, open a few recent jobs and compare `costUsd` per stage.
2. Plan cost up: the escalation provider is being hit on most jobs — the
   primary is returning invalid storyboards. Check the validation errors on
   the plan stage runs.
3. Voice cost up: cache misses. The TTS cache keys on text + voice + language;
   a provider or model change invalidates it once.
4. If it cannot be fixed quickly, remove `ANTHROPIC_API_KEY` to disable
   escalation (the fallback storyboard is free) and restart the general worker.

## Abuse or impersonation report

Reports arrive at the takedown address on the Acceptable Use page.

There is no admin screen for takedowns yet, so steps 2 and 3 are done directly
against the database and storage.

1. Find the job by share link or URL in the admin jobs list.
2. Take the video down: delete the job's row in `shares` (the public link
   stops working) and delete the objects under `jobs/<jobId>/` in the
   `renders` bucket.
3. If it is deliberate misuse, stop the user creating more: set
   `users.credits` to 0 for that user. There is no suspended flag; a real
   suspension feature is still to be built.
4. Reply to the reporter with what was removed. Keep the report.
5. Repeated abuse of one site: the per-domain throttle
   (`DOMAIN_THROTTLE_MAX`) limits how fast any site can be targeted.

## Infected upload

Log line: `infected uploads dropped`.

The file was not used. No action unless one user triggers it repeatedly — then
treat it as abuse. If uploads fail with `clamd` errors instead, ClamAV is
down: `dc restart clamav` (signatures take a minute or two to load).

## Restore from backup

1. Supabase console: restore the production project to a point in time into a
   new project.
2. Point a staging backend at it and check a known job loads.
3. To cut over: update `DATABASE_URL` in `.env.prod`, `dc up -d`.
4. Object storage is not rolled back by a database restore: jobs created
   after the restore point lose their rows but keep orphaned files, which the
   retention sweep does not touch. Clean them up by prefix if it matters.
