-- ─────────────────────────────────────────────────────────────────────────────
-- 028_escalation_rates.sql
--
-- Per-category annual price-escalation rates for the Price Jobs feature.
-- Categories map to CSA sections (the coarse axis chosen for v1):
--   PRELIMINARIES, MAIN WORKS, EXTERNAL WORKS, PROVISIONAL SUMS, DEFAULT
-- (VARIATIONS is excluded — it's never part of an original-contract price.)
--
-- Each rate is an annual percentage applied continuously from a price's
-- date to the target build date (both-direction: ages old prices up to
-- today AND projects forward to the build period).
--
-- Admin sets defaults here; a job can override per-category at pricing time
-- (the override lives on the saved job, not in this table).
--
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.escalation_rates (
  category      text primary key,
  annual_pct    numeric(6,3) not null default 5.000,
  updated_by    uuid references public.profiles(id),
  updated_at    timestamptz not null default now(),
  notes         text
);

-- Seed the known categories with a sensible 5%/yr starting point. ON CONFLICT
-- DO NOTHING so re-running never clobbers rates an admin has already tuned.
insert into public.escalation_rates (category, annual_pct) values
  ('PRELIMINARIES',    5.000),
  ('MAIN WORKS',       5.000),
  ('EXTERNAL WORKS',   5.000),
  ('PROVISIONAL SUMS', 5.000),
  ('DEFAULT',          5.000)
on conflict (category) do nothing;

alter table public.escalation_rates enable row level security;

-- All authenticated staff can read the rates (needed to price jobs).
drop policy if exists "Staff read escalation rates" on public.escalation_rates;
create policy "Staff read escalation rates" on public.escalation_rates
  for select using (auth.role() = 'authenticated');

-- Only admins can change them.
drop policy if exists "Admins manage escalation rates" on public.escalation_rates;
create policy "Admins manage escalation rates" on public.escalation_rates
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

notify pgrst, 'reload schema';
