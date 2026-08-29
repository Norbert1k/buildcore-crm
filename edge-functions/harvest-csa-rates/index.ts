// ─────────────────────────────────────────────────────────────────────────────
// harvest-csa-rates  (Supabase Edge Function, Deno)
//
// Scans every CSA xlsx stored in project_doc_files (folder = project docs,
// subfolder keyed 'csa' or per-building csa), downloads each from storage,
// parses it server-side, and upserts every priced line into rate_library.
//
// Designed to run on a SCHEDULE (Supabase cron) — see schedule.sql alongside.
// Can also be invoked manually (POST) to rebuild on demand.
//
// Idempotent: upserts on (source_file_id, ref) so re-runs update, not dupe.
// Material/labour split is NOT set here — it's captured by humans later in the
// Rate library viewer; the harvester only ever writes the blended line rate.
//
// Mirrors the row logic of src/lib/csaExtractor.js but with FLEXIBLE section
// detection (any all-caps header row with an empty total), because real CSAs
// use many detailed sections (SUBSTRUCTURE, ROOF, MEP SERVICES, …) beyond the
// 5 generic CFF ones.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'

const PRIMARY_FOLDER = '00-project-information'  // matches CffGeneratorModal
const DOCS_BUCKET = 'project-docs'

// Footer / non-data labels — never harvested as rate lines or sections.
const FOOTER_RE = /^(contract\s+sum|contract\s+total|total\s+due|grand\s+total|less\s+retention|retention|sub\s*total|variations?|provisional\s+sums?)\b/i

// Unit normalisation so sqm and m2 blend together, etc.
function normUnit(u: string): string {
  const s = String(u || '').toLowerCase().trim()
  if (s === 'sqm' || s === 'sq m' || s === 'm²' || s === 'm2') return 'm2'
  if (s === 'lm' || s === 'lin m' || s === 'linear m') return 'lm'
  if (s === 'no' || s === 'nr' || s === 'no.') return 'nr'
  return s
}

