-- ─────────────────────────────────────────────────────────────────────────────
-- 044 — Job diary + progress reports drafted by the CRM
--
-- project_log: what happened on each job, one line per event, written by the
--   Inbox from the emails and documents that come in (RFIs and answers,
--   instructions, VOs, issues and delays, drawings issued, deliveries,
--   payment notices…). It feeds the progress report.
-- progress_reports: drafts written by the CRM after each new PA carry
--   ai_draft = true until a person publishes them to the client.
-- Nothing existing is changed or deleted. Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.project_log (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  kind            text not null check (kind in ('rfi','rfi_answer','instruction','variation','issue','delay','progress',
                                                'hs','drawing','delivery','payment','quote','application','handover','correspondence','other')),
  ref             text,                       -- e.g. RFI-012, VO-21, A-201 Rev D
  title           text not null,              -- one line
  detail          text,                       -- a sentence or two
  status          text check (status in ('open','answered','closed')),
  happened_at     timestamptz not null default now(),
  source_item_id  uuid references public.intake_items(id) on delete set null,
  source_label    text,                       -- e.g. "Email from j.smith@bloombc.co.uk"
  created_at      timestamptz not null default now()
);
create index if not exists idx_project_log_job on public.project_log(project_id, happened_at desc);
create unique index if not exists uq_project_log_source on public.project_log(source_item_id, kind, coalesce(ref, ''), title);

alter table public.project_log enable row level security;
drop policy if exists project_log_staff_read on public.project_log;
create policy project_log_staff_read on public.project_log for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));
drop policy if exists project_log_staff_write on public.project_log;
create policy project_log_staff_write on public.project_log for insert
  with check (exists (select 1 from public.profiles p where p.id = auth.uid()));
drop policy if exists project_log_staff_update on public.project_log;
create policy project_log_staff_update on public.project_log for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

-- Drafted reports
alter table public.progress_reports add column if not exists ai_draft boolean not null default false;
alter table public.progress_reports add column if not exists ai_sources jsonb;      -- what the draft was written from
alter table public.progress_reports add column if not exists ai_pa_ref text;        -- e.g. "PA07" (one draft per PA)
alter table public.progress_reports add column if not exists period_from date;
alter table public.progress_reports add column if not exists period_to date;
alter table public.progress_report_photos add column if not exists caption text;
alter table public.progress_report_photos add column if not exists source_photo_id uuid;

notify pgrst, 'reload schema';
