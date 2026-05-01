// ─────────────────────────────────────────────────────────────────────────────
// cffCurves.js
// Distribution-curve math for CFF generation.
//
// Given a contract value, a number of months (N), and a curve type, returns
// a length-N array of monthly values. The values always sum to the input
// value exactly (any rounding drift is absorbed into the last month).
//
// Curves (proportional — stretch/compress for any N):
//   • even   — equal split (1/N each month)
//   • front  — front-loaded, linearly tapering. For N=4: 40/30/20/10 %
//   • back   — back-loaded, linearly building. For N=4: 10/20/30/40 %
//   • mid    — mid-peak, light edges & heavy middle. For N=4: 12.5/37.5/37.5/12.5 %
//
// Used by:
//   • CffGeneratorModal.jsx (preview the distribution before generating)
//   • cffGenerator.js (write monthly values into the xlsx body rows)
// ─────────────────────────────────────────────────────────────────────────────

export const CURVE_TYPES = ['even', 'front', 'back', 'mid']

export const CURVE_LABELS = {
  even: 'Even',
  front: 'Front-loaded',
  back: 'Back-loaded',
  mid: 'Mid-peak',
}

export const CURVE_DESCRIPTIONS = {
  even: 'Equal monthly split',
  front: 'Heavy early, tapering off',
  back: 'Light early, building up',
  mid: 'Peak in middle months',
}

function rawWeights(numMonths, curve) {
  if (numMonths < 1) return []
  switch (curve) {
    case 'even':
      return Array.from({ length: numMonths }, () => 1)
    case 'front':
      // Linear decreasing: weights N, N-1, ..., 1
      return Array.from({ length: numMonths }, (_, i) => numMonths - i)
    case 'back':
      // Linear increasing: weights 1, 2, ..., N
      return Array.from({ length: numMonths }, (_, i) => i + 1)
    case 'mid': {
      // Triangular peaked at middle: w = N - 2 * |i - (N-1)/2|
      // Always > 0 for N >= 1.
      const mid = (numMonths - 1) / 2
      return Array.from({ length: numMonths }, (_, i) => {
        const dist = Math.abs(i - mid)
        return Math.max(0.001, numMonths - 2 * dist)
      })
    }
    default:
      return Array.from({ length: numMonths }, () => 1)
  }
}

// Distribute `value` across `numMonths` months using the given `curve`.
// Returns an array of monthly amounts (rounded to 2dp) that sums to `value`
// exactly. Any rounding drift is absorbed into the final month.
export function distributeValue(value, numMonths, curve) {
  if (!numMonths || numMonths < 1) return []
  if (!value || value <= 0) return Array.from({ length: numMonths }, () => 0)

  const weights = rawWeights(numMonths, curve)
  const sumWeights = weights.reduce((s, w) => s + w, 0)
  if (sumWeights <= 0) return Array.from({ length: numMonths }, () => 0)

  const raw = weights.map(w => (value * w) / sumWeights)
  const rounded = raw.map(v => Math.round(v * 100) / 100)
  const drift = value - rounded.reduce((s, v) => s + v, 0)
  rounded[rounded.length - 1] = Math.round((rounded[rounded.length - 1] + drift) * 100) / 100
  return rounded
}

// Distribute a list of CFF-group rows across N months. Returns:
//   { rows: [{ id, label, value, curve, monthly: number[] }], totals: number[], cumulative: number[] }
export function distributeGroups(groups, numMonths, defaultCurve = 'even') {
  const rows = groups.map(g => {
    const curve = g.curve || defaultCurve
    const monthly = distributeValue(g.value, numMonths, curve)
    return { id: g.id, label: g.label, value: g.value, curve, monthly }
  })
  const totals = Array.from({ length: numMonths }, (_, i) =>
    rows.reduce((s, r) => s + (r.monthly[i] || 0), 0)
  )
  const cumulative = []
  let running = 0
  for (const t of totals) {
    running += t
    cumulative.push(Math.round(running * 100) / 100)
  }
  return { rows, totals: totals.map(t => Math.round(t * 100) / 100), cumulative }
}

// Compute number of months between two ISO date strings (start, end).
// Counts each calendar month the project is active in (inclusive of start &
// end month). Returns 0 if dates are missing or invalid; minimum 1 otherwise.
export function monthsBetween(startIso, endIso) {
  if (!startIso || !endIso) return 0
  const s = new Date(startIso)
  const e = new Date(endIso)
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0
  if (e < s) return 0
  const months =
    (e.getFullYear() - s.getFullYear()) * 12 +
    (e.getMonth() - s.getMonth()) +
    1
  return Math.max(1, months)
}

// Generate an array of "Month N" labels (or yyyy-MM if startIso is provided)
export function monthLabels(numMonths, startIso = null) {
  if (!startIso) {
    return Array.from({ length: numMonths }, (_, i) => `Month ${i + 1}`)
  }
  const start = new Date(startIso)
  if (isNaN(start.getTime())) {
    return Array.from({ length: numMonths }, (_, i) => `Month ${i + 1}`)
  }
  const out = []
  for (let i = 0; i < numMonths; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
    const yr = d.getFullYear()
    const mo = String(d.getMonth() + 1).padStart(2, '0')
    out.push(`${yr}-${mo}`)
  }
  return out
}
