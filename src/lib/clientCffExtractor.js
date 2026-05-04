// ─────────────────────────────────────────────────────────────────────────────
// clientCffExtractor.js
//
// Parser for Merton-style client CFF spreadsheets. The client provides a
// cashflow forecast in their own template (different from our CSA layout) —
// per-line-item monthly distribution percentages over a wide month grid.
//
// We extract: contract sum, number of active months, and a list of line
// items. Each line carries its section, description, total value, and a
// per-month percentage distribution. The convertor (clientCffAdapter.js)
// then normalises these into our CFF generator's input shape.
//
// File structure (what this parser expects):
//
//   Row 4 (HEADER_ROW):
//     col A: section code      ("4.1.1")
//     col B: section name      ("Facilitating Works")
//     col F: empty (section headers have no total)
//     col P–AY: month numbers  (1, 2, 3, ..., up to 36)
//
//   Construction line items follow each section header:
//     col A: ".1", ".2", ".3" …
//     col B: description
//     col F: total cost (£)
//     col J: start month
//     col K: finish month
//     col L: length (months)
//     col O: 1 (= sum of monthly pcts, sanity check column)
//     col P–AY: per-month distribution pct (0.0–1.0)
//
//   Sub-Total rows after each section: col B = "Sub-Total", col F = section total
//
//   Soft-cost lines (after construction):
//     col A: "4.2", "4.3", … (numeric Excel cell, parses as float)
//     col B: name ("Professional Fees", "Development Management" …)
//     col F: value or "NA" or 0
//
//   Final total row: col B = "Total (Excludes …)", col F = grand total
//
// Notable wrinkles handled:
//   • col A for soft-cost lines comes back as a float like 4.2 (not "4.2")
//     because the Excel cell is numeric — we normalise to string
//   • Monthly pcts often sum to 0.99 instead of 1.0 (rounding) — we DO NOT
//     fix that here; the adapter normalises so each line's monthly amounts
//     sum exactly to its stated value
//   • Zero-value lines (Development Management = NA, Employer's Agent = 0
//     etc.) are skipped — they would just clutter the output CFF
//   • Trailing month columns past the project's actual finish month are
//     truncated via the returned num_months
// ─────────────────────────────────────────────────────────────────────────────

const HEADER_ROW = 4
const MONTH_COL_START = 16  // col P (1-indexed)
const MONTH_COL_END = 51    // col AY (1-indexed) — file has 36 month columns

// SheetJS loader (matches existing pattern in csaExtractor / paExtractor)
async function loadSheetJs() {
  if (window.XLSX) return window.XLSX
  await new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
    script.onload = resolve
    script.onerror = reject
    document.head.appendChild(script)
  })
  return window.XLSX
}

// Read a cell from a SheetJS worksheet at 1-indexed (row, col).
function readCell(ws, row, col) {
  const XLSX = window.XLSX
  const addr = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 })
  const cell = ws[addr]
  return cell == null ? null : cell.v
}

// Normalise col-A to a string. Excel may return "4.1.1" (string) for typical
// section codes but numeric 4.2 (float) for "4.200"-style soft-cost rows.
function normaliseRefA(raw) {
  if (raw == null) return ''
  if (typeof raw === 'number') {
    // 4.2 → "4.2", 4.0 → "4". Avoid scientific notation for unusual values.
    return String(raw).replace(/0+$/, '').replace(/\.$/, '')
  }
  return String(raw).trim()
}

