-- ═════════════════════════════════════════════════════════════════════════════
-- backfill_portal_folder_visibility.sql
--
-- Makes every custom document folder that lives under a PORTAL-MAPPED area
-- visible to clients, ACROSS ALL PROJECTS. Fixes folders created before the
-- CRM's "auto-visible under a portal tile" logic existed — they were stuck at
-- the project_doc_folders.client_visible default of false, so the client
-- portal never showed them (e.g. the missing Survey sub-folders).
--
-- Portal-mapped roots (anything nested under these, at any depth, is meant to
-- reach the client):
--   Top-level template folders:
--     01-project-order, 02-payment-application, 03-payment-notice,
--     04-variations, 05-progress-report, 06-project-programme
--   Subfolders inside 00-project-information:
--     csa, cff, reports, meetings, photos
--
-- SAFETY
--   • Only ever sets false/null → true. It NEVER hides anything.
--   • Only touches folders whose parent-chain root is a portal root. Folders
--     under non-portal areas (genuinely internal) are left private.
--   • Run STEP 1 + STEP 2 (read-only previews) first. Only run STEP 3 once the
--     previews look right.
--
-- The recursive CTE is identical in all three steps — only the final line
-- differs (preview rows / preview counts / update).
-- ═════════════════════════════════════════════════════════════════════════════


-- ─── STEP 1 — ROW PREVIEW (read-only) ────────────────────────────────────────
-- Lists every folder that WOULD be unhidden, with its project and label, so you
-- can eyeball for anything that should stay private (e.g. "Old PC ..." archives).
with recursive portal_roots(root_key) as (
  select unnest(array[
    '01-project-order','02-payment-application','03-payment-notice',
    '04-variations','05-progress-report','06-project-programme',
    'csa','cff','reports','meetings','photos'
  ])
),
chain as (
  select f.project_id, f.folder_key, f.parent_key
  from project_doc_folders f
  where f.parent_key in (select root_key from portal_roots)
  union all
  select c2.project_id, c2.folder_key, c2.parent_key
  from project_doc_folders c2
  join chain ch on c2.parent_key = ch.folder_key and c2.project_id = ch.project_id
)
select p.project_name, f.label, f.folder_key, f.parent_key, f.client_visible
from project_doc_folders f
join chain c on c.folder_key = f.folder_key and c.project_id = f.project_id
join projects p on p.id = f.project_id
where f.client_visible is distinct from true
order by p.project_name, f.parent_key, f.label;


-- ─── STEP 2 — COUNT PREVIEW (read-only) ──────────────────────────────────────
-- How many folders would change, per project.
with recursive portal_roots(root_key) as (
  select unnest(array[
    '01-project-order','02-payment-application','03-payment-notice',
    '04-variations','05-progress-report','06-project-programme',
    'csa','cff','reports','meetings','photos'
  ])
),
chain as (
  select f.project_id, f.folder_key, f.parent_key
  from project_doc_folders f
  where f.parent_key in (select root_key from portal_roots)
  union all
  select c2.project_id, c2.folder_key, c2.parent_key
  from project_doc_folders c2
  join chain ch on c2.parent_key = ch.folder_key and c2.project_id = ch.project_id
)
select p.project_name, count(*) as folders_to_unhide
from project_doc_folders f
join chain c on c.folder_key = f.folder_key and c.project_id = f.project_id
join projects p on p.id = f.project_id
where f.client_visible is distinct from true
group by p.project_name
order by folders_to_unhide desc;


-- ─── STEP 3 — THE UPDATE (writes) ────────────────────────────────────────────
-- Run ONLY after the previews look right. Unhides every qualifying folder
-- across all projects.
with recursive portal_roots(root_key) as (
  select unnest(array[
    '01-project-order','02-payment-application','03-payment-notice',
    '04-variations','05-progress-report','06-project-programme',
    'csa','cff','reports','meetings','photos'
  ])
),
chain as (
  select f.project_id, f.folder_key, f.parent_key
  from project_doc_folders f
  where f.parent_key in (select root_key from portal_roots)
  union all
  select c2.project_id, c2.folder_key, c2.parent_key
  from project_doc_folders c2
  join chain ch on c2.parent_key = ch.folder_key and c2.project_id = ch.project_id
)
update project_doc_folders f
set client_visible = true
from chain c
where c.folder_key = f.folder_key
  and c.project_id = f.project_id
  and f.client_visible is distinct from true;


-- ─── OPTIONAL — also unhide individual FILES under portal areas ──────────────
-- Files default to client_visible = true, so this is usually unnecessary. Only
-- run if STEP 1 of your investigation showed files explicitly set to false that
-- you want shown. (Left commented — files are visible by default.)
--
-- with recursive portal_roots(root_key) as ( ... same as above ... ),
-- chain as ( ... same as above ... )
-- update project_doc_files f
-- set client_visible = true
-- from chain c
-- where c.folder_key = f.subfolder_key
--   and c.project_id = f.project_id
--   and f.client_visible is distinct from true;
