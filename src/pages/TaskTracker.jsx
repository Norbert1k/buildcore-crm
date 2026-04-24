import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { PROJECT_STATUSES, sortBy } from '../lib/utils'
import { Spinner, Pill, Modal, Field, IconPlus, ConfirmDialog } from '../components/ui'

const PRIORITIES = {
  high:   { label: 'High',   color: '#c00',   bg: '#fee', border: '#fcc' },
  medium: { label: 'Medium', color: '#b87a00', bg: '#fef4e0', border: '#fadfa0' },
  low:    { label: 'Low',    color: '#448a40', bg: '#e8f5e7', border: '#c4e3c1' },
}
const STATUS_LABELS = {
  active:      { label: 'Active',      cls: 'pill-blue' },
  working_on:  { label: 'Working On',  cls: 'pill-amber' },
  closed:      { label: 'Closed',      cls: 'pill-gray' },
}

export default function TaskTracker() {
  const navigate = useNavigate()
  const { can, profile } = useAuth()
  const [projects, setProjects] = useState([])
  const [tasks, setTasks] = useState([])
  const [assignees, setAssignees] = useState({})
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ project_id: '', title: '', description: '', priority: 'medium', assignee_ids: [] })
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [filterProject, setFilterProject] = useState('all')
  const [filterPriority, setFilterPriority] = useState('all')
  const [filterAssignee, setFilterAssignee] = useState('all')
  const [viewMode, setViewMode] = useState('open')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [projRes, taskRes, asgRes, usrRes] = await Promise.all([
        supabase.from('projects').select('id, project_name, project_ref, status').in('status', ['tender', 'active']).order('project_name'),
        supabase.from('tasks').select('*'),
        supabase.from('task_assignees').select('task_id, user_id, profiles(id, full_name)'),
        supabase.from('profiles').select('id, full_name, role').order('full_name'),
      ])
      if (projRes.error) console.error('[TaskTracker] projects:', projRes.error)
      if (taskRes.error) console.error('[TaskTracker] tasks:', taskRes.error)
      if (asgRes.error) console.error('[TaskTracker] assignees:', asgRes.error)
      if (usrRes.error) console.error('[TaskTracker] users:', usrRes.error)

      const map = {}
      for (const a of (asgRes.data || [])) {
        if (!map[a.task_id]) map[a.task_id] = []
        map[a.task_id].push({ user_id: a.user_id, full_name: a.profiles?.full_name || 'Unknown' })
      }
      setAssignees(map)
      setProjects(sortBy(projRes.data || [], 'project_name'))
      setTasks(taskRes.data || [])
      setUsers(sortBy(usrRes.data || [], 'full_name'))
    } catch (e) {
      console.error('[TaskTracker] load error:', e)
    }
    setLoading(false)
  }

  async function createTask() {
    if (!form.project_id || !form.title.trim()) { alert('Project and title are required'); return }
    setCreating(true)
    try {
      const { data: newTask, error } = await supabase.from('tasks').insert({
        project_id: form.project_id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        priority: form.priority,
        status: 'active',
        created_by: profile?.id,
      }).select().single()
      if (error) throw error

      if (form.assignee_ids.length > 0) {
        const rows = form.assignee_ids.map(uid => ({ task_id: newTask.id, user_id: uid }))
        const { error: ae } = await supabase.from('task_assignees').insert(rows)
        if (ae) console.error('[TaskTracker] assign error:', ae)
      }

      await supabase.from('task_activity').insert({
        task_id: newTask.id, actor_id: profile?.id, action: 'created',
        details: { title: form.title.trim(), priority: form.priority }
      })

      setShowCreate(false)
      setForm({ project_id: '', title: '', description: '', priority: 'medium', assignee_ids: [] })
      load()
    } catch (err) {
      console.error('[createTask]', err)
      alert('Create failed: ' + err.message)
    }
    setCreating(false)
  }

  async function deleteTask(taskId) {
    const { error } = await supabase.from('tasks').delete().eq('id', taskId)
    if (error) { alert('Delete failed: ' + error.message); return }
    setConfirmDelete(null)
    load()
  }

  async function claimTask(taskId) {
    const { error } = await supabase.from('task_assignees').insert({ task_id: taskId, user_id: profile?.id })
    if (error) { alert('Claim failed: ' + error.message); return }
    await supabase.from('task_activity').insert({
      task_id: taskId, actor_id: profile?.id, action: 'claimed',
    })
    load()
  }

  async function changeStatus(taskId, newStatus) {
    const updates = { status: newStatus }
    if (newStatus === 'closed') { updates.closed_at = new Date().toISOString(); updates.closed_by = profile?.id }
    else { updates.closed_at = null; updates.closed_by = null }
    const { error } = await supabase.from('tasks').update(updates).eq('id', taskId)
    if (error) { alert('Status change failed: ' + error.message); return }
    await supabase.from('task_activity').insert({
      task_id: taskId, actor_id: profile?.id, action: 'status_changed',
      details: { to: newStatus }
    })
    load()
  }

  const taskCountsByProject = {}
  for (const t of tasks) {
    if (!taskCountsByProject[t.project_id]) taskCountsByProject[t.project_id] = { open: 0, closed: 0, high: 0 }
    if (t.status === 'closed') taskCountsByProject[t.project_id].closed++
    else {
      taskCountsByProject[t.project_id].open++
      if (t.priority === 'high') taskCountsByProject[t.project_id].high++
    }
  }

  let displayed = tasks.filter(t => viewMode === 'open' ? t.status !== 'closed' : t.status === 'closed')
  if (filterProject !== 'all') displayed = displayed.filter(t => t.project_id === filterProject)
  if (filterPriority !== 'all') displayed = displayed.filter(t => t.priority === filterPriority)
  if (filterAssignee !== 'all') {
    if (filterAssignee === 'unassigned') displayed = displayed.filter(t => !(assignees[t.id]?.length))
    else if (filterAssignee === 'mine') displayed = displayed.filter(t => (assignees[t.id] || []).some(a => a.user_id === profile?.id))
    else displayed = displayed.filter(t => (assignees[t.id] || []).some(a => a.user_id === filterAssignee))
  }

  displayed = [...displayed].sort((a, b) => {
    const pa = a.priority === 'high' ? 0 : a.priority === 'medium' ? 1 : 2
    const pb = b.priority === 'high' ? 0 : b.priority === 'medium' ? 1 : 2
    if (pa !== pb) return pa - pb
    return new Date(b.created_at) - new Date(a.created_at)
  })

  const projectName = (pid) => projects.find(p => p.id === pid)?.project_name || '—'

  if (loading) return <Spinner />

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Task Tracker</h2>
          <p style={{ color: 'var(--text2)', fontSize: 13 }}>Track and manage in-house work across all projects</p>
        </div>
        {can('create_tasks') && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <IconPlus size={14} /> New Task
          </button>
        )}
      </div>

      {projects.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Projects</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
            {projects.map(p => {
              const c = taskCountsByProject[p.id] || { open: 0, closed: 0, high: 0 }
              const isFiltered = filterProject === p.id
              return (
                <div key={p.id} className="card card-pad"
                  onClick={() => setFilterProject(isFiltered ? 'all' : p.id)}
                  style={{ cursor: 'pointer', padding: 12, borderColor: isFiltered ? 'var(--accent)' : undefined, background: isFiltered ? 'var(--surface2)' : undefined }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Pill cls={PROJECT_STATUSES[p.status]?.cls || 'pill-gray'}>{PROJECT_STATUSES[p.status]?.label || p.status}</Pill>
                    {c.high > 0 && <span style={{ fontSize: 9, fontWeight: 700, background: '#fee', color: '#c00', borderRadius: 10, padding: '2px 6px' }}>{c.high} HIGH</span>}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{p.project_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    <strong style={{ color: 'var(--text)' }}>{c.open}</strong> open · {c.closed} closed
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="filter-tabs" style={{ marginBottom: 0 }}>
          <div className={`filter-tab ${viewMode === 'open' ? 'active' : ''}`} onClick={() => setViewMode('open')}>
            Active & Working On<span className="tab-badge">{tasks.filter(t => t.status !== 'closed').length}</span>
          </div>
          <div className={`filter-tab ${viewMode === 'closed' ? 'active' : ''}`} onClick={() => setViewMode('closed')}>
            Closed<span className="tab-badge">{tasks.filter(t => t.status === 'closed').length}</span>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {filterProject !== 'all' && (
            <button className="btn btn-sm" onClick={() => setFilterProject('all')}>Clear project filter ✕</button>
          )}
          <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} style={{ padding: '6px 10px', fontSize: 12 }}>
            <option value="all">All priorities</option>
            <option value="high">🔴 High</option>
            <option value="medium">🟡 Medium</option>
            <option value="low">🟢 Low</option>
          </select>
          <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} style={{ padding: '6px 10px', fontSize: 12 }}>
            <option value="all">Everyone</option>
            <option value="mine">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
            <option disabled>──────</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
      </div>

      {displayed.length === 0 ? (
        <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', padding: 40 }}>
          {viewMode === 'closed' ? 'No closed tasks.' : tasks.length === 0 ? 'No tasks yet. Create your first task to get started.' : 'No tasks match these filters.'}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th>Title</th>
                <th>Project</th>
                <th>Assigned</th>
                <th>Status</th>
                <th>Created</th>
                <th style={{ width: 180 }}></th>
              </tr>
            </thead>
            <tbody>
              {displayed.map(t => {
                const asg = assignees[t.id] || []
                const pri = PRIORITIES[t.priority] || PRIORITIES.medium
                const st = STATUS_LABELS[t.status] || STATUS_LABELS.active
                const isAssignee = asg.some(a => a.user_id === profile?.id)
                const canChangeStatus = isAssignee || profile?.role === 'admin'
                const canDelete = profile?.role === 'admin' || can('edit_tasks')
                return (
                  <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/tasks/${t.id}`)}>
                    <td onClick={e => e.stopPropagation()}>
                      <div title={pri.label + ' priority'}
                        style={{ width: 10, height: 10, borderRadius: '50%', background: pri.color, display: 'inline-block' }} />
                    </td>
                    <td style={{ fontWeight: 500 }}>{t.title}</td>
                    <td className="td-muted">{projectName(t.project_id)}</td>
                    <td>
                      {asg.length === 0 ? (
                        <span style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>Unassigned</span>
                      ) : (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {asg.map(a => <Pill key={a.user_id} cls="pill-blue">{a.full_name}</Pill>)}
                        </div>
                      )}
                    </td>
                    <td><Pill cls={st.cls}>{st.label}</Pill></td>
                    <td className="td-muted" style={{ fontSize: 11 }}>{new Date(t.created_at).toLocaleDateString('en-GB')}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        {t.status !== 'closed' && asg.length === 0 && (
                          <button className="btn btn-sm" onClick={() => claimTask(t.id)} title="Claim this task">Grab</button>
                        )}
                        {canChangeStatus && t.status === 'active' && (
                          <button className="btn btn-sm" onClick={() => changeStatus(t.id, 'working_on')} title="Mark as working on">Start</button>
                        )}
                        {canChangeStatus && t.status === 'working_on' && (
                          <button className="btn btn-sm" onClick={() => changeStatus(t.id, 'closed')} title="Close task">Close</button>
                        )}
                        {canChangeStatus && t.status === 'closed' && (
                          <button className="btn btn-sm" onClick={() => changeStatus(t.id, 'active')} title="Reopen">Reopen</button>
                        )}
                        {canDelete && (
                          <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(t.id)} title="Delete task">✕</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showCreate} onClose={() => !creating && setShowCreate(false)} title="New Task" size="sm"
        footer={<>
          <button className="btn" onClick={() => setShowCreate(false)} disabled={creating}>Cancel</button>
          <button className="btn btn-primary" onClick={createTask} disabled={creating || !form.title.trim() || !form.project_id}>
            {creating ? 'Creating...' : 'Create Task'}
          </button>
        </>}>
        <div className="form-grid">
          <div className="full"><Field label="Project *">
            <select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}>
              <option value="">Select a project…</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.project_name}{p.project_ref ? ` (${p.project_ref})` : ''}</option>)}
            </select>
          </Field></div>
          <div className="full"><Field label="Title *">
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Short task title" autoFocus />
          </Field></div>
          <div className="full"><Field label="Description">
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Details, links, context…" style={{ minHeight: 80 }} />
          </Field></div>
          <Field label="Priority">
            <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
              <option value="high">🔴 High</option>
              <option value="medium">🟡 Medium</option>
              <option value="low">🟢 Low</option>
            </select>
          </Field>
          <div className="full"><Field label="Assign to (optional)">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {users.map(u => {
                const selected = form.assignee_ids.includes(u.id)
                return (
                  <button key={u.id} type="button"
                    onClick={() => setForm(f => ({
                      ...f,
                      assignee_ids: selected ? f.assignee_ids.filter(id => id !== u.id) : [...f.assignee_ids, u.id]
                    }))}
                    style={{
                      padding: '4px 10px', fontSize: 11, borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
                      border: '1px solid ' + (selected ? 'var(--accent)' : 'var(--border)'),
                      background: selected ? 'var(--accent)' : 'var(--surface)',
                      color: selected ? 'white' : 'var(--text)'
                    }}>
                    {u.full_name}
                  </button>
                )
              })}
              {users.length === 0 && <span style={{ color: 'var(--text3)', fontSize: 11 }}>No team members loaded</span>}
            </div>
          </Field></div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => deleteTask(confirmDelete)}
        title="Delete task"
        message="Are you sure? This cannot be undone — notes and files will also be deleted."
        danger
      />
    </div>
  )
}