// Accepts either:
//   • a File / Blob (must have .arrayBuffer())  — upload-from-disk flow
//   • a raw ArrayBuffer                          — pick-existing flow
//     (caller has already downloaded from storage and produces the buffer)
export async function extractClientCff(input) {
  const XLSX = await loadSheetJs()
  const arrayBuffer = input instanceof ArrayBuffer
    ? input
    : await input.arrayBuffer()
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) {
    throw new Error('Spreadsheet has no sheets')
  }

  // Determine the row range to walk. SheetJS exposes a !ref bbox.
  const ref = ws['!ref'] || 'A1:A1'
  const range = XLSX.utils.decode_range(ref)
  const maxRow = range.e.r + 1  // inclusive, 1-indexed for our walk

  // Confirm month-header row has at least one numeric "1" — otherwise we're
  // looking at the wrong file or a different format.
  const firstMonthHeader = readCell(ws, HEADER_ROW, MONTH_COL_START)
  if (typeof firstMonthHeader !== 'number' || firstMonthHeader !== 1) {
    throw new Error(
      `Expected month "1" at row ${HEADER_ROW} col P (column ${MONTH_COL_START}). ` +
      `Found: ${firstMonthHeader}. Is this the correct client CFF format?`
    )
  }

  const lineItems = []
  let contractSum = 0
  let lastSectionLabel = null

  for (let r = 2; r <= maxRow; r++) {
    const aRaw = readCell(ws, r, 1)
    const a = normaliseRefA(aRaw)
    const b = readCell(ws, r, 2)
    const f = readCell(ws, r, 6)
    const j = readCell(ws, r, 10)
    const k = readCell(ws, r, 11)

    const bStr = b == null ? '' : String(b).trim()
    const bLower = bStr.toLowerCase()

    // Grand total — col B starts with "Total" + numeric col F. The file we've
    // seen uses "Total (Excludes VAT and Other Exclusions below)". Match
    // loosely so minor wording variations still work.
    if (bLower.startsWith('total') && typeof f === 'number') {
      // Multiple "Total" rows can appear (Total Estimated Construction Costs
      // earlier, then the grand total at the very bottom). Take whichever
      // includes the phrase "excludes vat" — that's the contract sum.
      if (bLower.includes('excludes vat')) {
        contractSum = f
      }
      continue
    }

    // Sub-Total rows — skip
    if (bLower === 'sub-total' || bLower === 'subtotal') {
      continue
    }

    // Section header: col A like "4.1.1" + col B has section name + col F empty
    if (a.startsWith('4.1.') && bStr && typeof f !== 'number') {
      lastSectionLabel = `${a} ${bStr}`
      continue
    }

    // Soft-cost line: col A is "4.X" where X is NOT "1.something". col B has
    // a name and col F is numeric and > 0. Zero-value or "NA" rows are
    // legitimate for the client to include but produce no useful output for
    // us, so skip.
    if (a.startsWith('4.') && !a.startsWith('4.1.') && bStr) {
      if (typeof f === 'number' && f > 0) {
        const monthly = readMonthlyDistribution(ws, r)
        lineItems.push({
          row: r,
          section: 'Professional Fees & Soft Costs',
          ref: a,
          description: bStr,
          value: f,
          monthly_pct: monthly,
          start_month: typeof j === 'number' ? Math.round(j) : null,
          finish_month: typeof k === 'number' ? Math.round(k) : null,
        })
      }
      continue
    }

    // Construction line: col A like ".1", ".2" + col F is numeric > 0
    if (a.startsWith('.') && typeof f === 'number' && f > 0) {
      const monthly = readMonthlyDistribution(ws, r)
      lineItems.push({
        row: r,
        section: lastSectionLabel || '(uncategorized)',
        ref: a,
        description: bStr,
        value: f,
        monthly_pct: monthly,
        start_month: typeof j === 'number' ? Math.round(j) : null,
        finish_month: typeof k === 'number' ? Math.round(k) : null,
      })
    }
  }

  // Determine project length from max finish month. If no item has a finish
  // month, fall back to the highest column with any non-zero distribution.
  let numMonths = 0
  for (const item of lineItems) {
    if (item.finish_month && item.finish_month > numMonths) {
      numMonths = item.finish_month
    }
  }
  if (numMonths === 0 && lineItems.length > 0) {
    // Fallback — find highest active month across all lines
    for (const item of lineItems) {
      for (let m = item.monthly_pct.length - 1; m >= 0; m--) {
        if (item.monthly_pct[m] > 0) {
          if (m + 1 > numMonths) numMonths = m + 1
          break
        }
      }
    }
  }

  // Sanity: line items should sum to the contract sum (within a few quid for
  // rounding). If not, the file is unusual — caller should warn but still
  // proceed. We expose the discrepancy via the returned shape.
  const lineSum = lineItems.reduce((s, it) => s + it.value, 0)
  const reconciles = Math.abs(lineSum - contractSum) < 5

  return {
    contract_sum: contractSum,
    num_months: numMonths,
    line_items: lineItems,
    line_sum: lineSum,
    reconciles,
  }
}

// Helper: read the per-month distribution row for a given line item. Returns
// a fixed-length array (MONTH_COL_END - MONTH_COL_START + 1 = 36 entries),
// each cell normalised to a number (defaulting to 0 for empty/non-numeric).
function readMonthlyDistribution(ws, row) {
  const out = []
  for (let c = MONTH_COL_START; c <= MONTH_COL_END; c++) {
    const v = readCell(ws, row, c)
    out.push(typeof v === 'number' ? v : 0)
  }
  return out
}
