// ─────────────────────────────────────────────────────────────────────────────
// reportValuation.js — the progress report's Commercial figures, filled the
// same tidy way everywhere (the editor's prefill and the CRM's drafts):
//
//   • valuation No.   = the PA number (PA07 → 7), never a duplicate row
//   • date submitted  = the PA's date (from its name, e.g. "05.11.26", else when
//                       it was uploaded) — not the day the report was written
//   • gross           = this application's gross (cumulative − previously
//                       certified), like the rows the team enters by hand
//   • net             = gross less retention
//   • money           = "2,161,072.89" — thousands separators, 2 decimals
// ─────────────────────────────────────────────────────────────────────────────

// "£1,234.5" / "1234.5" / 1234.5 → 1234.5 (null when it isn't a number)
export function parseMoney(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v ?? '').replace(/[£,\s]/g, '').replace(/^\((.*)\)$/, '-$1')
  if (!s || !/^-?\d*\.?\d+$/.test(s)) return null
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

// 2161072.889 → "2,161,072.89"; '' for blanks; text that isn't money is left alone
export function tidyMoney(v) {
  if (v === '' || v == null) return ''
  const n = parseMoney(v)
  if (n == null) return String(v)
  return (Math.round(n * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export const paNumber = name => {
  const m = String(name || '').match(/\bPA\s*[-_ ]?0*(\d{1,3})\b/i)
  return m ? parseInt(m[1], 10) : null
}

// "… PA07 05.11.26 …" → "2026-11-05"
export function dateFromName(name) {
  const m = String(name || '').match(/\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2}|\d{4})\b/)
  if (!m) return null
  const d = +m[1], mo = +m[2], y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
  if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2015 || y > 2100) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// The valuations list with this PA's row added (or refreshed if it's already there).
//   totals:    the PA reader's totals { cumulative, prev_certified, retention_pct }
//   paName:    the PA's file name, paDate: when it was uploaded (ISO)
//   history:   the previous report's valuations
//   retention: the job's retention % when the PA shows none
export function valuationsWithPa(history, { totals, paName, paDate, retention }) {
  const hist = (history || []).map(r => ({ ...r }))
  if (!totals || !(totals.cumulative > 0)) return hist
  const nums = hist.map(r => parseInt(r.no, 10)).filter(Number.isFinite)
  const no = paNumber(paName) ?? (nums.length ? Math.max(...nums) + 1 : hist.length + 1)
  const prev = parseMoney(totals.prev_certified)
  const gross = prev != null && prev > 0 && prev < totals.cumulative ? totals.cumulative - prev : totals.cumulative
  const ret = parseMoney(totals.retention_pct) ?? parseMoney(retention) ?? 0
  const row = {
    no: String(no),
    date_submitted: dateFromName(paName) || (paDate ? String(paDate).slice(0, 10) : new Date().toISOString().slice(0, 10)),
    gross_claimed: tidyMoney(gross),
    retention_pct: String(ret),
    amount_claimed: tidyMoney(gross * (1 - ret / 100)),
    amount_agreed: '',
  }
  const at = hist.findIndex(r => String(r.no).trim() === row.no)
  if (at >= 0) hist[at] = { ...row, amount_agreed: hist[at].amount_agreed || '' }
  else hist.push(row)
  return hist
}

// The PA's variations in the editor's shape, figures tidy
export function variationsFromPa(variations) {
  return (variations || []).map(v => ({
    instruction_no: v.instruction_no,
    si_ref: '',
    issue_date: '',
    instruction_details: v.instruction_details,
    scope_impact: '',
    cost_impact: tidyMoney(v.cost_impact),
    time_impact: '',
    agreed_cost: '',
  }))
}
