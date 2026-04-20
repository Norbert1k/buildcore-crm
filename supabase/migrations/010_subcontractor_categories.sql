-- ============================================================
-- Migration 010: Add category column to subcontractors
-- Separates subcontractors from design team members
-- ============================================================

alter table public.subcontractors
  add column if not exists category text default 'subcontractor'
  check (category in ('subcontractor', 'design_team', 'both'));

-- Auto-set existing records based on their trade
update public.subcontractors
set category = 'design_team'
where trade in (
  'Architects', 'Building Control', 'Civil Engineers', 'Consultant',
  'Fire Consultants', 'Principle Designers', 'Setting Out Engineer',
  'SFS Engineers', 'Structural Engineers', 'Warranty Providers'
);

create index if not exists idx_subcontractors_category on public.subcontractors(category);
