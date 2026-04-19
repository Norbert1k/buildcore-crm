-- ============================================================
-- Migration 007: Employers Agent system
-- Moves EA from Clients into Subcontractors section
-- ============================================================

-- 1. Ensure employer_agents table exists (may already exist from earlier work)
create table if not exists public.employer_agents (
  id uuid default uuid_generate_v4() primary key,
  company_name text not null,
  contact_name text,
  phone text,
  email text,
  payment_submission_email text,
  website text,
  notes text,
  status text default 'active' check (status in ('active', 'inactive')),
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

-- Rename 'name' to 'company_name' if the table was created with 'name' column
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employer_agents' AND column_name = 'name')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employer_agents' AND column_name = 'company_name')
  THEN
    ALTER TABLE public.employer_agents RENAME COLUMN name TO company_name;
  END IF;
END $$;

-- Add new columns if they don't exist
ALTER TABLE public.employer_agents ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE public.employer_agents ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.employer_agents ADD COLUMN IF NOT EXISTS payment_submission_email text;
ALTER TABLE public.employer_agents ADD COLUMN IF NOT EXISTS status text default 'active';
ALTER TABLE public.employer_agents ADD COLUMN IF NOT EXISTS created_by uuid references public.profiles(id);

-- 2. Project EA assignments — links EA to a project with a submission email for that job
create table if not exists public.project_employer_agents (
  id uuid default uuid_generate_v4() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  ea_id uuid references public.employer_agents(id) on delete cascade not null,
  submission_email text,
  created_at timestamptz default now(),
  unique(project_id, ea_id)
);

-- 3. RLS policies
alter table public.employer_agents enable row level security;
alter table public.project_employer_agents enable row level security;

-- EA policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'employer_agents' AND policyname = 'Authenticated users can view EAs') THEN
    CREATE POLICY "Authenticated users can view EAs" ON public.employer_agents FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'employer_agents' AND policyname = 'Authenticated users can insert EAs') THEN
    CREATE POLICY "Authenticated users can insert EAs" ON public.employer_agents FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'employer_agents' AND policyname = 'Authenticated users can update EAs') THEN
    CREATE POLICY "Authenticated users can update EAs" ON public.employer_agents FOR UPDATE USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'employer_agents' AND policyname = 'Authenticated users can delete EAs') THEN
    CREATE POLICY "Authenticated users can delete EAs" ON public.employer_agents FOR DELETE USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- Project EA assignment policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project_employer_agents' AND policyname = 'Authenticated users can view project EAs') THEN
    CREATE POLICY "Authenticated users can view project EAs" ON public.project_employer_agents FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project_employer_agents' AND policyname = 'Authenticated users can insert project EAs') THEN
    CREATE POLICY "Authenticated users can insert project EAs" ON public.project_employer_agents FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project_employer_agents' AND policyname = 'Authenticated users can delete project EAs') THEN
    CREATE POLICY "Authenticated users can delete project EAs" ON public.project_employer_agents FOR DELETE USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- 4. Indexes
create index if not exists idx_project_ea_project on public.project_employer_agents(project_id);
create index if not exists idx_project_ea_ea on public.project_employer_agents(ea_id);
