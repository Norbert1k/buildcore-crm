// ─────────────────────────────────────────────────────────────────────────────
// csaExtractor.js
// Reads a Contract Sum Analysis (CSA) xlsx file and extracts the line-item
// data needed to drive the CFF (Cashflow Forecast) generator.
//
// Returns:
//   {
//     project_name,           // string from row 6 col B
//     csa_no,                 // string from row 6 col E ("CSA No: 01")
//     contract_sum,           // number — grand total from CONTRACT SUM row
//     items: [                // flat list of line items
//       { ref, description, value, section, group }
//     ],
//     groups: [               // pre-aggregated rows ready for CFF
//       { id, label, value, section, group, item_count, source_refs[] }
//     ]
//   }
//
// Aggregation rule (matches the structure of the Arcady CFF template):
//   • PRELIMINARIES   — keep individual items (each item = one CFF row)
//   • MAIN WORKS      — group by Plot N (each plot = one CFF row, sub-items summed)
//   • EXTERNAL WORKS  — collapse to a single CFF row (all items summed)
//   • PROVISIONAL SUMS— collapse to a single CFF row, labelled "(N items — see CSA)"
//   • VARIATIONS      — excluded (CFF body is original contract only)
//
// CSA is structurally identical to a PA xlsx (same column layout) — main
// peculiarity: section headers can appear in column A *or* column B (the
// Arcady CSA puts "EXTERNAL WORKS" in col B with a numeric ref in col A).
// ─────────────────────────────────────────────────────────────────────────────

async function loadSheetJs() {
  if (window.XLSX) return window.XLSX
  const script = document.createElement('script')
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
  document.head.appendChild(script)
  await new Promise((r, j) => { script.onload = r; script.onerror = j })
  return window.XLSX
}

// Section names we recognise (checked against col A and col B, uppercased)
const KNOWN_SECTIONS = new Set([
  'PRELIMINARIES',
  'MAIN WORKS',
  'EXTERNAL WORKS',
  'PROVISIONAL SUMS',
  'VARIATIONS',
])

// Footer row labels — never treated as sections
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
    const joined = (rows[r] || []).map(v => String(v || '').toLowerCase()).join(' ')
    if (joined.includes('ref') && joined.includes('description') && joined.includes('total')) {
      return r
    }
  }
  return -1
}

function findProjectMeta(rows) {
  // Project name and CSA number live in the header block (rows 1-10)
  // Templates vary: label may be next-cell, next-row, or same-cell-with-colon.
  let projectName = ''
  let csaNo = ''

  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const row = rows[r] || []
    for (let c = 0; c < Math.min(10, row.length); c++) {
      const v = row[c]
      if (typeof v !== 'string') continue
      const trimmed = v.trim()
      const upper = trimmed.toUpperCase()

      // "CSA No: 01" embedded in any cell
      const csaMatch = trimmed.match(/CSA\s*No[:\s]+(\S+)/i)
      if (csaMatch && !csaNo) csaNo = csaMatch[1]

      // Bare "PROJECT" label — value is in next cell OR next row, same column
      if (upper === 'PROJECT' && !projectName) {
        const nextCell = row[c + 1]
        if (typeof nextCell === 'string' && nextCell.trim()) {
          projectName = nextCell.trim()
        } else {
          // Try next non-empty row, same column
          for (let r2 = r + 1; r2 < Math.min(r + 3, rows.length); r2++) {
            const nextRow = rows[r2] || []
            const candidate = nextRow[c]
            if (typeof candidate === 'string' && candidate.trim() &&
                candidate.trim().toUpperCase() !== 'PROJECT') {
              projectName = candidate.trim()
              break
            }
          }
        }
      }
    }
  }
  return { project_name: projectName, csa_no: csaNo }
}

