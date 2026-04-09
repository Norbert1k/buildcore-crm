import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PROJECT_STATUSES, formatDate, formatCurrency } from '../lib/utils'
import { Avatar, Pill, Spinner, EmptyState, IconPlus, IconEdit } from '../components/ui'
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
  const [filter, setFilter] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const navigate = useNavigate()
  const { can } = useAuth()

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

  const filtered = filter === 'all' ? projects : projects.filter(p => p.status === filter)
  const counts = ['active', 'tender', 'on_hold', 'completed', 'cancelled'].reduce((acc, s) => {
    acc[s] = projects.filter(p => p.status === s).length; return acc
  }, {})
  const activeValue = projects.filter(p => p.status === 'active').reduce((sum, p) => sum + (parseFloat(p.value) || 0), 0)
  const tenderValue = projects.filter(p => p.status === 'tender').reduce((sum, p) => sum + (parseFloat(p.value) || 0), 0)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Projects</h2>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 2 }}>{projects.length} projects total</p>
        </div>
        {can('manage_projects') && (
          <button className="btn btn-primary" onClick={() => { setEditing(null); setShowModal(true) }}>
            <IconPlus size={14} /> New Project
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div className="stat-card"><div className="stat-label">Active</div><div className="stat-value green">{counts.active}</div></div>
        <div className="stat-card"><div className="stat-label">Tender</div><div className="stat-value">{counts.tender}</div></div>
        <div className="stat-card"><div className="stat-label">On Hold</div><div className="stat-value amber">{counts.on_hold}</div></div>
        <div className="stat-card"><div className="stat-label">Completed</div><div className="stat-value">{counts.completed}</div></div>
        <div className="stat-card" style={{ borderTop: '3px solid var(--green)', gridColumn: 'span 2' }}>
          <div className="stat-label">Active Projects Value</div>
          <div className="stat-value green" style={{ fontSize: 22 }}>{activeValue > 0 ? formatCurrency(activeValue) : '—'}</div>
          {tenderValue > 0 && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>+ {formatCurrency(tenderValue)} in tender</div>}
        </div>
      </div>

      <div className="filter-tabs">
        <div className={`filter-tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All ({projects.length})</div>
        {Object.entries(PROJECT_STATUSES).map(([k, v]) => (
          <div key={k} className={`filter-tab ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>
            {v.label} ({counts[k] || 0})
          </div>
        ))}
      </div>

      {loading ? <Spinner /> : filtered.length === 0 ? (
        <EmptyState icon="🏗️" title="No projects" message="Create your first project to start assigning subcontractors." action={can('manage_projects') && <button className="btn btn-primary" onClick={() => setShowModal(true)}><IconPlus size={14}/> New Project</button>} />
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
                <th>Value</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${p.id}`)}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{p.project_name}</div>
                    {p.project_ref && <div className="td-muted">{p.project_ref}</div>}
                  </td>
                  <td>{p.client_name || '—'}</td>
                  <td>{p.profiles?.full_name || '—'}</td>
                  <td className="td-muted">{formatDate(p.start_date)}</td>
                  <td className="td-muted">{formatDate(p.end_date)}</td>
                  <td className="td-muted">{calcDuration(p.start_date, p.end_date) || '—'}</td>
                  <td><Pill cls="pill-blue">{p.project_subcontractors?.length || 0} assigned</Pill></td>
                  <td>{formatCurrency(p.value)}</td>
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

      {showModal && <ProjectModal project={editing} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load() }} />}
    </div>
  )
}
