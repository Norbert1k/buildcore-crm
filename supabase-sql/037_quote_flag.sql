-- ─────────────────────────────────────────────────────────────────────────────
-- 037 — Tell quote requests apart from old Task Tracker tasks
--
-- Quote requests and the old general tasks share the `tasks` table. This adds
-- tasks.is_quote: true = a quote request (shown in Quotes). Requests that
-- already have quotes are marked automatically; everything else stays as it
-- is and can be sorted in Quotes › "Old tasks". Nothing is deleted.
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.tasks add column if not exists is_quote boolean;

update public.tasks t set is_quote = true
where t.is_quote is null and exists (select 1 from public.task_quotes q where q.task_id = t.id);
