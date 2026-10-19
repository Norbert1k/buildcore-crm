-- ─────────────────────────────────────────────────────────────────────────────
-- 035 — People at Employers Agent firms
--
-- An EA firm (e.g. LPS) can have several people. Each job picks which of them
-- look after it. Nothing existing is changed or deleted:
--   • new table employer_agent_contacts (people at each firm)
--   • new column project_employer_agents.contact_ids (who's on this job)
--   • each firm's current contact is copied in as its "main" person, and
--     existing job assignments point at that person.
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.employer_agent_contacts (
  id          uuid primary key default gen_random_uuid(),
  ea_id       uuid not null references public.employer_agents(id) on delete cascade,
  name        text not null,
  job_title   text,
  email       text,
  phone       text,
  is_primary  boolean not null default false,
  sort        integer not null default 0,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_ea_contacts_ea on public.employer_agent_contacts(ea_id);

alter table public.project_employer_agents add column if not exists contact_ids uuid[] not null default '{}';

-- Copy each firm's existing contact in as its main person (only firms with no people yet)
insert into public.employer_agent_contacts (ea_id, name, email, phone, is_primary, sort)
select ea.id, coalesce(nullif(trim(ea.contact_name), ''), trim(ea.email)), nullif(trim(ea.email), ''), nullif(trim(ea.phone), ''), true, 0
from public.employer_agents ea
where (nullif(trim(ea.contact_name), '') is not null or nullif(trim(ea.email), '') is not null)
  and not exists (select 1 from public.employer_agent_contacts c where c.ea_id = ea.id);

-- Existing job assignments: that main person looks after the job
update public.project_employer_agents pea
set contact_ids = array[c.id]
from public.employer_agent_contacts c
where c.ea_id = pea.ea_id and c.is_primary and pea.contact_ids = '{}';

-- Access: CRM staff (anyone with a profile), same as the EA firms themselves
alter table public.employer_agent_contacts enable row level security;
drop policy if exists ea_contacts_staff on public.employer_agent_contacts;
create policy ea_contacts_staff on public.employer_agent_contacts for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid()))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid()));

-- Editing an assignment (who's on the job / submission emails) needs update rights
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'project_employer_agents' and cmd = 'UPDATE') then
    create policy "Authenticated users can update project EAs" on public.project_employer_agents for update using (auth.role() = 'authenticated');
  end if;
end $$;
