// ─────────────────────────────────────────────────────────────────────────────
// clientCffAdapter.js
//
// Bridges the client CFF parser (clientCffExtractor) and the existing CFF
// generator (cffGenerator). Takes a parsed client CFF and produces a
// generator-shaped { csaExtract, settings } pair, then calls generateCff.
//
// Why an adapter rather than a new generator: the existing generator already
// handles retention, release, net payment, formulas, cell formatting, and
// summary rows. We just need to feed it line items + per-row monthly
// overrides. By going through generateCff with row_manual, the resulting xlsx
// looks like any other CFF we produce — same template, same calculations.
//
// Input: { contract_sum, num_months, line_items, line_sum, reconciles }
//        — see clientCffExtractor.js for shape.
//
// Output: { blob, filename } — same shape as generateCff returns.
//
// Generator quirks worth knowing about:
//   • generateCff treats csaExtract.groups as the rows. Each group has
//     { id, group_key, label, value, section } and the generator assigns
//     monthly amounts via curve OR via settings.row_manual[group.id].
//   • settings.row_manual[id] must be a number array of length numMonths.
//     We provide one for every row so curves are bypassed entirely.
//   • Per-line monthly_pct from the client may sum to 0.99 instead of 1.0
//     (rounding). We normalise so each row's monthly amounts sum exactly to
//     the row's stated value — otherwise CFF totals would undershoot.
// ─────────────────────────────────────────────────────────────────────────────

import { generateCff } from './cffGenerator'
import { groupKeyFor } from './csaExtractor'

// Build a synthetic csaExtract from the parsed client CFF + a row_manual
// override map. Then call generateCff and return its blob/filename.
//
// Args:
//   parsed       — output of extractClientCff()
//   projectMeta  — { project_name, start_date, end_date } for headers/dates
//
// Returns: { blob, filename, summary, source: { line_items_count, ... } }
export async function generateCffFromClient(parsed, projectMeta) {
  if (!parsed || !Array.isArray(parsed.line_items) || parsed.line_items.length === 0) {
    throw new Error('Client CFF parsed but contained no line items')
  }
  const numMonths = parsed.num_months || 1

  // Build groups (= csaExtract row list) and row_manual map together. Each
  // line item becomes one group + one entry in row_manual.
  const groups = []
  const rowManual = {}
  let nextId = 1

  for (const item of parsed.line_items) {
    const id = `g${nextId++}`
    // group_key: use existing helper for consistency, with the client's
    // section as the section-name. group_key is mainly used by PA-aware
    // regenerate flow which we don't engage here, but populating it
    // correctly keeps the result consistent with our other CFFs.
    const group_key = groupKeyFor(item.section, item.description || item.ref)

    groups.push({
      id,
      group_key,
      label: item.description || item.ref || 'Item',
      value: item.value,
      section: item.section,
      group: null,
      item_count: 1,
      source_refs: [item.ref].filter(Boolean),
    })

    // Compute the monthly amounts for this row. Truncate to numMonths so
    // we don't write past the active range. Normalise pcts so the row's
    // monthly amounts sum exactly to its stated value.
    const truncatedPcts = item.monthly_pct.slice(0, numMonths)
    // Pad with zeros if the parser returned a shorter array (defensive)
    while (truncatedPcts.length < numMonths) truncatedPcts.push(0)
    const pctSum = truncatedPcts.reduce((s, p) => s + p, 0)

    let monthlyAmounts
    if (pctSum > 0) {
      // Normalise: scale each pct so they sum to exactly 1, then × value
      monthlyAmounts = truncatedPcts.map(p =>
        Math.round((item.value * p / pctSum) * 100) / 100
      )
      // Distribute rounding residual to the last non-zero month so the row
      // sum is exact. This matters because CFF Reconciliation will compare
      // row totals to PA cumulative when this CFF is later used with PAs.
      const sumAfterRound = monthlyAmounts.reduce((s, v) => s + v, 0)
      const residual = Math.round((item.value - sumAfterRound) * 100) / 100
      if (Math.abs(residual) > 0.001) {
        // Find last non-zero month and adjust
        for (let m = monthlyAmounts.length - 1; m >= 0; m--) {
          if (monthlyAmounts[m] > 0) {
            monthlyAmounts[m] = Math.round((monthlyAmounts[m] + residual) * 100) / 100
            break
          }
        }
      }
    } else {
      // No distribution given (all zeros). Spread evenly across active range
      // so the row's value still reaches the totals — better than dropping.
      const start = item.start_month && item.start_month >= 1 ? item.start_month : 1
      const finish = item.finish_month && item.finish_month >= start ? item.finish_month : numMonths
      const span = Math.min(finish, numMonths) - start + 1
      const per = span > 0 ? item.value / span : 0
      monthlyAmounts = Array.from({ length: numMonths }, (_, m) =>
        m + 1 >= start && m + 1 <= finish ? Math.round(per * 100) / 100 : 0
      )
    }

    rowManual[id] = monthlyAmounts
  }

  // Aggregate body_total (= sum of all group values) so the generator's
  // header reflects the contract correctly.
  const bodyTotal = groups.reduce((s, g) => s + g.value, 0)

  const csaExtract = {
    project_name: projectMeta.project_name || 'Project',
    contract_sum: parsed.contract_sum || bodyTotal,
    body_total: bodyTotal,
    groups,
  }

  // Pick start/end dates. Prefer project record's dates; fall back to
  // synthesized "month 1 to month N" dates if absent — generator will then
  // use synthesized month labels (M1, M2, …).
  const startDate = projectMeta.start_date || null
  const endDate = projectMeta.end_date || null

  // generateCff settings: we don't engage PA-aware (no actuals here — the
  // client gave us a forecast), and we override every row via row_manual.
  // default_curve is irrelevant because every row is overridden.
  const settings = {
    num_months: numMonths,
    start_date: startDate,
    end_date: endDate,
    default_curve: 'even',  // ignored — every row is in row_manual
    row_curves: {},
    row_manual: rowManual,
    pa_actuals: null,        // forecast-only output
  }

  const result = await generateCff(csaExtract, settings)

  return {
    blob: result.blob,
    filename: result.filename,
    summary: result.summary,
    source: {
      line_items_count: parsed.line_items.length,
      contract_sum: parsed.contract_sum,
      reconciles: parsed.reconciles,
      line_sum: parsed.line_sum,
    },
  }
}
