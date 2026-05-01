// ─────────────────────────────────────────────────────────────────────────────
// cffGenerator.js
// Generate a Cashflow Forecast (CFF) xlsx from a parsed CSA + user settings.
//
// Produces a styled spreadsheet matching the Arcady Heights template aesthetic:
//   • Title & subtitle block (rows 1-2)
//   • Project metadata block (rows 4-7)
//   • Column header band (row 9, dark fill, white text)
//   • Body: section headers (light-green fill) + data rows for each group
//   • Summary block: Monthly Gross, Cumulative, % Programme Complete
//   • Payment block: Less Retention 3%, Plus Retention Release 1.5% at PC,
//     NET PAYMENT DUE Ex VAT
//
// All numeric cells use £#,##0 format; percentages use 0.0%; formulas link
// summary/payment rows back to body so a user editing month columns will
// see totals re-compute live in Excel.
//
// Loads `xlsx-js-style` from CDN on first call (the existing `xlsx` package
// loaded by paExtractor cannot write styled cells; this is a separate dep).
// ─────────────────────────────────────────────────────────────────────────────

import { distributeGroups, distributeValue, monthLabels, monthsBetween } from './cffCurves'

// ─── CDN loader (xlsx-js-style is separate from the plain xlsx package) ────
async function loadXlsxStyle() {
  if (window.XLSXStyle) return window.XLSXStyle
  const script = document.createElement('script')
  script.src = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js'
  document.head.appendChild(script)
  await new Promise((resolve, reject) => {
    script.onload = resolve
    script.onerror = () => reject(new Error('Failed to load xlsx-js-style from CDN'))
  })
  // The bundle exposes XLSX globally. We alias it to avoid clashing with the
  // plain xlsx loaded for parsing.
  window.XLSXStyle = window.XLSX
  return window.XLSXStyle
}

// ─── Style constants ──────────────────────────────────────────────────────
const COLORS = {
  text: 'FF111111',
  muted: 'FF666666',
  white: 'FFFFFFFF',
  border: 'FFD0D0CC',
  headerBg: 'FF1C1B18',
  sectionBg: 'FFEAF3DE',
}

const thinBorder = {
  top: { style: 'thin', color: { rgb: COLORS.border } },
  bottom: { style: 'thin', color: { rgb: COLORS.border } },
  left: { style: 'thin', color: { rgb: COLORS.border } },
  right: { style: 'thin', color: { rgb: COLORS.border } },
}

