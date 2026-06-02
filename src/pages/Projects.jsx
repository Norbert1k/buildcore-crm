import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PROJECT_STATUSES, formatDate, formatCurrency } from '../lib/utils'
import { Avatar, Pill, Spinner, EmptyState, IconPlus, IconEdit, IconTrash, ConfirmDialog } from '../components/ui'
import { useAuth } from '../lib/auth'
import ProjectModal from '../components/ProjectModal'
import { loadDashboardFinancials, buildInstantFallback } from '../lib/dashboardFinancials'

function calcDuration(start, end) {
  if (!start || !end) return null
  const days = Math.round((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24))
  if (days < 0) return null
  if (days < 7) return days + 'd'
  if (days < 30) return Math.round(days / 7) + 'w'
  if (days < 365) return Math.round(days / 30) + ' mo'
  const yrs = Math.round(days / 365)
  return yrs + ' yr'
}

export default function Projects() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [liveOpen, setLiveOpen] = useState(() => localStorage.getItem('proj_live_open') === 'true')
  const [tenderOpen, setTenderOpen] = useState(() => localStorage.getItem('proj_tender_open') === 'true')
  // Dashboard financials — null until first projects load completes. Once
  // projects are loaded, dashFin starts as the buildInstantFallback shape
  // (instant, derived from project.value column) then gets replaced by the
  // real CFF/PA-aggregated shape as background fetches complete.
  const [dashFin, setDashFin] = useState(null)
  const navigate = useNavigate()
  const { can, role } = useAuth()
  const isAdmin = role === 'admin'

  function toggleLive() { setLiveOpen(v => { localStorage.setItem('proj_live_open', !v); return !v }) }
  function toggleTender() { setTenderOpen(v => { localStorage.setItem('proj_tender_open', !v); return !v }) }

  useEffect(() => { load() }, [])

  // Active projects only — derived from the loaded list. We compute it
  // synchronously here (cheap filter) so we can drive the dashboard load
  // from a stable reference.
  const activeProjects = useMemo(
    () => projects.filter(p => p.status === 'active'),
    [projects]
  )

  // Load dashboard financials whenever the set of active projects changes.
  //
  // Two-stage load:
  //   1. Synchronously build a fallback shape from project.value so the
  //      dashboard renders something instantly (no flicker, no blank cards)
  //   2. Asynchronously fetch + parse PAs and CFFs for every active
  //      project, updating dashFin as each completes (incremental progress)
  //
  // The cache layer in dashboardFinancials.js means subsequent visits with
  // unchanged files are near-instant.
  useEffect(() => {
    if (loading) return    // wait for projects load to finish
    if (activeProjects.length === 0) {
      setDashFin(buildInstantFallback([]))
      return
    }

    let cancelled = false
    setDashFin(buildInstantFallback(activeProjects))

    loadDashboardFinancials(supabase, activeProjects, ({ partial }) => {
      // Incremental progress callback — update with rolled-up numbers as
      // each project finishes. Marked as still-loading so the UI can show
      // a subtle indicator until the final resolve.
      if (cancelled) return
      setDashFin({ ...partial, loaded: false, loading_count: activeProjects.length })
    }).then(final => {
      if (cancelled) return
      setDashFin(final)
    }).catch(err => {
      console.warn('[Projects] dashboard load failed:', err)
      if (!cancelled) setDashFin(prev => prev || buildInstantFallback(activeProjects))
    })

    return () => { cancelled = true }
    // We intentionally key on the joined IDs string rather than the array
    // reference so re-renders that don't change membership don't re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, activeProjects.map(p => p.id).join('|')])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select('*, profiles!projects_project_manager_id_fkey(full_name), project_subcontractors(id)')
      .order('project_ref', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
    if (error) console.error('[Projects] load error:', error)
    setProjects(data || [])
    setLoading(false)
  }

  async function deleteProject(id) {
    await supabase.from('projects').delete().eq('id', id)
    setConfirmDelete(null)
    load()
  }

  const liveProjects = projects.filter(p => p.status !== 'tender')
  const tenderProjects = projects.filter(p => p.status === 'tender')

  const counts = ['active', 'tender', 'on_hold', 'completed', 'cancelled'].reduce((acc, s) => {
    acc[s] = projects.filter(p => p.status === s).length; return acc
  }, {})

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Projects</h2>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 2 }}>{projects.length} projects total</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={() => navigate('/projects/calendar')} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Calendar View
          </button>
          {can('manage_projects') && (
            <button className="btn btn-primary" onClick={() => { setEditing(null); setShowModal(true) }}>
              <IconPlus size={14} /> New Project
            </button>
          )}
        </div>
      </div>

      {loading ? <Spinner /> : projects.length === 0 ? (
        <EmptyState icon="🏗️" title="No projects" message="Create your first project to start assigning subcontractors." action={can('manage_projects') && <button className="btn btn-primary" onClick={() => setShowModal(true)}><IconPlus size={14}/> New Project</button>} />
      ) : (
        <>
          {/* ─── Live Projects ────────────────────────────────────── */}
          <div style={{ marginBottom: 16 }}>
            <div className="section-header" onClick={toggleLive}
              style={{ marginBottom: liveOpen ? 10 : 0, cursor: 'pointer', userSelect: 'none', padding: '8px 12px', background: 'var(--surface2)', borderRadius: 6 }}>
              <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: liveOpen ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s', flexShrink: 0 }}>
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#448a40', display: 'inline-block' }} />
                Live Projects
                <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text3)', marginLeft: 4 }}>{liveProjects.length}</span>
                {!liveOpen && liveProjects.length > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 'auto', fontWeight: 400 }}>Click to expand</span>
                )}
              </div>
            </div>
            {liveOpen && (
              liveProjects.length === 0 ? (
                <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No live projects yet.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Client</th>
                        <th>Project Manager</th>
                        <th>Start</th>
                        <th>End</th>
                        <th>Duration</th>
                        <th>Subcontractors</th>
                        {can('view_project_value') && <th>Value</th>}
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {liveProjects.map(p => (
                        <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${p.id}`)}>
                          <td>
                            <div style={{ fontWeight: 500 }}>{p.project_name}</div>
                            {p.project_ref && <div className="td-muted">{p.project_ref}</div>}
                          </td>
                          <td onClick={e => { if (p.client_id) { e.stopPropagation(); navigate(`/clients/${p.client_id}`) } }}>
                            {p.client_id
                              ? <span style={{ color: 'var(--text)', cursor: 'pointer', fontWeight: 700 }}>{p.client_name || '—'}</span>
                              : (p.client_name || '—')
                            }
                          </td>
                          <td>{p.profiles?.full_name || '—'}</td>
                          <td className="td-muted">{formatDate(p.start_date)}</td>
                          <td className="td-muted">{formatDate(p.end_date)}</td>
                          <td className="td-muted">{calcDuration(p.start_date, p.end_date) || '—'}</td>
                          <td><Pill cls="pill-blue">{p.project_subcontractors?.length || 0} assigned</Pill></td>
                          {can('view_project_value') && <td>{formatCurrency(p.value)}</td>}
                          <td><Pill cls={PROJECT_STATUSES[p.status]?.cls || 'pill-gray'}>{PROJECT_STATUSES[p.status]?.label || p.status}</Pill></td>
                          <td onClick={e => e.stopPropagation()}>
                            {can('manage_projects') && (
                              <button className="btn btn-sm" onClick={() => { setEditing(p); setShowModal(true) }}><IconEdit size={13}/></button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>

          {/* ─── Tender Projects ──────────────────────────────────── */}
          <div>
            <div className="section-header" onClick={toggleTender}
              style={{ marginBottom: tenderOpen ? 10 : 0, cursor: 'pointer', userSelect: 'none', padding: '8px 12px', background: 'var(--surface2)', borderRadius: 6 }}>
              <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: tenderOpen ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s', flexShrink: 0 }}>
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#9b87e0', display: 'inline-block' }} />
                Tender Projects
                <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text3)', marginLeft: 4 }}>{tenderProjects.length}</span>
                {!tenderOpen && tenderProjects.length > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 'auto', fontWeight: 400 }}>Click to expand</span>
                )}
              </div>
            </div>
            {tenderOpen && (
              tenderProjects.length === 0 ? (
                <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No projects at tender stage.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Client</th>
                        <th>Project Manager</th>
                        <th>Start</th>
                        <th>End</th>
                        <th>Duration</th>
                        {can('view_project_value') && <th>Value</th>}
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {tenderProjects.map(p => (
                        <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${p.id}`)}>
                          <td>
                            <div style={{ fontWeight: 500 }}>{p.project_name}</div>
                            {p.project_ref && <div className="td-muted">{p.project_ref}</div>}
                          </td>
                          <td onClick={e => { if (p.client_id) { e.stopPropagation(); navigate(`/clients/${p.client_id}`) } }}>
                            {p.client_id
                              ? <span style={{ color: 'var(--text)', cursor: 'pointer', fontWeight: 700 }}>{p.client_name || '—'}</span>
                              : (p.client_name || '—')
                            }
                          </td>
                          <td>{p.profiles?.full_name || '—'}</td>
                          <td className="td-muted">{formatDate(p.start_date)}</td>
                          <td className="td-muted">{formatDate(p.end_date)}</td>
                          <td className="td-muted">{calcDuration(p.start_date, p.end_date) || '—'}</td>
                          {can('view_project_value') && <td>{formatCurrency(p.value)}</td>}
                          <td><Pill cls={PROJECT_STATUSES[p.status]?.cls || 'pill-gray'}>{PROJECT_STATUSES[p.status]?.label || p.status}</Pill></td>
                          <td onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {can('manage_projects') && (
                                <button className="btn btn-sm" onClick={() => { setEditing(p); setShowModal(true) }} title="Edit"><IconEdit size={13}/></button>
                              )}
                              {isAdmin && (
                                <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(p)} title="Delete tender"><IconTrash size={13}/></button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
              </div>
              )
            )}
          </div>
        </>
      )}

      {/* Portfolio financial dashboard — KPIs, monthly cashflow, upcoming
          valuations, variance by month, per-project claimed-vs-plan bars.
          Sits below Live + Tender so the project lists read first. All data
          flows from PAs (claimed) and CFFs (forecast) via dashboardFinancials.js. */}
      <ProjectsDashboard
        counts={counts}
        dashFin={dashFin}
        canViewValue={can('view_project_value')}
        onProjectClick={(id) => navigate(`/projects/${id}`)}
      />

      {showModal && <ProjectModal project={editing} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load() }} />}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => deleteProject(confirmDelete.id)}
        title="Delete Tender Project"
        message={confirmDelete ? `Delete "${confirmDelete.project_name}"? This cannot be undone.` : ''}
        danger
      />
    </div>
  )
}

