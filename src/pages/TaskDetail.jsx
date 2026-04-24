import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { sortBy, formatDate } from '../lib/utils'
import { Spinner, Pill, Modal, Field, IconChevron, IconEdit, IconTrash, ConfirmDialog } from '../components/ui'

const PRIORITIES = {
  high:   { label: 'High',   color: '#c00' },
  medium: { label: 'Medium', color: '#b87a00' },
  low:    { label: 'Low',    color: '#448a40' },
}
const STATUS_LABELS = {
  active:      { label: 'Active',      cls: 'pill-green' },
  working_on:  { label: 'Working On',  cls: 'pill-amber' },
  closed:      { label: 'Closed',      cls: 'pill-gray' },
}

export default function TaskDetail() {
  const { taskId } = useParams()
  const navigate = useNavigate()
  const { can, profile } = useAuth()

  const [task, setTask] = useState(null)
  const [project, setProject] = useState(null)
  const [assignees, setAssignees] = useState([])
  const [notes, setNotes] = useState([])
  const [files, setFiles] = useState([])
  const [activity, setActivity] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [loading, setLoading] = useState(true)

  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [selectedAssignees, setSelectedAssignees] = useState(new Set())
  const [savingAssign, setSavingAssign] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [emlPreview, setEmlPreview] = useState(null)

  useEffect(() => { load() }, [taskId])

  async function load() {
    setLoading(true)
    try {
      const [taskRes, asgRes, notesRes, filesRes, actRes, usersRes] = await Promise.all([
        supabase.from('tasks').select('*').eq('id', taskId).single(),
        supabase.from('task_assignees').select('user_id, assigned_at, profiles(id, full_name, role)').eq('task_id', taskId),
        supabase.from('task_notes').select('*, profiles(id, full_name)').eq('task_id', taskId).order('created_at', { ascending: false }),
        supabase.from('task_files').select('*, profiles(id, full_name)').eq('task_id', taskId).order('uploaded_at', { ascending: false }),
        supabase.from('task_activity').select('*, profiles(id, full_name)').eq('task_id', taskId).order('created_at', { ascending: false }),
        supabase.from('profiles').select('id, full_name, role').order('full_name'),
      ])
      if (taskRes.error) { console.error('[TaskDetail] task error:', taskRes.error); setLoading(false); return }

      setTask(taskRes.data)
      setAssignees(asgRes.data || [])
      setNotes(notesRes.data || [])
      setFiles(filesRes.data || [])
      setActivity(actRes.data || [])
      setAllUsers(sortBy(usersRes.data || [], 'full_name'))

      if (taskRes.data?.project_id) {
        const { data: proj } = await supabase.from('projects').select('id, project_name, project_ref, status').eq('id', taskRes.data.project_id).single()
        setProject(proj)
      }
    } catch (e) {
      console.error('[TaskDetail] load error:', e)
    }
    setLoading(false)
  }

  const isAssignee = assignees.some(a => a.user_id === profile?.id)
  const isAdmin = profile?.role === 'admin'
  // All task actions require being an assignee (or admin)
  const canEditTask = isAssignee || isAdmin
  const canChangeStatus = isAssignee || isAdmin
  const canComment = isAssignee || isAdmin
  const canUpload = isAssignee || isAdmin
  const canDeleteNote = (note) => note.author_id === profile?.id || isAdmin
  const canDeleteFile = (file) => file.uploaded_by === profile?.id || isAdmin

  async function addNote() {
    if (!noteText.trim()) return
    setSavingNote(true)
    const { error } = await supabase.from('task_notes').insert({
      task_id: taskId, author_id: profile?.id, note: noteText.trim(),
    })
    if (error) { alert('Note failed: ' + error.message); setSavingNote(false); return }
    setNoteText('')
    await load()
    setSavingNote(false)
  }

  async function deleteNote(noteId) {
    if (!window.confirm('Delete this note?')) return
    await supabase.from('task_notes').delete().eq('id', noteId)
    load()
  }

  async function uploadFiles(fileList) {
    if (!fileList || fileList.length === 0) return
    setUploading(true)
    const errors = []
    for (const f of Array.from(fileList)) {
      const ext = f.name.split('.').pop()
      const path = `${taskId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: upErr } = await supabase.storage.from('task-files').upload(path, f, { upsert: false })
      if (upErr) { errors.push(`${f.name}: ${upErr.message}`); continue }
      const { error: dbErr } = await supabase.from('task_files').insert({
        task_id: taskId, file_name: f.name, storage_path: path, file_size: f.size,
        mime_type: f.type || null, uploaded_by: profile?.id,
      })
      if (dbErr) { errors.push(`${f.name}: ${dbErr.message}`); continue }
      await supabase.from('task_activity').insert({
        task_id: taskId, actor_id: profile?.id, action: 'file_uploaded',
        details: { file_name: f.name },
      })
    }
    if (errors.length) alert('Some uploads failed:\n' + errors.join('\n'))
    setUploading(false)
    load()
  }

  async function deleteFile(file) {
    if (!window.confirm(`Delete ${file.file_name}?`)) return
    await supabase.storage.from('task-files').remove([file.storage_path])
    await supabase.from('task_files').delete().eq('id', file.id)
    load()
  }

  async function downloadFile(file) {
    const { data } = await supabase.storage.from('task-files').createSignedUrl(file.storage_path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function previewFile(file) {
    const isEml = file.file_name.toLowerCase().endsWith('.eml')
    if (isEml) {
      // Download the EML content and parse it
      const { data: urlData } = await supabase.storage.from('task-files').createSignedUrl(file.storage_path, 60)
      if (!urlData?.signedUrl) { alert('Could not load email'); return }
      try {
        const resp = await fetch(urlData.signedUrl)
        const text = await resp.text()
        setEmlPreview({ file, parsed: parseEml(text) })
      } catch (e) {
        alert('Email parse failed: ' + e.message)
      }
    } else {
      downloadFile(file)
    }
  }

  async function changeStatus(newStatus) {
    const updates = { status: newStatus }
    if (newStatus === 'closed') { updates.closed_at = new Date().toISOString(); updates.closed_by = profile?.id }
    else { updates.closed_at = null; updates.closed_by = null }
    await supabase.from('tasks').update(updates).eq('id', taskId)
    await supabase.from('task_activity').insert({
      task_id: taskId, actor_id: profile?.id, action: 'status_changed', details: { to: newStatus }
    })
    load()
  }

  async function claimTask() {
    await supabase.from('task_assignees').insert({ task_id: taskId, user_id: profile?.id })
    await supabase.from('task_activity').insert({ task_id: taskId, actor_id: profile?.id, action: 'claimed' })
    load()
  }

  async function unassignSelf() {
    await supabase.from('task_assignees').delete().eq('task_id', taskId).eq('user_id', profile?.id)
    await supabase.from('task_activity').insert({ task_id: taskId, actor_id: profile?.id, action: 'unassigned' })
    load()
  }

  async function saveEdit() {
    const { error } = await supabase.from('tasks').update({
      title: editForm.title?.trim(),
      description: editForm.description?.trim() || null,
      priority: editForm.priority,
    }).eq('id', taskId)
    if (error) { alert('Save failed: ' + error.message); return }
    setShowEdit(false)
    load()
  }

  async function deleteTask() {
    const { error } = await supabase.from('tasks').delete().eq('id', taskId)
    if (error) { alert('Delete failed: ' + error.message); return }
    navigate('/tasks')
  }

  function openAssignModal() {
    setSelectedAssignees(new Set(assignees.map(a => a.user_id)))
    setShowAssignModal(true)
  }

  async function saveAssignees() {
    setSavingAssign(true)
    const current = new Set(assignees.map(a => a.user_id))
    const next = selectedAssignees
    // Add new
    const toAdd = [...next].filter(id => !current.has(id))
    if (toAdd.length) {
      const rows = toAdd.map(uid => ({ task_id: taskId, user_id: uid }))
      await supabase.from('task_assignees').insert(rows)
      for (const uid of toAdd) {
        const user = allUsers.find(u => u.id === uid)
        await supabase.from('task_activity').insert({
          task_id: taskId, actor_id: profile?.id, action: 'assigned',
          details: { user_id: uid, user_name: user?.full_name },
        })
      }
    }
    // Remove gone
    const toRemove = [...current].filter(id => !next.has(id))
    for (const uid of toRemove) {
      await supabase.from('task_assignees').delete().eq('task_id', taskId).eq('user_id', uid)
      const user = allUsers.find(u => u.id === uid)
      await supabase.from('task_activity').insert({
        task_id: taskId, actor_id: profile?.id, action: 'unassigned',
        details: { user_id: uid, user_name: user?.full_name },
      })
    }
    setShowAssignModal(false)
    setSavingAssign(false)
    load()
  }

  if (loading) return <Spinner />
  if (!task) return (
    <div>
      <button className="btn btn-sm" style={{ marginBottom: 16 }} onClick={() => navigate('/tasks')}><IconChevron size={13} dir="left" /> Back</button>
      <div className="card card-pad">Task not found.</div>
    </div>
  )

  const pri = PRIORITIES[task.priority] || PRIORITIES.medium
  const st = STATUS_LABELS[task.status] || STATUS_LABELS.active

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <button className="btn btn-sm" style={{ marginBottom: 16 }} onClick={() => navigate('/tasks')}><IconChevron size={13} dir="left" /> Back to Task Tracker</button>

      {/* Header */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div style={{ width: 14, height: 14, borderRadius: '50%', background: pri.color, flexShrink: 0, marginTop: 5 }} title={pri.label + ' priority'} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 6, lineHeight: 1.3 }}>{task.title}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--text3)' }}>
              <Pill cls={st.cls}>{st.label}</Pill>
              <span>Priority: <strong style={{ color: pri.color }}>{pri.label}</strong></span>
              <span>•</span>
              <span>Created {formatDate(task.created_at)}</span>
              <span>•</span>
              <span>Updated {formatDate(task.updated_at)}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 0 }}>
            {canChangeStatus && task.status === 'active' && <button className="btn btn-sm" onClick={() => changeStatus('working_on')}>Start</button>}
            {canChangeStatus && task.status === 'working_on' && <button className="btn btn-sm" onClick={() => changeStatus('closed')}>Close</button>}
            {canChangeStatus && task.status === 'closed' && <button className="btn btn-sm" onClick={() => changeStatus('active')}>Reopen</button>}
            {canEditTask && (
              <button className="btn btn-sm" onClick={() => { setEditForm({ title: task.title, description: task.description || '', priority: task.priority }); setShowEdit(true) }}>
                <IconEdit size={13} /> Edit
              </button>
            )}
            {canEditTask && (
              <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(true)}><IconTrash size={13} /></button>
            )}
          </div>
        </div>

        {project && (
          <div style={{ fontSize: 12, color: 'var(--text2)', paddingTop: 10, borderTop: '0.5px solid var(--border)' }}>
            <strong style={{ color: 'var(--text3)' }}>Project:</strong>{' '}
            <Link to={`/projects/${project.id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>
              {project.project_ref ? `${project.project_ref} — ` : ''}{project.project_name}
            </Link>
          </div>
        )}

        {task.description && (
          <div style={{ marginTop: 12, padding: 12, background: 'var(--surface2)', borderRadius: 6, fontSize: 13, color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {task.description}
          </div>
        )}
      </div>

      {/* Assignees card */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Assigned to</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {!isAssignee && task.status !== 'closed' && (
              <button className="btn btn-sm" onClick={claimTask}>Claim</button>
            )}
            {isAssignee && (
              <button className="btn btn-sm" onClick={unassignSelf}>Unassign me</button>
            )}
            {canEditTask && (
              <button className="btn btn-sm" onClick={openAssignModal}>Manage…</button>
            )}
          </div>
        </div>
        {assignees.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>Unassigned — anyone can claim this task.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {assignees.map(a => <Pill key={a.user_id} cls="pill-blue">{a.profiles?.full_name || 'Unknown'}</Pill>)}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Progress Notes</div>
        {canComment ? (
          <div style={{ marginBottom: 12 }}>
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)}
              placeholder="Add a progress update, question, or status note…"
              style={{ width: '100%', minHeight: 70, fontSize: 13, padding: 10, fontFamily: 'inherit' }}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addNote() }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>Ctrl/Cmd + Enter to post</div>
              <button className="btn btn-sm btn-primary" onClick={addNote} disabled={savingNote || !noteText.trim()}>
                {savingNote ? 'Posting…' : 'Post Note'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 12, padding: 10, background: 'var(--surface2)', borderRadius: 6, fontSize: 11, color: 'var(--text3)', textAlign: 'center', fontStyle: 'italic' }}>
            Only assigned team members can post notes. Claim this task to contribute.
          </div>
        )}
        {notes.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', textAlign: 'center', padding: 16 }}>No notes yet. Be the first to post an update.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {notes.map(n => (
              <div key={n.id} style={{ padding: 10, background: 'var(--surface2)', borderRadius: 6, borderLeft: '3px solid var(--accent)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>{n.profiles?.full_name || 'Unknown'}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 10, color: 'var(--text3)' }}>{new Date(n.created_at).toLocaleString('en-GB')}</div>
                    {canDeleteNote(n) && (
                      <button onClick={() => deleteNote(n.id)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 11, padding: 0 }} title="Delete note">✕</button>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{n.note}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Files */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Files & Emails</div>
          {canUpload && (
            <label className="btn btn-sm btn-primary" style={{ cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
              {uploading ? 'Uploading…' : '+ Upload'}
              <input type="file" multiple onChange={e => { uploadFiles(e.target.files); e.target.value = '' }} disabled={uploading} style={{ display: 'none' }} />
            </label>
          )}
        </div>
        {!canUpload && files.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center', padding: 16, fontStyle: 'italic' }}>
            Only assigned team members can upload files.
          </div>
        )}
        {files.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', textAlign: 'center', padding: 16 }}>
            No files uploaded. Drag and drop, or click Upload. Supports any file type including .eml emails.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {files.map(f => {
              const isEml = f.file_name.toLowerCase().endsWith('.eml')
              return (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, background: 'var(--surface2)', borderRadius: 6 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 4, background: isEml ? '#e3f2fd' : 'var(--surface)', color: isEml ? '#1565c0' : 'var(--text3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
                    {isEml ? '✉' : '📄'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                      {fmtBytes(f.file_size)} • {f.profiles?.full_name || 'Unknown'} • {new Date(f.uploaded_at).toLocaleDateString('en-GB')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {isEml && <button className="btn btn-sm" onClick={() => previewFile(f)} title="Read email">Open</button>}
                    <button className="btn btn-sm" onClick={() => downloadFile(f)} title="Download">⬇</button>
                    {canDeleteFile(f) && (
                      <button className="btn btn-sm btn-danger" onClick={() => deleteFile(f)} title="Delete">✕</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Activity log */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Activity</div>
        {activity.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', textAlign: 'center', padding: 16 }}>No activity yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activity.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, padding: '4px 0' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text3)', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <strong style={{ color: 'var(--text)' }}>{a.profiles?.full_name || 'Someone'}</strong>{' '}
                  <span style={{ color: 'var(--text2)' }}>{formatActivityAction(a)}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>{new Date(a.created_at).toLocaleString('en-GB')}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit modal */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit Task" size="sm"
        footer={<>
          <button className="btn" onClick={() => setShowEdit(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveEdit} disabled={!editForm.title?.trim()}>Save</button>
        </>}>
        <div className="form-grid">
          <div className="full"><Field label="Title *"><input value={editForm.title || ''} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} autoFocus /></Field></div>
          <div className="full"><Field label="Description"><textarea value={editForm.description || ''} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} style={{ minHeight: 80 }} /></Field></div>
          <Field label="Priority"><select value={editForm.priority || 'medium'} onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))}>
            <option value="high">🔴 High</option>
            <option value="medium">🟡 Medium</option>
            <option value="low">🟢 Low</option>
          </select></Field>
        </div>
      </Modal>

      {/* Assignees modal */}
      <Modal open={showAssignModal} onClose={() => !savingAssign && setShowAssignModal(false)} title="Manage Assignees" size="sm"
        footer={<>
          <button className="btn" onClick={() => setShowAssignModal(false)} disabled={savingAssign}>Cancel</button>
          <button className="btn btn-primary" onClick={saveAssignees} disabled={savingAssign}>{savingAssign ? 'Saving…' : 'Save'}</button>
        </>}>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>Click to toggle assignees. Multiple people can be assigned.</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {allUsers.map(u => {
            const sel = selectedAssignees.has(u.id)
            return (
              <button key={u.id} type="button"
                onClick={() => {
                  setSelectedAssignees(prev => {
                    const n = new Set(prev)
                    if (n.has(u.id)) n.delete(u.id); else n.add(u.id)
                    return n
                  })
                }}
                style={{
                  padding: '5px 12px', fontSize: 12, borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
                  border: '1px solid ' + (sel ? 'var(--accent)' : 'var(--border)'),
                  background: sel ? 'var(--accent)' : 'var(--surface)',
                  color: sel ? 'white' : 'var(--text)'
                }}>
                {u.full_name}
              </button>
            )
          })}
        </div>
      </Modal>

      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={deleteTask} title="Delete task" message="Permanently delete this task along with all its notes, files, and activity log?" danger />

      {/* EML preview overlay */}
      {emlPreview && <EmlViewer file={emlPreview.file} parsed={emlPreview.parsed} onClose={() => setEmlPreview(null)} />}
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────
function fmtBytes(b) {
  if (!b) return ''
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  return (b / 1024 / 1024).toFixed(1) + ' MB'
}

function formatActivityAction(a) {
  const d = a.details || {}
  switch (a.action) {
    case 'created': return `created this task (${d.priority || ''} priority)`
    case 'status_changed': return `changed status to ${(d.to || '').replace('_', ' ')}`
    case 'assigned': return `assigned ${d.user_name || 'someone'}`
    case 'unassigned': return `removed ${d.user_name || 'someone'}`
    case 'claimed': return 'claimed this task'
    case 'file_uploaded': return `uploaded ${d.file_name || 'a file'}`
    default: return a.action
  }
}

// Simple RFC 822 email parser — handles plain text and quoted-printable.
// For complex multipart MIME with base64 attachments, we still show the raw headers + text part.
function parseEml(text) {
  const headerEnd = text.search(/\r?\n\r?\n/)
  if (headerEnd < 0) return { headers: {}, body: text }
  const headerText = text.slice(0, headerEnd)
  const body = text.slice(headerEnd).replace(/^\r?\n\r?\n/, '')

  // Parse headers (naive, but good enough)
  const headers = {}
  const lines = headerText.split(/\r?\n/)
  let current = null
  for (const line of lines) {
    if (/^\s/.test(line) && current) {
      headers[current] += ' ' + line.trim()
    } else {
      const m = line.match(/^([^:]+):\s*(.*)$/)
      if (m) {
        current = m[1].toLowerCase()
        headers[current] = m[2]
      }
    }
  }

  // Try to find text/plain or text/html body
  let displayBody = body
  const contentType = headers['content-type'] || ''
  if (contentType.includes('multipart/')) {
    const m = contentType.match(/boundary="?([^";]+)"?/)
    if (m) {
      const parts = body.split('--' + m[1])
      let plainPart = null, htmlPart = null
      for (const p of parts) {
        if (/content-type:\s*text\/plain/i.test(p)) plainPart = p
        else if (/content-type:\s*text\/html/i.test(p)) htmlPart = p
      }
      const chosen = plainPart || htmlPart || ''
      const subEnd = chosen.search(/\r?\n\r?\n/)
      displayBody = subEnd >= 0 ? chosen.slice(subEnd).replace(/^\r?\n\r?\n/, '') : chosen
    }
  }

  // Decode quoted-printable
  if (/quoted-printable/i.test(headers['content-transfer-encoding'] || '') || /quoted-printable/i.test(contentType)) {
    displayBody = displayBody
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  }

  return {
    from: headers.from || '',
    to: headers.to || '',
    cc: headers.cc || '',
    subject: headers.subject || '(no subject)',
    date: headers.date || '',
    body: displayBody.trim(),
    isHtml: /content-type:\s*text\/html/i.test(contentType) && !/multipart/i.test(contentType),
  }
}

function EmlViewer({ file, parsed, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 8, maxWidth: 800, width: '100%', maxHeight: '90vh', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 14, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>✉ {file.file_name}</div>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        <div style={{ padding: 14, fontSize: 12, borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
          <div style={{ marginBottom: 4 }}><strong style={{ color: 'var(--text3)', minWidth: 60, display: 'inline-block' }}>From:</strong> {parsed.from}</div>
          <div style={{ marginBottom: 4 }}><strong style={{ color: 'var(--text3)', minWidth: 60, display: 'inline-block' }}>To:</strong> {parsed.to}</div>
          {parsed.cc && <div style={{ marginBottom: 4 }}><strong style={{ color: 'var(--text3)', minWidth: 60, display: 'inline-block' }}>Cc:</strong> {parsed.cc}</div>}
          {parsed.date && <div style={{ marginBottom: 4 }}><strong style={{ color: 'var(--text3)', minWidth: 60, display: 'inline-block' }}>Date:</strong> {parsed.date}</div>}
          <div><strong style={{ color: 'var(--text3)', minWidth: 60, display: 'inline-block' }}>Subject:</strong> <span style={{ fontWeight: 600 }}>{parsed.subject}</span></div>
        </div>
        <div style={{ padding: 14, fontSize: 13, lineHeight: 1.6, flex: 1, overflow: 'auto' }}>
          {parsed.isHtml ? (
            <iframe srcDoc={parsed.body} sandbox="" style={{ width: '100%', height: '60vh', border: '1px solid var(--border)', borderRadius: 4, background: 'white' }} />
          ) : (
            <pre style={{ fontFamily: 'inherit', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{parsed.body}</pre>
          )}
        </div>
      </div>
    </div>
  )
}
