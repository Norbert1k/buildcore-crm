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
      .select('*, director:profiles!projects_project_director_id_fkey(full_name), manager:profiles!projects_project_manager_id_fkey(full_name), project_subcontractors(id)')
      // Order by the project reference ("2026-006" … "2026-001") descending,
      // so the list always reads in project-ID order regardless of when each
      // row was created. project_ref is a zero-padded YYYY-NNN string, so a
      // plain string sort is correct. Projects with no ref sort to the end.
      .order('project_ref', { ascending: false, nullsFirst: false })
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

      {/* Status pills + portfolio dashboard. Replaces the previous 5-stat
          card row. Status counts are now compact pills at the top; below
          them sits a four-card KPI strip (total contract / claimed /
          variations / remaining), a monthly cashflow chart, an expected-
          billings panel, and a clickable per-project bars list. All
          financial data is pulled from PAs (claimed) and CFFs (forecast)
          and aggregated client-side via dashboardFinancials.js. */}
      <ProjectsDashboard
        counts={counts}
        dashFin={dashFin}
        canViewValue={can('view_project_value')}
        onProjectClick={(id) => navigate(`/projects/${id}`)}
      />

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
                        <th>Assigned To</th>
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
                          <td>{p.director?.full_name || '—'}</td>
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
                        <th>Assigned To</th>
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
                          <td>{p.director?.full_name || '—'}</td>
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
// Renders the new portfolio summary block at the top of the Projects page:
//   • Status pills row (Active / Tender / On Hold / Completed)
//   • 4-card KPI strip (Total contract / Claimed / Variations / Remaining)
//   • Monthly cashflow chart (next 12 months, summed across active projects)
//   • Expected billings panel (next 30/60/90 days)
//   • Per-project rows (clickable → navigates to project detail)
//
// All data flows from the `dashFin` prop populated by dashboardFinancials.js.
// While the async fetch is in progress, dashFin.loaded is false and a
// "loading live data" indicator appears in the KPI strip.
function ProjectsDashboard({ counts, dashFin, canViewValue, onProjectClick }) {
  const totals = dashFin?.totals || {
    total_contract: 0, claimed_to_date: 0,
    variations_total: 0, variations_count: 0, remaining: 0,
  }
  const billings = dashFin?.billings || []
  const monthlyForecast = dashFin?.monthly_forecast || []
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
          {/* KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <KpiCard label="Total contract" value={fmtMoney(totals.total_contract)} />
            <KpiCard label="Claimed to date" value={fmtMoney(totals.claimed_to_date)} accent="green"
              caption={totals.total_contract > 0
                ? `${Math.round((totals.claimed_to_date / totals.total_contract) * 100)}% of total`
                : null} />
            <KpiCard label="Variations" value={fmtMoney(totals.variations_total)}
              caption={totals.variations_count > 0
                ? `${totals.variations_count} VO${totals.variations_count === 1 ? '' : 's'}`
                : 'None issued'} />
            <KpiCard label="Remaining" value={fmtMoney(totals.remaining)}
              caption={`across ${counts.active} active`} />
          </div>

          {/* Cashflow chart + billings panel side-by-side. Stacks on narrow. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 10 }}>
            <CashflowChartCard data={monthlyForecast} />
            <BillingsCard billings={billings} />
          </div>

          {/* Per-project bars */}
          {projects.length > 0 && (
            <PerProjectBars projects={projects} onProjectClick={onProjectClick} />
          )}
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

// 4-up KPI card. Optional accent tint on the value (green for claimed).
function KpiCard({ label, value, accent, caption }) {
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
        color: accent === 'green' ? 'var(--green)' : 'var(--text)',
      }}>
        {value}
      </div>
      {caption && (
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{caption}</div>
      )}
    </div>
  )
}