// ─── Projects Dashboard ─────────────────────────────────────────────────────
//
// Renders the portfolio summary block at the top of the Projects page:
//   • Status pills row (Active / Tender / On Hold / Completed)
//   • 4-card KPI strip: Total contract / Planned to date / Claimed to date /
//     Variance vs CFF (positive = ahead, negative = behind)
//   • Mid row (60/40): Monthly cashflow chart (planned vs actual overlay) +
//     Upcoming valuations (with Likely-forecast column)
//   • Detail row (50/50): Variance by month table + Per-project bars (with
//     variance pill per row)
//
// All data flows from the `dashFin` prop populated by dashboardFinancials.js.
// While the async fetch is in progress, dashFin.loaded is false and a
// "loading live data" indicator appears in the KPI strip.
function ProjectsDashboard({ counts, dashFin, canViewValue, onProjectClick }) {
  const totals = dashFin?.totals || {
    total_contract: 0, planned_to_date: 0, claimed_to_date: 0,
    variations_total: 0, variations_count: 0, variance_to_date: 0, remaining: 0,
  }
  const billings = dashFin?.billings || []
  const monthlyForecast = dashFin?.monthly_forecast || []
  const monthlyActual = dashFin?.monthly_actual || []
  const likelyRatio = dashFin?.likely_ratio ?? null
  const projects = dashFin?.projects || []
  const isLoading = dashFin && !dashFin.loaded

  return (
    <div style={{
      background: 'var(--surface2)',
      borderRadius: 10,
      padding: 14,
      marginBottom: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      {/* Status pills row + a small "loading" indicator on the right while
          PA/CFF parsing is in progress. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <StatusPill label={`${counts.active} active`} accent="green" />
          <StatusPill label={`${counts.tender} tender`} />
          <StatusPill label={`${counts.on_hold} on hold`} accent={counts.on_hold > 0 ? 'amber' : null} />
          <StatusPill label={`${counts.completed} completed`} />
        </div>
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text3)' }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: 'var(--green)', opacity: 0.6,
              animation: 'pulse 1.5s ease-in-out infinite',
            }} />
            Loading live financial data…
          </div>
        )}
      </div>

      {canViewValue && (
        <>
          {/* KPI strip — variance-aware. The "Variations" card from the
              previous design is folded into the Total contract caption
              ("incl. £X variations") and replaced by Variance vs CFF. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <KpiCard
              label="Total contract"
              value={fmtMoney(totals.total_contract)}
              caption={totals.variations_count > 0
                ? `incl. ${fmtMoney(totals.variations_total)} variations (${totals.variations_count})`
                : 'No variations issued'}
            />
            <KpiCard
              label="Planned to date"
              value={fmtMoney(totals.planned_to_date)}
              accent="blue"
              caption={totals.total_contract > 0
                ? `per CFF · ${Math.round((totals.planned_to_date / totals.total_contract) * 100)}% of total`
                : 'No CFF data yet'}
            />
            <KpiCard
              label="Claimed to date"
              value={fmtMoney(totals.claimed_to_date)}
              accent="green"
              caption={totals.total_contract > 0
                ? `per accepted PAs · ${Math.round((totals.claimed_to_date / totals.total_contract) * 100)}% of total`
                : null}
            />
            <VarianceKpiCard
              variance={totals.variance_to_date}
              planned={totals.planned_to_date}
              claimed={totals.claimed_to_date}
            />
          </div>

          {/* Mid row — chart + upcoming valuations. Side-by-side at 60/40
              like the previous design; stacks on narrow. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 10 }}>
            <CashflowChartCard forecast={monthlyForecast} actual={monthlyActual} />
            <BillingsCard billings={billings} likelyRatio={likelyRatio} />
          </div>

          {/* Detail row — variance table + per-project bars at 50/50.
              The two tell complementary stories: the table shows WHEN you
              drifted from plan; the bars show WHICH project drove it. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
            <VarianceTable forecast={monthlyForecast} actual={monthlyActual} />
            {projects.length > 0 && (
              <PerProjectBars projects={projects} onProjectClick={onProjectClick} />
            )}
          </div>
        </>
      )}

      {/* Pulse animation for the loading indicator. Defined inline so the
          component is self-contained and we don't have to touch global CSS. */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// Compact status pill — used for active/tender/on-hold/completed counts.
function StatusPill({ label, accent }) {
  const accentMap = {
    green: { bg: 'rgba(72, 138, 64, 0.15)', color: '#448a40', border: 'rgba(72, 138, 64, 0.3)' },
    amber: { bg: 'rgba(202, 138, 4, 0.15)', color: '#ca8a04', border: 'rgba(202, 138, 4, 0.3)' },
  }
  const styles = accent && accentMap[accent] ? accentMap[accent] : null
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 500,
      padding: '4px 10px',
      borderRadius: 99,
      background: styles?.bg || 'var(--surface)',
      color: styles?.color || 'var(--text2)',
      border: `0.5px solid ${styles?.border || 'var(--border)'}`,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

// 4-up KPI card. Optional accent tint on the value (blue for planned,
// green for claimed; variance gets its own component because its colouring
// depends on sign and needs special rendering).
function KpiCard({ label, value, accent, caption }) {
  const colorMap = {
    green: 'var(--green)',
    blue: '#85B7EB',
  }
  return (
    <div style={{
      background: 'var(--surface)',
      border: '0.5px solid var(--border)',
      borderRadius: 8,
      padding: '10px 14px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{
        fontSize: 20, fontWeight: 600,
        color: colorMap[accent] || 'var(--text)',
      }}>
        {value}
      </div>
      {caption && (
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{caption}</div>
      )}
    </div>
  )
}

// Variance KPI card — the headline number. Tinted red when behind plan,
// green when ahead, neutral when no plan-to-date data exists. The accent
// is on the whole card (border + bg) rather than just the text so the
// variance reads as the focal point of the strip.
function VarianceKpiCard({ variance, planned, claimed }) {
  // No plan data yet → render a neutral "—" card so the strip stays 4-wide.
  if (!planned || planned === 0) {
    return (
      <div style={{
        background: 'var(--surface)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        padding: '10px 14px',
      }}>
        <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          Variance vs CFF
        </div>
        <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text3)' }}>—</div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>No CFF data to date</div>
      </div>
    )
  }

  const isBehind = variance < 0
  const isAhead = variance > 0
  const pctOfPlan = Math.round((claimed / planned) * 100)
  const accentColor = isBehind ? '#E24B4A' : (isAhead ? '#448a40' : 'var(--text)')
  const accentBg = isBehind ? 'rgba(226, 75, 74, 0.06)' : (isAhead ? 'rgba(72, 138, 64, 0.06)' : 'var(--surface)')
  const accentBorder = isBehind ? 'rgba(226, 75, 74, 0.4)' : (isAhead ? 'rgba(72, 138, 64, 0.4)' : 'var(--border)')
  const signedValue = (variance >= 0 ? '+' : '−') + fmtMoney(Math.abs(variance)).replace(/^£/, '£')
  const status = isBehind ? 'behind' : (isAhead ? 'ahead' : 'on plan')

  return (
    <div style={{
      background: accentBg,
      border: `0.5px solid ${accentBorder}`,
      borderRadius: 8,
      padding: '10px 14px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
        Variance vs CFF
      </div>
      <div style={{ fontSize: 20, fontWeight: 600, color: accentColor }}>
        {signedValue}
      </div>
      <div style={{ fontSize: 11, color: accentColor, marginTop: 2 }}>
        {pctOfPlan}% of plan · {status}
      </div>
    </div>
  )
}

// Monthly cashflow chart — vertical bars showing CFF forecast summed across
// active projects, for ~12 months around today. Past months get the actual
// PA delta overlaid as a darker bar (or amber for the current month, since
// it's incomplete). Future months show planned only.
function CashflowChartCard({ forecast, actual }) {
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`

  // Slice to a 12-month window around today (1 month context before, 11 ahead
  // if there's that much forecast). If the underlying data has fewer than 12
  // months we just show what's there.
  const sliced = useMemo(() => {
    if (!forecast || forecast.length === 0) return []
    const todayIdx = forecast.findIndex(p => p.date >= todayKey)
    const start = todayIdx === -1 ? 0 : Math.max(0, todayIdx - 1)
    return forecast.slice(start, start + 12)
  }, [forecast, todayKey])

  // Build a quick lookup of actual values by date.
  const actualByDate = useMemo(() => {
    const m = new Map()
    for (const p of (actual || [])) m.set(p.date, p.amount)
    return m
  }, [actual])

  const maxAmount = sliced.reduce((m, p) => {
    const a = actualByDate.get(p.date) || 0
    return Math.max(m, p.amount, a)
  }, 0) || 1

  return (
    <div style={{
      background: 'var(--surface)',
      border: '0.5px solid var(--border)',
      borderRadius: 8,
      padding: '12px 14px',
      minHeight: 130,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Monthly cashflow · planned vs actual</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, color: 'var(--text3)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 9, height: 9, background: 'rgba(133, 183, 235, 0.4)', borderRadius: 2 }} /> Planned
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 9, height: 9, background: '#378ADD', borderRadius: 2 }} /> Actual
          </span>
          {sliced.length > 0 && (
            <>
              <span style={{ color: 'var(--text3)' }}>·</span>
              <span>{sliced.length}mo</span>
            </>
          )}
        </div>
      </div>
      {sliced.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text3)', padding: '20px 0', textAlign: 'center' }}>
          Generate a CFF for any active project to populate this chart.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 70, position: 'relative' }}>
            {sliced.map(point => {
              const isPast = point.date < todayKey
              const isCurrent = point.date === todayKey
              const plannedHeightPct = Math.max(2, (point.amount / maxAmount) * 100)
              const actualAmount = actualByDate.get(point.date) || 0
              const actualHeightPct = actualAmount > 0 ? Math.max(2, (actualAmount / maxAmount) * 100) : 0
              // Current month uses amber for the actual overlay — signals
              // "in progress" so the user knows it's not a complete claim.
              const actualColor = isCurrent ? '#EF9F27' : '#378ADD'
              return (
                <div key={point.date}
                  title={`${fmtMonth(point.date)} · planned ${fmtMoney(point.amount)}${actualAmount > 0 ? ` · actual ${fmtMoney(actualAmount)}` : ''}`}
                  style={{
                    flex: 1,
                    height: '100%',
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'flex-end',
                  }}>
                  {/* Planned bar — full-width, lighter tint */}
                  <div style={{
                    position: 'absolute',
                    bottom: 0, left: 0, right: 0,
                    background: 'rgba(133, 183, 235, 0.35)',
                    height: `${plannedHeightPct}%`,
                    borderRadius: '2px 2px 0 0',
                    minHeight: 2,
                  }} />
                  {/* Actual bar — overlaid, narrower, darker. Only for past
                      and current months with non-zero actual data. */}
                  {(isPast || isCurrent) && actualAmount > 0 && (
                    <div style={{
                      position: 'absolute',
                      bottom: 0, left: '15%', right: '15%',
                      background: actualColor,
                      height: `${actualHeightPct}%`,
                      borderRadius: '2px 2px 0 0',
                      minHeight: 2,
                    }} />
                  )}
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
            {sliced.map(point => {
              const isCurrent = point.date === todayKey
              return (
                <div key={point.date} style={{
                  flex: 1, fontSize: 9, textAlign: 'center',
                  color: isCurrent ? '#EF9F27' : 'var(--text3)',
                  fontWeight: isCurrent ? 600 : 400,
                }}>
                  {fmtMonthShort(point.date)}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// Upcoming valuations panel — next 3 PA submissions across the portfolio.
// Now has two columns: Planned (from CFF directly) and Likely (planned ×
// trailing-3-month actual:planned ratio). When likelyRatio is null
// (insufficient history) the Likely column shows "—" and a hint.
function BillingsCard({ billings, likelyRatio }) {
  // Defensive: if data layer hasn't populated yet billings might be missing
  // or the wrong shape. Fall back to 3 zero entries dated to current/+1/+2.
  const rows = Array.isArray(billings) && billings.length === 3
    ? billings
    : [0, 1, 2].map(offset => {
        const today = new Date()
        const target = new Date(today.getFullYear(), today.getMonth() + offset, 1)
        const targetKey = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-01`
        return { date: targetKey, planned: 0, likely: 0 }
      })

  const labels = ['Next valuation', 'Following', 'Third upcoming']
  const hasLikely = likelyRatio !== null

  return (
    <div style={{
      background: 'var(--surface)',
      border: '0.5px solid var(--border)',
      borderRadius: 8,
      padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Upcoming valuations</div>
        <div style={{ fontSize: 10, color: 'var(--text3)' }}>
          {hasLikely
            ? `Likely = trend × planned (${Math.round(likelyRatio * 100)}%)`
            : 'Likely needs 3mo of PA history'}
        </div>
      </div>

      {/* Column headers — tight 1fr / 80 / 80 grid so the numbers line up. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 80px 80px',
        gap: 8,
        padding: '6px 0',
        fontSize: 9,
        color: 'var(--text3)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        borderBottom: '0.5px solid var(--border)',
      }}>
        <div></div>
        <div style={{ textAlign: 'right' }}>Planned</div>
        <div style={{ textAlign: 'right' }}>Likely</div>
      </div>

      {rows.map((row, idx) => (
        <BillingsRow
          key={row.date}
          label={labels[idx]}
          subtitle={fmtMonth(row.date)}
          planned={row.planned}
          likely={row.likely}
          hasLikely={hasLikely}
          accentPlanned={idx === 0}
          isLast={idx === rows.length - 1}
        />
      ))}
    </div>
  )
}

function BillingsRow({ label, subtitle, planned, likely, hasLikely, accentPlanned, isLast }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 80px 80px',
      gap: 8,
      alignItems: 'center',
      padding: '9px 0',
      borderBottom: isLast ? 'none' : '0.5px solid var(--border)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 500 }}>{label}</span>
        {subtitle && (
          <span style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>{subtitle}</span>
        )}
      </div>
      <span style={{
        textAlign: 'right',
        fontSize: 13,
        fontWeight: 600,
        color: accentPlanned ? '#85B7EB' : 'var(--text)',
      }}>
        {fmtMoney(planned)}
      </span>
      <span style={{
        textAlign: 'right',
        fontSize: 13,
        fontWeight: 600,
        color: hasLikely ? '#EF9F27' : 'var(--text3)',
      }}>
        {hasLikely ? fmtMoney(likely) : '—'}
      </span>
    </div>
  )
}

// Variance by month table — 6 past + 2 future. Past months show planned,
// actual, signed variance pill, and cumulative running variance. Future
// months show only planned (with actual / variance / cumulative as "—").
//
// The pivot is "today's month": months strictly before today are "past",
// today's month is highlighted as current (so the user can see the
// in-progress state), and months after are "future / forecast only".
function VarianceTable({ forecast, actual }) {
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`

  // Build a unified list of months covering 6 past + current + 2 future
  // (so up to 9 rows total). Defensive: if forecast is empty we render a
  // skeleton row to convey "no data yet".
  const rows = useMemo(() => {
    if (!forecast || forecast.length === 0) return []
    const actualByDate = new Map()
    for (const p of (actual || [])) actualByDate.set(p.date, p.amount || 0)

    // Find the index of today's month in the forecast array.
    let todayIdx = forecast.findIndex(p => p.date >= todayKey)
    if (todayIdx === -1) todayIdx = forecast.length    // today is past the forecast end
    const start = Math.max(0, todayIdx - 6)
    const end = Math.min(forecast.length, todayIdx + 3)  // +2 future months + today's month
    const window = forecast.slice(start, end)

    // Walk through to compute cumulative variance through past + current.
    let cum = 0
    return window.map(point => {
      const isFuture = point.date > todayKey
      const isCurrent = point.date === todayKey
      const planned = point.amount || 0
      const act = actualByDate.get(point.date) || 0
      const hasActual = !isFuture && actualByDate.has(point.date)
      const variance = hasActual ? (act - planned) : null
      if (variance !== null) cum += variance
      return {
        date: point.date,
        planned,
        actual: hasActual ? act : null,
        variance,
        cumulative: hasActual ? cum : null,
        isCurrent,
        isFuture,
      }
    })
  }, [forecast, actual, todayKey])

  const cellStyle = {
    padding: '7px 6px',
    fontSize: 11,
  }
  const headerStyle = {
    ...cellStyle,
    fontSize: 9,
    color: 'var(--text3)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    borderBottom: '0.5px solid var(--border)',
  }

  return (
    <div style={{
      background: 'var(--surface)',
      border: '0.5px solid var(--border)',
      borderRadius: 8,
      padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Variance by month</div>
        <div style={{ fontSize: 10, color: 'var(--text3)' }}>
          {rows.length > 0 ? '6mo back · 2mo forecast' : 'No data yet'}
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text3)', padding: '20px 0', textAlign: 'center' }}>
          Generate a CFF for any active project to populate this table.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...headerStyle, textAlign: 'left' }}>Month</th>
              <th style={{ ...headerStyle, textAlign: 'right' }}>Planned</th>
              <th style={{ ...headerStyle, textAlign: 'right' }}>Actual</th>
              <th style={{ ...headerStyle, textAlign: 'right' }}>Var.</th>
              <th style={{ ...headerStyle, textAlign: 'right' }}>Cum.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const rowBg = r.isCurrent ? 'rgba(239, 159, 39, 0.06)' : 'transparent'
              return (
                <tr key={r.date} style={{ background: rowBg }}>
                  <td style={{ ...cellStyle, color: r.isFuture ? 'var(--text3)' : 'var(--text2)' }}>
                    {r.isCurrent && (
                      <span style={{
                        display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
                        background: '#EF9F27', marginRight: 5, verticalAlign: 'middle',
                      }} />
                    )}
                    {fmtMonth(r.date)}
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'right', color: r.isFuture ? 'var(--text3)' : 'var(--text)' }}>
                    {fmtMoney(r.planned)}
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>
                    {r.actual !== null ? fmtMoney(r.actual) : <span style={{ color: 'var(--text3)' }}>—</span>}
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>
                    {r.variance !== null ? <VariancePill value={r.variance} /> : <span style={{ color: 'var(--text3)' }}>—</span>}
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'right', color: r.cumulative !== null && r.cumulative < 0 ? '#F09595' : 'var(--text3)' }}>
                    {r.cumulative !== null ? signedMoney(r.cumulative) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

// Small inline pill rendering a signed money variance. Red on negative,
// green on positive, neutral when exactly zero. Used by the variance
// table and the per-project bars.
function VariancePill({ value }) {
  const isZero = value === 0 || (Math.abs(value) < 1)  // round-to-£1 tolerance
  if (isZero) {
    return (
      <span style={{
        display: 'inline-block',
        padding: '2px 7px',
        borderRadius: 4,
        background: 'rgba(255, 255, 255, 0.04)',
        color: 'var(--text3)',
        fontSize: 10,
        fontWeight: 500,
      }}>
        on plan
      </span>
    )
  }
  const isNegative = value < 0
  const bg = isNegative ? 'rgba(226, 75, 74, 0.14)' : 'rgba(151, 196, 89, 0.16)'
  const color = isNegative ? '#F09595' : '#C0DD97'
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 7px',
      borderRadius: 4,
      background: bg,
      color,
      fontSize: 10,
      fontWeight: 500,
    }}>
      {signedMoney(value)}
    </span>
  )
}

// Per-project rows with progress bars showing claimed-vs-total, plus a
// variance pill telling you whether the project is ahead or behind plan.
// Each row is clickable and navigates to the project's detail page.
function PerProjectBars({ projects, onProjectClick }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '0.5px solid var(--border)',
      borderRadius: 8,
      padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Per-project · claimed vs plan</div>
        <div style={{ fontSize: 10, color: 'var(--text3)' }}>{projects.length} active</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {projects.map(p => {
          const hasPlanData = p.planned_to_date && p.planned_to_date > 0
          return (
            <div key={p.id}
              onClick={() => onProjectClick(p.id)}
              style={{
                cursor: 'pointer',
                padding: '5px 6px',
                borderRadius: 6,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontWeight: 500, fontSize: 12 }}>{p.project_name}</span>
                {hasPlanData
                  ? <VariancePill value={p.variance_to_date} />
                  : <span style={{ fontSize: 10, color: 'var(--text3)' }}>no plan</span>
                }
              </div>
              <div style={{ height: 5, borderRadius: 3, background: 'var(--surface2)', overflow: 'hidden', marginBottom: 3 }}>
                <div style={{
                  height: '100%',
                  width: `${Math.max(0, Math.min(100, p.pct_claimed))}%`,
                  background: '#448a40',
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)' }}>
                <span>{fmtMoney(p.claimed_to_date)} claimed</span>
                <span>{fmtMoney(p.total_contract)} total ({Math.round(p.pct_claimed)}%)</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────
function fmtMoney(n) {
  if (!n || !Number.isFinite(n)) return '£0'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `£${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `£${(abs / 1_000).toFixed(0)}K`
  return `£${Math.round(abs).toLocaleString()}`
}

// Signed money — used for variance values where the sign matters. Renders
// "+£100K" / "−£500K" / "£0". The leading minus is a unicode minus sign so
// it's visually distinct from a hyphen.
function signedMoney(n) {
  if (!n || !Number.isFinite(n) || Math.abs(n) < 1) return '£0'
  const sign = n >= 0 ? '+' : '−'
  return sign + fmtMoney(n)
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtMonth(ymd) {
  const [y, m] = ymd.split('-')
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y.slice(2)}`
}

function fmtMonthShort(ymd) {
  const [, m] = ymd.split('-')
  return MONTH_NAMES[parseInt(m, 10) - 1]
}
