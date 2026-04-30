// ─────────────────────────────────────────────────────────────────────────────
// paExtractor.js
// Reads a Payment Application xlsx file and extracts the data needed to
// pre-populate a Progress Report:
//   • groups       — list of { name, avg_pct, item_count }
//                    (one per Plot/section in the PA, with avg of Progress %)
//   • variations   — list of { instruction_no, instruction_details, cost_impact }
//                    (one per VO row in the VARIATIONS section)
//   • totals       — { total, cumulative, prev_certified } (project-wide sums)
//
// Used by ProgressReportEditor when the user clicks "New Progress Report" so
// the editor opens with sensible defaults that mirror the latest PA.
//
// Assumes the standardised PA column layout (Stage 2 output):
//   A=Ref  B=Description  C=Qty  D=Unit  E=Rate  F=Total  G=Progress%
//   H=Cumulative  I=Previously Certified  J=This App  K=Comments
//
// Robust to:
//   • Section headers (UPPERCASE col A) like PRELIMINARIES, SUBSTRUCTURE,
//     SUPERSTRUCTURE, VARIATIONS — these become groups directly
//   • Plot/group headers (mixed-case col A with no totals) like
//     "Plot 1, 2, 13, 14, 15, 23 - Detached 4 Bed" — these become groups
//   • Rows we should ignore (blank rows, summary totals, retention)
//
// SheetJS (window.XLSX) is loaded on-demand from CDN — same pattern as the
// existing Excel preview component in ProjectDocumentation.jsx.
// ─────────────────────────────────────────────────────────────────────────────

async function loadSheetJs() {
  if (window.XLSX) return window.XLSX
  const script = document.createElement('script')
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
  document.head.appendChild(script)
  await new Promise((r, j) => { script.onload = r; script.onerror = j })
  return window.XLSX
}

// Headers we treat as project-wide totals / footers — never groups.
const TOTAL_ROW_LABELS = new Set([
  'CONTRACT TOTAL',
  'TOTAL DUE',
  'GRAND TOTAL',
  'LESS RETENTION',
  'RETENTION',
  'SUB TOTAL',
])

