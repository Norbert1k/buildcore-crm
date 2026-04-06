-- ============================================================
-- SUPPLIERS TABLE
-- Run this as a new query in Supabase SQL Editor
-- ============================================================

create table public.suppliers (
  id uuid default uuid_generate_v4() primary key,
  company_name text not null,
  contact_name text,
  category text not null default 'General',
  email text,
  phone text,
  website text,
  address text,
  city text,
  postcode text,
  account_number text,
  credit_limit numeric(12,2),
  payment_terms text,
  portal_url text,
  portal_username text,
  portal_password text,
  notes text,
  status text not null default 'active' check (status in ('active','inactive')),
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.suppliers enable row level security;

create policy "Authenticated users can view suppliers" on public.suppliers
  for select using (auth.role() = 'authenticated');

create policy "Admins and PMs can manage suppliers" on public.suppliers
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','project_manager'))
  );

create trigger suppliers_updated_at before update on public.suppliers
  for each row execute function update_updated_at();

-- ============================================================
-- ACTIVITY LOG TABLE (for subcontractor notes/timeline)
-- ============================================================
create table if not exists public.subcontractor_notes (
  id uuid default uuid_generate_v4() primary key,
  subcontractor_id uuid references public.subcontractors(id) on delete cascade not null,
  note text not null,
  note_type text default 'note' check (note_type in ('note','call','email','visit','issue','document')),
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

alter table public.subcontractor_notes enable row level security;

create policy "Authenticated users can view notes" on public.subcontractor_notes
  for select using (auth.role() = 'authenticated');

create policy "Authenticated users can manage notes" on public.subcontractor_notes
  for all using (auth.role() = 'authenticated');

-- Add file_url to documents if not exists
alter table public.documents add column if not exists file_name text;
alter table public.documents add column if not exists file_url text;
