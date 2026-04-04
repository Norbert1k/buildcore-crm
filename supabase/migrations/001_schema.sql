-- ============================================================
-- BuildCore CRM - Full Database Schema
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROFILES (extends Supabase auth.users)
-- ============================================================
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  full_name text not null,
  email text not null,
  role text not null check (role in ('admin','project_manager','document_controller','viewer')),
  avatar_initials text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view all profiles" on public.profiles
  for select using (auth.role() = 'authenticated');

create policy "Admins can manage profiles" on public.profiles
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Users can update own profile" on public.profiles
  for update using (id = auth.uid());

-- ============================================================
-- SUBCONTRACTORS
-- ============================================================
create table public.subcontractors (
  id uuid default uuid_generate_v4() primary key,
  company_name text not null,
  contact_name text not null,
  trade text not null,
  email text,
  phone text,
  address text,
  city text,
  postcode text,
  website text,
  status text not null default 'active' check (status in ('active','approved','on_hold','inactive')),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.subcontractors enable row level security;

create policy "Authenticated users can view subcontractors" on public.subcontractors
  for select using (auth.role() = 'authenticated');

create policy "Admins and PMs can insert subcontractors" on public.subcontractors
  for insert with check (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','project_manager'))
  );

create policy "Admins and PMs can update subcontractors" on public.subcontractors
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','project_manager'))
  );

create policy "Only admins can delete subcontractors" on public.subcontractors
  for delete using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================================
-- DOCUMENTS
-- ============================================================
create table public.documents (
  id uuid default uuid_generate_v4() primary key,
  subcontractor_id uuid references public.subcontractors(id) on delete cascade not null,
  document_type text not null check (document_type in (
    'public_liability','employers_liability','professional_indemnity',
    'rams','method_statement','risk_assessment',
    'cscs_card','gas_safe','niceic','chas','constructionline',
    'iso_9001','iso_14001','iso_45001','f10_notification',
    'trade_certificate','other'
  )),
  document_name text not null,
  reference_number text,
  issue_date date,
  expiry_date date,
  file_url text,
  file_name text,
  notes text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.documents enable row level security;

create policy "Authenticated users can view documents" on public.documents
  for select using (auth.role() = 'authenticated');

create policy "Admins, PMs and doc controllers can manage documents" on public.documents
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','project_manager','document_controller'))
  );

-- ============================================================
-- PROJECTS
-- ============================================================
create table public.projects (
  id uuid default uuid_generate_v4() primary key,
  project_name text not null,
  project_ref text unique,
  client_name text,
  site_address text,
  city text,
  postcode text,
  status text not null default 'active' check (status in ('tender','active','on_hold','completed','cancelled')),
  start_date date,
  end_date date,
  project_manager_id uuid references public.profiles(id),
  value numeric(12,2),
  description text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.projects enable row level security;

create policy "Authenticated users can view projects" on public.projects
  for select using (auth.role() = 'authenticated');

create policy "Admins and PMs can manage projects" on public.projects
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','project_manager'))
  );

-- ============================================================
-- PROJECT SUBCONTRACTORS (many-to-many)
-- ============================================================
create table public.project_subcontractors (
  id uuid default uuid_generate_v4() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  subcontractor_id uuid references public.subcontractors(id) on delete cascade not null,
  trade_on_project text,
  start_date date,
  end_date date,
  contract_value numeric(12,2),
  status text default 'active' check (status in ('active','completed','removed')),
  notes text,
  assigned_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  unique(project_id, subcontractor_id)
);

alter table public.project_subcontractors enable row level security;

create policy "Authenticated users can view project subcontractors" on public.project_subcontractors
  for select using (auth.role() = 'authenticated');

create policy "Admins and PMs can manage project subcontractors" on public.project_subcontractors
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','project_manager'))
  );

-- ============================================================
-- PROJECT DOCUMENTS (RAMS etc linked to a project)
-- ============================================================
create table public.project_documents (
  id uuid default uuid_generate_v4() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  subcontractor_id uuid references public.subcontractors(id) on delete set null,
  document_type text not null,
  document_name text not null,
  expiry_date date,
  file_url text,
  file_name text,
  approved boolean default false,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  notes text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

alter table public.project_documents enable row level security;

create policy "Authenticated users can view project documents" on public.project_documents
  for select using (auth.role() = 'authenticated');

create policy "Admins PMs and doc controllers can manage project documents" on public.project_documents
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','project_manager','document_controller'))
  );

-- ============================================================
-- ACTIVITY LOG
-- ============================================================
create table public.activity_log (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  entity_name text,
  details jsonb,
  created_at timestamptz default now()
);

alter table public.activity_log enable row level security;

create policy "Admins can view all activity" on public.activity_log
  for select using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Authenticated users can insert activity" on public.activity_log
  for insert with check (auth.role() = 'authenticated');

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger subcontractors_updated_at before update on public.subcontractors
  for each row execute function update_updated_at();

create trigger documents_updated_at before update on public.documents
  for each row execute function update_updated_at();

create trigger projects_updated_at before update on public.projects
  for each row execute function update_updated_at();

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'viewer')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- SAMPLE DATA (optional - remove for production)
-- ============================================================
-- Note: Insert sample data after creating your first admin user
-- See README.md for instructions

-- ============================================================
-- DOCUMENT STATUS FUNCTION
-- (replaces generated column - computed at query time)
-- ============================================================

create or replace function public.get_doc_status(p_expiry_date date)
returns text as $$
begin
  if p_expiry_date is null then
    return 'no_expiry';
  elsif p_expiry_date < current_date then
    return 'expired';
  elsif p_expiry_date <= current_date + interval '30 days' then
    return 'expiring_soon';
  else
    return 'valid';
  end if;
end;
$$ language plpgsql stable;

-- View that adds computed status to every document query
create or replace view public.documents_with_status as
  select
    *,
    public.get_doc_status(expiry_date) as status
  from public.documents;
