-- ─────────────────────────────────────────────────────────────────────────────
-- 033b_company_information_edits.sql
--
-- Applies three edits to the existing company_information row:
--   1. Remove the director's home address.
--   2. Eugene's title → "Operations Director".
--   3. Sandra's phone normalised to +44 format (staff row + payments contact).
--
-- RUN THIS if you already ran 033_company_information.sql (the original seed
-- used "on conflict do nothing", so re-running the seed won't update an
-- existing row). If you have NOT run 033 yet, just run the updated 033 instead
-- and skip this — the seed already contains all three changes.
--
-- Safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────────

update public.company_information
set data = jsonb_set(
             jsonb_set(
               -- 2 + 3: rebuild the staff array with Eugene + Sandra fixed
               jsonb_set(
                 data,
                 '{staff}',
                 (
                   select jsonb_agg(
                     case
                       when s->>'name' = 'Eugene'
                         then jsonb_set(s, '{role}', '"Operations Director"')
                       when s->>'name' = 'Sandra Paukste'
                         then jsonb_set(s, '{phone}', '"+44 7522 382105"')
                       else s
                     end
                   )
                   from jsonb_array_elements(data->'staff') as s
                 )
               ),
               -- 3 (cont.): normalise Sandra's number inside the payments contact line
               '{contacts,payments_contact}',
               '"Sandra Paukste — +44 7522 382105 — accounts@cltd.co.uk"'
             ),
             -- 1: strip the home address from every director entry
             '{directors}',
             (
               select jsonb_agg(d - 'address')
               from jsonb_array_elements(data->'directors') as d
             )
           ),
    updated_at = now()
where id = 1;

notify pgrst, 'reload schema';
