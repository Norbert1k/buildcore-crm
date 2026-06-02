// ─────────────────────────────────────────────────────────────────────────────
// dashboardFinancials.js
//
// Aggregates real financial data across ACTIVE projects for the Projects page
// dashboard. Combines:
//   • PAs   (paExtractor.fetchAllProjectPas      — latest only, for totals)
//   • PAs   (paGroupExtractor.fetchAllProjectPas — full history, for monthly actuals)
//   • CFFs  (cffReader.fetchLatestCff           — for forecast curves)
//
// Returns a single shape:
//   {
//     loaded:           boolean,
//     loading_count:    number    // projects still being fetched
//     totals: {
//       total_contract:    number,
//       planned_to_date:   number,   // sum of CFF months ≤ current month
//       claimed_to_date:   number,
//       variations_total:  number,
//       variations_count:  number,
//       variance_to_date:  number,   // claimed_to_date − planned_to_date (signed)
//       remaining:         number,
//     },
//     monthly_forecast: [{ date: 'YYYY-MM-01', amount: number }, ...],
//     monthly_actual:   [{ date: 'YYYY-MM-01', amount: number }, ...],
//     likely_ratio:     number | null,   // last-3mo actual / last-3mo planned
//     billings: [
//       { date: 'YYYY-MM-01', planned: number, likely: number }, x3
//     ],
//     projects: [
//       { id, project_name, project_ref, total_contract, claimed_to_date,
//         planned_to_date, variance_to_date, pct_claimed, has_real_data }, ...
//     ]
//   }
//
// Caching strategy
// ────────────────
// Each project's parsed financials are cached in localStorage under
//   buildcore:dashFin:v2:<projectId>
// with key = latest_pa_created_at + latest_cff_created_at + a short hash of
// the file names. Cache is invalidated automatically when any new PA or CFF
// is uploaded (created_at changes → key changes).
// TTL: 30 days as a safety bound. Below that, cache is honoured.
//
// Version bumped to v2 in this revision because the per-project payload now
// includes the monthly_actual series and variance fields. Old v1 cache hits
// would deserialise without those fields and the roll-up would treat them
// as missing — bumping the prefix forces a one-time re-fetch.
//
// Pattern: try cache first; if miss, fetch + parse; write back to cache.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchAllProjectPas as fetchLatestPas, aggregateFinancials } from './paExtractor'
import { fetchAllPasAcrossSubfolders as fetchPaHistory } from './paGroupExtractor'
import { fetchLatestCff, projectCffOnCalendar } from './cffReader'

const CACHE_PREFIX = 'buildcore:dashFin:v5:'
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000   // 30 days

// ── localStorage cache helpers ────────────────────────────────────────────
function cacheGet(projectId, signature) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + projectId)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!obj || obj.signature !== signature) return null
    if (Date.now() - obj.cached_at > CACHE_TTL_MS) return null
    return obj.value
  } catch {
    return null
  }
}

function cacheSet(projectId, signature, value) {
  try {
    localStorage.setItem(CACHE_PREFIX + projectId, JSON.stringify({
      signature,
      cached_at: Date.now(),
      value,
    }))
  } catch (err) {
    // Quota exceeded? Log + carry on; the user will just refetch next time.
    console.warn('[dashFin] cache write failed:', err)
  }
}

// Build a cache signature from the latest PA + CFF created_at timestamps so
// the cache invalidates whenever new files are uploaded. We do a tiny
// metadata-only query (no xlsx download) to compute this.
async function computeProjectSignature(supabase, projectId) {
  try {
    const { data, error } = await supabase
      .from('project_doc_files')
      .select('folder_key, created_at')
      .eq('project_id', projectId)
      .in('folder_key', ['02-payment-application', '00-project-information'])
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) return ''
    return (data || []).map(r => r.created_at).join('|')
  } catch {
    return ''
  }
}