// Normalise a description for fuzzy matching: lowercase, strip punctuation,
// collapse whitespace, drop very common filler words.
function normDesc(d: string): string {
  return String(d || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(the|and|to|of|for|with|incl|including|various|etc|allowance|say|all|new)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Is this row an all-caps section header? Heuristic: column A or B is a short
// all-caps string (letters/&/spaces), and the total column is empty.
function detectSection(a: unknown, b: unknown, total: unknown): string | null {
  const empty = total == null || total === '' || total === 0
  if (!empty) return null
  for (const v of [a, b]) {
    if (typeof v !== 'string') continue
    const t = v.trim()
    if (!t || t.length < 3 || t.length > 60) continue
    if (FOOTER_RE.test(t)) continue
    // All-caps (allowing &, digits, spaces, commas) and has at least 3 letters
    if (/^[A-Z0-9 &,\/\-]+$/.test(t) && (t.match(/[A-Z]/g)?.length ?? 0) >= 3) {
      return t
    }
  }
  return null
}

function findHeaderRow(rows: any[][]): number {
  for (let r = 0; r < Math.min(20, rows.length); r++) {
    const joined = (rows[r] || []).map(v => String(v || '').toLowerCase()).join(' ')
    if (joined.includes('ref') && joined.includes('description') && joined.includes('total')) return r
  }
  return -1
}

function findProjectName(rows: any[][]): string {
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const row = rows[r] || []
    for (let c = 0; c < Math.min(10, row.length); c++) {
      const v = row[c]
      if (typeof v === 'string' && v.trim().toUpperCase() === 'PROJECT') {
        const next = row[c + 1]
        if (typeof next === 'string' && next.trim()) return next.trim()
        for (let r2 = r + 1; r2 < Math.min(r + 3, rows.length); r2++) {
          const cand = (rows[r2] || [])[c]
          if (typeof cand === 'string' && cand.trim() && cand.trim().toUpperCase() !== 'PROJECT') return cand.trim()
        }
      }
    }
  }
  return ''
}

// Parse one CSA workbook into rate rows.
function parseCsa(buf: ArrayBuffer) {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
  const headerIdx = findHeaderRow(rows)
  if (headerIdx < 0) return { projectName: '', lines: [] }
  const projectName = findProjectName(rows)

  // Column layout (0-indexed): Ref, Description, Qty, Unit, Rate, Total, ...
  const COL = { ref: 0, desc: 1, qty: 2, unit: 3, rate: 4, total: 5 }
  const lines: any[] = []
  let section: string | null = null

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || []
    const a = row[COL.ref], b = row[COL.desc]
    const total = row[COL.total]

    // Footer rows — stop harvesting once we hit contract sum / retention etc.
    const aStr = typeof a === 'string' ? a.trim() : ''
    if (FOOTER_RE.test(aStr)) {
      // Stop entirely at CONTRACT SUM and below (variations / prov sums excluded)
      if (/^(contract\s+sum|variations?|provisional\s+sums?)\b/i.test(aStr)) break
      continue
    }

    // Section header?
    const sec = detectSection(a, b, total)
    if (sec) { section = sec; continue }

    // Sub-group rows (description in col B, no ref, no total) — keep as context
    // but don't harvest. e.g. "Communal", "Apartments".
    const desc = typeof b === 'string' ? b.trim() : ''
    const rate = typeof row[COL.rate] === 'number' ? row[COL.rate] : null
    const qty = typeof row[COL.qty] === 'number' ? row[COL.qty] : null
    const totalNum = typeof total === 'number' ? total : null
    const unit = typeof row[COL.unit] === 'string' ? row[COL.unit].trim() : ''

    // A harvestable line needs a description and a positive rate or total.
    if (!desc) continue
    if (!(rate && rate > 0) && !(totalNum && totalNum > 0)) continue

    lines.push({
      ref: aStr || null,
      section: section || null,
      description: desc,
      description_norm: normDesc(desc),
      qty,
      unit: unit || null,
      unit_norm: normUnit(unit),
      rate: rate ?? (qty && totalNum ? totalNum / qty : null),
      total: totalNum,
    })
  }
  return { projectName, lines }
}

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,   // service role: bypasses RLS, can read storage
  )

  let filesSeen = 0, rowsUpserted = 0
  const errors: string[] = []

  try {
    // 1. List all CSA files across all projects. CSAs live in project_doc_files
    //    with a subfolder_key containing 'csa'.
    const { data: files, error: filesErr } = await supabase
      .from('project_doc_files')
      .select('id, project_id, file_name, storage_path, subfolder_key, created_at')
      .eq('folder_key', PRIMARY_FOLDER)
      .ilike('subfolder_key', '%csa%')
      .ilike('file_name', '%.xlsx')
    if (filesErr) throw filesErr

    for (const f of (files || [])) {
      filesSeen++
      try {
        // 2. Download from storage
        const { data: blob, error: dlErr } = await supabase.storage
          .from(DOCS_BUCKET)
          .download(f.storage_path)
        if (dlErr) { errors.push(`${f.file_name}: download ${dlErr.message}`); continue }
        const buf = await blob.arrayBuffer()

        // 3. Parse
        const { projectName, lines } = parseCsa(buf)
        if (!lines.length) { errors.push(`${f.file_name}: no lines parsed`); continue }

        // 4. Upsert each line. Preserve any existing material/labour split.
        const rows = lines.map(ln => ({
          project_id: f.project_id,
          project_name: projectName || null,
          source_file_id: f.id,
          source_file: f.file_name,
          csa_date: f.created_at ? new Date(f.created_at).toISOString().slice(0, 10) : null,
          ref: ln.ref,
          section: ln.section,
          description: ln.description,
          description_norm: ln.description_norm,
          qty: ln.qty,
          unit: ln.unit,
          unit_norm: ln.unit_norm,
          rate: ln.rate,
          total: ln.total,
          harvested_at: new Date().toISOString(),
        }))
        const { error: upErr } = await supabase
          .from('rate_library')
          .upsert(rows, { onConflict: 'source_file_id,ref', ignoreDuplicates: false })
        if (upErr) { errors.push(`${f.file_name}: upsert ${upErr.message}`); continue }
        rowsUpserted += rows.length
      } catch (e) {
        errors.push(`${f.file_name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    // 4b. Harvest priced quotes as whole-trade "item" rates. Quotes are lump
    //     sums per task (no unit/qty), so they live as unit='item' rates,
    //     matched only against item-unit lines when pricing. We include all
    //     priced quotes (accepted, pending — any with an amount > 0); rejected
    //     are skipped as they're not representative.
    let quotesSeen = 0
    try {
      const { data: quotes, error: qErr } = await supabase
        .from('task_quotes_full')
        .select('id, project_id, task_title, amount, vendor_name, vendor_name_text, status, received_date')
      if (qErr) throw qErr

      const qRows = []
      for (const q of (quotes || [])) {
        const amount = Number(q.amount)
        if (!(amount > 0)) continue
        if (String(q.status || '').toLowerCase() === 'rejected') continue
        const trade = String(q.task_title || '').trim()
        if (!trade) continue
        quotesSeen++
        const vendor = q.vendor_name || q.vendor_name_text || 'Unknown vendor'
        qRows.push({
          project_id: q.project_id || null,
          project_name: null,
          source_file_id: q.id,                 // quote uuid → unique key slot
          source_file: `Quote: ${vendor}`,
          csa_date: q.received_date ? new Date(q.received_date).toISOString().slice(0, 10) : null,
          ref: 'QUOTE',                          // fixed ref so (id, ref) is unique per quote
          section: 'QUOTES',
          description: trade,
          description_norm: normDesc(trade),
          qty: 1,
          unit: 'item',
          unit_norm: 'item',
          rate: amount,
          total: amount,
          harvested_at: new Date().toISOString(),
        })
      }
      if (qRows.length) {
        const { error: upErr } = await supabase
          .from('rate_library')
          .upsert(qRows, { onConflict: 'source_file_id,ref', ignoreDuplicates: false })
        if (upErr) errors.push(`quotes: upsert ${upErr.message}`)
        else rowsUpserted += qRows.length
      }
    } catch (e) {
      errors.push(`quotes: ${e instanceof Error ? e.message : String(e)}`)
    }

    // 5. Log the run
    await supabase.from('rate_library_harvest_log').insert({
      files_seen: filesSeen,
      rows_upserted: rowsUpserted,
      errors: errors.length ? errors.join(' | ').slice(0, 4000) : null,
    })

    return new Response(JSON.stringify({ ok: true, filesSeen, quotesSeen, rowsUpserted, errors }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase.from('rate_library_harvest_log').insert({ files_seen: filesSeen, rows_upserted: rowsUpserted, errors: msg })
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