// Monthly cashflow chart — vertical bars showing monthly forecast (gross
// valuation) summed across active projects, for the next 12 months from
// today. Past months are darker green (claimed already), future months
// lighter (forecast). For now we treat everything in monthly_forecast as
// forecast since CFFs don't carry actuals. Past-vs-future tint comes from
// whether the bucket is before or after today's month.
function CashflowChartCard({ data }) {
  // Slice to the next 12 months from today's month onwards, plus the
  // immediately-prior 1 for context. If the underlying data has fewer
  // than 12 months we just show what's there.
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
  const sliced = useMemo(() => {
    if (!data || data.length === 0) return []
    // Find the index of today's month, then take that ± window
    const todayIdx = data.findIndex(p => p.date >= todayKey)
    const start = todayIdx === -1 ? 0 : Math.max(0, todayIdx - 1)
    return data.slice(start, start + 12)
  }, [data, todayKey])

  const maxAmount = sliced.reduce((m, p) => Math.max(m, p.amount), 0) || 1

  return (
    <div style={{
      background: 'var(--surface)',
      border: '0.5px solid var(--border)',
      borderRadius: 8,
      padding: '12px 14px',
      minHeight: 130,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Monthly cashflow forecast</div>
        <div style={{ fontSize: 10, color: 'var(--text3)' }}>
          {sliced.length > 0 ? `${sliced.length} month${sliced.length === 1 ? '' : 's'}` : 'No CFF data yet'}
        </div>
      </div>
      {sliced.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text3)', padding: '20px 0', textAlign: 'center' }}>
          Generate a CFF for any active project to populate this chart.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 70 }}>
            {sliced.map(point => {
              const heightPct = Math.max(2, (point.amount / maxAmount) * 100)
              const isPast = point.date < todayKey
              return (
                <div key={point.date} title={`${fmtMonth(point.date)}: ${fmtMoney(point.amount)}`}
                  style={{
                    flex: 1,
                    background: isPast ? '#448a40' : '#86b67e',
                    height: `${heightPct}%`,
                    borderRadius: '2px 2px 0 0',
                    minHeight: 2,
                  }} />
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
            {sliced.map(point => (
              <div key={point.date} style={{ flex: 1, fontSize: 9, color: 'var(--text3)', textAlign: 'center' }}>
                {fmtMonthShort(point.date)}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Upcoming valuations panel — next 3 PA submissions across the portfolio,
// sourced from each project's CFF monthly forecast. Each row represents
// one calendar month. The first row (current month) gets the green accent
// since that's the PA you're about to submit; the next two are upcoming.
function BillingsCard({ billings }) {
  // Defensive: if data layer hasn't populated yet billings might be missing
  // or the wrong shape. Fall back to 3 zero entries dated to current/+1/+2.
  const rows = Array.isArray(billings) && billings.length === 3
    ? billings
    : [0, 1, 2].map(offset => {
        const today = new Date()
        const target = new Date(today.getFullYear(), today.getMonth() + offset, 1)
        const targetKey = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-01`
        return { date: targetKey, amount: 0 }
      })

  const labels = ['Next valuation', 'Following', 'Third upcoming']

  return (
    <div style={{
      background: 'var(--surface)',
      border: '0.5px solid var(--border)',
      borderRadius: 8,
      padding: '12px 14px',
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Upcoming valuations</div>
      {rows.map((row, idx) => (
        <BillingsRow
          key={row.date}
          label={labels[idx]}
          subtitle={fmtMonth(row.date)}
          value={row.amount}
          accent={idx === 0 ? 'green' : null}
          isLast={idx === rows.length - 1}
        />
      ))}
    </div>
  )
}

function BillingsRow({ label, subtitle, value, accent, isLast }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '6px 0',
      borderBottom: isLast ? 'none' : '0.5px solid var(--border)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 500 }}>{label}</span>
        {subtitle && (
          <span style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>{subtitle}</span>
        )}
      </div>
      <span style={{
        fontSize: 13,
        fontWeight: 600,
        color: accent === 'green' ? 'var(--green)' : 'var(--text)',
      }}>
        {fmtMoney(value)}
      </span>
    </div>
  )
}

// Per-project rows with progress bars showing claimed-vs-total. Each row
// is clickable and navigates to the project's detail page on click.
function PerProjectBars({ projects, onProjectClick }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '0.5px solid var(--border)',
      borderRadius: 8,
      padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Per-project: claimed vs total</div>
        <div style={{ fontSize: 10, color: 'var(--text3)' }}>{projects.length} active</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {projects.map(p => (
          <div key={p.id}
            onClick={() => onProjectClick(p.id)}
            style={{
              cursor: 'pointer',
              padding: '4px 6px',
              borderRadius: 6,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface2)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
              <span style={{ fontWeight: 500 }}>{p.project_name}</span>
              <span style={{ color: 'var(--text3)' }}>
                {fmtMoney(p.claimed_to_date)} / {fmtMoney(p.total_contract)} ({Math.round(p.pct_claimed)}%)
              </span>
            </div>
            <div style={{ height: 5, borderRadius: 3, background: 'var(--surface2)', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${Math.max(0, Math.min(100, p.pct_claimed))}%`,
                background: '#448a40',
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────
function fmtMoney(n) {
  if (!n || !Number.isFinite(n)) return '£0'
  if (Math.abs(n) >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `£${(n / 1_000).toFixed(0)}K`
  return `£${Math.round(n).toLocaleString()}`
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
