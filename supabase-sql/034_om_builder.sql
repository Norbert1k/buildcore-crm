-- 034_om_builder.sql — O&M builder (Project › Handover › O&M builder)
-- Additive only: new columns default to NULL, new tables are empty. Nothing is
-- dropped, renamed or rewritten, so existing handover files are untouched.

-- Claude's reading of each handover / project document (see handover-ai 'read')
alter table hs_files          add column if not exists ai jsonb;
alter table project_doc_files add column if not exists ai jsonb;
-- Files the builder issued itself (so they're never re-read as source material)
alter table hs_files          add column if not exists origin text;

-- One pack definition per project: what to produce, decisions, latest draft
create table if not exists om_packs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade unique,
  options     jsonb not null default '{}'::jsonb,   -- type, warranty, tenant, golden_thread, auto, building{height_m,storeys,units,bsr_ref}
  overrides   jsonb not null default '{}'::jsonb,   -- decisions where documents disagree
  draft       jsonb,                                -- last compose result
  draft_at    timestamptz,
  updated_at  timestamptz not null default now()
);

-- Every issued manual (the PDF itself lives in hs_files / hs-handover storage)
create table if not exists om_issues (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  kind        text not null check (kind in ('om', 'tenant', 'warranty')),
  issue_no    text not null,
  status      text not null default 'issued',
  file_name   text,
  pages       int,
  hs_file_id  text,                                -- id of the issued PDF in hs_files (no FK: keeps this migration independent of hs_files' key type)
  approved_by text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index if not exists om_issues_project on om_issues(project_id, created_at desc);

-- Same visibility as the project's handover files: anyone who can see the
-- project can read; writes go through the app (leads) and the service role.
alter table om_packs  enable row level security;
alter table om_issues enable row level security;

drop policy if exists om_packs_read on om_packs;
create policy om_packs_read on om_packs for select using (exists (select 1 from projects p where p.id = om_packs.project_id));
drop policy if exists om_packs_write on om_packs;
create policy om_packs_write on om_packs for all
  using (exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role in ('admin','project_manager','operations_manager','project_director')))
  with check (exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role in ('admin','project_manager','operations_manager','project_director')));

drop policy if exists om_issues_read on om_issues;
create policy om_issues_read on om_issues for select using (exists (select 1 from projects p where p.id = om_issues.project_id));
-- om_issues rows are written only by /api/om-render with the service role.
