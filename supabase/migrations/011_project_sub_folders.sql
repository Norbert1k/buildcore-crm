-- ============================================================
-- Migration 011: Subfolders for per-subcontractor documents
-- ============================================================

create table if not exists public.project_sub_folders (
  id uuid default uuid_generate_v4() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  project_sub_id uuid references public.project_subcontractors(id) on delete cascade not null,
  parent_key text not null,
  folder_key text not null,
  label text not null,
  created_at timestamptz default now()
);

alter table public.project_sub_folders enable row level security;

create policy "Auth users can view sub folders" on public.project_sub_folders for select using (auth.role() = 'authenticated');
create policy "Auth users can insert sub folders" on public.project_sub_folders for insert with check (auth.role() = 'authenticated');
create policy "Auth users can update sub folders" on public.project_sub_folders for update using (auth.role() = 'authenticated');
create policy "Auth users can delete sub folders" on public.project_sub_folders for delete using (auth.role() = 'authenticated');

create index if not exists idx_sub_folders_psid on public.project_sub_folders(project_sub_id);
create index if not exists idx_sub_folders_parent on public.project_sub_folders(project_sub_id, parent_key);
