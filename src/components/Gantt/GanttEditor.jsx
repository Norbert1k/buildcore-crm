import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { Spinner, Modal, Field, IconPlus, IconTrash, ConfirmDialog } from '../ui'
import {
  parseDate, fmtDate, fmtDateUK, addDays, diffDays, DAY_MS,
  newTask, flattenTasks, getDateBounds, durationFromDates, endFromStartAndDuration, rollupGroups,
  STAGES, stageColor, effectiveStage,
} from './ganttUtils'
import { buildProgrammePdf } from './programmePdf'

const ZOOM_LEVELS = {
  day:   { name: 'Day',   pxPerDay: 28 },
  week:  { name: 'Week',  pxPerDay: 8  },
  month: { name: 'Month', pxPerDay: 3  },
}
const ROW_HEIGHT = 30
const TASK_LIST_W = 260
const HEADER_H = 56  // date axis area

const COLORS = ['#448a40','#378ADD','#BA7517','#993C1D','#3B6D11','#534AB7','#888780','#c00','#1F8A70']

// ─── Per-building programme support (Stage 2 of Chunk 2c-programme) ───────
// `buildingOrdinal` selects which programme row this editor reads + writes:
//   • null (default)        → project-wide programme (building_ordinal IS NULL).
//                             Single-building projects always use this.
//                             Multi-building projects use this when editing
//                             the master/fallback programme that covers all
//                             buildings.
//   • 1, 2, 3, ...          → per-building programme matching the ordinal
//                             from buildings.js (Residential Block / Sports
//                             Hall / Changing Rooms etc).
//
// `programme_versions` is unchanged — versions belong to their parent
// programme by `programme_id`. Each (project_id, building_ordinal) pair
// has its own independent version history.
//
// `buildingLabel` is purely cosmetic — shown as a badge at the top of the
// editor so the user can tell at a glance which programme they're editing.
// Falls back to a generic "Building N" label if missing.
export default function GanttEditor({ projectId, projectName, onClose, canEdit, initialTasks = null, buildingOrdinal = null, buildingLabel = null }) {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [programme, setProgramme] = useState(null)
  const [versions, setVersions] = useState([])
  const [activeVersion, setActiveVersion] = useState(null)
  const [tasks, setTasks] = useState([])              // working copy
  const [originalTasks, setOriginalTasks] = useState([]) // for dirty-check
  const [zoom, setZoom] = useState('day')
  const [selectedTaskId, setSelectedTaskId] = useState(null)
  const [showVersionsMenu, setShowVersionsMenu] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  // Export dialog — header details for the CCG programme layout. Remembered
  // per project in this browser so the next issue only needs a new revision.
  const [exportForm, setExportForm] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [versionNote, setVersionNote] = useState('')
  const [confirmDeleteTask, setConfirmDeleteTask] = useState(null)
  const [confirmCloseDirty, setConfirmCloseDirty] = useState(false)
  // Drag state — tracking which task is being dragged + how many days it
  // has moved during the in-flight drag. We use a ref for the live mouse
  // position (high-frequency, mustn't re-render) and a state-only flag
  // for the visible delta (one re-render per day-of-movement, at worst).
  const dragRef = useRef(null)  // { taskId, startMouseX, originalStart, originalEnd, moved }
  const [dragDeltaDays, setDragDeltaDays] = useState(0)
  const [dragTaskId, setDragTaskId] = useState(null)

  const timelineScrollRef = useRef(null)

  useEffect(() => { load() }, [projectId, buildingOrdinal])

  async function load() {
    setLoading(true)
    try {
      // Find or create programme for this (project, building_ordinal) pair.
      // Building_ordinal IS NULL = project-wide programme; numeric = per-building.
      // Supabase JS builder distinguishes IS NULL from = NULL — use .is(...) for
      // the null case and .eq(...) for the numeric case. Without this, a
      // .eq('building_ordinal', null) call would generate WHERE building_ordinal = NULL
      // which never matches.
      let progQuery = supabase.from('programmes').select('*').eq('project_id', projectId)
      progQuery = (buildingOrdinal == null)
        ? progQuery.is('building_ordinal', null)
        : progQuery.eq('building_ordinal', buildingOrdinal)
      let { data: prog } = await progQuery.maybeSingle()

      // FALLBACK for the buildingOrdinal=null case: if no explicit project-wide
      // programme exists, use the FIRST programme on this project. This handles
      // existing data created before per-building support was introduced —
      // those rows have building_ordinal set to specific values (1/2/3) but
      // there's no project-wide row. Without this fallback, callers that don't
      // pass buildingOrdinal (e.g. the "Open in Gantt Editor" flow from the
      // AI PDF parser) would create a new orphan project-wide programme and
      // miss all existing version history. This matches the pre-per-building
      // load behavior that was on production through May.
      if (!prog && buildingOrdinal == null) {
        const { data: anyProg } = await supabase
          .from('programmes')
          .select('*')
          .eq('project_id', projectId)
          .order('building_ordinal', { ascending: true, nullsFirst: true })
          .limit(1)
        if (anyProg && anyProg.length > 0) prog = anyProg[0]
      }

      if (!prog && canEdit) {
        const insertPayload = { project_id: projectId }
        // Only set building_ordinal when we have one — leaving it absent makes
        // Postgres assign NULL, which is what the project-wide programme wants.
        if (buildingOrdinal != null) insertPayload.building_ordinal = buildingOrdinal
        const { data: newProg, error } = await supabase
          .from('programmes')
          .insert(insertPayload)
          .select()
          .single()
        if (error) console.error('[Gantt] create programme failed:', error)
        prog = newProg
      }
      if (!prog) { setLoading(false); return }
      setProgramme(prog)

      // Load all versions
      const { data: vs } = await supabase.from('programme_versions')
        .select('id, version_number, notes, created_at, created_by, profiles(full_name)')
        .eq('programme_id', prog.id)
        .order('version_number', { ascending: false })
      setVersions(vs || [])

      // Load latest version's tasks
      const latest = (vs || [])[0]
      if (latest) {
        const { data: full } = await supabase.from('programme_versions').select('*').eq('id', latest.id).single()
        setActiveVersion(latest)
        setTasks(full?.tasks || [])
        setOriginalTasks(full?.tasks || [])
      } else {
        setActiveVersion(null)
        setTasks([])
        setOriginalTasks([])
      }

      // If we got pre-filled tasks from the AI parser, use them as the working set.
      // Marks the editor dirty so the user is prompted to save when ready.
      if (initialTasks && Array.isArray(initialTasks) && initialTasks.length > 0) {
        setTasks(initialTasks)
        // Don't update originalTasks — that way isDirty is true and a save prompt appears
      }
    } catch (e) { console.error('[Gantt] load:', e) }
    setLoading(false)
  }

  async function loadVersion(versionId) {
    if (isDirty && !window.confirm('You have unsaved changes. Discard them and load this version?')) return
    setLoading(true)
    const { data } = await supabase.from('programme_versions').select('*').eq('id', versionId).single()
    if (data) {
      const v = versions.find(v => v.id === versionId) || data
      setActiveVersion(v)
      setTasks(data.tasks || [])
      setOriginalTasks(data.tasks || [])
      setSelectedTaskId(null)
    }
    setLoading(false)
    setShowVersionsMenu(false)
  }

  async function deleteVersion(versionId) {
    // Per Issue 4b, no minimum-version safety rail — user can delete the
    // only remaining version. When they do, the editor clears the canvas
    // back to empty (versionsCount=0, tasks=[]) so they truly start over.
    const v = versions.find(x => x.id === versionId)
    if (!v) return
    const isLastOne = versions.length === 1
    const confirmMessage = isLastOne
      ? `Permanently delete Version ${v.version_number}?\n\nThis is the only saved version. Deleting it will clear the Gantt back to empty. This cannot be undone.`
      : `Permanently delete Version ${v.version_number}? This cannot be undone.`
    if (!window.confirm(confirmMessage)) return
    try {
      // Use .select() so Supabase returns the rows that were actually
      // deleted. If RLS or any other policy silently blocks the delete,
      // Supabase returns { data: [], error: null } — no error, but no
      // rows touched either. Without checking the count we'd update
      // local state optimistically and the user would see the version
      // reappear on next reload (the "deleted versions come back" bug).
      const { data: deleted, error } = await supabase
        .from('programme_versions')
        .delete()
        .eq('id', versionId)
        .select('id')
      if (error) throw error
      if (!deleted || deleted.length === 0) {
        throw new Error('Delete was blocked by row-level security. Ask an admin to add a DELETE policy on programme_versions.')
      }
      const remaining = versions.filter(x => x.id !== versionId)
      setVersions(remaining)
      // If the deleted version was the active one, decide what to show next.
      if (activeVersion?.id === versionId) {
        const next = remaining[0] // versions are sorted DESC by version_number
        if (next) {
          // Reuse loadVersion logic but skip the dirty-check (we just deleted, so 'dirty' state is irrelevant)
          setLoading(true)
          const { data } = await supabase.from('programme_versions').select('*').eq('id', next.id).single()
          if (data) {
            setActiveVersion(next)
            setTasks(data.tasks || [])
            setOriginalTasks(data.tasks || [])
            setSelectedTaskId(null)
          }
          setLoading(false)
        } else {
          // No remaining versions — clear the canvas back to empty (Issue 4b).
          // The user explicitly asked to start over rather than keep the
          // deleted tasks as a working draft.
          setActiveVersion(null)
          setTasks([])
          setOriginalTasks([])
          setSelectedTaskId(null)
        }
      }
    } catch (err) {
      console.error('[Gantt] delete version failed:', err)
      alert('Delete failed: ' + (err?.message || err))
    }
  }

  async function saveAsNewVersion() {
    if (!programme) return
    setSaving(true)
    try {
      const nextVersionNumber = (versions[0]?.version_number || 0) + 1
      // Roll up groups before save (so parents reflect children's spans)
      const rolled = rollupGroups(tasks)
      const { data: newV, error } = await supabase.from('programme_versions').insert({
        programme_id: programme.id,
        version_number: nextVersionNumber,
        tasks: rolled,
        notes: versionNote.trim() || null,
        created_by: profile?.id,
      }).select('id, version_number, notes, created_at, created_by, profiles(full_name)').single()
      if (error) throw error
      setVersions([newV, ...versions])
      setActiveVersion(newV)
      setOriginalTasks(rolled)
      setTasks(rolled)
      setShowSaveDialog(false)
      setVersionNote('')
    } catch (err) {
      console.error('[Gantt] save failed:', err)
      alert('Save failed: ' + (err?.message || err))
    }
    setSaving(false)
  }

  // Dirty check (deep)
  const isDirty = useMemo(() => {
    return JSON.stringify(tasks) !== JSON.stringify(originalTasks)
  }, [tasks, originalTasks])

  function handleClose() {
    if (isDirty) setConfirmCloseDirty(true)
    else onClose()
  }

  // Export the current Gantt to PDF (CCG landscape letterhead style)
  // ── Export: CCG programme layout (see programmePdf.js) ──────────────────
  async function exportPDF() {
    const key = `ccg-prog-export:${projectId}${buildingOrdinal != null ? ':' + buildingOrdinal : ''}`
    let saved = {}
    try { saved = JSON.parse(localStorage.getItem(key) || '{}') } catch { /* ignore */ }
    let proj = null
    try {
      const { data } = await supabase.from('projects')
        .select('project_ref, project_name, site_address, city, postcode, client_name, status')
        .eq('id', projectId).maybeSingle()
      proj = data
    } catch { /* ignore */ }
    const isTender = (proj?.status || '').toLowerCase() === 'tender'
    const addr = [proj?.site_address, proj?.city, proj?.postcode].filter(Boolean).join(', ')
    const scope = buildingOrdinal != null ? ` — ${buildingLabel || `Building ${String(buildingOrdinal).padStart(2, '0')}`}` : ''
    const setUp = rolledTasks.filter(t => effectiveStage(t, rolledTasks.some(x => x.parent_id === t.id)) === 'SET-UP')
      .map(t => t.start_date).sort()[0]
    setExportForm({
      key,
      title: saved.title || (isTender ? 'TENDER PROGRAMME' : 'CONSTRUCTION PROGRAMME'),
      projectNo: saved.projectNo || proj?.project_ref || '',
      projectTitle: saved.projectTitle || [(proj?.project_name || projectName) + scope, addr].filter(Boolean).join(', '),
      client: saved.client || proj?.client_name || '',
      status: saved.status || (isTender ? 'TENDER' : (proj?.status || '').toUpperCase() || 'CONSTRUCTION'),
      revision: activeVersion ? `Rev ${activeVersion.version_number}` : (saved.revision || 'Draft'),
      possession: saved.possession || setUp || bounds.min?.toISOString?.().slice(0, 10) || '',
      shutdown: saved.shutdown !== false,
      notes: saved.notes || '',
    })
  }

  async function runExport() {
    const f = exportForm; if (!f) return
    setExporting(true)
    try {
      try { localStorage.setItem(f.key, JSON.stringify({ ...f, key: undefined })) } catch { /* ignore */ }
      const loadScript = (src) => new Promise((resolve, reject) => {
        const el = document.createElement('script'); el.src = src
        el.onload = resolve; el.onerror = () => reject(new Error('Failed to load ' + src))
        document.head.appendChild(el)
      })
      if (!window.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
      const { jsPDF } = window.jspdf
      let logo = null
      try {
        const resp = await fetch('/logo.png')
        if (resp.ok) {
          const blob = await resp.blob()
          logo = await new Promise(res => { const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(blob) })
        }
      } catch { /* ignore */ }

      // Every group expanded for the export, groups rolled up from children.
      const rows = flattenTasks(rollupGroups(tasks.map(t => ({ ...t, collapsed: false }))))
      const today = new Date()
      const { doc } = buildProgrammePdf(jsPDF, rows, {
        title: f.title, projectNo: f.projectNo, projectTitle: f.projectTitle, client: f.client,
        possession: f.possession ? parseDate(f.possession) : null, status: f.status, revision: f.revision,
        revisionDate: `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getFullYear()).slice(2)}`,
        email: profile?.email || '', shutdown: f.shutdown,
        notes: String(f.notes || '').split('\n').map(x => x.trim()).filter(Boolean),
      }, logo)

      const fileScope = buildingOrdinal != null ? ` (${buildingLabel || `Building ${String(buildingOrdinal).padStart(2, '0')}`})` : ''
      const rawFileName = `${projectName} - ${f.title ? f.title.charAt(0) + f.title.slice(1).toLowerCase() : 'Programme'}${fileScope} - ${f.revision || 'draft'} - ${today.toISOString().slice(0, 10)}.pdf`
      const safeFileName = rawFileName.replace(/[\/\\<>:"|?*]+/g, '').replace(/\s+/g, ' ').trim() || 'Programme.pdf'
      doc.save(safeFileName)
      setExportForm(null)

      // Also file the PDF in the project's '06. Project Programme' folder (best effort).
      try {
        const arrayBuffer = doc.output('arraybuffer')
        const storagePath = `projects/${projectId}/06-project-programme/${Date.now()}-${safeFileName}`
        const { error: upErr } = await supabase.storage.from('project-docs').upload(storagePath, new Blob([arrayBuffer], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false })
        if (!upErr) await supabase.from('project_doc_files').insert({ project_id: projectId, folder_key: '06-project-programme', file_name: safeFileName, file_size: arrayBuffer.byteLength, storage_path: storagePath })
        else console.warn('[Gantt] PDF auto-upload failed:', upErr.message || upErr)
      } catch (e) { console.warn('[Gantt] PDF auto-upload threw:', e?.message || e) }
    } catch (err) {
      console.error('[Gantt] export PDF failed:', err)
      alert('Export failed: ' + (err?.message || err))
    } finally {
      setExporting(false)
    }
  }

  function addTask() {
    const t = newTask({})
    setTasks(prev => [...prev, t])
    setSelectedTaskId(t.id)
  }

  // Extend a group's (or the project row's) end date by pushing the tasks
  // that currently finish LAST in that group out to the new end date.
  // ("Stretch": mid-programme tasks are untouched; only the finishers move.)
  // Works in both directions; a task's end never moves before its start.
  // Group bars redraw automatically via the live rollup.
  function stretchGroupEnd(groupId, newEndStr) {
    const newEnd = parseDate(newEndStr)
    if (!newEnd) return
    const ids = new Set([groupId])
    let grew = true
    while (grew) {
      grew = false
      for (const t of tasks) {
        if (t.parent_id && ids.has(t.parent_id) && !ids.has(t.id)) { ids.add(t.id); grew = true }
      }
    }
    const hasChild = new Set(tasks.filter(t => t.parent_id && ids.has(t.parent_id)).map(t => t.parent_id))
    const leaves = tasks.filter(t => ids.has(t.id) && t.id !== groupId && !hasChild.has(t.id))
    if (!leaves.length) return
    let maxEnd = null
    for (const t of leaves) {
      const e = parseDate(t.end_date)
      if (e && (!maxEnd || e > maxEnd)) maxEnd = e
    }
    if (!maxEnd) return
    const maxEndStr = fmtDate(maxEnd)
    setTasks(prev => prev.map(t => {
      if (!ids.has(t.id) || hasChild.has(t.id) || t.id === groupId) return t
      if (t.end_date !== maxEndStr) return t
      const start = parseDate(t.start_date)
      const clamped = (start && newEnd < start) ? start : newEnd
      return { ...t, end_date: fmtDate(clamped) }
    }))
  }

  function updateTask(id, patch) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
  }

  // Start a drag on a task's bar. Captures the original dates and the
  // mouse's starting X, then listens on `window` for move/up so the drag
  // tracks even when the cursor leaves the bar. The visible bar position
  // is offset by `dragDeltaDays * pxPerDay` during the drag; on release
  // we commit the new start/end via setTasks and the dirty-flag effect
  // takes over to show "unsaved changes".
  //
  // Skipped for group/summary tasks because their dates are computed
  // from children — moving the parent bar wouldn't move the children
  // and the parent's dates would just snap back on next rollup.
  function beginBarDrag(e, task, pxPerDay) {
    if (!canEdit) return
    if (task._hasChildren) return  // group bars not draggable
    e.stopPropagation()
    e.preventDefault()

    const startMouseX = e.clientX
    const originalStart = task.start_date
    const originalEnd = task.end_date
    dragRef.current = { taskId: task.id, startMouseX, originalStart, originalEnd, moved: false }
    setDragTaskId(task.id)
    setDragDeltaDays(0)

    const onMove = (moveEvt) => {
      const ref = dragRef.current
      if (!ref) return
      const deltaPx = moveEvt.clientX - ref.startMouseX
      const deltaDays = Math.round(deltaPx / pxPerDay)
      // Threshold: only mark as a real drag once the cursor has moved
      // by more than ~3px. Below that we treat as a click.
      if (Math.abs(deltaPx) > 3) ref.moved = true
      setDragDeltaDays(deltaDays)
    }
    const onUp = (upEvt) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const ref = dragRef.current
      dragRef.current = null
      setDragTaskId(null)
      setDragDeltaDays(0)
      if (!ref || !ref.moved) return  // tiny movement = click, not drag
      const deltaPx = upEvt.clientX - ref.startMouseX
      const deltaDays = Math.round(deltaPx / pxPerDay)
      if (deltaDays === 0) return
      // Commit: shift both start and end by the same day-delta, preserving
      // duration. parseDate/addDays/fmtDate are UTC-safe so we don't drift
      // across DST boundaries.
      const newStart = fmtDate(addDays(parseDate(ref.originalStart), deltaDays))
      const newEnd   = fmtDate(addDays(parseDate(ref.originalEnd),   deltaDays))
      setTasks(prev => prev.map(t => t.id === ref.taskId
        ? { ...t, start_date: newStart, end_date: newEnd }
        : t
      ))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function deleteTask(id) {
    // Also remove children recursively + remove dependencies pointing at it
    const removeIds = new Set([id])
    let grew = true
    while (grew) {
      grew = false
      for (const t of tasks) {
        if (t.parent_id && removeIds.has(t.parent_id) && !removeIds.has(t.id)) {
          removeIds.add(t.id); grew = true
        }
      }
    }
    setTasks(prev => prev
      .filter(t => !removeIds.has(t.id))
      .map(t => ({ ...t, depends_on: (t.depends_on || []).filter(d => !removeIds.has(d)) }))
    )
    if (selectedTaskId && removeIds.has(selectedTaskId)) setSelectedTaskId(null)
    setConfirmDeleteTask(null)
  }

  function indentTask(id) {
    // Set parent to the previous sibling (in flat order)
    const flat = flattenTasks(tasks)
    const idx = flat.findIndex(t => t.id === id)
    if (idx <= 0) return
    // Find a sibling (same depth) above
    const me = flat[idx]
    for (let i = idx - 1; i >= 0; i--) {
      if (flat[i]._depth === me._depth) {
        updateTask(id, { parent_id: flat[i].id })
        return
      }
      if (flat[i]._depth < me._depth) return  // hit a parent without a same-depth sibling above
    }
  }

  function outdentTask(id) {
    const t = tasks.find(t => t.id === id)
    if (!t || !t.parent_id) return
    const parent = tasks.find(p => p.id === t.parent_id)
    updateTask(id, { parent_id: parent?.parent_id || null })
  }

  function moveTask(id, dir) {
    // Reorder among siblings (same parent)
    const t = tasks.find(t => t.id === id)
    if (!t) return
    const siblings = tasks.filter(x => x.parent_id === t.parent_id)
    const idx = siblings.findIndex(s => s.id === id)
    const swapWith = siblings[idx + dir]
    if (!swapWith) return
    // Find positions in main array and swap
    const aIdx = tasks.findIndex(x => x.id === id)
    const bIdx = tasks.findIndex(x => x.id === swapWith.id)
    const next = [...tasks]
    ;[next[aIdx], next[bIdx]] = [next[bIdx], next[aIdx]]
    setTasks(next)
  }

  // ─── Timeline geometry ────────────────────────────────────
  const flat = useMemo(() => flattenTasks(rollupGroups(tasks)), [tasks])
  const bounds = useMemo(() => {
    const b = getDateBounds(flat)
    // Pad timeline 7 days each side
    return { min: addDays(b.min, -7), max: addDays(b.max, 14) }
  }, [flat])
  const totalDays = Math.max(30, diffDays(bounds.min, bounds.max) + 1)
  const pxPerDay = ZOOM_LEVELS[zoom].pxPerDay
  const timelineW = totalDays * pxPerDay

  // Date X position (pixels) from start
  const dayToX = (d) => {
    const days = diffDays(bounds.min, parseDate(d))
    return days * pxPerDay
  }
  const taskBarPos = (t) => {
    const s = parseDate(t.start_date), e = parseDate(t.end_date)
    if (!s || !e) return null
    const x = dayToX(t.start_date)
    const w = Math.max(2, (durationFromDates(s, e)) * pxPerDay)
    return { x, w }
  }

  // Build axis ticks based on zoom
  const axisMarkers = useMemo(() => buildAxisMarkers(bounds.min, bounds.max, zoom), [bounds, zoom])

  // Today line
  const todayX = useMemo(() => {
    const today = new Date()
    if (today < bounds.min || today > bounds.max) return null
    return diffDays(bounds.min, today) * pxPerDay
  }, [bounds, pxPerDay])

  // The details panel must show the same dates the chart draws. Group rows
  // derive their span from their children (rollupGroups), so read the rolled
  // version — otherwise a group's End/Duration display its stale stored
  // values and appear frozen after a Stretch.
  const rolledTasks = useMemo(() => rollupGroups(tasks), [tasks])
  const selectedTask = rolledTasks.find(t => t.id === selectedTaskId) || null

  if (loading) return (
    <Overlay onClose={handleClose}>
      <div style={{ padding: 60, textAlign: 'center' }}><Spinner /></div>
    </Overlay>
  )

  return (
    <Overlay onClose={handleClose}>
      {/* Top toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              ⏱ Live Programme — {projectName}
            </span>
            {/* Per-building scope badge — only shown when this editor is
                scoped to a specific building. Project-wide editing has no
                badge so single-building projects look unchanged. */}
            {buildingOrdinal != null && (
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 4,
                background: '#534AB720',
                color: '#534AB7',
                border: '0.5px solid #534AB7',
                whiteSpace: 'nowrap',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}>
                Building {String(buildingOrdinal).padStart(2, '0')}
                {buildingLabel ? ` · ${buildingLabel}` : ''}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            {activeVersion ? `Version ${activeVersion.version_number} · ${fmtDateUK(activeVersion.created_at)}` : 'No saved versions yet'}
            {isDirty && <span style={{ color: '#b87a00', marginLeft: 8, fontWeight: 600 }}>• unsaved changes</span>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 0, border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          {Object.entries(ZOOM_LEVELS).map(([k, v]) => (
            <button key={k} onClick={() => setZoom(k)} style={{ fontSize: 11, padding: '4px 10px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: zoom === k ? '#448a40' : 'var(--surface)', color: zoom === k ? 'white' : 'var(--text2)' }}>{v.name}</button>
          ))}
        </div>

        <button className="btn btn-sm" onClick={() => {
          // Scroll timeline so today is visible
          if (todayX !== null && timelineScrollRef.current) {
            timelineScrollRef.current.scrollLeft = Math.max(0, todayX - 200)
          }
        }}>Today</button>

        <div style={{ position: 'relative' }}>
          <button className="btn btn-sm" onClick={() => setShowVersionsMenu(v => !v)}>Versions ({versions.length})</button>
          {showVersionsMenu && (
            <div onMouseLeave={() => setShowVersionsMenu(false)}
              style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', minWidth: 280, maxHeight: 320, overflow: 'auto', zIndex: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
              {versions.length === 0 && <div style={{ padding: 12, fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>No versions saved yet.</div>}
              {versions.map(v => (
                <div key={v.id} onClick={() => loadVersion(v.id)}
                  style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '0.5px solid var(--border)', background: activeVersion?.id === v.id ? 'var(--surface2)' : undefined, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>Version {v.version_number}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)' }}>{fmtDateUK(v.created_at)} · {v.profiles?.full_name || 'Unknown'}</div>
                    {v.notes && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2, fontStyle: 'italic' }}>"{v.notes}"</div>}
                  </div>
                  {canEdit && (
                    <button
                      onClick={e => { e.stopPropagation(); deleteVersion(v.id) }}
                      title={`Delete Version ${v.version_number}`}
                      style={{ flexShrink: 0, background: 'transparent', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '2px 6px', borderRadius: 4 }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--danger-bg, #ffe5e5)'; e.currentTarget.style.color = 'var(--danger, #d33)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text3)' }}
                    >×</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <button className="btn btn-sm" onClick={() => exportPDF()}>📄 Export PDF</button>
        {canEdit && (
          <button className="btn btn-sm btn-primary" onClick={() => setShowSaveDialog(true)} disabled={!isDirty || saving}>
            {saving ? 'Saving…' : 'Save as new version'}
          </button>
        )}
        <button className="btn btn-sm" onClick={handleClose}>Close</button>
      </div>

      {/* Body — task list + timeline */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {/* LEFT: task list */}
        <div style={{ width: TASK_LIST_W, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
          {/* List header */}
          <div style={{ height: HEADER_H, display: 'flex', alignItems: 'center', padding: '0 10px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)', flexShrink: 0 }}>
            <div style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Task</div>
            <div style={{ width: 80, fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Days</div>
          </div>
          {/* Task rows */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {flat.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
                No tasks yet. {canEdit ? 'Click "Add Task" below to start.' : ''}
              </div>
            ) : flat.map(t => {
              const dur = durationFromDates(parseDate(t.start_date), parseDate(t.end_date))
              return (
                <div key={t.id} onClick={() => setSelectedTaskId(t.id)}
                  style={{
                    height: ROW_HEIGHT, display: 'flex', alignItems: 'center', padding: '0 10px',
                    paddingLeft: 10 + t._depth * 14,
                    background: selectedTaskId === t.id ? 'var(--surface2)' : undefined,
                    cursor: 'pointer', borderBottom: '0.5px solid var(--border)',
                    fontSize: 12,
                  }}>
                  {t._hasChildren && (
                    <span onClick={(e) => { e.stopPropagation(); updateTask(t.id, { collapsed: !t.collapsed }) }}
                      style={{ marginRight: 6, color: 'var(--text3)', cursor: 'pointer', userSelect: 'none', fontSize: 9 }}>
                      {t.collapsed ? '▶' : '▼'}
                    </span>
                  )}
                  <span style={{ flex: 1, fontWeight: t._hasChildren ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name || '(untitled)'}</span>
                  <span style={{ width: 80, textAlign: 'right', color: 'var(--text3)', fontSize: 11 }}>{dur}d</span>
                </div>
              )
            })}
          </div>
          {/* Add Task button */}
          {canEdit && (
            <div style={{ padding: 8, borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-sm btn-primary" onClick={addTask} style={{ width: '100%' }}>
                <IconPlus size={12} /> Add Task
              </button>
            </div>
          )}
        </div>

        {/* RIGHT: timeline */}
        <div ref={timelineScrollRef} style={{ flex: 1, minWidth: 0, overflow: 'auto', position: 'relative', background: 'var(--surface)' }}>
          <div style={{ position: 'relative', width: timelineW, minHeight: '100%' }}>
            {/* Date axis (sticky) */}
            <div style={{ position: 'sticky', top: 0, height: HEADER_H, background: 'var(--surface2)', borderBottom: '1px solid var(--border)', zIndex: 2 }}>
              <AxisRender markers={axisMarkers} pxPerDay={pxPerDay} bounds={bounds} zoom={zoom} />
            </div>

            {/* Vertical day grid lines + weekend shading + today line */}
            <svg style={{ position: 'absolute', top: HEADER_H, left: 0, width: timelineW, height: flat.length * ROW_HEIGHT, pointerEvents: 'none' }}>
              {/* Weekend shading (only at day zoom) */}
              {zoom === 'day' && (() => {
                const cells = []
                for (let i = 0; i < totalDays; i++) {
                  const d = addDays(bounds.min, i)
                  const dow = d.getUTCDay()
                  if (dow === 0 || dow === 6) {
                    cells.push(<rect key={i} x={i * pxPerDay} y={0} width={pxPerDay} height="100%" fill="#0001" />)
                  }
                }
                return cells
              })()}
              {/* Vertical grid lines (every day at day, every week elsewhere) */}
              {axisMarkers.major.map((m, i) => (
                <line key={'maj' + i} x1={m.x} y1={0} x2={m.x} y2="100%" stroke="var(--border)" strokeWidth="0.5" />
              ))}
              {/* Today line */}
              {todayX !== null && (
                <line x1={todayX} y1={0} x2={todayX} y2="100%" stroke="#c00" strokeWidth="1.5" strokeDasharray="3 3" />
              )}
            </svg>

            {/* Task rows + bars */}
            {flat.map((t, i) => {
              const pos = taskBarPos(t)
              if (!pos) return null
              const isGroup = t._hasChildren
              const isSelected = selectedTaskId === t.id
              const isDragging = dragTaskId === t.id
              const dragOffsetX = isDragging ? dragDeltaDays * pxPerDay : 0
              return (
                <div key={t.id}
                  onClick={() => setSelectedTaskId(t.id)}
                  style={{
                    position: 'absolute', top: HEADER_H + i * ROW_HEIGHT, left: 0,
                    width: timelineW, height: ROW_HEIGHT,
                    borderBottom: '0.5px solid var(--border)',
                    background: isSelected ? 'rgba(68,138,64,0.05)' : undefined,
                    cursor: 'pointer',
                  }}>
                  {/* The bar — draggable for non-group tasks when caller
                      has edit permission. Group/summary bars stay
                      click-only since their dates roll up from children. */}
                  <div
                    onMouseDown={(e) => beginBarDrag(e, t, pxPerDay)}
                    title={`${t.name} · ${fmtDateUK(t.start_date)} → ${fmtDateUK(t.end_date)}${canEdit && !isGroup ? ' · drag to move' : ''}`}
                    style={{
                      position: 'absolute',
                      left: pos.x + dragOffsetX, top: 6,
                      width: pos.w, height: ROW_HEIGHT - 12,
                      background: isGroup ? '#333' : (t.color || '#448a40'),
                      borderRadius: isGroup ? 0 : 4,
                      borderLeft: isGroup ? `4px solid ${t.color || '#000'}` : 'none',
                      borderRight: isGroup ? `4px solid ${t.color || '#000'}` : 'none',
                      display: 'flex', alignItems: 'center', paddingLeft: 6,
                      fontSize: 10, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden',
                      boxShadow: isSelected ? '0 0 0 2px var(--accent)' : 'none',
                      cursor: isGroup ? 'pointer' : (isDragging ? 'grabbing' : (canEdit ? 'grab' : 'pointer')),
                      opacity: isDragging ? 0.85 : 1,
                      userSelect: 'none',
                    }}>
                    {/* Progress overlay */}
                    {t.progress > 0 && (
                      <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${t.progress}%`, background: isGroup ? 'rgba(68,138,64,0.55)' : 'rgba(0,0,0,0.25)', borderRadius: 4 }} />
                    )}
                    <span style={{ position: 'relative', textShadow: '0 1px 0 rgba(0,0,0,0.3)' }}>
                      {pos.w > 60 ? t.name : ''}
                    </span>
                  </div>
                </div>
              )
            })}

            {/* Empty state in timeline */}
            {flat.length === 0 && (
              <div style={{ position: 'absolute', top: HEADER_H + 40, left: 0, width: '100%', textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
                Add tasks on the left and they'll appear here as bars.
              </div>
            )}
          </div>
        </div>

        {/* Right: Edit panel (slides in when task selected) */}
        {selectedTask && canEdit && (
          <TaskEditPanel
            task={selectedTask}
            allTasks={tasks}
            onChange={patch => updateTask(selectedTask.id, patch)}
            onGroupEnd={newEnd => stretchGroupEnd(selectedTask.id, newEnd)}
            onDelete={() => setConfirmDeleteTask(selectedTask.id)}
            onIndent={() => indentTask(selectedTask.id)}
            onOutdent={() => outdentTask(selectedTask.id)}
            onMoveUp={() => moveTask(selectedTask.id, -1)}
            onMoveDown={() => moveTask(selectedTask.id, 1)}
            onClose={() => setSelectedTaskId(null)}
          />
        )}
      </div>

      {/* Save dialog */}
      <Modal open={!!exportForm} onClose={() => !exporting && setExportForm(null)} title="Export programme (PDF)" size="md"
        footer={<>
          <button className="btn" onClick={() => setExportForm(null)} disabled={exporting}>Cancel</button>
          <button className="btn btn-primary" onClick={runExport} disabled={exporting}>{exporting ? 'Exporting…' : 'Export PDF'}</button>
        </>}>
        {exportForm && (() => {
          const set = (k) => (e) => setExportForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 8 }}>
                <Field label="Title"><input value={exportForm.title} onChange={set('title')} /></Field>
                <Field label="Status"><input value={exportForm.status} onChange={set('status')} /></Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr)', gap: 8 }}>
                <Field label="Project no"><input value={exportForm.projectNo} onChange={set('projectNo')} /></Field>
                <Field label="Client"><input value={exportForm.client} onChange={set('client')} /></Field>
              </div>
              <Field label="Project title"><input value={exportForm.projectTitle} onChange={set('projectTitle')} /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8 }}>
                <Field label="Revision no"><input value={exportForm.revision} onChange={set('revision')} /></Field>
                <Field label="Possession (week 1)"><input type="date" value={exportForm.possession} onChange={set('possession')} /></Field>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)' }}>
                <input type="checkbox" checked={exportForm.shutdown} onChange={set('shutdown')} /> Christmas shutdown (shaded, excluded from working days)
              </label>
              <Field label="Notes under the key (one per line)">
                <textarea value={exportForm.notes} onChange={set('notes')} style={{ minHeight: 70 }} placeholder="e.g. Programme assumes contract award by Jan 2027…" />
              </Field>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>Practical completion and contract period are calculated from the programme. A copy is filed in 06. Project Programme.</div>
            </div>
          )
        })()}
      </Modal>

      <Modal open={showSaveDialog} onClose={() => !saving && setShowSaveDialog(false)} title="Save as new version" size="sm"
        footer={<>
          <button className="btn" onClick={() => setShowSaveDialog(false)} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={saveAsNewVersion} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </>}>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12 }}>
          A new immutable version snapshot will be created. Previous versions stay accessible from the Versions menu.
        </div>
        <Field label="Change note (optional)">
          <input value={versionNote} onChange={e => setVersionNote(e.target.value)} placeholder="e.g. Added Phase 2 groundworks, pushed practical completion to mid-July" autoFocus />
        </Field>
      </Modal>

      <ConfirmDialog open={!!confirmDeleteTask} onClose={() => setConfirmDeleteTask(null)} onConfirm={() => deleteTask(confirmDeleteTask)} title="Delete task" message="Delete this task and all its sub-tasks? Other tasks depending on it will lose that link." danger />

      <ConfirmDialog open={confirmCloseDirty} onClose={() => setConfirmCloseDirty(false)} onConfirm={() => { setConfirmCloseDirty(false); onClose() }} title="Discard unsaved changes?" message="You have unsaved changes that will be lost if you close now." danger />
    </Overlay>
  )
}

// ─── Subcomponents ──────────────────────────────────────────

function Overlay({ children, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1500, display: 'flex', alignItems: 'stretch', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius)', width: '100%', maxWidth: 1700, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}

function AxisRender({ markers, pxPerDay, bounds, zoom }) {
  return (
    <div style={{ position: 'relative', height: HEADER_H }}>
      {/* Major labels (top) */}
      {markers.majorLabels.map((m, i) => (
        <div key={'majL' + i} style={{ position: 'absolute', left: m.x + 4, top: 4, fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>
          {m.label}
        </div>
      ))}
      {/* Minor labels (bottom) */}
      {markers.minor.map((m, i) => (
        <div key={'minL' + i} style={{ position: 'absolute', left: m.x, top: 28, fontSize: 9, color: 'var(--text3)', width: pxPerDay * (zoom === 'day' ? 1 : zoom === 'week' ? 7 : 30), textAlign: 'center' }}>
          {m.label}
        </div>
      ))}
    </div>
  )
}

function buildAxisMarkers(min, max, zoom) {
  // major: month boundaries (for all zooms) — drawn with month name + year
  // minor: day numbers (day zoom), week start dates (week zoom), or month abbrev (month zoom)
  const totalDays = diffDays(min, max) + 1
  const majorLabels = []
  const minor = []
  const major = []  // tick positions for vertical grid lines

  for (let i = 0; i < totalDays; i++) {
    const d = addDays(min, i)
    const dow = d.getUTCDay()
    const dayOfMonth = d.getUTCDate()
    const x = i * ZOOM_LEVELS[zoom].pxPerDay

    // Major: first of month
    if (dayOfMonth === 1) {
      majorLabels.push({ x, label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) })
      major.push({ x })
    }

    // Minor: depends on zoom
    if (zoom === 'day') {
      minor.push({ x, label: String(dayOfMonth) })
      // also weekly grid line on Mondays
      if (dow === 1) major.push({ x })
    } else if (zoom === 'week') {
      if (dow === 1 || i === 0) {
        minor.push({ x, label: String(dayOfMonth) })
        major.push({ x })
      }
    } else if (zoom === 'month') {
      if (dayOfMonth === 1) {
        minor.push({ x, label: d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) })
      }
    }
  }

  return { majorLabels, minor, major }
}

function TaskEditPanel({ task, allTasks, onChange, onGroupEnd, onDelete, onIndent, onOutdent, onMoveUp, onMoveDown, onClose }) {
  // Group rows (rows with children) derive their bar from their children, so
  // editing their End/Duration goes through the Stretch behaviour instead of
  // a plain field write (which would visibly do nothing).
  const isGroup = allTasks.some(x => x.parent_id === task.id)
  const dur = durationFromDates(parseDate(task.start_date), parseDate(task.end_date))

  return (
    <div style={{ width: 320, flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Task Details</div>
        <button className="btn btn-sm" onClick={onClose}>✕</button>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field label="Name">
          <input value={task.name} onChange={e => onChange({ name: e.target.value })} autoFocus />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8 }}>
          <Field label="Start">
            <input type="date" value={task.start_date}
              style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }}
              onChange={e => {
                const newStart = e.target.value
                const newEnd = endFromStartAndDuration(newStart, dur)
                onChange({ start_date: newStart, end_date: fmtDate(newEnd) })
              }} />
          </Field>
          <Field label="End">
            <input type="date" value={task.end_date}
              style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }}
              onChange={e => isGroup ? onGroupEnd(e.target.value) : onChange({ end_date: e.target.value })} />
            {isGroup && (
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
                Extends the task(s) finishing last in this group
              </div>
            )}
          </Field>
        </div>
        <Field label={`Duration (${dur} days)`}>
          <input type="number" min="1" value={dur}
            onChange={e => {
              const n = Math.max(1, parseInt(e.target.value, 10) || 1)
              const newEnd = endFromStartAndDuration(task.start_date, n)
              if (isGroup) onGroupEnd(fmtDate(newEnd))
              else onChange({ end_date: fmtDate(newEnd) })
            }} />
        </Field>
        <Field label="Progress (%)">
          {/* The CRM's global input CSS sets appearance:none, which strips a
              range slider of its track and thumb — leaving nothing to drag.
              Same fix as the radio buttons elsewhere: restore the native
              control appearance for this input only. */}
          <input type="range" min="0" max="100" value={task.progress || 0}
            onChange={e => onChange({ progress: parseInt(e.target.value, 10) })}
            style={{ appearance: 'auto', WebkitAppearance: 'auto', width: '100%', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', accentColor: '#448a40' }} />
          <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center', marginTop: 4 }}>{task.progress || 0}%</div>
        </Field>
        {!isGroup && (
          <Field label="Stage">
            <select value={task.stage || ''} onChange={e => {
              const st = e.target.value || null
              const patch = { stage: st }
              if (st && stageColor(st)) patch.color = stageColor(st)
              if (st === 'MILESTONE') patch.end_date = task.start_date
              onChange(patch)
            }}>
              <option value="">— Auto{effectiveStage(task) ? ` (${effectiveStage(task)})` : ''} —</option>
              {STAGES.map(st => <option key={st.key} value={st.key}>{st.key}</option>)}
            </select>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>Sets the bar colour and the STAGE column on exported programmes</div>
          </Field>
        )}
        <Field label="Color">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {COLORS.map(c => (
              <div key={c} onClick={() => onChange({ color: c })}
                style={{ width: 24, height: 24, borderRadius: 4, background: c, cursor: 'pointer', border: task.color === c ? '2px solid var(--text)' : '2px solid transparent' }} />
            ))}
          </div>
        </Field>
        <Field label="Notes">
          <textarea value={task.notes || ''} onChange={e => onChange({ notes: e.target.value })} placeholder="Optional notes / detail" style={{ minHeight: 60 }} />
        </Field>
      </div>
      <div style={{ padding: 12, borderTop: '1px solid var(--border)', marginTop: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
          <button className="btn btn-sm" onClick={onMoveUp}>↑ Move Up</button>
          <button className="btn btn-sm" onClick={onMoveDown}>↓ Move Down</button>
          <button className="btn btn-sm" onClick={onOutdent}>← Outdent</button>
          <button className="btn btn-sm" onClick={onIndent}>→ Indent</button>
        </div>
        <button className="btn btn-sm btn-danger" onClick={onDelete} style={{ width: '100%' }}><IconTrash size={12} /> Delete task</button>
      </div>
    </div>
  )
}