// ── Per-project fetch + parse ─────────────────────────────────────────────
//
// Combines PA and CFF data for a single project. Returns the shape used
// by the dashboard. Heavy operation (downloads xlsx files, parses them) —
// always go through the cache wrapper, never call directly from the UI.
async function fetchAndParseProject(supabase, project) {
  const projectId = project.id

  // Fire latest PAs, PA history, and CFF in parallel — three independent
  // fetches. Each one is wrapped so a failure doesn't kill the others.
  // latest PAs gives variations + contract figures (the current paExtractor
  // path); PA history gives the cumulative-by-PA series for monthly actuals.
  const [paList, paHistory, cffExtract] = await Promise.all([
    fetchLatestPas(supabase, projectId).catch(err => {
      console.warn(`[dashFin] PA latest fetch failed for ${projectId}:`, err)
      return []
    }),
    fetchPaHistory(supabase, projectId).catch(err => {
      console.warn(`[dashFin] PA history fetch failed for ${projectId}:`, err)
      return []
    }),
    fetchLatestCff(supabase, projectId).catch(err => {
      console.warn(`[dashFin] CFF fetch failed for ${projectId}:`, err)
      return null
    }),
  ])

  // ── Aggregate latest PAs (variations + contract figures) ─────────────
  // paExtractor.aggregateFinancials gives total_value (original + variations)
  // and variations_total/_count. It does NOT roll up cumulative — we sum
  // that ourselves across sub-buildings.
  const paAgg = aggregateFinancials(paList)
  let claimed_to_date = 0
  for (const pa of paList) {
    if (pa?.extract?.totals?.cumulative) {
      claimed_to_date += pa.extract.totals.cumulative
    }
  }

  // Filter variations: only count those with a non-zero figure (matches the
  // portal fix from the variations badge work). aggregateFinancials in CRM
  // counts ALL VO rows including empty placeholders — adjust here.
  let variations_total = 0
  let variations_count = 0
  for (const pa of paList) {
    for (const v of (pa?.extract?.variations || [])) {
      const n = parseFloat(v.cost_impact)
      if (Number.isFinite(n) && n !== 0) {
        variations_count++
        variations_total += n
      }
    }
  }

  // total_contract = original + variations from PAs. If no PAs, fall back
  // to CFF contract_sum, then to project.value.
  let total_contract = 0
  let has_real_data = false
  if (paAgg.original > 0) {
    total_contract = paAgg.original + variations_total
    has_real_data = true
  } else if (cffExtract?.contract_sum) {
    total_contract = cffExtract.contract_sum
    has_real_data = true
  } else {
    total_contract = parseFloat(project.value) || 0
  }

  // ── Project monthly forecast onto calendar dates ─────────────────────
  // Uses project.start_date as the anchor for CFF month 1. If there's no
  // start_date the projection returns []; the dashboard rolls those up
  // as "no forecast data" silently.
  const monthly_forecast = cffExtract && project.start_date
    ? projectCffOnCalendar(cffExtract, project.start_date)
    : []

  // ── Project monthly actuals from PA history onto calendar dates ──────
  //
  // Each PA in paHistory has { subfolder_key, index, total_cumulative,
  // created_at, retention_pct, retention_amount }. For multi-building
  // projects (e.g. Merton with Residential / Sports Hall / Changing Rooms),
  // PAs from different subfolders are INDEPENDENT sequences — Sports Hall
  // PA01's cumulative has nothing to do with Residential PA01's cumulative.
  // We segregate by subfolder_key before computing per-PA deltas.
  //
  // monthly delta = cum[N] − cum[N-1] within the same subfolder, clamped
  // to 0 to handle the PA-cumulative-non-monotonic edge case.
  //
  // monthly_actual uses the PA file UPLOAD DATE as the calendar slot.
  // pa_entries carries the full per-PA shape needed by the Monthly
  // Payments tab — upload date, delta, retention info, PA number, file
  // name, and the subfolder/building label for projects that have one.
  let monthly_actual = []
  let pa_entries = []
  if (paHistory.length > 0) {
    // Group PAs by subfolder_key so each building's deltas are computed
    // against its own previous PA, not a PA from a different building.
    const bySubfolder = new Map()
    for (const pa of paHistory) {
      const k = pa.subfolder_key == null ? '__root__' : pa.subfolder_key
      if (!bySubfolder.has(k)) bySubfolder.set(k, [])
      bySubfolder.get(k).push(pa)
    }

    for (const [, group] of bySubfolder.entries()) {
      const sortedHistory = [...group].sort((a, b) => (a.index || 0) - (b.index || 0))

      // ── Date anchoring ─────────────────────────────────────────────────
      // Upload timestamps are NOT a reliable signal of when a PA's work was
      // actually claimed — back-dated batch uploads (PA01-PA03 all uploaded
      // on the same day after a catch-up) would otherwise collapse into
      // one month.
      //
      // Rule: use the LATEST PA's upload month as the anchor; each earlier
      // PA is attributed one calendar month back per index step. So if
      // PA03 was uploaded in May, PA02 lands in April and PA01 in March,
      // regardless of when they were actually uploaded.
      //
      // Why latest-as-anchor (not earliest, not project-start): the most
      // recently uploaded PA is most likely to have been uploaded close
      // to its real period. As newer PAs come in, the anchor moves with
      // them and the back-attribution stays internally consistent.
      let anchorMonthStart = null  // Date object on the 1st of the anchor month
      let anchorIndex = null
      for (let i = sortedHistory.length - 1; i >= 0; i--) {
        const pa = sortedHistory[i]
        if (!Number.isFinite(pa.index) || pa.index < 1) continue
        if (!pa.created_at) continue
        const d = new Date(pa.created_at)
        if (isNaN(d.getTime())) continue
        anchorMonthStart = new Date(d.getFullYear(), d.getMonth(), 1)
        anchorIndex = pa.index
        break
      }
      // Fallback anchor: project.start_date if no PA has a usable timestamp.
      let fallbackStart = null
      if (!anchorMonthStart && project.start_date) {
        const sd = new Date(project.start_date)
        if (!isNaN(sd.getTime())) {
          fallbackStart = new Date(sd.getFullYear(), sd.getMonth(), 1)
        }
      }

      let prevCum = 0
      for (const pa of sortedHistory) {
        const idx = pa.index
        if (!Number.isFinite(idx) || idx < 1) continue
        const cum = Number.isFinite(pa.total_cumulative) ? pa.total_cumulative : 0
        const delta = Math.max(0, cum - prevCum)

        let ymd = null
        if (anchorMonthStart && anchorIndex != null) {
          // Anchor: latest PA's upload month. Step back (anchorIndex − idx).
          const monthsBack = anchorIndex - idx
          const d = new Date(anchorMonthStart.getFullYear(), anchorMonthStart.getMonth() - monthsBack, 1)
          ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
        } else if (fallbackStart) {
          // Last-resort: project start + (idx - 1) months.
          const d = new Date(fallbackStart.getFullYear(), fallbackStart.getMonth() + (idx - 1), 1)
          ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
        }

        if (ymd) monthly_actual.push({ date: ymd, amount: delta })
        pa_entries.push({
          pa_index: idx,
          pa_label: pa.pa_label || `PA${String(idx).padStart(2, '0')}`,
          file_name: pa.file_name || null,
          uploaded_at: pa.created_at || null,
          subfolder_key: pa.subfolder_key || null,
          subfolder_label: pa.subfolder_label || null,
          date: ymd,
          amount: delta,
          cumulative: cum,
          retention_pct: pa.retention_pct ?? null,
          retention_amount: pa.retention_amount ?? null,
        })
        prevCum = cum
      }
    }
  }

  // Compute planned_to_date for this project (sum of CFF months ≤ current).
  const todayKey = monthStartKey(new Date())
  let planned_to_date = 0
  for (const pt of monthly_forecast) {
    if (pt.date <= todayKey) planned_to_date += pt.amount || 0
  }

  // variance_to_date is signed: positive = ahead of plan, negative = behind.
  // Uses claimed_to_date (which is the project's running total) rather than
  // summing monthly_actual, because claimed_to_date reflects the latest PA's
  // own cumulative (more authoritative when intermediate PAs are missing).
  const variance_to_date = claimed_to_date - planned_to_date

  return {
    id: projectId,
    project_name: project.project_name,
    project_ref: project.project_ref,
    total_contract,
    claimed_to_date,
    planned_to_date,
    variance_to_date,
    variations_total,
    variations_count,
    monthly_forecast,
    monthly_actual,
    pa_entries,
    has_real_data,
    pct_claimed: total_contract > 0 ? (claimed_to_date / total_contract) * 100 : 0,
  }
}

