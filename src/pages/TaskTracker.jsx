import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { PROJECT_STATUSES, sortBy } from '../lib/utils'
import { Spinner, Pill } from '../components/ui'

export default function TaskTracker() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const [projects, setProjects] = useState([])
  const [taskCounts, setTaskCounts] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    // Projects that aren't fully closed/archived — tender + active
    const { data: projs, error: pe } = await supabase
      .from('projects')
      .select('id, project_name, project_ref, status')
      .in('status', ['tender', 'active'])
      .order('project_name')
    if (pe) console.error('[TaskTracker] projects error:', pe)

    const { data: tasks, error: te } = await supabase
      .from('tasks')
      .select('id, project_id, status, priority')
    if (te) console.error('[TaskTracker] tasks error:', te)

    // Aggregate task counts per project
    const counts = {}
    for (const t of (tasks || [])) {
      if (!counts[t.project_id]) counts[t.project_id] = { total: 0, open: 0, high: 0 }
      counts[t.project_id].total++
      if (t.status !== 'closed') counts[t.project_id].open++
      if (t.priority === 'high' && t.status !== 'closed') counts[t.project_id].high++
    }
    setTaskCounts(counts)
    setProjects(sortBy(projs || [], 'project_name'))
    setLoading(false)
  }

  if (loading) return <Spinner />

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Task Tracker</h2>
          <p style={{ color: 'var(--text2)', fontSize: 13 }}>Track and manage in-house work across all projects</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/tasks/all')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4 }}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          View All Active Tasks
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)' }}>
          No active or tender projects. Create a project first, then come back here to add tasks.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {projects.map(p => {
            const c = taskCounts[p.id] || { total: 0, open: 0, high: 0 }
            return (
              <div key={p.id} className="card card-pad"
                onClick={() => navigate(`/tasks/project/${p.id}`)}
                style={{ cursor: 'pointer', transition: 'all 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = ''}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Pill cls={PROJECT_STATUSES[p.status]?.cls || 'pill-gray'}>{PROJECT_STATUSES[p.status]?.label || p.status}</Pill>
                  {c.high > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: '#fee', color: '#c00', border: '1px solid #fcc', borderRadius: 10, padding: '2px 8px' }}>
                      {c.high} HIGH
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{p.project_name}</div>
                {p.project_ref && <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>{p.project_ref}</div>}
                <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text2)', paddingTop: 8, borderTop: '0.5px solid var(--border)' }}>
                  <span><strong style={{ color: 'var(--text)' }}>{c.open}</strong> open</span>
                  <span><strong style={{ color: 'var(--text3)' }}>{c.total - c.open}</strong> closed</span>
                  <span style={{ marginLeft: 'auto', color: 'var(--text3)' }}>{c.total} total</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!can('create_tasks') && (
        <div style={{ marginTop: 20, padding: 12, background: 'var(--surface2)', borderRadius: 6, fontSize: 12, color: 'var(--text3)' }}>
          You have view-only access. Contact a Project or Operations Manager to create tasks.
        </div>
      )}
    </div>
  )
}
