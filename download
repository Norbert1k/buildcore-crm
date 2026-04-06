-- ============================================================
-- SUBCONTRACTOR CONTACTS TABLE
-- Run this as a new query in Supabase SQL Editor
-- ============================================================

create table public.subcontractor_contacts (
  id uuid default uuid_generate_v4() primary key,
  subcontractor_id uuid references public.subcontractors(id) on delete cascade not null,
  full_name text not null,
  job_title text,
  email text,
  phone text,
  mobile text,
  is_primary boolean default false,
  notes text,
  created_at timestamptz default now()
);

alter table public.subcontractor_contacts enable row level security;

create policy "Authenticated users can view contacts" on public.subcontractor_contacts
  for select using (auth.role() = 'authenticated');

create policy "Admins and PMs can manage contacts" on public.subcontractor_contacts
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role in ('admin', 'project_manager', 'document_controller')
    )
  );

-- Migrate existing contact_name and phone/email into contacts table
-- (Run manually after creating table if you want to migrate existing data)
-- insert into public.subcontractor_contacts (subcontractor_id, full_name, email, phone, is_primary)
-- select id, contact_name, email, phone, true from public.subcontractors where contact_name is not null;

-- Add contact_role to subcontractors table
alter table public.subcontractors add column if not exists contact_role text;