// Cache wrapper — checks localStorage first, falls through to fetch+parse.
async function getProjectFinancials(supabase, project) {
  const signature = await computeProjectSignature(supabase, project.id)
  if (signature) {
    const cached = cacheGet(project.id, signature)
    if (cached) return cached
  }
  const fresh = await fetchAndParseProject(supabase, project)
  if (signature) cacheSet(project.id, signature, fresh)
  return fresh
}

// ── Top-level dashboard fetch ─────────────────────────────────────────────
//
// Fetches all active projects in parallel. The onProgress callback (if
// provided) is called whenever a single project's data is ready, so the UI
// can update incrementally — useful when there are 5+ projects and parsing
// takes 2-3 seconds.
//
// Returns a Promise that resolves to the final aggregated shape once
// every project is done.
export async function loadDashboardFinancials(supabase, activeProjects, onProgress) {
  // Empty case — no projects, return zeroed shape immediately.
  if (!activeProjects || activeProjects.length === 0) {
    return {
      loaded: true,
      loading_count: 0,
      totals: {
        total_contract: 0,
        planned_to_date: 0,
        claimed_to_date: 0,
        variations_total: 0,
        variations_count: 0,
        variance_to_date: 0,
        remaining: 0,
      },
      monthly_forecast: [],
      monthly_actual: [],
      pa_entries: [],
      likely_ratio: null,
      billings: zeroBillings(),
      projects: [],
    }
  }

  // Kick off all per-project fetches in parallel. Track completion
  // individually so onProgress can fire as each finishes.
  const projectResults = new Array(activeProjects.length)
  let completed = 0

  const fetches = activeProjects.map((project, idx) =>
    getProjectFinancials(supabase, project).then(result => {
      projectResults[idx] = result
      completed++
      if (typeof onProgress === 'function') {
        onProgress({
          completed,
          total: activeProjects.length,
          partial: rollUp(projectResults.filter(Boolean)),
        })
      }
      return result
    }).catch(err => {
      // Per-project failure shouldn't kill the whole dashboard — record a
      // zeroed entry and move on. The UI can show a "couldn't load" hint.
      console.warn(`[dashFin] failed for ${project.id}:`, err)
      const fallback = {
        id: project.id,
        project_name: project.project_name,
        project_ref: project.project_ref,
        total_contract: parseFloat(project.value) || 0,
        claimed_to_date: 0,
        planned_to_date: 0,
        variance_to_date: 0,
        variations_total: 0,
        variations_count: 0,
        monthly_forecast: [],
        monthly_actual: [],
        pa_entries: [],
        has_real_data: false,
        pct_claimed: 0,
      }
      projectResults[idx] = fallback
      completed++
      return fallback
    })
  )

  await Promise.all(fetches)
  return rollUp(projectResults.filter(Boolean))
}

