-- ─────────────────────────────────────────────────────────────────────────────
-- 047 — RAMS off the Compliance timer, onto the job's appointed subcontractor;
--       automatic emails out of the Inbox's "To check"
--
-- RAMS / method statements / risk assessments don't expire, so they don't
-- belong on a subcontractor's Compliance record (where they show as expiring).
-- Each one moves to Job › People › Subcontractors › <firm> › 05. RAMS & Method
-- Statements when its job is known:
--   • filed from email → the job the Inbox filed it to
--   • otherwise → the firm's only live job (if it is on exactly one)
-- The file itself isn't touched (same stored file, now listed under the job).
-- Ones whose job can't be told stay on Compliance with no expiry date, so they
-- never show as expired; the query at the end lists them.
--
-- Emails from no-reply / notification senders and calendar replies that are
-- waiting in To check are marked Ignored (not deleted — Retry brings one back).
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Which job each RAMS document belongs to
drop table if exists rams_move;
create temporary table rams_move as
with rams as (
  select d.* from public.documents d
  where d.document_type in ('rams', 'method_statement', 'risk_assessment') and d.storage_path is not null
),
from_inbox as (
  select distinct on (r.id) r.id as doc_id, (i.filed_to->>'project_id')::uuid as project_id
  from rams r
  join public.intake_items i on i.status = 'filed' and i.filed_to->'also'->>'document_id' = r.id::text
  where i.filed_to->>'project_id' ~ '^[0-9a-f-]{36}$'
),
only_job as (
  select r.id as doc_id, min(ps.project_id::text)::uuid as project_id
  from rams r
  join public.project_subcontractors ps on ps.subcontractor_id = r.subcontractor_id and coalesce(ps.status, 'active') <> 'removed'
  join public.projects p on p.id = ps.project_id and p.status <> 'cancelled'
  group by r.id having count(distinct ps.project_id) = 1
)
select r.id as doc_id, r.subcontractor_id, coalesce(fi.project_id, oj.project_id) as project_id,
       r.file_name, r.document_name, r.storage_path, r.uploaded_by, r.created_at
from rams r
left join from_inbox fi on fi.doc_id = r.id
left join only_job oj on oj.doc_id = r.id
where coalesce(fi.project_id, oj.project_id) is not null;

-- 2. The firm is on the job's appointed subcontractors (added if it wasn't)
insert into public.project_subcontractors (project_id, subcontractor_id, category, trade_on_project, status)
select distinct m.project_id, m.subcontractor_id, 'contractual_work', s.trade, 'active'
from rams_move m join public.subcontractors s on s.id = m.subcontractor_id
where not exists (select 1 from public.project_subcontractors ps where ps.project_id = m.project_id and ps.subcontractor_id = m.subcontractor_id);

-- 3. Listed in the firm's 05. RAMS & Method Statements on that job (same stored file)
insert into public.project_sub_files (project_id, project_sub_id, folder_key, file_name, storage_path, direction, notes, uploaded_by, created_at)
select m.project_id, ps.id, 'rams', coalesce(nullif(m.file_name, ''), m.document_name), m.storage_path, 'received',
       'Moved from Compliance (RAMS don''t expire)', m.uploaded_by, m.created_at
from rams_move m
join public.project_subcontractors ps on ps.project_id = m.project_id and ps.subcontractor_id = m.subcontractor_id
where not exists (select 1 from public.project_sub_files f where f.project_sub_id = ps.id and f.storage_path = m.storage_path);

-- 4. Off Compliance (only the ones now listed under their job)
delete from public.documents d
using rams_move m
where d.id = m.doc_id
  and exists (select 1 from public.project_sub_files f where f.project_id = m.project_id and f.storage_path = m.storage_path);

-- 5. Any RAMS left on Compliance never shows as expiring
update public.documents set expiry_date = null
where document_type in ('rams', 'method_statement', 'risk_assessment') and expiry_date is not null;

-- 6. Automatic emails and calendar replies waiting in To check → Ignored
update public.intake_items
set status = 'ignored',
    reason = case when file_name ~* ' - EMAIL - (Accepted|Declined|Tentative|Canceled|Cancelled|Updated invitation|Invitation)' then 'Calendar reply' else 'Automatic email (no-reply / notification)' end,
    updated_at = now()
where status in ('to_check', 'pending', 'error')
  and file_name ~* ' - EMAIL - '
  and (file_name ~* '^\d{4}-\d{2}-\d{2}[_ ]\d{3,4}\s*-\s*[^\s@]*(no-?reply|donotreply|do-not-reply|newsletter|mailchimp|notification|mailer-daemon|postmaster|linkedin|barclays|americanexpress|hmrc)'
       or file_name ~* ' - EMAIL - (Accepted|Declined|Tentative|Canceled|Cancelled|Updated invitation|Invitation)');

drop table if exists rams_move;

-- What's left for a person: RAMS still on Compliance (job couldn't be told)
select s.company_name, d.document_name, d.file_name
from public.documents d join public.subcontractors s on s.id = d.subcontractor_id
where d.document_type in ('rams', 'method_statement', 'risk_assessment')
order by s.company_name;
