// ─────────────────────────────────────────────────────────────────────────────
// rateEngine.js
//
// Given a line to price (description + unit), searches the rate_library rows
// (harvested from past CSAs) for matching elements, blends them into a single
// rate, and returns the material/labour split where known.
//
// Matching rule (confirmed): match by UNIT + close description wording.
//   • Unit must match (m2 only blends with m2 — never mix £/m² and £/nr).
//   • Description similarity via word overlap (Jaccard-ish). Above a threshold
//     = confident; below = flagged for human review.
// Blending rule (confirmed): AVERAGE all matching sources into one rate.
//
// Material/labour split (Option A): if matched rows carry material_rate /
// labour_rate, average those too. If none do, the split is null (the UI shows
// the blended total and lets the user enter the split, which then feeds back
// into the library going forward).
//
// Pure functions — pass in the library rows; no DB calls here.
// ─────────────────────────────────────────────────────────────────────────────

const STOP = new Set(['the', 'and', 'to', 'of', 'for', 'with', 'incl', 'including',
  'various', 'etc', 'allowance', 'say', 'all', 'new', 'a', 'an', 'in', 'on', 'at'])

export function normUnit(u) {
  const s = String(u || '').toLowerCase().trim()
  if (['sqm', 'sq m', 'm²', 'm2'].includes(s)) return 'm2'
  if (['lm', 'lin m', 'linear m'].includes(s)) return 'lm'
  if (['no', 'nr', 'no.'].includes(s)) return 'nr'
  return s
}

export function wordsOf(desc) {
  return new Set(
    String(desc || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !STOP.has(w))
  )
}

// Jaccard similarity between two word sets (0..1).
function similarity(aWords, bWords) {
  if (!aWords.size || !bWords.size) return 0
  let inter = 0
  for (const w of aWords) if (bWords.has(w)) inter++
  return inter / (aWords.size + bWords.size - inter)
}

const avg = arr => arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : null

// Find and blend a rate for one line.
//   line: { description, unit }
//   library: [{ description, description_norm, unit_norm, rate, material_rate,
//               labour_rate, section, project_name, csa_date }]
//   opts: { threshold = 0.34, max = 8 }
// Returns:
//   { rate, material_rate, labour_rate, confidence, matchCount, sources[],
//     bestSim } | null
export function priceLine(line, library, opts = {}) {
  const threshold = opts.threshold ?? 0.34
  const unit = normUnit(line.unit)
  const lineWords = wordsOf(line.description)
  if (!lineWords.size) return null

  // Candidate rows: same unit, with a usable rate.
  const scored = []
  for (const row of library) {
    if (normUnit(row.unit_norm || row.unit) !== unit) continue
    if (!(row.rate > 0)) continue
    const sim = similarity(lineWords, wordsOf(row.description_norm || row.description))
    if (sim >= threshold) scored.push({ row, sim })
  }
  if (!scored.length) return null

  scored.sort((a, b) => b.sim - a.sim)
  const top = scored.slice(0, opts.max ?? 8)

  const rate = avg(top.map(s => s.row.rate))
  const matWithSplit = top.filter(s => s.row.material_rate != null)
  const labWithSplit = top.filter(s => s.row.labour_rate != null)
  const material_rate = matWithSplit.length ? avg(matWithSplit.map(s => s.row.material_rate)) : null
  const labour_rate = labWithSplit.length ? avg(labWithSplit.map(s => s.row.labour_rate)) : null

  const bestSim = top[0].sim
  // Confidence: high if the best match is strong AND we have corroboration.
  let confidence = 'low'
  if (bestSim >= 0.6 && top.length >= 2) confidence = 'high'
  else if (bestSim >= 0.45) confidence = 'medium'

  return {
    rate: round2(rate),
    material_rate: material_rate != null ? round2(material_rate) : null,
    labour_rate: labour_rate != null ? round2(labour_rate) : null,
    hasSplit: material_rate != null || labour_rate != null,
    confidence,
    matchCount: top.length,
    bestSim: Math.round(bestSim * 100),
    sources: top.map(s => ({
      description: s.row.description,
      rate: s.row.rate,
      unit: s.row.unit,
      section: s.row.section,
      project: s.row.project_name,
      date: s.row.csa_date,
      sim: Math.round(s.sim * 100),
      material_rate: s.row.material_rate ?? null,
      labour_rate: s.row.labour_rate ?? null,
    })),
  }
}

function round2(n) { return n == null ? null : Math.round(n * 100) / 100 }

export const confidenceColor = (c) =>
  c === 'high' ? 'var(--green, #5cb85c)' : c === 'medium' ? 'var(--amber, #e6a23c)' : 'var(--red, #e06c6c)'