// Build the empty 3-entry billings array for current/next/+2 months. Used
// by both the empty case and the instant fallback so the UI can always
// render 3 rows even before any CFF data has loaded.
function zeroBillings() {
  const today = new Date()
  const out = []
  for (let offset = 0; offset < 3; offset++) {
    const target = new Date(today.getFullYear(), today.getMonth() + offset, 1)
    const targetKey = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-01`
    out.push({ date: targetKey, planned: 0, likely: 0 })
  }
  return out
}

// Helper: YYYY-MM-01 string for the first day of a Date's month.
function monthStartKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

// ── Roll-up: merge per-project shapes into the dashboard shape ────────────
function rollUp(projects) {
  const totals = projects.reduce((acc, p) => ({
    total_contract:    acc.total_contract    + (p.total_contract || 0),
    planned_to_date:   acc.planned_to_date   + (p.planned_to_date || 0),
    claimed_to_date:   acc.claimed_to_date   + (p.claimed_to_date || 0),
    variations_total:  acc.variations_total  + (p.variations_total || 0),
    variations_count:  acc.variations_count  + (p.variations_count || 0),
  }), {
    total_contract: 0, planned_to_date: 0, claimed_to_date: 0,
    variations_total: 0, variations_count: 0,
  })
  totals.variance_to_date = totals.claimed_to_date - totals.planned_to_date
  totals.remaining = Math.max(0, totals.total_contract - totals.claimed_to_date)

  // Combine all per-project forecasts onto the calendar. Sum amounts that
  // share a calendar month across projects.
  const forecastByMonth = new Map()
  for (const p of projects) {
    for (const point of (p.monthly_forecast || [])) {
      forecastByMonth.set(point.date, (forecastByMonth.get(point.date) || 0) + (point.amount || 0))
    }
  }
  const monthly_forecast = Array.from(forecastByMonth.entries())
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

  // Same roll-up for actuals.
  const actualByMonth = new Map()
  for (const p of projects) {
    for (const point of (p.monthly_actual || [])) {
      actualByMonth.set(point.date, (actualByMonth.get(point.date) || 0) + (point.amount || 0))
    }
  }
  const monthly_actual = Array.from(actualByMonth.entries())
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

  // ── Likely-ratio for forward forecast ────────────────────────────────
  //
  // Computed from the last 3 completed months (i.e. months strictly before
  // the current month) of planned vs actual. Defined as
  //   sum(last 3 mo actual) / sum(last 3 mo planned)
  // Returns null when there aren't 3 months of data with non-zero planned —
  // the UI will fall back to displaying planned as-is in that case.
  //
  // We exclude the current month from the trend because mid-month it's
  // typically half-claimed and would drag the ratio artificially low.
  const today = new Date()
  const currentKey = monthStartKey(today)
  const pastForecast = monthly_forecast.filter(p => p.date < currentKey).slice(-3)
  let plannedSum = 0
  let actualSum = 0
  for (const p of pastForecast) {
    plannedSum += p.amount || 0
    const actMatch = monthly_actual.find(a => a.date === p.date)
    actualSum += actMatch ? (actMatch.amount || 0) : 0
  }
  const likely_ratio = (pastForecast.length === 3 && plannedSum > 0)
    ? actualSum / plannedSum
    : null

  // ── Upcoming valuations — next 3 PA submissions across the portfolio ─
  //
  // Each PA is submitted roughly monthly per project. The CFF's monthly
  // forecast for a given calendar month is the expected gross valuation
  // for that month's PA.
  //
  // For each of the next 3 months we expose:
  //   • planned — sum of monthly_forecast amounts at that calendar month
  //   • likely  — planned × likely_ratio (the trend extrapolation). If
  //               likely_ratio is null we set likely = planned so the
  //               column has a fallback value the UI can still show.
  const billings = []
  for (let offset = 0; offset < 3; offset++) {
    const target = new Date(today.getFullYear(), today.getMonth() + offset, 1)
    const targetKey = monthStartKey(target)
    const found = monthly_forecast.find(p => p.date === targetKey)
    const planned = found ? found.amount : 0
    const likely = likely_ratio !== null ? planned * likely_ratio : planned
    billings.push({
      date: targetKey,
      planned,
      likely,
    })
  }

  return {
    loaded: true,
    loading_count: 0,
    totals,
    monthly_forecast,
    monthly_actual,
    likely_ratio,
    billings,
    projects: projects.slice().sort((a, b) =>
      (b.total_contract || 0) - (a.total_contract || 0)
    ),
  }
}

// Synchronous fallback shape from project.value column — used while async
// data is still loading so the UI shows immediate numbers, not blanks.
export function buildInstantFallback(activeProjects) {
  if (!activeProjects || activeProjects.length === 0) {
    return {
      loaded: false,
      loading_count: 0,
      totals: {
        total_contract: 0, planned_to_date: 0, claimed_to_date: 0,
        variations_total: 0, variations_count: 0, variance_to_date: 0,
        remaining: 0,
      },
      monthly_forecast: [],
      monthly_actual: [],
      pa_entries: [],
      likely_ratio: null,
      billings: zeroBillings(),
      projects: [],
    }
  }
  let total = 0
  const projects = activeProjects.map(p => {
    const v = parseFloat(p.value) || 0
    total += v
    return {
      id: p.id,
      project_name: p.project_name,
      project_ref: p.project_ref,
      total_contract: v,
      claimed_to_date: 0,
      planned_to_date: 0,
      variance_to_date: 0,
      variations_total: 0,
      variations_count: 0,
      monthly_forecast: [],
      monthly_actual: [],
      pa_entries: [],
      has_real_data: false,
      pct_claimed: 0,
    }
  })
  return {
    loaded: false,
    loading_count: activeProjects.length,
    totals: {
      total_contract: total,
      planned_to_date: 0,
      claimed_to_date: 0,
      variations_total: 0,
      variations_count: 0,
      variance_to_date: 0,
      remaining: total,
    },
    monthly_forecast: [],
    monthly_actual: [],
    pa_entries: [],
    likely_ratio: null,
    billings: zeroBillings(),
    projects: projects.sort((a, b) => b.total_contract - a.total_contract),
  }
}