// Returns null if extraction fails (e.g. malformed file). Caller falls back
// to default empty report.
export async function extractFromPa(arrayBuffer) {
  try {
    const XLSX = await loadSheetJs()
    const wb = XLSX.read(arrayBuffer, { type: 'array' })

    // Choose the main sheet — prefer one ending with " - PA"; otherwise first
    let sheetName = wb.SheetNames[0]
    for (const s of wb.SheetNames) {
      if (s.endsWith(' - PA') || s.endsWith('- PA')) { sheetName = s; break }
    }
    const ws = wb.Sheets[sheetName]
    if (!ws) return null

    // Convert sheet to 2D array (header:1 mode = no auto-named keys)
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
    if (!rows.length) return null

    // Find header row by scanning for "Ref" + "Description" tokens
    let headerRowIdx = -1
    for (let r = 0; r < Math.min(15, rows.length); r++) {
      const joined = (rows[r] || []).map(v => String(v || '').toLowerCase()).join(' ')
      if (joined.includes('ref') && joined.includes('description')) {
        headerRowIdx = r; break
      }
    }
    if (headerRowIdx === -1) return null

    // Now walk rows looking for sections, groups, data rows, variations.
    const groups = []   // [{ name, items: [{ progress_pct }] }]
    const variations = []
    let totalSum = 0, cumulativeSum = 0, prevCertSum = 0

    let currentSection = null   // 'PRELIMINARIES', 'MAIN WORKS', 'VARIATIONS', etc.
    let currentGroup = null     // pointer into groups array

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] || []
      const a = row[0]   // Ref
      const b = row[1]   // Description
      const f = row[5]   // Total (£)
      const g = row[6]   // Progress %
      const h = row[7]   // Cumulative (£)
      const i = row[8]   // Previously Certified (£)

      // ── Section header: col A is UPPERCASE multi-character string ──
      const aStr = (typeof a === 'string') ? a.trim() : ''
      const isSection = aStr && aStr.length > 4 && aStr === aStr.toUpperCase() &&
        /[A-Z]/.test(aStr) && !/^V\d+$/i.test(aStr) && !/^VO\d+$/i.test(aStr)

      if (isSection) {
        currentSection = aStr.toUpperCase()
        if (TOTAL_ROW_LABELS.has(currentSection)) {
          currentGroup = null
          continue
        }
        // Don't create the group yet — wait for first data row to confirm
        // there's actual content. Set group pointer to null so the data-row
        // logic creates the group on demand.
        currentGroup = null
        continue
      }

      // ── Variation row (col A like 'VO1', 'VO2') under VARIATIONS ──
      if (currentSection === 'VARIATIONS' && /^VO\d+$/i.test(aStr)) {
        variations.push({
          instruction_no: aStr.toUpperCase(),
          instruction_details: typeof b === 'string' ? b.trim() : '',
          cost_impact: (typeof f === 'number') ? String(f) : '',
        })
        continue
      }

      // ── Group/plot header: col A has text (not a Ref like 1.1), col F empty ──
      if (aStr && !/^\d/.test(aStr) && (f == null || f === 0 || f === '')) {
        // It's a plot header (e.g. "Plot 1, 2, 13, 14, 15, 23 - Detached 4 Bed")
        // — but only if we already passed PRELIMINARIES (otherwise it's a stray)
        currentGroup = { name: aStr, items: [] }
        groups.push(currentGroup)
        continue
      }

      // ── Data row: numeric Progress% in col G ──
      if (typeof g === 'number') {
        if (!currentGroup) {
          // No group set yet — fall back to using the section as group name
          const fallbackName = currentSection
            ? toTitleCase(currentSection)
            : 'Main Works'
          currentGroup = { name: fallbackName, items: [] }
          groups.push(currentGroup)
        }
        currentGroup.items.push({ progress_pct: g * 100 })
        if (typeof f === 'number') totalSum += f
        if (typeof h === 'number') cumulativeSum += h
        if (typeof i === 'number') prevCertSum += i
      }
    }

    // Reduce groups to summary form. Drop groups with no data rows.
    const resultGroups = groups
      .filter(grp => grp.items.length > 0)
      .map(grp => ({
        name: grp.name,
        avg_pct: Math.round(grp.items.reduce((s, x) => s + x.progress_pct, 0) / grp.items.length),
        item_count: grp.items.length,
      }))

    return {
      groups: resultGroups,
      variations,
      totals: {
        total: totalSum,
        cumulative: cumulativeSum,
        prev_certified: prevCertSum,
      },
    }
  } catch (err) {
    console.warn('[paExtractor] failed:', err)
    return null
  }
}

