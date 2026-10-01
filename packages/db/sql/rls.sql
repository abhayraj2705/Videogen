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
