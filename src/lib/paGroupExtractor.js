// ─────────────────────────────────────────────────────────────────────────────
// paGroupExtractor.js
//
// Variant of csaExtractor for Payment Application files. Same template, same
// column layout, but reads col H (Cumulative) instead of col F (Total).
//
// Returns:
//   {
//     contract_sum,                  // CONTRACT SUM row F (informational)
//     contract_cumulative,           // CONTRACT SUM row H (claimed-to-date)
//     groups: {                      // keyed by section + group-label
//       [key]: { section, group, cumulative, item_count }
//     }
//   }
//
// The group keys produced here MUST match the group keys produced by
// csaExtractor.aggregateIntoGroups(). That's how cffGenerator can join
// CSA contract values with PA cumulative values per row.
//
// "Best-effort" failure mode: if a PA's structure diverges from the CSA's,
// some groups will end up with 0 cumulative (no items mapped). That's
// acceptable — the modal will warn the user and the affected rows fall
// back to forecast for those months.
// ─────────────────────────────────────────────────────────────────────────────

import { groupKeyFor } from './csaExtractor'
import { sortPaRowsByPaNumber, paNumberFromFilename } from './paOrdering'

async function loadSheetJs() {
  if (window.XLSX) return window.XLSX
  const script = document.createElement('script')
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
  document.head.appendChild(script)
  await new Promise((r, j) => { script.onload = r; script.onerror = j })
  return window.XLSX
}

const KNOWN_SECTIONS = new Set([
  'PRELIMINARIES',
  'MAIN WORKS',
  'EXTERNAL WORKS',
  'PROVISIONAL SUMS',
  'VARIATIONS',
])
const FOOTER_LABELS = new Set([
  'CONTRACT TOTAL',
  'CONTRACT SUM',
  'TOTAL DUE',
  'TOTAL DUE THIS APPLICATION',
  'GRAND TOTAL',
  'LESS RETENTION',
  'RETENTION',
  'SUB TOTAL',
])

function findHeaderRow(rows) {
  for (let r = 0; r < Math.min(20, rows.length); r++) {
    const joined = (rows[r] || []).map(c => String(c || '').toLowerCase()).join(' ')
    if (joined.includes('ref') && joined.includes('description') && joined.includes('total')) {
      return r
    }
  }
  return -1
}

// Scan rows AFTER the header for a "LESS RETENTION" row and extract the
// rate and deducted amount. Returns { pct, amount } or { pct: null, amount: null }
// if we can't confidently read it (the UI then falls back to per-project
// admin override).
//
// Rate sources, in order of confidence:
//   1. A "%" token in the description (e.g. "Less Retention 3%", "Less Retention @ 5.00%")
//   2. A decimal between 0 and 0.2 anywhere on the row (likely the rate as a fraction)
//   3. Computed: |amount| / cumulative_total — only if we have a CONTRACT SUM cumulative
//
// Amount: the row's largest absolute-valued non-rate number, expected negative
// in a Less-Retention row. We store the absolute value.
function extractRetention(rows, headerRowIdx) {
  // First pass: locate CONTRACT SUM cumulative for fallback rate calc
  let contractCumForCalc = 0
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const a = (rows[r] || [])[0]
    if (typeof a === 'string' && a.trim().toUpperCase() === 'CONTRACT SUM') {
      const h = (rows[r] || [])[7]
      if (typeof h === 'number') contractCumForCalc = h
      break
    }
  }

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] || []
    const descCells = [row[0], row[1]].map(c => (typeof c === 'string' ? c.trim() : ''))
    const descJoined = descCells.join(' ').toLowerCase()
    if (!/(^|\s)less\s+retention\b/.test(descJoined) && !/^retention\b/.test(descJoined)) continue

    // Found a candidate row. Extract amount: largest absolute number in any cell.
    let amount = null
    for (const cell of row) {
      if (typeof cell !== 'number') continue
      const abs = Math.abs(cell)
      if (abs > 1 && (amount == null || abs > amount)) amount = abs
    }

    // Rate source 1: percentage in description text
    let pct = null
    for (const cell of row) {
      if (typeof cell !== 'string') continue
      const m = cell.match(/(\d+(?:\.\d+)?)\s*%/)
      if (m) {
        const v = parseFloat(m[1]) / 100
        if (v > 0 && v < 1) { pct = v; break }
      }
    }

    // Rate source 2: decimal between 0 and 0.2 in any numeric cell
    if (pct == null) {
      for (const cell of row) {
        if (typeof cell !== 'number') continue
        if (cell > 0 && cell < 0.2) { pct = cell; break }
      }
    }

    // Rate source 3: compute from amount vs contract cumulative
    if (pct == null && amount != null && contractCumForCalc > 0) {
      const ratio = amount / contractCumForCalc
      if (ratio > 0 && ratio < 0.2) pct = Math.round(ratio * 10000) / 10000
    }

    return { pct, amount }
  }
  return { pct: null, amount: null }
}

