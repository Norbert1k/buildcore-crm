-- ─────────────────────────────────────────────────────────────────────────────
-- 041 — CRM watchdog: "Needs attention"
--
-- The `watchdog` edge function checks every active job each morning (and on
-- "Check now") and keeps one list of what needs doing:
--   PA due · progress report due (each new PA) · client revised a PA ·
--   PA hidden from client · CFF behind the PAs · no payment notice yet ·
--   two versions of the same PA · completion close/passed · expired insurance ·
--   quote requests with no prices · Inbox files / subcontractor applications waiting ·
--   loose drawings.
-- Items close themselves when the job is done. Nothing in the CRM is deleted.
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.crm_alerts (
  id             uuid primary key default gen_random_uuid(),
  key            text not null unique,          -- what it's about, e.g. pa_due:<job>:8
  project_id     uuid references public.projects(id) on delete cascade,
  kind           text not null,
  severity       text not null default 'soon' check (severity in ('urgent','soon','info')),
  title          text not null,
  detail         text,
  action_label   text,
  action_url     text,
  fix            text,                           -- one-tap fix the watchdog can do itself
  due_date       date,
  status         text not null default 'open' check (status in ('open','done','dismissed')),
  snoozed_until  timestamptz,
  notified       boolean not null default false,
  first_seen     timestamptz not null default now(),
  last_seen      timestamptz not null default now(),
  resolved_at    timestamptz,
  resolved_by    uuid references public.profiles(id)
);
create index if not exists idx_crm_alerts_open on public.crm_alerts(status, severity);
create index if not exists idx_crm_alerts_project on public.crm_alerts(project_id);

alter table public.crm_alerts enable row level security;
drop policy if exists crm_alerts_staff_read on public.crm_alerts;
create policy crm_alerts_staff_read on public.crm_alerts for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));
drop policy if exists crm_alerts_staff_update on public.crm_alerts;
create policy crm_alerts_staff_update on public.crm_alerts for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

notify pgrst, 'reload schema';

-- Every morning at 06:40 (UK winter time; 07:40 in summer)
select cron.unschedule('watchdog-daily')
where exists (select 1 from cron.job where jobname = 'watchdog-daily');
select cron.schedule(
  'watchdog-daily',
  '40 6 * * *',
  $$
  select net.http_post(
    url     := 'https://tjelbvoeciklpfvapxvn.supabase.co/functions/v1/watchdog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-intake-key', (select cron_token from public.intake_settings where id = 1)
    ),
    body    := '{"action":"run","digest":true}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
