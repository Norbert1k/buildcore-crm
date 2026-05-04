// ─────────────────────────────────────────────────────────────────────────────
// dashboardFinancials.js
//
// Aggregates real financial data across ACTIVE projects for the Projects page
// dashboard. Combines:
//   • PAs   (paExtractor.fetchAllProjectPas + per-PA extracted totals/variations)
//   • CFFs  (cffReader.fetchLatestCff for forecast curves)
//
// Returns a single shape:
//   {
//     loaded:           boolean,
//     loading_count:    number    // projects still being fetched
//     totals: {
//       total_contract:    number,
//       claimed_to_date:   number,
//       variations_total:  number,
//       variations_count:  number,
//       remaining:         number,
//     },
//     monthly_forecast: [{ date: 'YYYY-MM-01', amount: number }, ...],
//     billings: [
//       { date: 'YYYY-MM-01', amount: number },   // Next valuation (this month)
//       { date: 'YYYY-MM-01', amount: number },   // Following (next month)
//       { date: 'YYYY-MM-01', amount: number },   // Third upcoming (month after)
//     ],
//     projects: [
//       { id, project_name, project_ref, total_contract, claimed_to_date,
//         pct_claimed, has_real_data }, ...
//     ]
//   }
//
// Caching strategy
// ────────────────
// Each project's parsed financials are cached in localStorage under
//   buildcore:dashFin:v1:<projectId>
// with key = latest_pa_created_at + latest_cff_created_at + a short hash of
// the file names. Cache is invalidated automatically when any new PA or CFF
// is uploaded (created_at changes → key changes).
// TTL: 30 days as a safety bound. Below that, cache is honoured.
//
// Pattern: try cache first; if miss, fetch + parse; write back to cache.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchAllProjectPas, aggregateFinancials } from './paExtractor'
import { fetchLatestCff, projectCffOnCalendar } from './cffReader'

const CACHE_PREFIX = 'buildcore:dashFin:v1:'
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

  // Fire PA + CFF in parallel — independent fetches.
  const [paList, cffExtract] = await Promise.all([
    fetchAllProjectPas(supabase, projectId).catch(err => {
      console.warn(`[dashFin] PA fetch failed for ${projectId}:`, err)
      return []
    }),
    fetchLatestCff(supabase, projectId).catch(err => {
      console.warn(`[dashFin] CFF fetch failed for ${projectId}:`, err)
      return null
    }),
  ])

  // ── Aggregate PAs ────────────────────────────────────────────────────
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

  return {
    id: projectId,
    project_name: project.project_name,
    project_ref: project.project_ref,
    total_contract,
    claimed_to_date,
    variations_total,
    variations_count,
    monthly_forecast,
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
        claimed_to_date: 0,
        variations_total: 0,
        variations_count: 0,
        remaining: 0,
      },
      monthly_forecast: [],
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
        variations_total: 0,
        variations_count: 0,
        monthly_forecast: [],
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
    out.push({ date: targetKey, amount: 0 })
  }
  return out
}

// ── Roll-up: merge per-project shapes into the dashboard shape ────────────
function rollUp(projects) {
  const totals = projects.reduce((acc, p) => ({
    total_contract:    acc.total_contract    + (p.total_contract || 0),
    claimed_to_date:   acc.claimed_to_date   + (p.claimed_to_date || 0),
    variations_total:  acc.variations_total  + (p.variations_total || 0),
    variations_count:  acc.variations_count  + (p.variations_count || 0),
  }), { total_contract: 0, claimed_to_date: 0, variations_total: 0, variations_count: 0 })
  totals.remaining = Math.max(0, totals.total_contract - totals.claimed_to_date)

  // Combine all per-project forecasts onto the calendar. Sum amounts that
  // share a calendar month across projects.
  const byMonth = new Map()
  for (const p of projects) {
    for (const point of (p.monthly_forecast || [])) {
      byMonth.set(point.date, (byMonth.get(point.date) || 0) + (point.amount || 0))
    }
  }
  const monthly_forecast = Array.from(byMonth.entries())
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

  // Upcoming valuations — next 3 PA submissions across the portfolio.
  //
  // Each PA is submitted roughly monthly per project. The CFF's monthly
  // forecast for a given calendar month is the expected gross valuation
  // for that month's PA. We pick:
  //   • Next valuation       = forecast for the CURRENT month (the PA
  //                             you're about to submit for this month's
  //                             work — typically end-of-month submission)
  //   • Following valuation  = next calendar month
  //   • Third upcoming       = month after that
  //
  // Months in monthly_forecast are keyed YYYY-MM-01. We find the bucket
  // whose date >= today's month-start, then take that and the next 2.
  // If a project has no CFF its contribution is 0 — the figure is the
  // sum across whatever projects HAVE forecast data for that month.
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const billings = []
  for (let offset = 0; offset < 3; offset++) {
    const target = new Date(today.getFullYear(), today.getMonth() + offset, 1)
    const targetKey = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-01`
    const found = monthly_forecast.find(p => p.date === targetKey)
    billings.push({
      date: targetKey,
      amount: found ? found.amount : 0,
    })
  }

  return {
    loaded: true,
    loading_count: 0,
    totals,
    monthly_forecast,
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
        total_contract: 0, claimed_to_date: 0,
        variations_total: 0, variations_count: 0, remaining: 0,
      },
      monthly_forecast: [],
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
      variations_total: 0,
      variations_count: 0,
      monthly_forecast: [],
      has_real_data: false,
      pct_claimed: 0,
    }
  })
  return {
    loaded: false,
    loading_count: activeProjects.length,
    totals: {
      total_contract: total,
      claimed_to_date: 0,
      variations_total: 0,
      variations_count: 0,
      remaining: total,
    },
    monthly_forecast: [],
    billings: zeroBillings(),
    projects: projects.sort((a, b) => b.total_contract - a.total_contract),
  }
}