export async function extractPaGroups(file) {
  const XLSX = await loadSheetJs()
  const arrayBuffer = await file.arrayBuffer()
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  if (!wb.SheetNames.length) throw new Error('PA file contains no sheets')
  // Pick the standard CCG PA sheet (matches "- PA" suffix) or fall back to first.
  let ws = wb.Sheets[wb.SheetNames[0]]
  for (const name of wb.SheetNames) {
    if (/-\s*PA\s*$/i.test(name)) { ws = wb.Sheets[name]; break }
  }
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })

  const headerRowIdx = findHeaderRow(rows)
  if (headerRowIdx < 0) throw new Error('Could not locate header row in PA')

  // Retention scan — runs once per file, captures from the first LESS RETENTION
  // row encountered. Defensive: tries multiple places the rate can live.
  // Sets retention to null if we can't confidently extract it (UI then falls
  // back to the per-project admin override).
  const retention = extractRetention(rows, headerRowIdx)

  // Walk rows applying the same group-detection rules as csaExtractor
  let currentSection = null
  let currentGroup = null
  let contractSumF = null
  let contractCumulativeH = null
  const groupAcc = {}    // key → { section, group, cumulative, item_count, description }

  function bumpGroup(section, groupLabel, cumulative, itemDescription) {
    const key = groupKeyFor(
      section,
      // For PRELIMS each item becomes its own group keyed by description
      section === 'PRELIMINARIES' ? itemDescription : groupLabel,
    )
    if (!groupAcc[key]) {
      groupAcc[key] = {
        section,
        group: section === 'PRELIMINARIES' ? itemDescription : groupLabel,
        cumulative: 0,
        item_count: 0,
      }
    }
    groupAcc[key].cumulative += cumulative
    groupAcc[key].item_count += 1
  }

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] || []
    const a = row[0]
    const b = row[1]
    const f = row[5]
    const h = row[7]    // cumulative column

    // CONTRACT SUM row
    if (typeof a === 'string' && a.trim().toUpperCase() === 'CONTRACT SUM') {
      if (typeof f === 'number') contractSumF = f
      if (typeof h === 'number') contractCumulativeH = h
      continue
    }

    const aUpper = (typeof a === 'string') ? a.trim().toUpperCase() : ''
    if (FOOTER_LABELS.has(aUpper)) continue
    if (typeof a === 'string' && /^(less\s+retention|total\s+due|grand\s+total|sub\s*total)\b/i.test(a.trim())) continue

    const fIsNumber = typeof f === 'number' && f > 0
    const fEmpty = f == null || f === '' || f === 0

    const bUpper = (typeof b === 'string') ? b.trim().toUpperCase() : ''
    let detectedSection = null
    if (KNOWN_SECTIONS.has(aUpper) && fEmpty) detectedSection = aUpper
    else if (KNOWN_SECTIONS.has(bUpper) && fEmpty) detectedSection = bUpper

    if (detectedSection) {
      currentSection = detectedSection
      currentGroup = null
      continue
    }

    if (currentSection === 'VARIATIONS') continue

    const aEmpty = !a
    const bEmpty = !b

    // Subtotal row — skip
    if (aEmpty && bEmpty && fIsNumber) continue

    // Group header
    if (fEmpty && currentSection) {
      if (typeof a === 'string' && a.trim() && bEmpty) { currentGroup = a.trim(); continue }
      if (typeof a === 'number' && typeof b === 'string' && b.trim()) { currentGroup = b.trim(); continue }
      if (aEmpty && typeof b === 'string' && b.trim()) { currentGroup = b.trim(); continue }
    }

    // Data row — record cumulative (may be 0 if work not yet started)
    if (fIsNumber && currentSection) {
      const desc = typeof b === 'string' ? b.trim() : ''
      const cumulative = typeof h === 'number' ? h : 0
      bumpGroup(currentSection, currentGroup, cumulative, desc)
    }
  }

  return {
    contract_sum: contractSumF,
    contract_cumulative: contractCumulativeH || 0,
    groups: groupAcc,
    retention_pct: retention.pct,        // null if unreadable
    retention_amount: retention.amount,   // null if unreadable
  }
}

