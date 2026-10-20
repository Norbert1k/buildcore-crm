-- 039_completion_certificates.sql
-- Proof of completion, checked by Claude before the CRM accepts it.
--
--  • Subcontractor on a job → "Completed" needs the Final Account certificate
--    signed by both parties. The file lives in that subcontractor's
--    02. Payment Applications folder; the assignment points at it.
--  • Project → Practical Completion certificate. The PC date sits on the
--    project; the file is filed in Documents › 00. Project Information ›
--    13. Practical Completion.
--  • Pounds and pence: variation totals are kept to the penny.
--
-- Safe to run more than once. Adds columns only — nothing is deleted.

-- ── Subcontractor completion ────────────────────────────────────────────────
alter table public.project_subcontractors add column if not exists completed_on date;
alter table public.project_subcontractors add column if not exists completion_file_id uuid
  references public.project_sub_files(id) on delete set null;
alter table public.project_subcontractors add column if not exists completion_check jsonb;

-- ── Practical completion ────────────────────────────────────────────────────
alter table public.projects add column if not exists pc_date date;
alter table public.projects add column if not exists pc_file_id uuid
  references public.project_doc_files(id) on delete set null;
alter table public.projects add column if not exists pc_check jsonb;

-- ── To the penny ────────────────────────────────────────────────────────────
-- Order values are already numeric(12,2). Variation totals were added later;
-- if that column was made a whole-number type, widen it to pounds and pence.
do $$
declare t text; sc int;
begin
  select data_type, numeric_scale into t, sc from information_schema.columns
   where table_schema = 'public' and table_name = 'project_subcontractors' and column_name = 'variation_amount';
  if t is null then
    alter table public.project_subcontractors add column variation_amount numeric(14,2) default 0;
  elsif t in ('integer', 'bigint', 'smallint', 'real', 'double precision') or (t = 'numeric' and coalesce(sc, 2) < 2 and sc is not null) then
    begin
      alter table public.project_subcontractors alter column variation_amount type numeric(14,2) using round(variation_amount::numeric, 2);
    exception when others then
      raise notice 'variation_amount left as %: %', t, sqlerrm;   -- e.g. a view depends on it; everything else still applies
    end;
  end if;
end $$;

-- ── Status values the screen offers ─────────────────────────────────────────
-- The edit screen offers Active / Completed / On hold / Cancelled; the
-- original rule only allowed active / completed / removed, so "On hold" and
-- "Cancelled" failed silently. Allow all of them (existing rows unaffected).
do $$
declare c text;
begin
  for c in select con.conname from pg_constraint con
            join pg_class rel on rel.oid = con.conrelid
            join pg_namespace n on n.oid = rel.relnamespace
           where n.nspname = 'public' and rel.relname = 'project_subcontractors'
             and con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.project_subcontractors drop constraint %I', c);
  end loop;
  alter table public.project_subcontractors add constraint project_subcontractors_status_check
    check (status is null or status in ('active', 'completed', 'removed', 'on_hold', 'cancelled')) not valid;   -- NOT VALID: existing rows are never re-checked
end $$;
