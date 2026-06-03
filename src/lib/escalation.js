// ─────────────────────────────────────────────────────────────────────────────
// escalation.js
//
// Pure price-escalation maths for the Price Jobs feature. No React, no
// Supabase — just functions, so it's easy to test and reason about.
//
// Concept: a price captured on `priceDate` is escalated to a `buildDate`
// at a per-category annual rate. This is ONE continuous compound calculation
// across however many years separate the two dates — it naturally handles
// "both directions":
//   • priceDate in the PAST, buildDate = today      → ages the price up to now
//   • priceDate = today,      buildDate in FUTURE    → projects forward
//   • priceDate in PAST,      buildDate in FUTURE     → does both in one step
//
// Formula:  escalated = base × (1 + r)^years
//   r     = annualPct / 100
//   years = (buildDate − priceDate) in fractional years (can be negative if
//           a price is somehow dated after the build date — then it de-escalates,
//           which is mathematically correct though rare in practice)
//
// Compounding annually (not monthly) keeps it intuitive: "5%/yr for 2 years"
// = ×1.1025, the number a QS expects.
// ─────────────────────────────────────────────────────────────────────────────

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000

// Fractional years between two dates (signed). Accepts Date objects, ISO
// strings, or YYYY-MM / YYYY-MM-DD strings.
export function yearsBetween(fromDate, toDate) {
  const a = toDateObj(fromDate)
  const b = toDateObj(toDate)
  if (!a || !b) return null
  return (b.getTime() - a.getTime()) / MS_PER_YEAR
}

// Core escalation. Returns { base, escalated, years, factor, rate } or null
// if inputs are unusable. `annualPct` is a percent number (5 = 5%/yr).
export function escalate(base, priceDate, buildDate, annualPct) {
  const baseNum = Number(base)
  if (!Number.isFinite(baseNum)) return null
  const years = yearsBetween(priceDate, buildDate)
  if (years == null) {
    // No usable dates — return base unchanged so the line still prices,
    // just without escalation. Caller can flag "no date" separately.
    return { base: baseNum, escalated: baseNum, years: null, factor: 1, rate: annualPct }
  }
  const r = Number(annualPct) / 100
  if (!Number.isFinite(r)) return { base: baseNum, escalated: baseNum, years, factor: 1, rate: annualPct }
  const factor = Math.pow(1 + r, years)
  const escalated = baseNum * factor
  return { base: baseNum, escalated, years, factor, rate: annualPct }
}

// Resolve a category to its annual rate, given a rates map { category: pct }.
// Falls back to the DEFAULT rate, then to 0 if even that's missing (0 = no
// escalation, the safe choice — never invents a rate).
export function rateForCategory(category, ratesMap) {
  if (!ratesMap) return 0
  const key = (category || '').toUpperCase().trim()
  if (key && Object.prototype.hasOwnProperty.call(ratesMap, key)) return ratesMap[key]
  if (Object.prototype.hasOwnProperty.call(ratesMap, 'DEFAULT')) return ratesMap.DEFAULT
  return 0
}

// Convenience: escalate a line given its category + a rates map + overrides.
// `overrides` (optional) is a per-job { category: pct } that wins over the
// saved defaults — supports "admin sets defaults, override per job".
export function escalateLine({ base, priceDate, category }, buildDate, ratesMap, overrides) {
  const effectiveMap = overrides ? { ...ratesMap, ...overrides } : ratesMap
  const pct = rateForCategory(category, effectiveMap)
  const result = escalate(base, priceDate, buildDate, pct)
  return result ? { ...result, category: (category || 'DEFAULT'), appliedPct: pct } : null
}

// Format helpers kept here so UI and any export share one source of truth.
export function fmtMoney(n) {
  if (!Number.isFinite(Number(n))) return '—'
  return '£' + Math.round(Number(n)).toLocaleString('en-GB')
}

export function fmtYears(y) {
  if (y == null) return 'no date'
  const abs = Math.abs(y)
  const label = abs < 1
    ? `${Math.round(abs * 12)} mo`
    : `${abs.toFixed(abs < 10 ? 1 : 0)} yr`
  return y < 0 ? `−${label}` : label
}

// ── internal ────────────────────────────────────────────────────────────────
function toDateObj(d) {
  if (!d) return null
  if (d instanceof Date) return isNaN(d.getTime()) ? null : d
  const s = String(d).trim()
  // Accept YYYY-MM by padding to the 1st of the month.
  const padded = /^\d{4}-\d{2}$/.test(s) ? `${s}-01` : s
  const dt = new Date(padded)
  return isNaN(dt.getTime()) ? null : dt
}
