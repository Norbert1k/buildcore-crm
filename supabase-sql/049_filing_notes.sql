-- ─────────────────────────────────────────────────────────────────────────────
-- 049 — Filing notes per job (read by the Inbox before it places a file)
--
-- projects.doc_notes: building names, what drawing codes mean, where things go.
-- Edited in Job › Documents › Filing notes. The Inbox reads it when it picks
-- the job and when it picks the folder.
-- Merton gets its three buildings now. Nothing existing is changed or deleted.
-- Safe to run more than once (only fills Merton's notes if they're empty).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.projects add column if not exists doc_notes text;

update public.projects
set doc_notes = 'Three buildings in one job: Residential Block (PB); Sports Hall (PSC); Changing Room Block — also called Education Block / Education Building (PD). '
  || 'File every drawing under the building it covers, then consultant › stage › drawing type (Layouts, Schematics, Combined Services, Model, Documents) — never loose in a parent folder. '
  || 'If a drawing''s building code isn''t clear, file it with earlier drawings carrying the same code; if there are none, leave it for a person.'
where project_name ilike '%merton%' and coalesce(status, '') <> 'cancelled' and coalesce(doc_notes, '') = '';

notify pgrst, 'reload schema';

select project_name, doc_notes from public.projects where doc_notes is not null;
