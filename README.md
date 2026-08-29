# BuildCore — changed files bundle (this session)

Drop these into your CURRENT repo, keeping the folder layout below. Every path
here mirrors where the file goes in the repo. Nothing else in your repo is
touched — these are individual file replacements/additions, safe against
whatever is currently live.

The folder layout in this zip already matches the repo, EXCEPT:
  • PORTAL_src_components_InlineFileBrowser.tsx is a PORTAL file (different
    repo: buildcore-portal). It goes to buildcore-portal/src/components/
    InlineFileBrowser.tsx — renamed here so it doesn't collide with the CRM.

## CRM file placement (buildcore-crm repo)

src/components/
  ProjectDocumentation.jsx   REPLACE — cumulative: explorer toggle + file-date
                             fix + progress-report publish fix, all in one.
  DocExplorer.jsx            NEW — the two-panel explorer (read/navigate/
                             download/bulk-select; behind the toggle).
  CompanyInformation.jsx     NEW — Company Information panel.
  Sidebar.jsx                REPLACE — renames "Web Search" → "Price Jobs".

src/pages/
  CompanyDocuments.jsx       REPLACE — renders the Company Information panel.
  WebSearch.jsx              REPLACE — adds Rate library tab (Price Jobs page).
  PriceJobTab.jsx            NEW — price-a-job with ✨ rate suggestions.
  RateLibraryTab.jsx         NEW — harvested rate library + material/labour split.
  PricedJobsHistory.jsx      NEW — saved priced jobs.
  Settings.jsx               REPLACE — escalation rates admin.
  ProcurementTab.jsx         NEW — per-project procurement tracker (auto-fill
                             button removed).
  ProjectDetail.jsx          REPLACE — adds the Procurement tab.

src/lib/
  auth.jsx                   REPLACE — adds manage_company_info permission.
  rateEngine.js              NEW — rate matching/blending engine.
  escalation.js              NEW — escalation maths + fmt helpers.

## Edge functions (Supabase — deploy via CLI, not the repo)

edge-functions/harvest-csa-rates/index.ts
    supabase functions deploy harvest-csa-rates
edge-functions/index.ts   (suggest-escalation-rate)
    deploy as function "suggest-escalation-rate"

## SQL (run in Supabase SQL editor, in number order)

supabase-sql/
  028_escalation_rates.sql
  029_priced_jobs.sql
  030_project_procurement.sql
  031_rate_library.sql
  032_rate_harvest_schedule.sql      (edit PROJECT_REF + SERVICE_ROLE_KEY first)
  033_company_information.sql         (only if NOT seeded before)
  033b_company_information_edits.sql  (run INSTEAD if 033 already seeded)
  backfill_portal_folder_visibility.sql  (run STEP 1+2 previews first, then 3)

## Portal (buildcore-portal repo — separate Vercel deploy)

PORTAL_src_components_InlineFileBrowser.tsx
  → buildcore-portal/src/components/InlineFileBrowser.tsx
  Carries: Payment Notice tile + folder sort-by-label ordering fix.

## Deploy-only-what-you-need
If you've already deployed some of these earlier in the session, skip those.
The only one that changed since the last drops is ProjectDocumentation.jsx —
it's now cumulative (explorer + the two earlier fixes), so use THIS copy and
discard any older ProjectDocumentation you may have staged.

## Honest note on "whole src"
This is the changed-files set, not a full src tree — deliberately, so it can't
overwrite anything currently live that isn't listed here. If you ever want a
complete, accurate src, re-upload a fresh export of the live repo and I'll
apply these onto it.
