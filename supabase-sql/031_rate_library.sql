-- ─────────────────────────────────────────────────────────────────────────────
-- 031_rate_library.sql
--
-- Historical rate library, harvested from past CSAs by the harvest-csa-rates
-- edge function. Each row is one CSA line item turned into a reusable rate:
--   description, section, unit, qty, rate, total + the source project/file.
--
-- Material/labour split (Option A — captured going forward): material_rate
-- and labour_rate are NULL until someone fills them in via the Rate library
-- viewer. The pricing engine blends rates by (normalised description, unit)
-- and surfaces the split where known.
--
-- Re-harvest is idempotent per source line via the natural key
-- (source_file_id, ref) — re-running updates rather than duplicates.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.rate_library (
  id             uuid primary key default uuid_generate_v4(),
  -- Source provenance
  project_id     uuid references public.projects(id) on delete set null,
  project_name   text,
  source_file_id uuid,                 -- project_doc_files.id of the CSA
  source_file    text,                 -- file name, for display
  csa_date       date,                 -- date the CSA was created/uploaded
  -- The harvested line
  ref            text,                 -- CSA ref e.g. "7.1"
  section        text,                 -- CSA section e.g. "ROOF"
  description    text not null,
  description_norm text,               -- normalised for matching (lowercased, despaced)
  qty            numeric,
  unit           text,                 -- m2, nr, lm, sqm, item, storeys...
  unit_norm      text,                 -- normalised unit (sqm->m2 etc.)
  rate           numeric,              -- £ per unit
  total          numeric,              -- £ line total
  -- Material / labour split (captured going forward; NULL until set)
  material_rate  numeric,
  labour_rate    numeric,
  split_source   text,                 -- 'manual' once a human sets the split
  harvested_at   timestamptz not null default now(),
  unique (source_file_id, ref)
);

create index if not exists rate_library_descnorm_idx on public.rate_library (description_norm);
create index if not exists rate_library_unit_idx on public.rate_library (unit_norm);
create index if not exists rate_library_section_idx on public.rate_library (section);

alter table public.rate_library enable row level security;

drop policy if exists "Staff read rate library" on public.rate_library;
create policy "Staff read rate library" on public.rate_library
  for select using (auth.role() = 'authenticated');

-- Staff can update the material/labour split. Inserts/deletes come from the
-- harvester (service role, bypasses RLS) but allow staff too for manual adds.
drop policy if exists "Staff write rate library" on public.rate_library;
create policy "Staff write rate library" on public.rate_library
  for all using (auth.role() = 'authenticated');

-- Bookkeeping for the scheduled harvest: last run + summary.
create table if not exists public.rate_library_harvest_log (
  id          uuid primary key default uuid_generate_v4(),
  run_at      timestamptz not null default now(),
  files_seen  integer,
  rows_upserted integer,
  errors      text
);
alter table public.rate_library_harvest_log enable row level security;
drop policy if exists "Staff read harvest log" on public.rate_library_harvest_log;
create policy "Staff read harvest log" on public.rate_library_harvest_log
  for select using (auth.role() = 'authenticated');

notify pgrst, 'reload schema';
