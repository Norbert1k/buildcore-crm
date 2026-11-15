-- ─────────────────────────────────────────────────────────────────────────────
-- 040 — Automatic filing from Google Drive ("Inbox")
--
-- Your email automation saves attachments into a Google Drive folder. The
-- `intake` edge function looks at that folder every 5 minutes, reads each new
-- file with Claude and files it in the CRM:
--   drawings, surveys, PAs, payment notices, VOs, programmes, RAMS → job Documents
--   insurance / certificates / accreditations → subcontractor Compliance
--   subcontractor & supplier quotes → the job's quote request (Quotes)
-- Anything it isn't sure about waits in Inbox › To check.
--
-- Drive is only ever READ: nothing there is moved, renamed or deleted.
-- Nothing existing in the CRM is changed or deleted. Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.intake_settings (
  id               int primary key default 1 check (id = 1),
  enabled          boolean not null default false,
  drive_folder_id  text,
  start_from       timestamptz not null default now(),   -- files created before this are left alone
  auto_threshold   numeric not null default 0.85,        -- below this → To check
  trial            boolean not null default true,         -- trial: suggest only, nothing is filed until you press File
  last_run_at      timestamptz,
  last_run_note    text,
  updated_at       timestamptz not null default now()
);
alter table public.intake_settings add column if not exists trial boolean not null default true;
-- The schedule's pass for calling the function — made here, never typed by anyone
alter table public.intake_settings add column if not exists cron_token text not null
  default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
insert into public.intake_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.intake_items (
  id               uuid primary key default gen_random_uuid(),
  source           text not null default 'gdrive',
  source_file_id   text not null,
  file_name        text not null,
  mime_type        text,
  file_size        bigint,
  md5              text,
  source_path      text,                 -- Drive folder path, e.g. "Attachments/2026-11-14 Quote – Arcady"
  source_created_at timestamptz,
  staged_path      text,                 -- copy in storage (project-docs/intake/…) for preview + filing
  status           text not null default 'pending'
                   check (status in ('pending','filed','to_check','ignored','duplicate','error')),
  doc_type         text,
  summary          text,
  confidence       numeric,
  reason           text,
  guess            jsonb,                -- Claude's reading: project, vendor, quote, compliance fields…
  filed_to         jsonb,                -- where it went: { target, project_id, folder_key, …, label }
  filed_at         timestamptz,
  filed_by         uuid references public.profiles(id),   -- null = filed automatically
  attempts         int not null default 0,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (source, source_file_id)
);
create index if not exists idx_intake_items_status on public.intake_items(status, created_at desc);
create index if not exists idx_intake_items_md5 on public.intake_items(md5);

alter table public.intake_settings enable row level security;
alter table public.intake_items enable row level security;

-- CRM staff can see the Inbox; filing itself goes through the edge function,
-- which checks the role.
drop policy if exists intake_items_staff_read on public.intake_items;
create policy intake_items_staff_read on public.intake_items for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));
drop policy if exists intake_settings_staff_read on public.intake_settings;
create policy intake_settings_staff_read on public.intake_settings for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));
drop policy if exists intake_settings_admin_write on public.intake_settings;
create policy intake_settings_admin_write on public.intake_settings for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid()
                 and p.role in ('admin','operations_manager','project_director')));

notify pgrst, 'reload schema';

-- ─── Schedule: every 5 minutes ───────────────────────────────────────────────
-- Needs pg_cron and pg_net (Database → Extensions; already on if 032 ran).
-- Does nothing until Inbox › Settings is switched on.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('intake-every-5-min')
where exists (select 1 from cron.job where jobname = 'intake-every-5-min');

select cron.schedule(
  'intake-every-5-min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://tjelbvoeciklpfvapxvn.supabase.co/functions/v1/intake',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-intake-key', (select cron_token from public.intake_settings where id = 1)
    ),
    body    := '{"action":"run"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
