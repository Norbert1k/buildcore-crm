-- ─────────────────────────────────────────────────────────────────────────────
-- 048 — Inbox clean-up: photos, zips and Quant's working files out of the CRM
--
-- From now on the Inbox never takes these in (they stay in Quant's Drive):
-- photos, zips / archives, scripts and data files, Quant's "_generator",
-- "_Superseded" and other "_" working folders, and folders set to skip.
-- This tidies what came in before that:
--   1. waiting items of those kinds → Ignored (Retry brings one back)
--   2. photos the Inbox filed into job Documents → taken off the job's file
--      list (the stored copy is kept; the original stays in Quant's Drive)
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Waiting items that aren't for the CRM
update public.intake_items
set status = 'ignored', updated_at = now(), last_error = null,
    reason = case
      when file_name ~* '\.(jpe?g|png|gif|heic|heif|webp|bmp|tiff?)$' then 'Photo — not filed (stays in Quant''s Drive)'
      when file_name ~* '\.(zip|rar|7z|tar|gz)$' then 'Zip / archive — not filed (stays in Quant''s Drive)'
      when file_name ~* '\.(py|js|ts|json|csv|bak|md|log|tmp|xml|mp4|mov|avi|m4a|mp3|wav)$' then 'Working / data file — not for the CRM'
      else 'Quant''s working folder — not for the CRM' end
where status in ('pending', 'to_check', 'error')
  and (file_name ~* '\.(jpe?g|png|gif|heic|heif|webp|bmp|tiff?|zip|rar|7z|tar|gz|py|js|ts|json|csv|bak|md|log|tmp|xml|mp4|mov|avi|m4a|mp3|wav)$'
       or coalesce(source_path, '') ~* '(^|/ )\s*_(generator|superseded|patch|archive|old|tmp|temp|working|scripts?)'
       or coalesce(source_path, '') ~* '^13\. Company & Admin / (18 Daily Email Digest|21 Action Register)');

-- 2. Photos the Inbox filed into job Documents: off the job's file list
drop table if exists filed_photos;
create temporary table filed_photos as
select i.id as item_id, (i.filed_to->>'file_id')::uuid as file_id
from public.intake_items i
where i.status = 'filed'
  and i.file_name ~* '\.(jpe?g|png|gif|heic|heif|webp|bmp|tiff?)$'
  and i.filed_to->>'target' = 'project_doc'
  and i.filed_to->>'file_id' ~ '^[0-9a-f-]{36}$';

delete from public.project_doc_files f using filed_photos p where f.id = p.file_id;

update public.intake_items i
set status = 'ignored', updated_at = now(),
    reason = 'Photo — taken off the CRM (original stays in Quant''s Drive)'
from filed_photos p where i.id = p.item_id;

drop table if exists filed_photos;

-- What's left waiting, by kind
select status, lower(substring(file_name from '(?i)\.([a-z0-9]{1,5})$')) as type, count(*)
from public.intake_items where status in ('pending', 'to_check') group by 1, 2 order by 1, 3 desc;
