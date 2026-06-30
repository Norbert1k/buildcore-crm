-- ─────────────────────────────────────────────────────────────────────────────
-- 030_project_procurement.sql
--
-- Per-project procurement tracker. One row per project; the staged trade list
-- + tick state lives in a single JSONB column so add / delete / reorder are
-- just a rewrite of the document (no fiddly child-table reordering).
--
-- Shape of `data`:
--   {
--     "stages": [
--       { "id": "...", "name": "Stage 1 · Design team",
--         "trades": [
--           { "id": "...", "name": "Architect",
--             "materials": false, "labour": false,
--             "procured_from": "", "status": "Not started",
--             "target_date": null, "notes": "" }
--         ] }
--     ]
--   }
--
-- The default template is seeded client-side on first open (kept in the React
-- component so it's easy to tweak without a migration).
--
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.project_procurement (
  project_id  uuid primary key references public.projects(id) on delete cascade,
  data        jsonb not null default '{"stages":[]}'::jsonb,
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now()
);

alter table public.project_procurement enable row level security;

-- Authenticated staff can read/write procurement for any project (same access
-- model as the rest of the internal project tabs).
drop policy if exists "Staff manage project procurement" on public.project_procurement;
create policy "Staff manage project procurement" on public.project_procurement
  for all using (auth.role() = 'authenticated');

notify pgrst, 'reload schema';
