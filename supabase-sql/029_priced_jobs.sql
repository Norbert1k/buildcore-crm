-- ─────────────────────────────────────────────────────────────────────────────
-- 029_priced_jobs.sql
--
-- Stores each "price a job" exercise so it can be revisited from History and
-- reused. A job holds:
--   • metadata (name, client, build date, escalation overrides)
--   • the uploaded tender file references
--   • the priced line items (stored as JSONB — flexible while the pricing
--     engine evolves; we can normalise to a child table later if needed)
--
-- Tender files themselves live in storage; this table keeps their paths.
--
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.priced_jobs (
  id              uuid primary key default uuid_generate_v4(),
  job_name        text not null,
  client_name     text,
  project_id      uuid references public.projects(id) on delete set null,
  build_date      date,
  -- Per-job escalation overrides: { "MAIN WORKS": 8, ... }. NULL/empty = use
  -- the saved defaults from escalation_rates.
  escalation_overrides jsonb not null default '{}'::jsonb,
  -- Priced lines: [{ description, category, base, price_date, escalated,
  --                  source, confidence, ... }]
  lines           jsonb not null default '[]'::jsonb,
  -- References to uploaded tender files: [{ name, storage_path, size }]
  tender_files    jsonb not null default '[]'::jsonb,
  status          text not null default 'draft',   -- draft | priced | issued
  total_base      numeric(14,2),
  total_escalated numeric(14,2),
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists priced_jobs_created_idx on public.priced_jobs (created_at desc);
create index if not exists priced_jobs_project_idx on public.priced_jobs (project_id);

alter table public.priced_jobs enable row level security;

-- Any authenticated staff member can work with priced jobs (estimating is a
-- shared activity). Tighten later if you want per-user ownership.
drop policy if exists "Staff manage priced jobs" on public.priced_jobs;
create policy "Staff manage priced jobs" on public.priced_jobs
  for all using (auth.role() = 'authenticated');

-- Storage bucket for tender uploads. Created via SQL so deploy is one step.
insert into storage.buckets (id, name, public)
values ('tender-docs', 'tender-docs', false)
on conflict (id) do nothing;

-- Staff can read/write tender docs; portal client users cannot (this bucket
-- is internal estimating only).
drop policy if exists "Staff read tender docs" on storage.objects;
create policy "Staff read tender docs" on storage.objects
  for select using (
    bucket_id = 'tender-docs'
    and exists (select 1 from public.profiles where id = auth.uid())
  );

drop policy if exists "Staff write tender docs" on storage.objects;
create policy "Staff write tender docs" on storage.objects
  for insert with check (
    bucket_id = 'tender-docs'
    and exists (select 1 from public.profiles where id = auth.uid())
  );

drop policy if exists "Staff update tender docs" on storage.objects;
create policy "Staff update tender docs" on storage.objects
  for update using (
    bucket_id = 'tender-docs'
    and exists (select 1 from public.profiles where id = auth.uid())
  );

drop policy if exists "Staff delete tender docs" on storage.objects;
create policy "Staff delete tender docs" on storage.objects
  for delete using (
    bucket_id = 'tender-docs'
    and exists (select 1 from public.profiles where id = auth.uid())
  );

notify pgrst, 'reload schema';