// Fetch PAs for a project, parse each, return ordered list. Each entry includes:
//   • index    — derived from parsed PA filename (PA01 → 1) when possible,
//     else falls back to the entry's array position (1-based)
//   • pa_label — display label like "PA01" / "PA02"
//
// Ordering: PAs sort by parsed PA number ASC, with unparseable filenames
// trailing by created_at. This is reupload-stable: a freshly-uploaded PA01
// no longer jumps to the end of the list.
//
// Scoping (paSubfolderKey arg):
//   • undefined or null → root-level PAs only (single-building projects like
//     Bishops where PAs sit directly under '02-payment-application')
//   • string key        → PAs in that specific subfolder (e.g. Merton's
//     '02-payment-application-custom-...tsd8' for Sports Hall)
//
// For projects with no PAs at the queried location, returns []. The CFF
// generator's PA-aware regenerate falls back to forecast-only mode in that
// case.
export async function fetchAllProjectPas(supabase, projectId, paSubfolderKey = null) {
  let q = supabase
    .from('project_doc_files')
    .select('id, file_name, storage_path, created_at')
    .eq('project_id', projectId)
    .eq('folder_key', '02-payment-application')
  // PostgREST handles null vs string differently. Use .is() for null,
  // .eq() for an actual string key.
  if (paSubfolderKey == null) {
    q = q.is('subfolder_key', null)
  } else {
    q = q.eq('subfolder_key', paSubfolderKey)
  }

  const { data: rows, error } = await q

  if (error) throw error
  if (!rows || rows.length === 0) return []
  const xlsxRows = rows.filter(r => /\.xlsx$/i.test(r.file_name))
  if (xlsxRows.length === 0) return []

  // Sort by parsed PA number ASC (PA01, PA02, ..., PA10). Unparseable
  // filenames trail by created_at.
  const sorted = sortPaRowsByPaNumber(xlsxRows, 'asc')

  // Parse each PA in parallel
  const parsed = await Promise.all(sorted.map(async (row, arrayIdx) => {
    try {
      const { data: signed } = await supabase
        .storage
        .from('project-docs')
        .createSignedUrl(row.storage_path, 600)
      if (!signed?.signedUrl) return null
      const res = await fetch(signed.signedUrl)
      if (!res.ok) return null
      const blob = await res.blob()
      const extract = await extractPaGroups(blob)
      // Index/label come from the parsed PA number when available, so
      // PA02 always shows as "PA02" regardless of upload order. Falls
      // back to array position for unparseable filenames.
      const paNum = paNumberFromFilename(row.file_name)
      const index = paNum ?? (arrayIdx + 1)
      return {
        index,
        pa_label: `PA${String(index).padStart(2, '0')}`,
        file_name: row.file_name,
        created_at: row.created_at,
        contract_sum: extract.contract_sum,
        total_cumulative: extract.contract_cumulative,
        groups: extract.groups,
        retention_pct: extract.retention_pct,
        retention_amount: extract.retention_amount,
      }
    } catch (err) {
      console.warn('PA parse failed:', row.file_name, err)
      return null
    }
  }))
  return parsed.filter(p => p !== null)
}
