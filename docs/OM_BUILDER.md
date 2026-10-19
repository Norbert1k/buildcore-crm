# O&M builder — how it works and how to switch it on

Project › Handover › **O&M builder**. Produces the O&M manual (package or whole building), the tenant
O&M (one per flat) and the Golden Thread section, in the CCG standard layout.

## Flow (mostly automatic)
1. **Read** — every PDF/photo in the job's Handover folders and Documents is read once by Claude
   (`handover-ai` → `read`). Uploads in H&S Handover are read in the background; documents dropped on
   the builder are read *and filed* into the folder Claude suggests (unsure ones wait under "To file").
2. **Check** — the builder shows what's found / missing for the ticked packs, where two documents
   disagree (you pick the right value once) and anything Claude flagged.
3. **Draft** — `handover-ai` → `compose` writes the pack JSON from the readings, following
   `supabase/functions/handover-ai/examples.json` (Scotsbridge = package, resi + tenant samples) so every
   job comes out in the same layout. With "keep up to date" ticked the draft rebuilds after new documents.
4. **Issue** — a lead approves; `/api/om-render` prints it (headless Chromium, Carlito embedded), works out
   page numbers, binds the appendix documents in, adds header/footer/bookmarks, saves the PDF into
   Handover › Section 8 (`hs_files.origin = 'om_builder'`) and records it in `om_issues`.

Nothing is deleted or overwritten. Issued manuals are never used as source material.

## Files
- `src/components/OmBuilder.jsx` — the screen
- `src/lib/omRenderCore.js` — the one layout renderer (browser preview and print server share it)
- `src/lib/omStyle.css`, `src/lib/omTenant.css`, `src/assets/om/*` — house style
- `src/lib/omFacts.js` — readiness / conflicts / higher-risk test
- `src/lib/omApi.js` — calls to handover-ai and /api/om-render
- `server/omPrint.js`, `api/om-render.js`, `server/fonts/` — print service (Vercel)
- `supabase/functions/handover-ai/` — Claude read + compose
- `supabase-sql/034_om_builder.sql` — additive migration (renumber if live is past 033)

## Go-live checklist
1. Supabase → SQL Editor: run `supabase-sql/034_om_builder.sql` (additive only).
2. Supabase → Edge Functions → new function `handover-ai`: paste `supabase/functions/handover-ai/index.ts`
   (single file). Uses the existing `ANTHROPIC_API_KEY` secret. "Verify JWT" OFF (the function checks
   the signed-in user itself; the legacy-secret check can reject valid logins).
3. Supabase → Storage → `hs-handover` bucket: upload size limit at least 50 MB (issued manuals with
   manufacturer documents bound in can be 15–40 MB).
4. Vercel → Project → Settings → Environment Variables (Production + Preview):
   `SUPABASE_URL` (same value as VITE_SUPABASE_URL) and `SUPABASE_SERVICE_ROLE_KEY`
   (Supabase → Project Settings → API → service_role). Never prefix this one with VITE_.
5. Push the code on a new branch; Vercel builds a Preview link. Test there, then merge to main.

## Multi-building jobs (e.g. Merton)
- Needs `supabase-sql/038_handover_buildings.sql`. Buildings come from the job's numbered folders
  ("01. CCG PB - Residential", "01. CSA - Residential Building", …) — the same ones the CFF/CSA use.
- Handover shows a building bar: All buildings (overview + untagged documents) and one tab per building.
  Each building has its own O&M settings, readiness, draft and issue numbers ("Merton — Sports Hall — O&M
  Manual — Issue 01"). Documents are tagged per building (Claude suggests it while reading; "Tag by name";
  or by hand in Details › Documents). Untagged and "Whole site" documents go into every building's manual.
- Push the code before running 038 (old code saves settings with the old one-per-job rule).

## After go-live
- Drawings tab shows the Design portal register through `design-link` (CRM) → `crm-drawings` (Design
  project, read-only, Verify JWT off, shared secret `CRM_DRAWINGS_SECRET` = CRM's `DESIGN_DRAWINGS_SECRET`).
  Jobs not in Design keep the old Drawings & Surveys view automatically.
- Site-manager limits are enforced in the app. To enforce them in the database too, add RLS on projects /
  subcontractors / project_subcontractors based on `user_project_access` (test carefully — it can lock people out).
- Issue numbers start at Issue 01 for each job in the CRM; a job already issued outside the CRM
  (e.g. Scotsbridge Issue 01) will need its first CRM issue renamed or the count seeded with one om_issues row.