function parseRows(rows, headerRowIdx) {
  const items = []
  let currentSection = null
  let currentGroup = null
  let contractSum = null
  let variationsSum = 0    // tracked separately so callers can explain
                            // any gap between contract sum and CFF body total

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] || []
    const a = row[0]
    const b = row[1]
    const f = row[5]

    // ── CONTRACT SUM row — capture grand total then continue
    if (typeof a === 'string' && a.trim().toUpperCase() === 'CONTRACT SUM') {
      if (typeof f === 'number') contractSum = f
      continue
    }

    // ── Footer rows — skip
    const aUpper = (typeof a === 'string') ? a.trim().toUpperCase() : ''
    if (FOOTER_LABELS.has(aUpper)) continue

    // Some CSAs have descriptive labels that START with a footer-ish word
    // (e.g. "Less Retention 3% (on This Application)"). Catch those too.
    if (typeof a === 'string' && /^(less\s+retention|total\s+due|grand\s+total|sub\s*total)\b/i.test(a.trim())) continue

    const fIsNumber = typeof f === 'number' && f > 0
    const fEmpty = f == null || f === '' || f === 0

    // ── Section header detection. A row qualifies as a section header when:
    //    • col A or col B holds a known section name (e.g. "MAIN WORKS"), AND
    //    • col F is empty (sections never carry a value)
    // The `f empty` check is critical because some CSAs have a line item
    // literally named "Preliminaries" inside the PRELIMINARIES section
    // (Hopton). Without the F check we'd misclassify the data row as a
    // section header and lose the £value.
    const bUpper = (typeof b === 'string') ? b.trim().toUpperCase() : ''
    let detectedSection = null
    if (KNOWN_SECTIONS.has(aUpper) && fEmpty) detectedSection = aUpper
    else if (KNOWN_SECTIONS.has(bUpper) && fEmpty) detectedSection = bUpper

    if (detectedSection) {
      currentSection = detectedSection
      currentGroup = null
      continue
    }

    // ── Skip variations entirely (CFF excludes them) but tally so the
    //    UI can show a "excluded variations" hint instead of a mismatch error.
    //    Only count item rows (col A or col B has content) — skip the
    //    section subtotal row (both empty).
    if (currentSection === 'VARIATIONS') {
      const looksLikeItem = (typeof a === 'string' && a.trim()) || (typeof b === 'string' && b.trim())
      if (typeof f === 'number' && f > 0 && looksLikeItem) variationsSum += f
      continue
    }

    // ── Subtotal row (A and B both empty, F is positive number)
    const aEmpty = !a
    const bEmpty = !b
    if (aEmpty && bEmpty && fIsNumber) continue

    // ── Group header detection — generic. A row is a group header when:
    //    • col F is empty (no value)
    //    • we're inside a section
    //    • EITHER col A is a non-empty string + col B empty,    (Hopton style)
    //      OR col A is a numeric ref + col B is a non-empty string  (Arcady style)
    //
    // Real CSAs use both patterns:
    //    "PLOT 1" with col A=1 numeric ref + col B="PLOT 1"     (Arcady)
    //    "Plot 1, 2, 13, ... 4 Bed" with col A=label + col B empty (Hopton)
    //    "Garrod's Groundworks" with col A=label + col B empty   (Hopton, non-plot)
    if (fEmpty && currentSection) {
      // Pattern 1: descriptive label in col A, col B empty
      if (typeof a === 'string' && a.trim() && bEmpty) {
        currentGroup = a.trim()
        continue
      }
      // Pattern 2: numeric ref in col A, label in col B (Arcady's "1 / PLOT 1")
      if (typeof a === 'number' && typeof b === 'string' && b.trim()) {
        currentGroup = b.trim()
        continue
      }
      // Pattern 3: col A empty, label in col B (legacy fallback)
      if (aEmpty && typeof b === 'string' && b.trim()) {
        currentGroup = b.trim()
        continue
      }
    }

    // ── Data row: positive F is the line item total
    if (fIsNumber && currentSection) {
      items.push({
        ref: typeof a === 'string' ? a.trim() : (a != null ? String(a) : ''),
        description: typeof b === 'string' ? b.trim() : '',
        value: f,
        section: currentSection,
        group: currentGroup,
      })
    }
  }

  return { items, contractSum, variationsSum }
}

// ─── Aggregation: collapse items into CFF-ready group rows ─────────────────
// PRELIMS → keep individual items
// MAIN WORKS → one row per plot (sub-items summed)
// EXTERNAL WORKS / PROVISIONAL SUMS → one collapsed row per section
// Build a stable key that uniquely identifies a CFF row across CSA + PA
// extractions. Same key strategy is used by paGroupExtractor.js so per-row
// PA-aware regenerate can join the two by group_key.
//   • PRELIMINARIES — keyed by description (each prelim item = own group)
//   • MAIN WORKS    — keyed by plot/group label
//   • EXTERNAL WORKS / PROVISIONAL SUMS — single collapsed row, fixed key
export function groupKeyFor(section, identifier) {
  if (section === 'PRELIMINARIES') return `PRELIMINARIES::${identifier || ''}`
  if (section === 'EXTERNAL WORKS') return 'EXTERNAL WORKS::__all__'
  if (section === 'PROVISIONAL SUMS') return 'PROVISIONAL SUMS::__all__'
  return `${section}::${identifier || '(no group)'}`
}

