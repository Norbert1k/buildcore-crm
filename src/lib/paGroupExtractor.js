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
  }
}

// Fetch all root-level PAs for a project, parse each, return ordered list.
// Each entry includes the index (PA01, PA02, ...) inferred from chronological
// order of created_at. Multi-building projects: only root-level PAs are
// covered for now (matches the v1 "no multi-building" decision).
export async function fetchAllProjectPas(supabase, projectId) {
  const { data: rows, error } = await supabase
    .from('project_doc_files')
    .select('id, file_name, storage_path, created_at')
    .eq('project_id', projectId)
    .eq('folder_key', '02-payment-application')
    .is('subfolder_key', null)
    .order('created_at', { ascending: true })

  if (error) throw error
  if (!rows || rows.length === 0) return []
  const xlsxRows = rows.filter(r => /\.xlsx$/i.test(r.file_name))
  if (xlsxRows.length === 0) return []

  // Parse each PA in parallel
  const parsed = await Promise.all(xlsxRows.map(async (row, idx) => {
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
      return {
        index: idx + 1,    // 1-based: PA01, PA02, ...
        pa_label: `PA${String(idx + 1).padStart(2, '0')}`,
        file_name: row.file_name,
        created_at: row.created_at,
        contract_sum: extract.contract_sum,
        total_cumulative: extract.contract_cumulative,
        groups: extract.groups,
      }
    } catch (err) {
      console.warn('PA parse failed:', row.file_name, err)
      return null
    }
  }))
  return parsed.filter(p => p !== null)
}
