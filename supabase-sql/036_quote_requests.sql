-- ─────────────────────────────────────────────────────────────────────────────
-- 036 — Quote requests: return-by date, budget, and suppliers asked to price
--
-- Quote requests stay in `tasks` (with their quotes in `task_quotes`), so every
-- existing request, note, file and quote carries straight over. This adds:
--   • tasks.return_by   — date prices are due back
--   • tasks.budget      — optional budget figure to compare prices against
--   • task_quote_invites — who has been asked to price (and who declined)
-- Nothing existing is changed or deleted. Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.tasks add column if not exists return_by date;
alter table public.tasks add column if not exists budget numeric;

create table if not exists public.task_quote_invites (
  id                uuid primary key default gen_random_uuid(),
  task_id           uuid not null references public.tasks(id) on delete cascade,
  supplier_id       uuid references public.suppliers(id) on delete set null,
  subcontractor_id  uuid references public.subcontractors(id) on delete set null,
  vendor_name_text  text not null,
  contact_email     text,
  status            text not null default 'asked' check (status in ('asked', 'declined')),
  asked_at          timestamptz not null default now(),
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now()
);
create index if not exists idx_task_quote_invites_task on public.task_quote_invites(task_id);

-- Access: CRM staff (anyone with a profile)
alter table public.task_quote_invites enable row level security;
drop policy if exists task_quote_invites_staff on public.task_quote_invites;
create policy task_quote_invites_staff on public.task_quote_invites for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid()))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid()));
