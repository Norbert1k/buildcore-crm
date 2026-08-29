import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PROJECT_STATUSES, formatDate, formatCurrency } from '../lib/utils'
import { Avatar, Pill, Spinner, EmptyState, IconPlus, IconEdit, IconTrash, ConfirmDialog } from '../components/ui'
import { useAuth } from '../lib/auth'
import ProjectModal from '../components/ProjectModal'

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
  const navigate = useNavigate()
  const { can, role, division } = useAuth()
  const isAdmin = role === 'admin'

  function toggleLive() { setLiveOpen(v => { localStorage.setItem('proj_live_open', !v); return !v }) }
  function toggleTender() { setTenderOpen(v => { localStorage.setItem('proj_tender_open', !v); return !v }) }

  useEffect(() => { load() }, [division])

  // Active projects only — derived from the loaded list. We compute it
  // synchronously here (cheap filter) so we can drive the dashboard load
  // from a stable reference.
  const activeProjects = useMemo(
    () => projects.filter(p => p.status === 'active'),
    [projects]
  )

  // Load dashboard financials whenever the set of active projects changes.
  //

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select('*, profiles!projects_project_manager_id_fkey(full_name), director:profiles!projects_project_director_id_fkey(full_name), project_subcontractors(id)')
      .eq('division', division)
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
                          <td>{p.director?.full_name || p.profiles?.full_name || '—'}</td>
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
          <div style={{ marginBottom: 16 }}>
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
                          <td>{p.director?.full_name || p.profiles?.full_name || '—'}</td>
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
// ── Projects Dashboard ─────────────────────────────────────────────────────
// Two-tab layout inside the collapsible "Project Financials" wrapper:
//
//   Tab 1 — Portfolio       : top-line KPIs (total / claimed / remaining /
//                             retention held) + per-job table showing
//                             contract, claimed, remaining, % complete,
//                             retention rate.
//   Tab 2 — Monthly Payments: month-by-month report of every PA issued,
//                             grouped by upload month, showing applied,
//                             retention (from each PA file), and net due.
//                             Expand a month to see the per-PA breakdown.
//
// All data flows from dashFin (computed by dashboardFinancials.js). The
// retention reading inside each PA file lives on pa_entries[].retention_pct
// (added in this build). When that's null for a given PA, the UI falls back
// to the project's retention_pct_override (admin-set, also in dashFin).
function ProjectsDashboard({ counts, dashFin, canViewValue, onProjectClick }) {
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('proj_fin_tab') || 'portfolio')

  function switchTab(key) {
    setActiveTab(key)
    localStorage.setItem('proj_fin_tab', key)
  }

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <StatusPill label={`${counts.active} active`} accent="green" />
          <StatusPill label={`${counts.tender} tender`} />
          <StatusPill label={`${counts.on_hold} on hold`} accent={counts.on_hold > 0 ? 'amber' : null} />
          <StatusPill label={`${counts.completed} completed`} />
        </div>
        {isLoading && (
          <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)', animation: 'pulse 1.5s infinite' }} />
            loading live data
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 2, borderBottom: '0.5px solid var(--border)' }}>
        <TabButton active={activeTab === 'portfolio'} onClick={() => switchTab('portfolio')}>Portfolio</TabButton>
        <TabButton active={activeTab === 'monthly'} onClick={() => switchTab('monthly')}>Monthly Payments</TabButton>
      </div>

      {activeTab === 'portfolio' && (
        <PortfolioTab projects={projects} canViewValue={canViewValue} onProjectClick={onProjectClick} />
      )}
      {activeTab === 'monthly' && (
        <MonthlyPaymentsTab projects={projects} />
      )}
    </div>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <div onClick={onClick}
      style={{
        fontSize: 12,
        padding: '8px 14px',
        cursor: 'pointer',
        color: active ? 'var(--blue)' : 'var(--text3)',
        borderBottom: active ? '2px solid var(--blue)' : '2px solid transparent',
        fontWeight: active ? 500 : 400,
        userSelect: 'none',
      }}>
      {children}
    </div>
  )
}

