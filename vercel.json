-- ============================================================
-- Migration 006: Project subcontractor categories + Notifications
-- ============================================================

-- 1. Add category column to project_subcontractors
--    'design_team' = Architects, Structural Engineers, etc.
--    'contractual_work' = Physical trades / labour
alter table public.project_subcontractors
  add column if not exists category text default 'contractual_work'
  check (category in ('design_team', 'contractual_work'));

-- 2. Notifications table for in-CRM alerts
create table if not exists public.notifications (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  message text,
  type text default 'info' check (type in ('info', 'warning', 'danger', 'success')),
  link text,
  read boolean default false,
  created_at timestamptz default now()
);

alter table public.notifications enable row level security;

create policy "Users can view own notifications" on public.notifications
  for select using (auth.uid() = user_id);

create policy "Users can update own notifications" on public.notifications
  for update using (auth.uid() = user_id);

create policy "System can insert notifications" on public.notifications
  for insert with check (true);

-- Index for fast unread count queries
create index if not exists idx_notifications_user_unread
  on public.notifications (user_id, read) where read = false;

-- Index for expiry date checks on documents
create index if not exists idx_documents_expiry
  on public.documents (expiry_date) where expiry_date is not null;
