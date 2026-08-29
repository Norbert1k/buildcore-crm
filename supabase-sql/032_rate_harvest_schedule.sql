-- ─────────────────────────────────────────────────────────────────────────────
-- 032_rate_harvest_schedule.sql
--
-- Schedules harvest-csa-rates to run nightly via pg_cron + pg_net.
-- Requires the pg_cron and pg_net extensions (enable in Supabase dashboard:
-- Database → Extensions → enable `pg_cron` and `pg_net`).
--
-- Replace <PROJECT_REF> and <SERVICE_ROLE_KEY> before running, OR set them via
-- the dashboard's Vault and reference them (recommended). For simplicity the
-- inline form is shown; move the key to Vault for production.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable extensions (no-op if already enabled)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any previous schedule with this name
select cron.unschedule('harvest-csa-rates-nightly')
where exists (select 1 from cron.job where jobname = 'harvest-csa-rates-nightly');

-- Run every night at 02:30 UTC
select cron.schedule(
  'harvest-csa-rates-nightly',
  '30 2 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/harvest-csa-rates',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- To run it once right now (manual rebuild), execute just the inner block:
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/harvest-csa-rates',
--     headers := jsonb_build_object('Content-Type','application/json',
--                'Authorization','Bearer <SERVICE_ROLE_KEY>'),
--     body := '{}'::jsonb);