// ── Portfolio Tab ──────────────────────────────────────────────────────────
// 4 KPIs (total / claimed / remaining / retention) then a per-job table.
// Retention shown per-job is the effective rate — pulled from the latest
// readable PA, or falling back to the project's admin override.
function PortfolioTab({ projects, canViewValue, onProjectClick }) {
  // Roll-ups
  const totalContract = projects.reduce((s, p) => s + (p.total_contract || 0), 0)
  const totalClaimed = projects.reduce((s, p) => s + (p.claimed_to_date || 0), 0)
  const totalRemaining = Math.max(0, totalContract - totalClaimed)
  const totalRetention = projects.reduce((s, p) => s + computeRetentionHeld(p), 0)

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <KpiCard label="Total Contract Value"
          value={fmtMoney(totalContract)}
          caption={`across ${projects.length} active job${projects.length === 1 ? '' : 's'}`} />
        <KpiCard label="Claimed To Date"
          value={fmtMoney(totalClaimed)}
          accent="green"
          caption={totalContract > 0 ? `${Math.round((totalClaimed / totalContract) * 100)}% of total` : ''} />
        <KpiCard label="Remaining To Claim"
          value={fmtMoney(totalRemaining)}
          accent="blue"
          caption={totalContract > 0 ? `${Math.round((totalRemaining / totalContract) * 100)}% still to go` : ''} />
        <KpiCard label="Retention Held"
          value={fmtMoney(totalRetention)}
          accent="amber"
          caption="released at PC" />
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6, padding: '0 4px' }}>Per job</div>
        <div style={{ border: '0.5px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1.6fr 1fr 1fr 1fr 60px',
            padding: '8px 12px',
            background: 'var(--surface2)',
            fontSize: 10,
            color: 'var(--text3)',
            letterSpacing: '0.04em',
          }}>
            <span>PROJECT</span>
            <span style={{ textAlign: 'right' }}>CONTRACT</span>
            <span style={{ textAlign: 'right' }}>CLAIMED</span>
            <span style={{ textAlign: 'right' }}>REMAINING</span>
            <span style={{ textAlign: 'right' }}>%</span>
          </div>

          {projects.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text3)' }}>
              No active projects to show.
            </div>
          )}

          {projects.map((p) => {
            const remaining = Math.max(0, (p.total_contract || 0) - (p.claimed_to_date || 0))
            const pct = p.total_contract > 0 ? Math.round((p.claimed_to_date / p.total_contract) * 100) : 0
            const retInfo = effectiveRetention(p)
            return (
              <div key={p.id}
                onClick={() => onProjectClick && onProjectClick(p.id)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.6fr 1fr 1fr 1fr 60px',
                  padding: '8px 12px',
                  borderTop: '0.5px solid var(--border)',
                  fontSize: 12,
                  alignItems: 'center',
                  cursor: 'pointer',
                }}>
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 500 }}>{p.project_name}</span>
                  <span style={{ fontSize: 10, color: 'var(--text3)' }}>
                    {p.project_ref}
                    {retInfo.label && ` · ret. ${retInfo.label}`}
                    {retInfo.needsAttention && (
                      <span title="Retention couldn't be read from PA — admin can set a fallback in the project edit modal"
                        style={{ marginLeft: 4, color: 'var(--amber)' }}>⚠</span>
                    )}
                  </span>
                </span>
                <span style={{ textAlign: 'right' }}>{fmtMoney(p.total_contract)}</span>
                <span style={{ textAlign: 'right', color: 'var(--green)' }}>{fmtMoney(p.claimed_to_date)}</span>
                <span style={{ textAlign: 'right', color: 'var(--blue)' }}>{fmtMoney(remaining)}</span>
                <span style={{ textAlign: 'right', color: 'var(--text3)' }}>{pct}%</span>
              </div>
            )
          })}

          {projects.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1.6fr 1fr 1fr 1fr 60px',
              padding: '8px 12px',
              borderTop: '0.5px solid var(--border2)',
              background: 'var(--surface2)',
              fontSize: 12,
              alignItems: 'center',
            }}>
              <span style={{ fontWeight: 500, fontSize: 11, letterSpacing: '0.03em' }}>TOTAL</span>
              <span style={{ textAlign: 'right', fontWeight: 500 }}>{fmtMoney(totalContract)}</span>
              <span style={{ textAlign: 'right', fontWeight: 500, color: 'var(--green)' }}>{fmtMoney(totalClaimed)}</span>
              <span style={{ textAlign: 'right', fontWeight: 500, color: 'var(--blue)' }}>{fmtMoney(totalRemaining)}</span>
              <span style={{ textAlign: 'right', fontWeight: 500, color: 'var(--text3)' }}>
                {totalContract > 0 ? Math.round((totalClaimed / totalContract) * 100) : 0}%
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Monthly Payments Tab ───────────────────────────────────────────────────
// Aggregates pa_entries[] across all projects, groups by upload month,
// shows applied / retention / net due. Per-PA breakdown when a month is
// expanded. Year filter + per-job filter. CSV export.
function MonthlyPaymentsTab({ projects }) {
  // Flatten pa_entries across all projects, attaching project info onto each
  const allEntries = []
  for (const p of projects) {
    for (const e of (p.pa_entries || [])) {
      if (!e.date) continue   // skip entries with no calendar slot
      // Determine effective retention rate for this PA: file's own rate if
      // readable, otherwise the project's admin override (may also be null).
      const projRet = effectiveRetention(p)
      const effRate = e.retention_pct ?? projRet.pct
      const effAmt = e.retention_amount ?? (effRate != null ? e.amount * effRate : null)
      allEntries.push({
        ...e,
        project_id: p.id,
        project_name: p.project_name,
        project_ref: p.project_ref,
        effective_rate: effRate,
        effective_amount: effAmt,
        rate_source: e.retention_pct != null ? 'pa' : (projRet.pct != null ? 'override' : 'none'),
      })
    }
  }

  // Available years (descending)
  const years = Array.from(new Set(allEntries.map(e => e.date.slice(0, 4)))).sort().reverse()
  const [selectedYear, setSelectedYear] = useState(years[0] || String(new Date().getFullYear()))
  const [selectedProject, setSelectedProject] = useState('all')
  const [expandedMonths, setExpandedMonths] = useState(new Set())

  function toggleMonth(ym) {
    setExpandedMonths(prev => {
      const n = new Set(prev)
      if (n.has(ym)) n.delete(ym); else n.add(ym)
      return n
    })
  }

  // Filter by year + project
  const filtered = allEntries.filter(e =>
    e.date.startsWith(selectedYear) &&
    (selectedProject === 'all' || e.project_id === selectedProject)
  )

  // Roll-ups for KPI strip
  const yrApplied = filtered.reduce((s, e) => s + (e.amount || 0), 0)
  const yrRetention = filtered.reduce((s, e) => s + (e.effective_amount || 0), 0)
  const yrNet = yrApplied - yrRetention
  const yrCount = filtered.length

  // Group by month (YYYY-MM)
  const byMonth = new Map()
  for (const e of filtered) {
    const ym = e.date.slice(0, 7)
    if (!byMonth.has(ym)) byMonth.set(ym, [])
    byMonth.get(ym).push(e)
  }
  const monthRows = Array.from(byMonth.entries())
    .map(([ym, entries]) => {
      const applied = entries.reduce((s, e) => s + (e.amount || 0), 0)
      const retention = entries.reduce((s, e) => s + (e.effective_amount || 0), 0)
      const projectIds = new Set(entries.map(e => e.project_id))
      return {
        ym,
        entries,
        applied,
        retention,
        net: applied - retention,
        projectCount: projectIds.size,
        paCount: entries.length,
      }
    })
    .sort((a, b) => b.ym.localeCompare(a.ym))

  function exportCsv() {
    const rows = []
    rows.push(['Month', 'Project ref', 'Project', 'Building', 'PA', 'Uploaded', 'Applied', 'Retention rate', 'Retention amount', 'Net due', 'Rate source'])
    for (const m of monthRows) {
      for (const e of m.entries) {
        rows.push([
          fmtMonthYM(m.ym),
          e.project_ref || '',
          e.project_name || '',
          e.subfolder_label || '',
          e.pa_label || '',
          e.uploaded_at ? new Date(e.uploaded_at).toLocaleDateString('en-GB') : '',
          Math.round(e.amount || 0),
          e.effective_rate != null ? (e.effective_rate * 100).toFixed(2) + '%' : '',
          e.effective_amount != null ? Math.round(e.effective_amount) : '',
          Math.round((e.amount || 0) - (e.effective_amount || 0)),
          e.rate_source,
        ])
      }
    }
    const csv = rows.map(r => r.map(c => {
      const s = String(c)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `monthly-payments-${selectedYear}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text3)' }}>Year:</span>
        <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)}
          style={{ fontSize: 11, padding: '3px 6px', background: 'var(--surface2)', color: 'var(--text)', border: '0.5px solid var(--border2)', borderRadius: 4 }}>
          {years.length === 0 && <option value={selectedYear}>{selectedYear}</option>}
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={{ color: 'var(--text3)', marginLeft: 8 }}>Job:</span>
        <select value={selectedProject} onChange={e => setSelectedProject(e.target.value)}
          style={{ fontSize: 11, padding: '3px 6px', background: 'var(--surface2)', color: 'var(--text)', border: '0.5px solid var(--border2)', borderRadius: 4 }}>
          <option value="all">All jobs</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.project_name}</option>)}
        </select>
        <button onClick={exportCsv} disabled={filtered.length === 0}
          style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 9px', background: 'transparent', color: 'var(--text)', border: '0.5px solid var(--border2)', borderRadius: 4, cursor: filtered.length === 0 ? 'not-allowed' : 'pointer', opacity: filtered.length === 0 ? 0.4 : 1 }}>
          Export CSV
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginTop: 10 }}>
        <KpiCard label="Year Applied" value={fmtMoney(yrApplied)} />
        <KpiCard label="Retention (from PAs)" value={fmtMoney(yrRetention)} accent="amber" />
        <KpiCard label="Net Payment" value={fmtMoney(yrNet)} accent="green" />
        <KpiCard label="PAs Issued" value={String(yrCount)} />
      </div>

      <div style={{ border: '0.5px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginTop: 10 }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '28px 100px 1fr 100px 90px 100px',
          padding: '8px 12px',
          background: 'var(--surface2)',
          fontSize: 10,
          color: 'var(--text3)',
          letterSpacing: '0.04em',
        }}>
          <span></span>
          <span>MONTH</span>
          <span></span>
          <span style={{ textAlign: 'right' }}>APPLIED</span>
          <span style={{ textAlign: 'right' }}>RETENTION</span>
          <span style={{ textAlign: 'right' }}>NET DUE</span>
        </div>

        {monthRows.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text3)' }}>
            No payment applications in {selectedYear}{selectedProject !== 'all' ? ' for the selected job' : ''}.
          </div>
        )}

        {monthRows.map((m) => {
          const isExpanded = expandedMonths.has(m.ym)
          return (
            <div key={m.ym}>
              <div onClick={() => toggleMonth(m.ym)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '28px 100px 1fr 100px 90px 100px',
                  padding: '8px 12px',
                  borderTop: '0.5px solid var(--border)',
                  fontSize: 12,
                  alignItems: 'center',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s', color: 'var(--text3)' }}>
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
                <span style={{ fontWeight: 500 }}>{fmtMonthYM(m.ym)}</span>
                <span style={{ color: 'var(--text3)', fontSize: 11 }}>
                  {m.paCount} PA{m.paCount === 1 ? '' : 's'} · {m.projectCount} project{m.projectCount === 1 ? '' : 's'}
                </span>
                <span style={{ textAlign: 'right', fontWeight: 500 }}>{fmtMoney(m.applied)}</span>
                <span style={{ textAlign: 'right', color: 'var(--amber)' }}>{fmtMoney(m.retention)}</span>
                <span style={{ textAlign: 'right', fontWeight: 500, color: 'var(--green)' }}>{fmtMoney(m.net)}</span>
              </div>
              {isExpanded && (
                <div style={{ background: 'rgba(91,155,213,0.04)', padding: '6px 12px 10px' }}>
                  {m.entries.map((e, i) => (
                    <div key={i}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '28px 1fr 100px 90px 100px',
                        padding: '6px 0',
                        fontSize: 11,
                        gap: 8,
                        alignItems: 'center',
                        borderTop: i === 0 ? 'none' : '0.5px solid var(--border)',
                      }}>
                      <span></span>
                      <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ color: 'var(--text)' }}>
                          {e.project_name} · {e.pa_label}
                          {e.subfolder_label && <span style={{ color: 'var(--text3)', fontWeight: 400 }}> · {e.subfolder_label}</span>}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text3)' }}>
                          {e.project_ref}
                          {e.uploaded_at && ` · uploaded ${new Date(e.uploaded_at).toLocaleDateString('en-GB').replace(/\//g, '.')}`}
                          {e.effective_rate != null && ` · ret. ${(e.effective_rate * 100).toFixed(e.effective_rate * 100 % 1 === 0 ? 0 : 1)}%`}
                          {e.rate_source === 'override' && (
                            <span title="Read from project admin override (PA file rate unreadable)"
                              style={{ marginLeft: 4, color: 'var(--text3)' }}>(override)</span>
                          )}
                          {e.rate_source === 'none' && (
                            <span title="No retention rate set — admin should set a fallback in the project edit modal"
                              style={{ marginLeft: 4, color: 'var(--amber)' }}>⚠ no rate</span>
                          )}
                        </span>
                      </span>
                      <span style={{ textAlign: 'right' }}>{fmtMoney(e.amount)}</span>
                      <span style={{ textAlign: 'right', color: 'var(--amber)' }}>{fmtMoney(e.effective_amount || 0)}</span>
                      <span style={{ textAlign: 'right', color: 'var(--green)' }}>{fmtMoney((e.amount || 0) - (e.effective_amount || 0))}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {monthRows.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '28px 100px 1fr 100px 90px 100px',
            padding: '8px 12px',
            borderTop: '0.5px solid var(--border2)',
            background: 'var(--surface2)',
            fontSize: 12,
            alignItems: 'center',
          }}>
            <span></span>
            <span style={{ fontWeight: 500, fontSize: 11, letterSpacing: '0.03em' }}>YEAR TOTAL</span>
            <span></span>
            <span style={{ textAlign: 'right', fontWeight: 500 }}>{fmtMoney(yrApplied)}</span>
            <span style={{ textAlign: 'right', fontWeight: 500, color: 'var(--amber)' }}>{fmtMoney(yrRetention)}</span>
            <span style={{ textAlign: 'right', fontWeight: 500, color: 'var(--green)' }}>{fmtMoney(yrNet)}</span>
          </div>
        )}
      </div>
    </>
  )
}

// ── Retention helpers ──────────────────────────────────────────────────────
// effectiveRetention(project) returns:
//   { pct, label, source, needsAttention }
// where:
//   pct            — decimal (0.03 = 3%) or null if no data available
//   label          — display string like "3%" / "5.5%" / "" when none
//   source         — 'pa' (read from latest readable PA) | 'override' |
//                    'none' (no source at all)
//   needsAttention — true if no PA has readable retention AND no override
//                    set; the UI surfaces a small warning glyph
function effectiveRetention(p) {
  // Latest readable PA wins
  const entries = p.pa_entries || []
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].retention_pct != null) {
      const pct = entries[i].retention_pct
      return { pct, label: fmtPct(pct), source: 'pa', needsAttention: false }
    }
  }
  // Fall back to admin override on project record
  if (p.retention_pct_override != null) {
    return { pct: p.retention_pct_override, label: fmtPct(p.retention_pct_override), source: 'override', needsAttention: false }
  }
  // Nothing readable, nothing set
  return { pct: null, label: '', source: 'none', needsAttention: entries.length > 0 }
}

