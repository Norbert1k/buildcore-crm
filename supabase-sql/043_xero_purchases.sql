-- ─────────────────────────────────────────────────────────────────────────────
-- 043 — Xero (read-only) as evidence of what each job bought
--
-- The robot reads the supplier invoice attached to each Xero bill (from
-- 1 Jan 2026), works out the job from the delivery/site address or order ref,
-- and notes the products against that job (Inbox › Materials). Only those
-- products' datasheets go into the job's O&M. Nothing is written to Xero and
-- invoices still never go into the CRM.
-- Nothing existing is changed or deleted. Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per Xero bill the robot has looked at
create table if not exists public.xero_bill_reads (
  xero_invoice_id text primary key,
  status          text not null check (status in ('read','no_job','no_products','skipped','no_attachment','error')),
  project_id      uuid references public.projects(id) on delete set null,
  confidence      numeric,
  summary         text,
  products        jsonb,
  attempts        int not null default 1,
  note            text,
  read_at         timestamptz not null default now()
);
create index if not exists idx_xero_bill_reads_project on public.xero_bill_reads(project_id);

alter table public.xero_bill_reads enable row level security;
drop policy if exists xero_bill_reads_staff_read on public.xero_bill_reads;
create policy xero_bill_reads_staff_read on public.xero_bill_reads for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

-- Materials can now come from a Xero bill too
alter table public.job_materials drop constraint if exists job_materials_source_check;
alter table public.job_materials add constraint job_materials_source_check
  check (source in ('invoice','delivery','order','manual','xero'));

notify pgrst, 'reload schema';

-- Every hour at :25 — new bills from Xero (every 6 h) + read up to 8 invoices
select cron.unschedule('xero-hourly')
where exists (select 1 from cron.job where jobname = 'xero-hourly');
select cron.schedule(
  'xero-hourly',
  '25 * * * *',
  $$
  select net.http_post(
    url     := 'https://tjelbvoeciklpfvapxvn.supabase.co/functions/v1/intake',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-intake-key', (select cron_token from public.intake_settings where id = 1)
    ),
    body    := '{"action":"xero"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