function aggregateIntoGroups(items) {
  const groups = []
  let nextId = 1

  // PRELIMINARIES — keep each item
  const prelims = items.filter(it => it.section === 'PRELIMINARIES')
  for (const it of prelims) {
    const description = it.description || it.ref || 'Preliminary item'
    groups.push({
      id: `g${nextId++}`,
      group_key: groupKeyFor('PRELIMINARIES', description),
      label: description,
      value: it.value,
      section: 'PRELIMINARIES',
      group: null,
      item_count: 1,
      source_refs: [it.ref].filter(Boolean),
    })
  }

  // MAIN WORKS — group by plot
  const mainItems = items.filter(it => it.section === 'MAIN WORKS')
  const plotMap = new Map()
  for (const it of mainItems) {
    const key = it.group || '(unspecified)'
    if (!plotMap.has(key)) plotMap.set(key, { items: [], total: 0 })
    const entry = plotMap.get(key)
    entry.items.push(it)
    entry.total += it.value
  }
  for (const [plotName, data] of plotMap) {
    groups.push({
      id: `g${nextId++}`,
      group_key: groupKeyFor('MAIN WORKS', plotName),
      label: plotName,
      value: data.total,
      section: 'MAIN WORKS',
      group: plotName,
      item_count: data.items.length,
      source_refs: data.items.map(it => it.ref).filter(Boolean),
    })
  }

  // EXTERNAL WORKS — collapse to one row
  const externals = items.filter(it => it.section === 'EXTERNAL WORKS')
  if (externals.length > 0) {
    const total = externals.reduce((s, it) => s + it.value, 0)
    const refs = externals.map(it => it.ref).filter(Boolean)
    groups.push({
      id: `g${nextId++}`,
      group_key: groupKeyFor('EXTERNAL WORKS', null),
      label: 'External Works',
      value: total,
      section: 'EXTERNAL WORKS',
      group: null,
      item_count: externals.length,
      source_refs: refs,
    })
  }

  // PROVISIONAL SUMS — collapse to one row, with item count in label
  const provisional = items.filter(it => it.section === 'PROVISIONAL SUMS')
  if (provisional.length > 0) {
    const total = provisional.reduce((s, it) => s + it.value, 0)
    const refs = provisional.map(it => it.ref).filter(Boolean)
    const label = provisional.length === 1
      ? (provisional[0].description || 'Provisional Sum')
      : `Provisional Sums (${provisional.length} items — see CSA)`
    groups.push({
      id: `g${nextId++}`,
      group_key: groupKeyFor('PROVISIONAL SUMS', null),
      label,
      value: total,
      section: 'PROVISIONAL SUMS',
      group: null,
      item_count: provisional.length,
      source_refs: refs,
    })
  }

  return groups
}

// ─── Public API ───────────────────────────────────────────────────────────
export async function extractCsa(file) {
  const XLSX = await loadSheetJs()
  const arrayBuffer = await file.arrayBuffer()
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  if (!wb.SheetNames.length) throw new Error('CSA file contains no sheets')
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })

  const headerRowIdx = findHeaderRow(rows)
  if (headerRowIdx < 0) throw new Error('Could not locate header row in CSA')

  const meta = findProjectMeta(rows)
  const parseResult = parseRows(rows, headerRowIdx)
  const { items, contractSum } = parseResult
  if (items.length === 0) throw new Error('No line items found in CSA')

  // Determine contract sum: prefer explicit CONTRACT SUM row; fall back to sum of items
  const itemTotal = items.reduce((s, it) => s + it.value, 0)
  const finalContractSum = contractSum != null ? contractSum : itemTotal

  const groups = aggregateIntoGroups(items)
  const { variationsSum } = parseResult

  return {
    project_name: meta.project_name,
    csa_no: meta.csa_no,
    contract_sum: finalContractSum,    // CONTRACT SUM row value (incl. variations)
    body_total: itemTotal,              // Sum of CFF body items only (excl. variations)
    variations_sum: variationsSum,     // Sum of VOs in the VARIATIONS section
    items,
    groups,
  }
}
