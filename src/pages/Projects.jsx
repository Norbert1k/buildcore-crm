import { useEffect, useState } from 'react'
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
  const navigate = useNavigate()
  const { can, role } = useAuth()
  const isAdmin = role === 'admin'

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('projects')
      .select('*, profiles!projects_project_manager_id_fkey(full_name), project_subcontractors(id)')
      .order('created_at', { ascending: false })
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
  const activeValue = projects.filter(p => p.status === 'active').reduce((sum, p) => sum + (parseFloat(p.value) || 0), 0)
  const tenderValue = tenderProjects.reduce((sum, p) => sum + (parseFloat(p.value) || 0), 0)

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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div className="stat-card"><div className="stat-label">Active</div><div className="stat-value green">{counts.active}</div></div>
        <div className="stat-card"><div className="stat-label">Tender</div><div className="stat-value">{counts.tender}</div></div>
        <div className="stat-card"><div className="stat-label">On Hold</div><div className="stat-value amber">{counts.on_hold}</div></div>
        <div className="stat-card"><div className="stat-label">Completed</div><div className="stat-value">{counts.completed}</div></div>
        {can('view_project_value') && (
        <div className="stat-card" style={{ borderTop: '3px solid var(--green)', gridColumn: 'span 2' }}>
          <div className="stat-label">Active Projects Value</div>
          <div className="stat-value green" style={{ fontSize: 22 }}>{activeValue > 0 ? formatCurrency(activeValue) : '—'}</div>
          {tenderValue > 0 && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>+ {formatCurrency(tenderValue)} in tender</div>}
        </div>
        )}
      </div>

      {loading ? <Spinner /> : projects.length === 0 ? (
        <EmptyState icon="🏗️" title="No projects" message="Create your first project to start assigning subcontractors." action={can('manage_projects') && <button className="btn btn-primary" onClick={() => setShowModal(true)}><IconPlus size={14}/> New Project</button>} />
      ) : (
        <>
          {/* ─── Live Projects ────────────────────────────────────── */}
          <div style={{ marginBottom: 28 }}>
            <div className="section-header" style={{ marginBottom: 10 }}>
              <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#448a40', display: 'inline-block' }} />
                Live Projects
                <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text3)', marginLeft: 4 }}>{liveProjects.length}</span>
              </div>
            </div>
            {liveProjects.length === 0 ? (
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
                            ? <span style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 500 }}>{p.client_name || '—'}</span>
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
            )}
          </div>

          {/* ─── Tender Projects ──────────────────────────────────── */}
          <div>
            <div className="section-header" style={{ marginBottom: 10 }}>
              <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#378ADD', display: 'inline-block' }} />
                Tender Projects
                <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text3)', marginLeft: 4 }}>{tenderProjects.length}</span>
              </div>
            </div>
            {tenderProjects.length === 0 ? (
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
                            ? <span style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 500 }}>{p.client_name || '—'}</span>
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
