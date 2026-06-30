-- ─────────────────────────────────────────────────────────────────────────────
-- 033_company_information.sql
--
-- Single-row table holding the company's master information, shown as a
-- "Company Information" dropdown at the top of Company Documents. Editable by
-- admins only (enforced in the UI via the manage_company_info permission, and
-- here defensively via RLS).
--
-- Stored as structured JSONB so fields can be added/edited without migrations.
-- Sensitive blocks (directors' personal details, banking) are kept in their
-- own keys so the UI can gate their VISIBILITY separately from general info.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.company_information (
  id          integer primary key default 1,
  data        jsonb not null default '{}'::jsonb,
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now(),
  constraint company_information_singleton check (id = 1)
);

alter table public.company_information enable row level security;

-- All authenticated staff can READ (the UI decides which sub-blocks to show
-- per role). Writes are restricted to admins.
drop policy if exists "Staff read company info" on public.company_information;
create policy "Staff read company info" on public.company_information
  for select using (auth.role() = 'authenticated');

-- Admin-only writes. We can't read the app role table generically here, so we
-- gate on the profiles.role = 'admin' (matches the app's admin short-circuit).
drop policy if exists "Admin manage company info" on public.company_information;
create policy "Admin manage company info" on public.company_information
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Seed the single row with the current CCG details.
insert into public.company_information (id, data) values (1, $json$
{
  "company": {
    "trading_name": "City Construction Group Ltd",
    "companies_house_url": "https://find-and-update.company-information.service.gov.uk/company/12311732",
    "trading_style": "Limited Company",
    "company_registration_no": "12311732",
    "vat_registration_no": "441934200",
    "incorporated_on": "12 November 2019"
  },
  "addresses": {
    "registered_office": "One Canada Square, London, E14 5AA"
  },
  "contacts": {
    "general_enquiries": "info@cltd.co.uk",
    "payments_contact": "Sandra Paukste — +44 7522 382105 — accounts@cltd.co.uk",
    "invoices_statements": "accounts@cltd.co.uk"
  },
  "directors": [
    {
      "name": "Norbertas Lenktys",
      "dob": "25/03/1992",
      "phone": "+44 7960 905955"
    }
  ],
  "banking": {
    "bank": "Barclays Bank UK PLC",
    "branch": "Bexleyheath",
    "sort_code": "20-62-69",
    "account_no": "13630752"
  },
  "staff": [
    { "name": "Norbertas Lenktys", "role": "Director", "phone": "+44 7960 905955" },
    { "name": "Eugene", "role": "Operations Director", "phone": "+44 7990 544469" },
    { "name": "Phil Dove", "role": "Operations Manager", "phone": "+44 7974 358771" },
    { "name": "Sandra Paukste", "role": "Accounts Manager", "phone": "+44 7522 382105" },
    { "name": "Mark Telfer", "role": "Project Director", "phone": "+44 7741 565657" },
    { "name": "Billy Mustafa", "role": "Senior Project Manager", "phone": "+44 7875 374264" },
    { "name": "Azim Bakshi", "role": "Project Manager", "phone": "+44 7541 027678" },
    { "name": "Jim Otakho", "role": "Junior Project Manager", "phone": "+44 7539 951825" },
    { "name": "Chris Galkowski", "role": "Junior Project Manager", "phone": "+44 7460 388640" }
  ]
}
$json$::jsonb)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