const STYLES = {
  title: { font: { bold: true, sz: 16, color: { rgb: COLORS.text } } },
  subtitle: { font: { italic: true, sz: 11, color: { rgb: COLORS.muted } } },
  label: { font: { bold: true, sz: 10 }, alignment: { vertical: 'center' } },
  value: { font: { sz: 10 }, alignment: { vertical: 'center' } },
  valueCurrency: {
    font: { sz: 10 },
    alignment: { vertical: 'center' },
    numFmt: '£#,##0',
  },
  colHeader: {
    font: { bold: true, sz: 10, color: { rgb: COLORS.white } },
    fill: { fgColor: { rgb: COLORS.headerBg } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: thinBorder,
  },
  sectionHeader: {
    font: { bold: true, sz: 10 },
    fill: { fgColor: { rgb: COLORS.sectionBg } },
    alignment: { vertical: 'center' },
    border: thinBorder,
  },
  dataRef: {
    font: { sz: 10 },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: thinBorder,
  },
  dataDesc: {
    font: { sz: 10 },
    alignment: { vertical: 'center', wrapText: true },
    border: thinBorder,
  },
  dataNum: {
    font: { sz: 10 },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: thinBorder,
    numFmt: '£#,##0',
  },
  dataNote: {
    font: { italic: true, sz: 9, color: { rgb: COLORS.muted } },
    alignment: { vertical: 'center', wrapText: true },
    border: thinBorder,
  },
  summaryLabel: {
    font: { bold: true, sz: 10 },
    fill: { fgColor: { rgb: COLORS.sectionBg } },
    alignment: { vertical: 'center' },
    border: thinBorder,
  },
  summaryNum: {
    font: { bold: true, sz: 10 },
    fill: { fgColor: { rgb: COLORS.sectionBg } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: thinBorder,
    numFmt: '£#,##0',
  },
  summaryPct: {
    font: { bold: true, sz: 10 },
    fill: { fgColor: { rgb: COLORS.sectionBg } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: thinBorder,
    numFmt: '0.0%',
  },
  paymentTitle: {
    font: { bold: true, sz: 11 },
    alignment: { vertical: 'center' },
  },
  netPaymentLabel: {
    font: { bold: true, sz: 11 },
    fill: { fgColor: { rgb: COLORS.sectionBg } },
    alignment: { vertical: 'center' },
    border: thinBorder,
  },
  netPaymentNum: {
    font: { bold: true, sz: 11 },
    fill: { fgColor: { rgb: COLORS.sectionBg } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: thinBorder,
    numFmt: '£#,##0',
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function formatUkDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function generateMonthHeaders(numMonths, startIso, endIso) {
  // Each month label like "Month 1\n11 May – 7 Jun 2026"
  // For simplicity, divide the date range into N equal periods.
  // (The actual Arcady CFF used 4-week periods; we use calendar months instead.)
  const labels = []
  if (!startIso) {
    for (let i = 1; i <= numMonths; i++) labels.push(`Month ${i}`)
    return labels
  }
  const start = new Date(startIso)
  const end = endIso ? new Date(endIso) : null
  if (isNaN(start.getTime())) {
    for (let i = 1; i <= numMonths; i++) labels.push(`Month ${i}`)
    return labels
  }

  // Calculate period boundaries: equal-day partition of start..end
  if (!end || isNaN(end.getTime()) || end <= start) {
    // Fallback: monthly increments from start
    for (let i = 0; i < numMonths; i++) {
      const periodStart = new Date(start.getFullYear(), start.getMonth() + i, start.getDate())
      const periodEnd = new Date(start.getFullYear(), start.getMonth() + i + 1, start.getDate() - 1)
      labels.push(`Month ${i + 1}\n${formatPeriod(periodStart, periodEnd)}`)
    }
    return labels
  }

  const totalDays = Math.round((end - start) / (1000 * 60 * 60 * 24))
  for (let i = 0; i < numMonths; i++) {
    const pStart = new Date(start.getTime() + Math.round((i * totalDays) / numMonths) * 86400000)
    const pEnd =
      i === numMonths - 1
        ? new Date(end)
        : new Date(start.getTime() + (Math.round(((i + 1) * totalDays) / numMonths) - 1) * 86400000)
    labels.push(`Month ${i + 1}\n${formatPeriod(pStart, pEnd)}`)
  }
  return labels
}

function formatPeriod(start, end) {
  const sameYear = start.getFullYear() === end.getFullYear()
  const sameMonth = sameYear && start.getMonth() === end.getMonth()
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  if (sameMonth) {
    return `${start.getDate()} – ${end.getDate()} ${months[end.getMonth()]} ${end.getFullYear()}`
  }
  if (sameYear) {
    return `${start.getDate()} ${months[start.getMonth()]} – ${end.getDate()} ${months[end.getMonth()]} ${end.getFullYear()}`
  }
  return `${start.getDate()} ${months[start.getMonth()]} ${start.getFullYear()} – ${end.getDate()} ${months[end.getMonth()]} ${end.getFullYear()}`
}

// Map a group's section to its display name
const SECTION_DISPLAY = {
  PRELIMINARIES: 'PRELIMINARIES',
  'MAIN WORKS': 'MAIN WORKS',
  'EXTERNAL WORKS': 'EXTERNAL WORKS',
  'PROVISIONAL SUMS': 'PROVISIONAL SUMS',
}
const SECTION_ORDER = ['PRELIMINARIES', 'MAIN WORKS', 'EXTERNAL WORKS', 'PROVISIONAL SUMS']

// Assign each group a display ref (1.1, 2.1, etc.) based on its section position
function assignRefs(groups) {
  const sectionCounters = {}
  const sectionToNum = {}
  let nextSectionNum = 1
  return groups.map(g => {
    const sect = g.section
    if (!sectionToNum[sect]) sectionToNum[sect] = nextSectionNum++
    sectionCounters[sect] = (sectionCounters[sect] || 0) + 1
    const ref = `${sectionToNum[sect]}.${sectionCounters[sect]}`
    return { ...g, ref }
  })
}

// ─── Main API ─────────────────────────────────────────────────────────────
// Inputs:
//   csaExtract: result from csaExtractor.extractCsa() — must have groups[]
//   settings: {
//     project_name (optional override),
//     start_date: ISO string,
//     end_date: ISO string,
//     num_months: integer (computed from dates if omitted),
//     csa_no: string,
//     row_curves: { [groupId]: 'even' | 'front' | 'back' | 'mid' },
//     default_curve: 'even',
//   }
// Returns: { blob: Blob, filename: string, summary: { totalForecast, retention, release, netPayment } }
export async function generateCff(csaExtract, settings) {
  const XLSX = await loadXlsxStyle()

  const numMonths =
    settings.num_months ||
    monthsBetween(settings.start_date, settings.end_date) ||
    1

  // Compute distributions per group. For each row we either use the curve-
  // derived distribution OR a user-supplied manual array (settings.row_manual).
  // Manual arrays must be exactly numMonths long; otherwise they're ignored.
  const groupsWithCurves = csaExtract.groups.map(g => ({
    ...g,
    curve: (settings.row_curves && settings.row_curves[g.id]) || settings.default_curve || 'even',
  }))
  const distribution = distributeGroups(groupsWithCurves, numMonths, settings.default_curve || 'even')

  // ─── PA-aware overlay ──────────────────────────────────────────────────
  // If `settings.pa_actuals.paList` is provided, replace the FIRST N months
  // of every row with values derived from the PAs (one PA = one month),
  // then redistribute the row's remaining contract value across the
  // remaining months using the row's curve.
  //
  // For each row R:
  //   monthN value = R.cumulative_in_PA_N - R.cumulative_in_PA_(N-1)
  //   future = distributeValue(R.value - R.cumulative_in_last_PA, future_months, R.curve)
  //
  // If a row has no matching group in a PA, that PA contributes 0 (row's
  // past months show £0 — the work hadn't started). This is the correct
  // behaviour for plots that started later in the programme.
  const paList = (settings.pa_actuals && Array.isArray(settings.pa_actuals.paList))
    ? settings.pa_actuals.paList
    : []
  const paMonthCount = Math.min(paList.length, numMonths)
  const paAwareRows = distribution.rows.map(r => {
    if (paMonthCount === 0) return r    // no PAs → leave as curve-derived
    const csaGroup = csaExtract.groups.find(g => g.id === r.id)
    if (!csaGroup) return r
    const groupKey = csaGroup.group_key
    if (!groupKey) return r              // shouldn't happen, but defensive

    // Per-PA cumulative for this row's group
    const cumulatives = paList
      .slice(0, paMonthCount)
      .map(p => (p.cumulative_by_group && p.cumulative_by_group[groupKey]) || 0)

    // Convert cumulative → per-month deltas
    const pastMonthly = []
    let prev = 0
    for (const cum of cumulatives) {
      pastMonthly.push(Math.max(0, cum - prev))    // clamp ≥0 for sanity
      prev = cum
    }
    const finalCumulative = prev    // = cumulatives[last]

    // Future months: redistribute remaining contract value using curve
    const remaining = Math.max(0, csaGroup.value - finalCumulative)
    const futureMonths = numMonths - paMonthCount
    const futureMonthly = futureMonths > 0
      ? distributeValue(remaining, futureMonths, r.curve)
      : []

    return { ...r, monthly: [...pastMonthly, ...futureMonthly], pa_aware: true }
  })

  // Apply manual overrides — these win over PA-aware values too. User
  // edits are sticky.
  const rowManual = settings.row_manual || {}
  const resolvedRows = paAwareRows.map(r => {
    const manual = rowManual[r.id]
    if (Array.isArray(manual) && manual.length === numMonths) {
      return { ...r, monthly: manual.slice(), pa_aware: false }
    }
    return r
  })

  // Recompute totals + cumulative from the resolved (post-override) rows so
  // the fallback `v` values written into the xlsx match what Excel will show
  // once formulas evaluate. Otherwise Excel-on-open is right but anyone
  // reading raw cell `.v` (e.g. our portal parser before formulas evaluate)
  // would see stale curve-only numbers.
  const resolvedTotals = Array.from({ length: numMonths }, (_, m) =>
    Math.round(resolvedRows.reduce((s, r) => s + (r.monthly[m] || 0), 0) * 100) / 100
  )
  const resolvedCumulative = []
  let running = 0
  for (const t of resolvedTotals) {
    running = Math.round((running + t) * 100) / 100
    resolvedCumulative.push(running)
  }
  // Repackage as a distribution-shaped object so the rest of the generator
  // can reference it under the same name.
  const finalDist = {
    rows: resolvedRows,
    totals: resolvedTotals,
    cumulative: resolvedCumulative,
  }

  // Merge distribution back into groups for rendering
  const groupsForRender = assignRefs(
    groupsWithCurves.map(g => {
      const row = finalDist.rows.find(r => r.id === g.id)
      return { ...g, monthly: row ? row.monthly : Array(numMonths).fill(0) }
    })
  )

  const monthHeaders = generateMonthHeaders(numMonths, settings.start_date, settings.end_date)

  const projectName = settings.project_name || csaExtract.project_name || ''
  const csaNo = settings.csa_no || csaExtract.csa_no || ''
  const contractSum = csaExtract.contract_sum

  // Build sheet
  const ws = {}
  const merges = []

  const totalCols = 3 + numMonths + 2
  const lastColIdx = totalCols - 1
  const lastMonthColIdx = 2 + numMonths
  const totalForecastColIdx = 3 + numMonths
  const totalForecastColLetter = XLSX.utils.encode_col(totalForecastColIdx)
  const lastMonthColLetter = XLSX.utils.encode_col(lastMonthColIdx)
  const firstMonthCol = 'D'

  function setCell(addr, cell) { ws[addr] = cell }
  function rc(r, c) { return XLSX.utils.encode_cell({ r, c }) }

  // Row 1: Title
  setCell('A1', { v: 'CITY CONSTRUCTION GROUP LTD', t: 's', s: STYLES.title })
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: lastColIdx } })

  // Row 2: Subtitle
  setCell('A2', { v: 'Cashflow Forecast', t: 's', s: STYLES.subtitle })
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: lastColIdx } })

  // Row 4: Project
  setCell('A4', { v: 'Project:', t: 's', s: STYLES.label })
  setCell('B4', { v: projectName, t: 's', s: STYLES.value })
  merges.push({ s: { r: 3, c: 1 }, e: { r: 3, c: lastColIdx } })

  // Row 5: CSA Ref + Contract Sum
  setCell('A5', { v: 'CSA Ref:', t: 's', s: STYLES.label })
  setCell('B5', { v: csaNo, t: 's', s: STYLES.value })
  if (lastColIdx >= 4) {
    setCell('D5', { v: 'Contract Sum:', t: 's', s: STYLES.label })
    setCell('E5', { v: contractSum, t: 'n', s: STYLES.valueCurrency })
  }

  // Row 6: Programme dates
  setCell('A6', { v: 'Programme:', t: 's', s: STYLES.label })
  const dateRange = `${formatUkDate(settings.start_date)} to ${formatUkDate(settings.end_date)}`
  setCell('B6', { v: dateRange, t: 's', s: STYLES.value })
  merges.push({ s: { r: 5, c: 1 }, e: { r: 5, c: lastColIdx } })

  // Row 7: Generated
  setCell('A7', { v: 'Generated:', t: 's', s: STYLES.label })
  setCell('B7', { v: new Date().toISOString().slice(0, 10), t: 's', s: STYLES.value })

  // Row 9 (idx 8): Column headers
  const headerRowIdx = 8
  const headerCells = [
    { v: 'Ref' },
    { v: 'Description' },
    { v: 'Contract Value (£)' },
    ...monthHeaders.map(h => ({ v: h })),
    { v: 'Total Forecast (£)' },
    { v: 'Notes' },
  ]
  for (let c = 0; c < headerCells.length; c++) {
    setCell(rc(headerRowIdx, c), { ...headerCells[c], t: 's', s: STYLES.colHeader })
  }

  // Body: section headers + group data rows
  const sectionGroups = {}
  for (const g of groupsForRender) {
    if (!sectionGroups[g.section]) sectionGroups[g.section] = []
    sectionGroups[g.section].push(g)
  }

  let rowIdx = headerRowIdx + 1
  const dataFirstRowIdx = rowIdx  // first section header row (will be row 10 1-indexed)

  for (const sectName of SECTION_ORDER) {
    const sectRows = sectionGroups[sectName]
    if (!sectRows || sectRows.length === 0) continue

    // Section header — fill across all columns
    for (let c = 0; c <= lastColIdx; c++) {
      setCell(rc(rowIdx, c), {
        v: c === 0 ? SECTION_DISPLAY[sectName] : '',
        t: 's',
        s: STYLES.sectionHeader,
      })
    }
    rowIdx++

    // Group rows
    for (const g of sectRows) {
      setCell(rc(rowIdx, 0), { v: g.ref, t: 's', s: STYLES.dataRef })
      setCell(rc(rowIdx, 1), { v: g.label, t: 's', s: STYLES.dataDesc })
      setCell(rc(rowIdx, 2), { v: g.value, t: 'n', s: STYLES.dataNum })
      for (let m = 0; m < numMonths; m++) {
        setCell(rc(rowIdx, 3 + m), { v: g.monthly[m], t: 'n', s: STYLES.dataNum })
      }
      // Total Forecast = SUM of month columns
      const monthRange = `${firstMonthCol}${rowIdx + 1}:${lastMonthColLetter}${rowIdx + 1}`
      setCell(rc(rowIdx, totalForecastColIdx), {
        t: 'n',
        v: g.value,
        f: `SUM(${monthRange})`,
        s: STYLES.dataNum,
      })
      // Notes column: include source refs as a tooltip note
      const noteText =
        g.section === 'MAIN WORKS' && g.item_count > 1
          ? `${g.item_count} items rolled up`
          : g.section === 'EXTERNAL WORKS' && g.item_count > 1
          ? `${g.item_count} external work items combined`
          : g.section === 'PROVISIONAL SUMS' && g.item_count > 1
          ? `${g.item_count} TBC budgets — see CSA`
          : ''
      setCell(rc(rowIdx, lastColIdx), { v: noteText, t: 's', s: STYLES.dataNote })
      rowIdx++
    }
  }

  const dataLastRowIdx = rowIdx - 1
  const dataLastRow1Indexed = dataLastRowIdx + 1
  const dataFirstRow1Indexed = dataFirstRowIdx + 1

  // Summary: MONTHLY GROSS VALUATION
  setCell(rc(rowIdx, 0), { v: '', t: 's', s: STYLES.summaryLabel })
  setCell(rc(rowIdx, 1), { v: 'MONTHLY GROSS VALUATION', t: 's', s: STYLES.summaryLabel })
  setCell(rc(rowIdx, 2), {
    t: 'n',
    v: contractSum,
    f: `SUM(C${dataFirstRow1Indexed}:C${dataLastRow1Indexed})`,
    s: STYLES.summaryNum,
  })
  for (let m = 0; m < numMonths; m++) {
    const colLetter = XLSX.utils.encode_col(3 + m)
    setCell(rc(rowIdx, 3 + m), {
      t: 'n',
      v: finalDist.totals[m],
      f: `SUM(${colLetter}${dataFirstRow1Indexed}:${colLetter}${dataLastRow1Indexed})`,
      s: STYLES.summaryNum,
    })
  }
  setCell(rc(rowIdx, totalForecastColIdx), {
    t: 'n',
    v: contractSum,
    f: `SUM(${totalForecastColLetter}${dataFirstRow1Indexed}:${totalForecastColLetter}${dataLastRow1Indexed})`,
    s: STYLES.summaryNum,
  })
  setCell(rc(rowIdx, lastColIdx), { v: '', t: 's', s: STYLES.summaryLabel })
  const monthlyGrossRowIdx = rowIdx
  rowIdx++

  // Summary: CUMULATIVE VALUATION
  setCell(rc(rowIdx, 0), { v: '', t: 's', s: STYLES.summaryLabel })
  setCell(rc(rowIdx, 1), { v: 'CUMULATIVE VALUATION', t: 's', s: STYLES.summaryLabel })
  setCell(rc(rowIdx, 2), { v: '', t: 's', s: STYLES.summaryLabel })
  for (let m = 0; m < numMonths; m++) {
    const colLetter = XLSX.utils.encode_col(3 + m)
    let formula
    if (m === 0) {
      formula = `${colLetter}${monthlyGrossRowIdx + 1}`
    } else {
      const prevCol = XLSX.utils.encode_col(3 + m - 1)
      formula = `${prevCol}${rowIdx + 1}+${colLetter}${monthlyGrossRowIdx + 1}`
    }
    setCell(rc(rowIdx, 3 + m), {
      t: 'n',
      v: finalDist.cumulative[m],
      f: formula,
      s: STYLES.summaryNum,
    })
  }
  setCell(rc(rowIdx, totalForecastColIdx), { v: '', t: 's', s: STYLES.summaryLabel })
  setCell(rc(rowIdx, lastColIdx), { v: '', t: 's', s: STYLES.summaryLabel })
  const cumulativeRowIdx = rowIdx
  rowIdx++

  // Summary: % PROGRAMME COMPLETE
  setCell(rc(rowIdx, 0), { v: '', t: 's', s: STYLES.summaryLabel })
  setCell(rc(rowIdx, 1), { v: '% PROGRAMME COMPLETE', t: 's', s: STYLES.summaryLabel })
  setCell(rc(rowIdx, 2), { v: '', t: 's', s: STYLES.summaryLabel })
  for (let m = 0; m < numMonths; m++) {
    const colLetter = XLSX.utils.encode_col(3 + m)
    setCell(rc(rowIdx, 3 + m), {
      t: 'n',
      v: finalDist.cumulative[m] / contractSum,
      f: `IFERROR(${colLetter}${cumulativeRowIdx + 1}/${totalForecastColLetter}${monthlyGrossRowIdx + 1},0)`,
      s: STYLES.summaryPct,
    })
  }
  setCell(rc(rowIdx, totalForecastColIdx), { v: '', t: 's', s: STYLES.summaryLabel })
  setCell(rc(rowIdx, lastColIdx), { v: '', t: 's', s: STYLES.summaryLabel })
  rowIdx++

  // Spacer row
  rowIdx++

  // Payment Calculation block
  setCell(rc(rowIdx, 0), { v: 'PAYMENT CALCULATION', t: 's', s: STYLES.paymentTitle })
  merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: lastColIdx } })
  rowIdx++

  // Less Retention 3%
  setCell(rc(rowIdx, 1), { v: 'Less Retention 3%', t: 's', s: STYLES.dataDesc })
  for (let m = 0; m < numMonths; m++) {
    const colLetter = XLSX.utils.encode_col(3 + m)
    setCell(rc(rowIdx, 3 + m), {
      t: 'n',
      v: -finalDist.totals[m] * 0.03,
      f: `-${colLetter}${monthlyGrossRowIdx + 1}*0.03`,
      s: STYLES.dataNum,
    })
  }
  setCell(rc(rowIdx, totalForecastColIdx), {
    t: 'n',
    v: -contractSum * 0.03,
    f: `-${totalForecastColLetter}${monthlyGrossRowIdx + 1}*0.03`,
    s: STYLES.dataNum,
  })
  const retentionRowIdx = rowIdx
  rowIdx++

  // Plus Retention Release 1.5% (at PC) — only last month gets the value
  setCell(rc(rowIdx, 1), { v: 'Plus Retention Release 1.5% (at PC)', t: 's', s: STYLES.dataDesc })
  for (let m = 0; m < numMonths; m++) {
    const isLast = m === numMonths - 1
    const cell = {
      t: 'n',
      v: isLast ? contractSum * 0.015 : 0,
      s: STYLES.dataNum,
    }
    if (isLast) cell.f = `${totalForecastColLetter}${monthlyGrossRowIdx + 1}*0.015`
    setCell(rc(rowIdx, 3 + m), cell)
  }
  const releaseRange = `${firstMonthCol}${rowIdx + 1}:${lastMonthColLetter}${rowIdx + 1}`
  setCell(rc(rowIdx, totalForecastColIdx), {
    t: 'n',
    v: contractSum * 0.015,
    f: `SUM(${releaseRange})`,
    s: STYLES.dataNum,
  })
  setCell(rc(rowIdx, lastColIdx), {
    v: 'Released at Practical Completion',
    t: 's',
    s: STYLES.dataNote,
  })
  const releaseRowIdx = rowIdx
  rowIdx++

  // NET PAYMENT DUE
  setCell(rc(rowIdx, 0), { v: '', t: 's', s: STYLES.netPaymentLabel })
  setCell(rc(rowIdx, 1), { v: 'NET PAYMENT DUE (Ex VAT)', t: 's', s: STYLES.netPaymentLabel })
  setCell(rc(rowIdx, 2), { v: '', t: 's', s: STYLES.netPaymentLabel })
  for (let m = 0; m < numMonths; m++) {
    const colLetter = XLSX.utils.encode_col(3 + m)
    const isLast = m === numMonths - 1
    const monthly = finalDist.totals[m]
    const retention = monthly * 0.03
    const release = isLast ? contractSum * 0.015 : 0
    setCell(rc(rowIdx, 3 + m), {
      t: 'n',
      v: monthly - retention + release,
      f: `${colLetter}${monthlyGrossRowIdx + 1}+${colLetter}${retentionRowIdx + 1}+${colLetter}${releaseRowIdx + 1}`,
      s: STYLES.netPaymentNum,
    })
  }
  const netPayment = contractSum - contractSum * 0.03 + contractSum * 0.015
  setCell(rc(rowIdx, totalForecastColIdx), {
    t: 'n',
    v: netPayment,
    f: `${totalForecastColLetter}${monthlyGrossRowIdx + 1}+${totalForecastColLetter}${retentionRowIdx + 1}+${totalForecastColLetter}${releaseRowIdx + 1}`,
    s: STYLES.netPaymentNum,
  })
  setCell(rc(rowIdx, lastColIdx), { v: '', t: 's', s: STYLES.netPaymentLabel })

  // Set sheet range
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rowIdx, c: lastColIdx } })
  ws['!merges'] = merges

  // Column widths
  const cols = [
    { wch: 7 },
    { wch: 50 },
    { wch: 16 },
  ]
  for (let m = 0; m < numMonths; m++) cols.push({ wch: 16 })
  cols.push({ wch: 16 })
  cols.push({ wch: 36 })
  ws['!cols'] = cols

  // Row heights for header rows
  const rowHeights = []
  rowHeights[0] = { hpt: 22 }
  rowHeights[1] = { hpt: 18 }
  rowHeights[8] = { hpt: 36 }
  ws['!rows'] = rowHeights

  // Build workbook
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Cashflow Forecast')

  // Write to ArrayBuffer → Blob
  const ab = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true })
  const blob = new Blob([ab], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

  const safeName = (projectName || 'Project').replace(/[^a-z0-9_-]+/gi, '_').replace(/_+/g, '_')
  const filename = `${safeName}_-_Cashflow_Forecast.xlsx`

  return {
    blob,
    filename,
    summary: {
      contractSum,
      totalForecast: contractSum,
      retention: contractSum * 0.03,
      release: contractSum * 0.015,
      netPayment,
      numMonths,
    },
  }
}
