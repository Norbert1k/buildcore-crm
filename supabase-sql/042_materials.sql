-- ─────────────────────────────────────────────────────────────────────────────
-- 042 — Materials register + automatic datasheets for the O&M
--
-- What each job actually bought, read from the invoices, delivery notes and
-- order confirmations that come in by email (invoices themselves stay out of
-- the CRM — Xero only — only their line items are noted here).
-- A datasheet is only put into a job's Handover when that product was bought
-- for that job; datasheets sent "for info" wait in Inbox › To check.
-- Every morning the CRM looks up the manufacturer's datasheet for bought items
-- that still have none; each one found waits for one tap of approval.
-- Nothing existing is changed or deleted. Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.job_materials (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  norm_key          text not null,                 -- manufacturer + product, normalised (one row per product per job)
  manufacturer      text,
  product           text not null,
  code              text,
  qty               text,
  supplier          text,
  source            text not null default 'invoice' check (source in ('invoice','delivery','order','manual')),
  purchased         boolean not null default true,
  evidence_item_id  uuid references public.intake_items(id) on delete set null,
  evidence_label    text,                          -- e.g. "Travis Perkins invoice 12 Nov"
  datasheet_status  text not null default 'needed'
                    check (datasheet_status in ('needed','found','filed','not_found','not_needed')),
  datasheet_item_id uuid references public.intake_items(id) on delete set null,
  attempts          int not null default 0,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (project_id, norm_key)
);
create index if not exists idx_job_materials_status on public.job_materials(datasheet_status);

alter table public.job_materials enable row level security;
drop policy if exists job_materials_staff_read on public.job_materials;
create policy job_materials_staff_read on public.job_materials for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));
drop policy if exists job_materials_staff_write on public.job_materials;
create policy job_materials_staff_write on public.job_materials for insert
  with check (exists (select 1 from public.profiles p where p.id = auth.uid()));
drop policy if exists job_materials_staff_update on public.job_materials;
create policy job_materials_staff_update on public.job_materials for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

notify pgrst, 'reload schema';

-- Datasheet search every morning at 07:10
select cron.unschedule('datasheets-daily')
where exists (select 1 from cron.job where jobname = 'datasheets-daily');
select cron.schedule(
  'datasheets-daily',
  '10 7 * * *',
  $$
  select net.http_post(
    url     := 'https://tjelbvoeciklpfvapxvn.supabase.co/functions/v1/intake',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-intake-key', (select cron_token from public.intake_settings where id = 1)
    ),
    body    := '{"action":"datasheets"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
