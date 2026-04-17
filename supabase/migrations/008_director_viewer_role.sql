-- ============================================================
-- Migration 008: Add director_viewer role
-- View-only role with full PM-level visibility (financials, all tabs)
-- but no edit, add, or delete permissions
-- ============================================================

-- Update profiles role check to include director_viewer
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in (
    'admin',
    'project_manager',
    'director_viewer',
    'accountant',
    'site_manager',
    'document_controller',
    'viewer'
  ));
