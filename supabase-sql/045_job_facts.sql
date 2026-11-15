-- ─────────────────────────────────────────────────────────────────────────────
-- 045 — The CRM fills in job details from emails and documents
--
-- project_contract: the main contract's terms (form, LADs, payment terms,
--   defects period, insurance…). Contract sum, retention % and the start /
--   completion dates stay on projects (value, retention_pct, start_date,
--   end_date) as before.
-- job_fills: every detail the CRM filled in or suggests — what, from which
--   email or document, what was there before. Money, awards, the client and
--   anything that differs from what a person entered wait as 'pending' until
--   someone accepts or rejects them in the job's Commercial › Contract view.
-- Nothing existing is changed or deleted. Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.project_contract (
  project_id            uuid primary key references public.projects(id) on delete cascade,
  contract_form         text,            -- e.g. JCT Design and Build 2016
  contract_date         date,
  contract_ref          text,
  lads_amount           numeric(12,2),   -- liquidated damages
  lads_per              text check (lads_per in ('day', 'week')),
  retention_release     text,            -- e.g. half at PC, half after 12 months
  payment_terms         text,
  defects_period_months integer,
  insurance             text,
  notes                 text,
  read_files            text[] not null default '{}',   -- job documents already read for terms
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.profiles(id)
);

create table if not exists public.job_fills (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  kind            text not null check (kind in ('party', 'contract', 'procurement')),
  field           text not null,         -- e.g. contract_sum, employer_agent, design:architect, trade:<id>
  label           text not null,         -- what a person reads, e.g. "Contract sum"
  value           jsonb not null,        -- what the CRM found
  display         text,                  -- the value as text, e.g. "£1,234,000"
  previous        jsonb,                 -- what was there before
  status          text not null default 'pending' check (status in ('applied', 'pending', 'rejected', 'undone', 'superseded')),
  why             text,                  -- why it waits for a person
  source_item_id  uuid references public.intake_items(id) on delete set null,
  source_label    text,                  -- e.g. "Email from j.smith@bloombc.co.uk" / file name
  source_date     timestamptz,
  decided_by      uuid references public.profiles(id),
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_job_fills_job on public.job_fills(project_id, status, created_at desc);
create unique index if not exists uq_job_fills_same on public.job_fills(project_id, field, md5(value::text));

alter table public.project_contract enable row level security;
drop policy if exists project_contract_staff_read on public.project_contract;
create policy project_contract_staff_read on public.project_contract for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));
drop policy if exists project_contract_staff_write on public.project_contract;
create policy project_contract_staff_write on public.project_contract for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','project_manager','operations_manager','project_director','document_controller')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','project_manager','operations_manager','project_director','document_controller')));

alter table public.job_fills enable row level security;
drop policy if exists job_fills_staff_read on public.job_fills;
create policy job_fills_staff_read on public.job_fills for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));
-- Writes go through the job-facts function only

notify pgrst, 'reload schema';
