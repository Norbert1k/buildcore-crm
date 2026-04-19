-- ============================================================
-- Migration 009: Per-subcontractor document folders in projects
-- Auto-created folder structure when a sub is assigned to a project
-- ============================================================

create table if not exists public.project_sub_files (
  id uuid default uuid_generate_v4() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  project_sub_id uuid references public.project_subcontractors(id) on delete cascade not null,
  folder_key text not null,
  file_name text not null,
  file_size bigint,
  storage_path text not null,
  direction text default 'received' check (direction in ('sent', 'received')),
  notes text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

alter table public.project_sub_files enable row level security;

create policy "Authenticated users can view project sub files" on public.project_sub_files
  for select using (auth.role() = 'authenticated');

create policy "Authenticated users can insert project sub files" on public.project_sub_files
  for insert with check (auth.role() = 'authenticated');

create policy "Authenticated users can update project sub files" on public.project_sub_files
  for update using (auth.role() = 'authenticated');

create policy "Authenticated users can delete project sub files" on public.project_sub_files
  for delete using (auth.role() = 'authenticated');

create index if not exists idx_project_sub_files_ps on public.project_sub_files(project_sub_id);
create index if not exists idx_project_sub_files_proj on public.project_sub_files(project_id);
create index if not exists idx_project_sub_files_folder on public.project_sub_files(project_sub_id, folder_key);
