-- Row-level security: every user-facing table is locked to auth.uid() = user_id.
-- The backend connects with the service role (bypasses RLS by design) for job
-- orchestration; RLS is the last line of defense if a client ever gets a direct
-- Postgres/PostgREST connection (Supabase exposes one) instead of going through
-- the backend API.

alter table users enable row level security;
alter table jobs enable row level security;
alter table stage_runs enable row level security;
alter table credit_ledger enable row level security;
alter table crawls enable row level security;
alter table storyboards enable row level security;
alter table audio_takes enable row level security;
alter table renders enable row level security;

drop policy if exists users_self_select on users;
create policy users_self_select on users
  for select using (auth.uid() = id);

drop policy if exists users_self_update on users;
create policy users_self_update on users
  for update using (auth.uid() = id);

drop policy if exists jobs_owner_all on jobs;
create policy jobs_owner_all on jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists stage_runs_owner_select on stage_runs;
create policy stage_runs_owner_select on stage_runs
  for select using (
    exists (select 1 from jobs where jobs.id = stage_runs.job_id and jobs.user_id = auth.uid())
  );

drop policy if exists credit_ledger_owner_select on credit_ledger;
create policy credit_ledger_owner_select on credit_ledger
  for select using (auth.uid() = user_id);

drop policy if exists crawls_owner_select on crawls;
create policy crawls_owner_select on crawls
  for select using (
    exists (select 1 from jobs where jobs.id = crawls.job_id and jobs.user_id = auth.uid())
  );

drop policy if exists storyboards_owner_select on storyboards;
create policy storyboards_owner_select on storyboards
  for select using (
    exists (select 1 from jobs where jobs.id = storyboards.job_id and jobs.user_id = auth.uid())
  );

drop policy if exists audio_takes_owner_select on audio_takes;
create policy audio_takes_owner_select on audio_takes
  for select using (
    exists (
      select 1 from storyboards
      join jobs on jobs.id = storyboards.job_id
      where storyboards.id = audio_takes.storyboard_id and jobs.user_id = auth.uid()
    )
  );

drop policy if exists renders_owner_select on renders;
create policy renders_owner_select on renders
  for select using (
    exists (
      select 1 from storyboards
      join jobs on jobs.id = storyboards.job_id
      where storyboards.id = renders.storyboard_id and jobs.user_id = auth.uid()
    )
  );

-- Wave A tables -------------------------------------------------------------

alter table shares enable row level security;
alter table ratings enable row level security;
alter table brand_kits enable row level security;
alter table payments enable row level security;
alter table webhook_events enable row level security;
alter table deletion_requests enable row level security;

-- Shares: owners manage their own. The *public* read path is the backend's
-- GET /api/share/:shareId (service role), never PostgREST, so there is
-- deliberately no anon select policy.
drop policy if exists shares_owner_all on shares;
create policy shares_owner_all on shares
  for all using (
    exists (select 1 from jobs where jobs.id = shares.job_id and jobs.user_id = auth.uid())
  ) with check (
    auth.uid() = created_by
    and exists (select 1 from jobs where jobs.id = shares.job_id and jobs.user_id = auth.uid())
  );

drop policy if exists ratings_owner_all on ratings;
create policy ratings_owner_all on ratings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists brand_kits_owner_all on brand_kits;
create policy brand_kits_owner_all on brand_kits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Payments are written only by the backend (webhooks); users may read theirs.
drop policy if exists payments_owner_select on payments;
create policy payments_owner_select on payments
  for select using (auth.uid() = user_id);

-- webhook_events: service role only (RLS enabled + no policies = no access).

drop policy if exists deletion_requests_owner_select on deletion_requests;
create policy deletion_requests_owner_select on deletion_requests
  for select using (auth.uid() = user_id);
