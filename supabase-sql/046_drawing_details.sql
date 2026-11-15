-- ─────────────────────────────────────────────────────────────────────────────
-- 046 — What the Inbox read from each filed document, kept with the file
--
-- project_doc_files.meta: for drawings the title block (number, revision,
--   title, discipline, originator, status, plot / block), plus for every
--   document filed from email who sent it, when, and the one-line summary.
--   The CRM's Drawings view shows and searches it, and works out which
--   revision is current.
-- Files filed before today get theirs from the Inbox's own records.
-- Nothing existing is changed or deleted. Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.project_doc_files add column if not exists meta jsonb;

update public.project_doc_files f
set meta = jsonb_strip_nulls(jsonb_build_object(
  'drawing', case when i.guess->'drawing'->>'number' is not null or i.guess->'drawing'->>'title' is not null then i.guess->'drawing' end,
  'doc_type', i.doc_type,
  'summary', i.summary,
  'sender', substring(i.file_name from '^\d{4}-\d{2}-\d{2}[_ ]\d{3,4}\s*-\s*([^\s@]+@[^\s]+)\s*-'),
  'received_at', i.source_created_at,
  'intake_item_id', i.id
))
from public.intake_items i
where i.status = 'filed'
  and i.filed_to->>'file_id' ~ '^[0-9a-f-]{36}$'
  and (i.filed_to->>'file_id')::uuid = f.id
  and f.meta is null;

notify pgrst, 'reload schema';