// Total retention held across all PAs of one project, used in the Portfolio
// KPI strip. Sums each PA's effective retention amount.
function computeRetentionHeld(p) {
  const projRet = effectiveRetention(p)
  let held = 0
  for (const e of (p.pa_entries || [])) {
    if (e.retention_amount != null) {
      held += e.retention_amount
    } else if (projRet.pct != null && e.amount) {
      held += e.amount * projRet.pct
    }
  }
  return held
}

function fmtPct(p) {
  if (p == null) return ''
  const v = p * 100
  return v % 1 === 0 ? `${v}%` : `${v.toFixed(1)}%`
}

function fmtMonthYM(ym) {
  const [y, m] = ym.split('-')
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`
}

function StatusPill({ label, accent }) {
  const accentMap = {
    green: { bg: 'var(--green-bg)', color: 'var(--green)', border: 'var(--green-border)' },
    amber: { bg: 'var(--amber-bg)', color: 'var(--amber)', border: 'var(--amber-border)' },
    blue:  { bg: 'var(--blue-bg)',  color: 'var(--blue)',  border: 'var(--blue-border)' },
  }
  const a = accentMap[accent] || {}
  return (
    <span style={{
      fontSize: 11,
      padding: '4px 10px',
      borderRadius: 999,
      background: a.bg || 'var(--surface2)',
      color: a.color || 'var(--text2)',
      border: a.border ? `1px solid ${a.border}` : '0.5px solid var(--border)',
    }}>{label}</span>
  )
}

function KpiCard({ label, value, accent, caption }) {
  const accentColor = {
    green: 'var(--green)',
    amber: 'var(--amber)',
    blue:  'var(--blue)',
    red:   'var(--red)',
  }[accent]
  return (
    <div style={{
      background: 'var(--surface)',
      border: '0.5px solid var(--border)',
      borderRadius: 8,
      padding: '12px 14px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', letterSpacing: '0.04em' }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 22, fontWeight: 500, marginTop: 6, color: accentColor || 'var(--text)' }}>{value}</div>
      {caption && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>{caption}</div>}
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
