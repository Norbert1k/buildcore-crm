-- ============================================================
-- PERFORMANCE RATINGS SYSTEM
-- Run this as a new query in Supabase SQL Editor
-- ============================================================

-- Add VAT and CIS to subcontractors
alter table public.subcontractors add column if not exists vat_number text;
alter table public.subcontractors add column if not exists cis_number text;
alter table public.subcontractors add column if not exists cis_verified boolean default false;

-- Performance ratings table
create table public.performance_ratings (
  id uuid default uuid_generate_v4() primary key,
  subcontractor_id uuid references public.subcontractors(id) on delete cascade not null,
  project_id uuid references public.projects(id) on delete set null,
  rating_type text not null check (rating_type in ('commendation', 'yellow_card', 'red_card')),
  category text not null check (category in (
    'quality_of_work', 'health_safety', 'timekeeping', 'communication',
    'site_cleanliness', 'documentation', 'attitude', 'general'
  )),
  description text not null,
  issued_by uuid references public.profiles(id),
  email_sent boolean default false,
  created_at timestamptz default now()
);

alter table public.performance_ratings enable row level security;

create policy "Authenticated users can view ratings" on public.performance_ratings
  for select using (auth.role() = 'authenticated');

create policy "Admins and PMs can manage ratings" on public.performance_ratings
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role in ('admin', 'project_manager')
    )
  );
