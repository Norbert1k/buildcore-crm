-- ─────────────────────────────────────────────────────────────────────────────
-- 038 — Handover per building (jobs like Merton: several buildings in one job)
--
-- The CRM already knows a job's buildings from its numbered folders
-- ("01. CSA - Residential Building", "02. … Sports Hall", …).
-- This lets the Handover keep a separate O&M for each of them:
--   • hs_files.building   — 'b1', 'b2', … (building number), 'site' for whole-site
--                           documents, or empty = not tagged yet
--   • om_packs.building   — settings/draft per building ('' = the whole job,
--                           which is what every single-building job keeps using)
--   • om_issues.building  — which building an issued manual is for
-- Nothing existing is changed or deleted. Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.hs_files   add column if not exists building text;
alter table public.om_packs   add column if not exists building text not null default '';
alter table public.om_issues  add column if not exists building text not null default '';

-- One settings row per job AND building (was one per job)
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.om_packs'::regclass and contype = 'u'
             and pg_get_constraintdef(oid) = 'UNIQUE (project_id)'
  loop
    execute format('alter table public.om_packs drop constraint %I', c);
  end loop;
end $$;
drop index if exists public.om_packs_project_id_key;
create unique index if not exists om_packs_project_building on public.om_packs (project_id, building);
create index if not exists idx_hs_files_building on public.hs_files (project_id, building);
