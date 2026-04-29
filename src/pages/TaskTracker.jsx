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
  active:      { label: 'Active',      cls: 'pill-green' },
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
  const [form, setForm] = useState({ project_id: '', title: '', description: '', priority: 'medium', partner_id: '' })
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
        supabase.from('projects').select('id, project_name, project_ref, status').in('status', ['tender', 'active']).order('project_ref'),
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
      setProjects(sortBy(projRes.data || [], 'project_ref'))
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

      // Always assign the creator, plus optional partner
      const assigneeIds = [profile?.id]
      if (form.partner_id && form.partner_id !== profile?.id) assigneeIds.push(form.partner_id)
      const rows = assigneeIds.filter(Boolean).map(uid => ({ task_id: newTask.id, user_id: uid }))
      if (rows.length) {
        const { error: ae } = await supabase.from('task_assignees').insert(rows)
        if (ae) console.error('[TaskTracker] assign error:', ae)
      }

      await supabase.from('task_activity').insert({
        task_id: newTask.id, actor_id: profile?.id, action: 'created',
        details: { title: form.title.trim(), priority: form.priority }
      })

      setShowCreate(false)
      setForm({ project_id: '', title: '', description: '', priority: 'medium', partner_id: '' })
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

  // Export tasks as PDF — landscape, CCG letterhead.
  // mode: 'list' = single table; 'detailed' = per-task sections with notes/comments.
  async function exportTasksPDF(mode) {
    console.log('[exportTasksPDF]', mode, 'items:', displayed.length)
    try {
      // Load jsPDF + autoTable from CDN (reuse same deps as Project Directory export)
      const loadScript = (src) => new Promise((resolve, reject) => {
        const s = document.createElement('script'); s.src = src
        s.onload = resolve; s.onerror = () => reject(new Error('Failed to load ' + src))
        document.head.appendChild(s)
      })
      if (!window.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
      if (!window.jspdf?.jsPDF?.API?.autoTable) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js')
      const { jsPDF } = window.jspdf

      // Load logo
      let logoDataUrl = null
      try {
        const resp = await fetch('/cltd-logo.jpg')
        if (resp.ok) {
          const blob = await resp.blob()
          logoDataUrl = await new Promise(res => {
            const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(blob)
          })
        }
      } catch (e) { console.warn('[exportTasksPDF] logo failed', e) }

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const pageW = doc.internal.pageSize.getWidth()
      const pageH = doc.internal.pageSize.getHeight()

      const drawLetterhead = () => {
        if (logoDataUrl) {
          try {
            const p = doc.getImageProperties(logoDataUrl)
            const h = 28
            const w = (p.width / p.height) * h
            doc.addImage(logoDataUrl, 'JPEG', pageW - 12 - w, 8, w, h)
          } catch (e) {}
        }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(45, 45, 45)
        doc.text('City Construction Group', 15, 16)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90)
        doc.text('One Canada Square, Canary Wharf, London E14 5AA', 15, 22)
        doc.text('T: 0203 948 1930   E: info@cltd.co.uk   W: www.cltd.co.uk', 15, 26)
        doc.setDrawColor(207, 207, 207); doc.setLineWidth(0.2)
        doc.line(15, 40, pageW - 15, 40)
      }

      drawLetterhead()
      const title = mode === 'list' ? 'Task List' : 'Detailed Task Report'
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(45, 45, 45)
      doc.text(title, 15, 50)
      // Filters summary
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100, 100, 100)
      const summary = []
      if (filterProject !== 'all') { const p = projects.find(pr => pr.id === filterProject); if (p) summary.push(`Project: ${p.project_name}`) }
      if (filterPriority !== 'all') summary.push(`Priority: ${filterPriority}`)
      if (filterAssignee !== 'all') {
        if (filterAssignee === 'mine') summary.push('Assigned to me')
        else if (filterAssignee === 'unassigned') summary.push('Unassigned')
        else { const u = users.find(us => us.id === filterAssignee); if (u) summary.push(`Assignee: ${u.full_name}`) }
      }
      summary.push(`Status: ${viewMode === 'open' ? 'Open' : 'Closed'}`)
      summary.push(`Generated: ${new Date().toLocaleString('en-GB')}`)
      doc.text(summary.join(' · '), 15, 55)

      if (displayed.length === 0) {
        doc.setFont('helvetica', 'italic'); doc.setTextColor(150, 150, 150)
        doc.text('No tasks matched the current filters.', pageW / 2, 80, { align: 'center' })
      } else if (mode === 'list') {
        // LIST MODE — single table
        const body = displayed.map(t => {
          const asg = assignees[t.id] || []
          const p = projects.find(pr => pr.id === t.project_id)
          return [
            (PRIORITIES[t.priority]?.label || t.priority || '').toUpperCase(),
            t.title,
            p ? (p.project_ref ? `${p.project_ref} — ${p.project_name}` : p.project_name) : '—',
            asg.length === 0 ? 'Unassigned' : asg.map(a => a.full_name).join(', '),
            (STATUS_LABELS[t.status]?.label || t.status),
            new Date(t.created_at).toLocaleDateString('en-GB'),
          ]
        })
        doc.autoTable({
          startY: 62,
          head: [['Priority', 'Title', 'Project', 'Assigned', 'Status', 'Created']],
          body,
          theme: 'plain',
          styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 3.5, textColor: [45, 45, 45], lineWidth: 0, overflow: 'linebreak' },
          headStyles: { fillColor: [45, 45, 45], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10, cellPadding: { top: 2, bottom: 2, left: 4, right: 4 }, minCellHeight: 7 },
          alternateRowStyles: { fillColor: [249, 249, 249] },
          columnStyles: {
            0: { cellWidth: 22, fontStyle: 'bold' },
            1: { cellWidth: 70 },
            2: { cellWidth: 65 },
            3: { cellWidth: 55 },
            4: { cellWidth: 28 },
            5: { cellWidth: 'auto' },
          },
          didParseCell: (data) => {
            // Colour the priority cell
            if (data.section === 'body' && data.column.index === 0) {
              const v = data.cell.raw
              if (v === 'HIGH')   { data.cell.styles.textColor = [204, 0, 0] }
              if (v === 'MEDIUM') { data.cell.styles.textColor = [184, 122, 0] }
              if (v === 'LOW')    { data.cell.styles.textColor = [68, 138, 64] }
            }
          },
          margin: { left: 15, right: 15, top: 46 },
          didDrawPage: (data) => { if (data.pageNumber > 1) drawLetterhead() },
        })
      } else {
        // DETAILED MODE — per-task section with description + notes
        // Fetch notes for all displayed tasks in one query
        const taskIds = displayed.map(t => t.id)
        let allNotes = []
        if (taskIds.length) {
          const { data: n } = await supabase.from('task_notes').select('*, profiles(full_name)').in('task_id', taskIds).order('created_at', { ascending: true })
          allNotes = n || []
        }
        const notesByTask = {}
        for (const n of allNotes) { if (!notesByTask[n.task_id]) notesByTask[n.task_id] = []; notesByTask[n.task_id].push(n) }

        let cursorY = 62
        const sectionSpacing = 6
        const bottomLimit = pageH - 20

        for (let i = 0; i < displayed.length; i++) {
          const t = displayed[i]
          const asg = assignees[t.id] || []
          const p = projects.find(pr => pr.id === t.project_id)
          const pri = PRIORITIES[t.priority] || PRIORITIES.medium
          const st = STATUS_LABELS[t.status] || STATUS_LABELS.active
          const tNotes = notesByTask[t.id] || []

          // Estimate section height
          const estBaseH = 38 + (t.description ? 20 : 0)
          const estNotesH = tNotes.length * 16 + (tNotes.length ? 12 : 0)
          const estH = estBaseH + estNotesH + sectionSpacing + 10

          if (cursorY + 30 > bottomLimit) { doc.addPage(); drawLetterhead(); cursorY = 46 }

          // Divider line above each section except the first on its page
          if (i > 0 && cursorY > 50) {
            doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.2)
            doc.line(15, cursorY, pageW - 15, cursorY)
            cursorY += 6
          }

          // Priority pill + title
          const priRGB = t.priority === 'high' ? [204, 0, 0] : t.priority === 'medium' ? [184, 122, 0] : [68, 138, 64]
          doc.setFillColor(...priRGB); doc.roundedRect(15, cursorY - 4, 16, 6, 1, 1, 'F')
          doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255)
          doc.text(pri.label.toUpperCase(), 23, cursorY + 0.2, { align: 'center' })

          doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(45, 45, 45)
          const titleLines = doc.splitTextToSize(t.title, pageW - 60)
          doc.text(titleLines, 34, cursorY + 1)
          cursorY += Math.max(5, titleLines.length * 4.5)

          // Metadata row
          doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100, 100, 100)
          const meta = [
            `Status: ${st.label}`,
            `Project: ${p ? (p.project_ref ? p.project_ref + ' — ' + p.project_name : p.project_name) : '—'}`,
            `Assigned: ${asg.length ? asg.map(a => a.full_name).join(', ') : 'Unassigned'}`,
            `Created: ${new Date(t.created_at).toLocaleDateString('en-GB')}`,
          ]
          doc.text(meta.join('   |   '), 15, cursorY + 4)
          cursorY += 10

          // Description
          if (t.description && t.description.trim()) {
            doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(80, 80, 80)
            doc.text('Description:', 15, cursorY)
            cursorY += 4
            doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(45, 45, 45)
            const descLines = doc.splitTextToSize(t.description, pageW - 30)
            if (cursorY + descLines.length * 4 > bottomLimit) { doc.addPage(); drawLetterhead(); cursorY = 46 }
            doc.text(descLines, 15, cursorY)
            cursorY += descLines.length * 4 + 4
          }

          // Notes / comments
          if (tNotes.length > 0) {
            doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(80, 80, 80)
            if (cursorY + 8 > bottomLimit) { doc.addPage(); drawLetterhead(); cursorY = 46 }
            doc.text(`Progress Notes (${tNotes.length}):`, 15, cursorY)
            cursorY += 5
            for (const n of tNotes) {
              const header = `${n.profiles?.full_name || 'Unknown'} — ${new Date(n.created_at).toLocaleString('en-GB')}`
              const noteLines = doc.splitTextToSize(n.note || '', pageW - 40)
              const block = 4 + noteLines.length * 4 + 2
              if (cursorY + block > bottomLimit) { doc.addPage(); drawLetterhead(); cursorY = 46 }
              // Left border accent
              doc.setFillColor(68, 138, 64)
              doc.rect(15, cursorY - 2.5, 1, block - 1, 'F')
              doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(80, 80, 80)
              doc.text(header, 19, cursorY)
              cursorY += 3.5
              doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(45, 45, 45)
              doc.text(noteLines, 19, cursorY)
              cursorY += noteLines.length * 4 + 3
            }
          } else {
            doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(150, 150, 150)
            doc.text('No progress notes yet.', 15, cursorY)
            cursorY += 5
          }

          cursorY += sectionSpacing
        }
      }

      // Footer on every page
      const pageCount = doc.internal.getNumberOfPages()
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(160, 160, 160)
        doc.text('City Construction Group', pageW / 2, pageH - 8, { align: 'center' })
        doc.text(`Page ${i} of ${pageCount}`, pageW - 15, pageH - 8, { align: 'right' })
      }

      const filename = `Tasks - ${title} - ${new Date().toISOString().slice(0, 10)}.pdf`
      doc.save(filename)
      console.log('[exportTasksPDF] saved:', filename)
    } catch (err) {
      console.error('[exportTasksPDF] error:', err)
      alert('PDF export failed: ' + (err?.message || err))
    }
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

  const projectDisplay = (pid) => {
    const p = projects.find(p => p.id === pid)
    if (!p) return { ref: '', name: '—' }
    return { ref: p.project_ref || '', name: p.project_name || '—' }
  }

  if (loading) return <Spinner />

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Task Tracker</h2>
          <p style={{ color: 'var(--text2)', fontSize: 13 }}>Track and manage in-house work across all projects</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tasks.length > 0 && (
            <>
              <button className="btn btn-sm" onClick={() => exportTasksPDF('list')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Export Tasks List
              </button>
              <button className="btn btn-sm" onClick={() => exportTasksPDF('detailed')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Export Detailed Tasks
              </button>
            </>
          )}
          {can('create_tasks') && (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <IconPlus size={14} /> New Task
            </button>
          )}
        </div>
      </div>

      {projects.length > 0 && (() => {
        const activeProjs = projects.filter(p => p.status === 'active')
        const tenderProjs = projects.filter(p => p.status === 'tender')

        const renderCard = (p) => {
          const c = taskCountsByProject[p.id] || { open: 0, closed: 0, high: 0 }
          const isFiltered = filterProject === p.id
          return (
            <div key={p.id} className="card card-pad"
              onClick={() => setFilterProject(isFiltered ? 'all' : p.id)}
              style={{ cursor: 'pointer', padding: 12, borderColor: isFiltered ? 'var(--accent)' : undefined, background: isFiltered ? 'var(--surface2)' : undefined }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                {p.project_ref && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: '0.03em' }}>{p.project_ref}</span>}
                {c.high > 0 && <span style={{ fontSize: 9, fontWeight: 700, background: '#fee', color: '#c00', borderRadius: 10, padding: '2px 6px', marginLeft: 'auto' }}>{c.high} HIGH</span>}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, lineHeight: 1.3 }}>{p.project_name}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                <strong style={{ color: 'var(--text)' }}>{c.open}</strong> open · {c.closed} closed
              </div>
            </div>
          )
        }

        return (
          <div style={{ marginBottom: 24 }}>
            {activeProjs.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#448a40' }} />
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Active Projects ({activeProjs.length})
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                  {activeProjs.map(renderCard)}
                </div>
              </div>
            )}
            {tenderProjs.length > 0 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#7960c7' }} />
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Tender Projects ({tenderProjs.length})
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                  {tenderProjs.map(renderCard)}
                </div>
              </div>
            )}
          </div>
        )
      })()}

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
                <th style={{ width: 90 }}>Priority</th>
                <th>Title</th>
                <th>Project</th>
                <th>Assigned</th>
                <th>Status</th>
                <th>Created</th>
                <th style={{ width: 200 }}></th>
              </tr>
            </thead>
            <tbody>
              {displayed.map(t => {
                const asg = assignees[t.id] || []
                const pri = PRIORITIES[t.priority] || PRIORITIES.medium
                const st = STATUS_LABELS[t.status] || STATUS_LABELS.active
                const isAssignee = asg.some(a => a.user_id === profile?.id)
                const canChangeStatus = isAssignee || profile?.role === 'admin'
                const canDelete = profile?.role === 'admin' || (isAssignee && can('edit_tasks'))
                return (
                  <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/tasks/${t.id}`)}>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 10, background: pri.bg, border: '1px solid ' + pri.border }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: pri.color }} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: pri.color }}>{pri.label}</span>
                      </div>
                    </td>
                    <td style={{ fontWeight: 500 }}>{t.title}</td>
                    <td className="td-muted">
                      {(() => { const { ref, name } = projectDisplay(t.project_id); return (
                        <>
                          {ref && <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', letterSpacing: '0.03em' }}>{ref}</div>}
                          <div>{name}</div>
                        </>
                      ) })()}
                    </td>
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
          <Field label="You (auto-assigned)">
            <input value={profile?.full_name || 'You'} disabled readOnly style={{ opacity: 0.7, cursor: 'not-allowed' }} />
          </Field>
          <Field label="Partner (optional)">
            <select value={form.partner_id} onChange={e => setForm(f => ({ ...f, partner_id: e.target.value }))}>
              <option value="">— None —</option>
              {users.filter(u => u.id !== profile?.id).map(u => (
                <option key={u.id} value={u.id}>{u.full_name}</option>
              ))}
            </select>
          </Field>
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