// Convert "SUBSTRUCTURE" → "Substructure", "FITTINGS, FURNISHINGS & EQUIPMENT" → "Fittings, Furnishings & Equipment"
function toTitleCase(s) {
  return s.toLowerCase().replace(/(^|[\s,&\-/])(\w)/g, (_, sep, c) => sep + c.toUpperCase())
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchLatestPaForSubfolder(supabase, projectId, paSubfolderKey) → ArrayBuffer | null
//
// Looks up the most recent Payment Application file in the given location:
//   • paSubfolderKey === null      → the root of 02-payment-application
//   • paSubfolderKey === <string>  → a specific PA subfolder (e.g. Sports Hall)
//
// For multi-building projects (Merton-style), each sub-building has its own
// PA subfolder containing PA01, PA02, etc. — and the corresponding Progress
// Report should auto-extract from the LATEST PA in THAT subfolder, not from
// other sub-buildings' PAs.
//
// Returns the raw bytes for extractFromPa to parse, or null if no PA exists
// in that location. Caller falls back to default empty groups.
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchLatestPaForSubfolder(supabase, projectId, paSubfolderKey) {
  try {
    let q = supabase
      .from('project_doc_files')
      .select('storage_path, file_name, created_at')
      .eq('project_id', projectId)
      .eq('folder_key', '02-payment-application')
      .order('created_at', { ascending: false })
      .limit(1)
    // NULL vs string handling: PostgREST treats .eq(null) and .is(null)
    // differently. Use .is() for null, .eq() for an actual key.
    if (paSubfolderKey == null) q = q.is('subfolder_key', null)
    else q = q.eq('subfolder_key', paSubfolderKey)

    const { data: rows, error } = await q
    if (error) throw error
    if (!rows || rows.length === 0) return null

    const { data: signed, error: sErr } = await supabase.storage
      .from('project-docs')
      .createSignedUrl(rows[0].storage_path, 600)
    if (sErr || !signed?.signedUrl) return null

    const res = await fetch(signed.signedUrl)
    if (!res.ok) return null
    return await res.arrayBuffer()
  } catch (err) {
    console.warn('[paExtractor] fetchLatestPaForSubfolder failed:', err)
    return null
  }
}

// Backwards-compat alias — earlier code passed no subfolder so behaviour
// was "root only". Existing callers continue to work via this delegating
// wrapper which always queries the root.
export async function fetchLatestPaForProject(supabase, projectId) {
  return fetchLatestPaForSubfolder(supabase, projectId, null)
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchAllProjectPas(supabase, projectId)
//   → [{ subfolder_key, subfolder_label, extract }, ...]
//
// Used by the project header's financial summary, which needs to show the
// CURRENT contract value across all sub-buildings. Finds the latest PA in
// every PA location (root + each custom subfolder) and parses each one.
//
// For a single-building project this returns one entry. For multi-building
// projects (Merton-style with sub-folders for each building) it returns
// one entry per sub-building. Caller sums totals across the array.
//
// Returns [] if no PAs exist.
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchAllProjectPas(supabase, projectId) {
  try {
    // Pull every PA file's metadata in a single query, then group by
    // subfolder_key to find the latest per location. More efficient than
    // multiple round-trips.
    const { data: rows, error } = await supabase
      .from('project_doc_files')
      .select('storage_path, file_name, subfolder_key, created_at')
      .eq('project_id', projectId)
      .eq('folder_key', '02-payment-application')
      .order('created_at', { ascending: false })
    if (error) throw error
    if (!rows || rows.length === 0) return []

    // Group by subfolder_key (null = root). Within each group keep the
    // first row, since rows are already ordered DESC by created_at.
    const latestPerLocation = new Map()  // key: subfolder_key (string or '__root__')
    for (const row of rows) {
      const k = row.subfolder_key == null ? '__root__' : row.subfolder_key
      if (!latestPerLocation.has(k)) latestPerLocation.set(k, row)
    }

    // Look up subfolder labels in a separate query so each PA entry can show
    // a friendly building name (e.g. "Sports Hall") rather than the raw key.
    const subfolderKeys = [...latestPerLocation.keys()].filter(k => k !== '__root__')
    let labelMap = {}
    if (subfolderKeys.length > 0) {
      const { data: folders } = await supabase
        .from('project_doc_folders')
        .select('folder_key, label')
        .eq('project_id', projectId)
        .in('folder_key', subfolderKeys)
      labelMap = Object.fromEntries((folders || []).map(f => [f.folder_key, f.label]))
    }

    // Download + parse each PA in parallel. fetchLatestPaForSubfolder already
    // handles signed URLs and the actual byte download.
    const results = []
    await Promise.all(
      [...latestPerLocation.entries()].map(async ([k, row]) => {
        const subfolderKey = k === '__root__' ? null : k
        const buf = await fetchLatestPaForSubfolder(supabase, projectId, subfolderKey)
        if (!buf) return
        const extract = await extractFromPa(buf)
        if (!extract) return
        results.push({
          subfolder_key: subfolderKey,
          subfolder_label: subfolderKey ? (labelMap[subfolderKey] || subfolderKey) : null,
          file_name: row.file_name,
          extract,
        })
      })
    )
    return results
  } catch (err) {
    console.warn('[paExtractor] fetchAllProjectPas failed:', err)
    return []
  }
}

// Aggregate the result of fetchAllProjectPas into project-wide financial
// totals. Computes original (sum of data row totals across all sub-buildings),
// variations (sum of all VO cost_impact values, treating null/empty as 0),
// and the count of VO rows.
//
// Pure function — no async work, just summation.
export function aggregateFinancials(paList) {
  let original = 0
  let variations = 0
  let variations_count = 0
  for (const pa of (paList || [])) {
    const ex = pa?.extract
    if (!ex) continue
    if (ex.totals?.total) original += ex.totals.total
    for (const v of (ex.variations || [])) {
      variations_count++
      // cost_impact is stored as a string in the editor schema, but the
      // extractor outputs it as the raw number string. Coerce safely.
      const n = parseFloat(v.cost_impact)
      if (!Number.isNaN(n)) variations += n
    }
  }
  return {
    original,
    variations_total: variations,
    variations_count,
    total_value: original + variations,
  }
}
