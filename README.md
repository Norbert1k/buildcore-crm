-- ============================================================
-- EXTENDED ROLES & PROJECT ASSIGNMENTS
-- Run this as a new query in Supabase SQL Editor
-- ============================================================

-- Update profiles role check to include new roles
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in (
    'admin',
    'project_manager',
    'accountant',
    'site_manager',
    'document_controller',
    'viewer'
  ));

-- Site manager project assignments
-- Links site managers to specific projects they can access
create table if not exists public.user_project_access (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  project_id uuid references public.projects(id) on delete cascade not null,
  granted_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  unique(user_id, project_id)
);

alter table public.user_project_access enable row level security;

create policy "Admins can manage project access" on public.user_project_access
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Users can view own project access" on public.user_project_access
  for select using (user_id = auth.uid());

-- Add must_change_password flag to profiles
alter table public.profiles add column if not exists must_change_password boolean default false;

-- Add Google Drive folder link to projects
alter table public.projects add column if not exists drive_folder_id text;
alter table public.projects add column if not exists drive_folder_name text;

-- App settings table for storing company-wide config like Drive folder links
create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

alter table public.app_settings enable row level security;

create policy "Authenticated users can view settings" on public.app_settings
  for select using (auth.role() = 'authenticated');

create policy "Admins can manage settings" on public.app_settings
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- Company documents library
create table if not exists public.company_documents (
  id uuid default uuid_generate_v4() primary key,
  category text not null,
  file_name text not null,
  file_size bigint,
  file_type text,
  storage_path text not null,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

alter table public.company_documents enable row level security;

create policy "Authenticated users can view company docs" on public.company_documents
  for select using (auth.role() = 'authenticated');

create policy "Admins and PMs can manage company docs" on public.company_documents
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','project_manager'))
  );

-- Add sort_order to company_documents for drag reordering
alter table public.company_documents add column if not exists sort_order integer default 0;

-- Add theme preference to profiles
alter table public.profiles add column if not exists theme text default 'light' check (theme in ('light', 'dark'));
