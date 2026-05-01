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

    // ── Section header — check col A first, then col B
    const bUpper = (typeof b === 'string') ? b.trim().toUpperCase() : ''
    let detectedSection = null
    if (KNOWN_SECTIONS.has(aUpper)) detectedSection = aUpper
    else if (KNOWN_SECTIONS.has(bUpper)) detectedSection = bUpper

    if (detectedSection) {
      currentSection = detectedSection
      currentGroup = null
      continue
    }

    // ── Skip variations entirely (CFF excludes them)
    if (currentSection === 'VARIATIONS') continue

    // ── Subtotal row (A and B both empty, F is positive number)
    const aEmpty = !a
    const bEmpty = !b
    if (aEmpty && bEmpty && typeof f === 'number' && f > 0) continue

    // ── Plot/group header: B matches "PLOT N" pattern, F empty
    if (typeof b === 'string' && /^PLOT\s+\d+$/i.test(b.trim()) &&
        (f == null || f === 0 || f === '')) {
      currentGroup = b.trim()
      continue
    }

    // ── Data row: positive F is the line item total
    if (typeof f === 'number' && f > 0 && currentSection) {
      items.push({
        ref: typeof a === 'string' ? a.trim() : (a != null ? String(a) : ''),
        description: typeof b === 'string' ? b.trim() : '',
        value: f,
        section: currentSection,
        group: currentGroup,
      })
    }
  }

  return { items, contractSum }
}

// ─── Aggregation: collapse items into CFF-ready group rows ─────────────────
// PRELIMS → keep individual items
// MAIN WORKS → one row per plot (sub-items summed)
// EXTERNAL WORKS / PROVISIONAL SUMS → one collapsed row per section
function aggregateIntoGroups(items) {
  const groups = []
  let nextId = 1

  // PRELIMINARIES — keep each item
  const prelims = items.filter(it => it.section === 'PRELIMINARIES')
  for (const it of prelims) {
    groups.push({
      id: `g${nextId++}`,
      label: it.description || it.ref || 'Preliminary item',
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
      label: plotName, // e.g. "PLOT 1"
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
  const { items, contractSum } = parseRows(rows, headerRowIdx)
  if (items.length === 0) throw new Error('No line items found in CSA')

  // Determine contract sum: prefer explicit CONTRACT SUM row; fall back to sum of items
  const itemTotal = items.reduce((s, it) => s + it.value, 0)
  const finalContractSum = contractSum != null ? contractSum : itemTotal

  const groups = aggregateIntoGroups(items)

  return {
    project_name: meta.project_name,
    csa_no: meta.csa_no,
    contract_sum: finalContractSum,
    items,
    groups,
  }
}
