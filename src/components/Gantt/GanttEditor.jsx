import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { Spinner, Modal, Field, IconPlus, IconTrash, ConfirmDialog } from '../ui'
import {
  parseDate, fmtDate, fmtDateUK, addDays, diffDays, DAY_MS,
  newTask, flattenTasks, getDateBounds, durationFromDates, endFromStartAndDuration, rollupGroups,
} from './ganttUtils'

const ZOOM_LEVELS = {
  day:   { name: 'Day',   pxPerDay: 28 },
  week:  { name: 'Week',  pxPerDay: 8  },
  month: { name: 'Month', pxPerDay: 3  },
}
const ROW_HEIGHT = 30
const TASK_LIST_W = 360
const HEADER_H = 56  // date axis area

const COLORS = ['#448a40','#378ADD','#BA7517','#993C1D','#3B6D11','#534AB7','#888780','#c00','#1F8A70']

export default function GanttEditor({ projectId, projectName, onClose, canEdit, initialTasks = null }) {
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
  const [versionNote, setVersionNote] = useState('')
  const [confirmDeleteTask, setConfirmDeleteTask] = useState(null)
  const [confirmCloseDirty, setConfirmCloseDirty] = useState(false)

  const timelineScrollRef = useRef(null)

  useEffect(() => { load() }, [projectId])

  async function load() {
    setLoading(true)
    try {
      // Find or create programme for this project
      let { data: prog } = await supabase.from('programmes').select('*').eq('project_id', projectId).maybeSingle()
      if (!prog && canEdit) {
        const { data: newProg, error } = await supabase.from('programmes').insert({ project_id: projectId }).select().single()
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
  async function exportPDF() {
    try {
      // Lazy-load jsPDF if not already
      const loadScript = (src) => new Promise((resolve, reject) => {
        const s = document.createElement('script'); s.src = src
        s.onload = resolve; s.onerror = () => reject(new Error('Failed to load ' + src))
        document.head.appendChild(s)
      })
      if (!window.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
      const { jsPDF } = window.jspdf

      // Load CCG logo
      let logoDataUrl = null
      try {
        const resp = await fetch('/cltd-logo.jpg')
        if (resp.ok) {
          const blob = await resp.blob()
          logoDataUrl = await new Promise(res => {
            const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(blob)
          })
        }
      } catch (e) { /* ignore */ }

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' })
      const pageW = doc.internal.pageSize.getWidth()   // 420mm
      const pageH = doc.internal.pageSize.getHeight()  // 297mm

      const drawLetterhead = () => {
        if (logoDataUrl) { try { doc.addImage(logoDataUrl, 'JPEG', pageW - 28, 8, 18, 18) } catch (e) {} }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(45, 45, 45)
        doc.text('City Construction Group', 15, 16)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90)
        doc.text('One Canada Square · Canary Wharf · London E14 5AA · 0203 948 1930 · info@cltd.co.uk · www.cltd.co.uk', 15, 22)
        doc.setDrawColor(207, 207, 207); doc.setLineWidth(0.2)
        doc.line(15, 26, pageW - 15, 26)
      }

      drawLetterhead()
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(45, 45, 45)
      doc.text(`Programme — ${projectName}`, 15, 34)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100, 100, 100)
      const versionLabel = activeVersion ? `Version ${activeVersion.version_number} · ${fmtDateUK(activeVersion.created_at)}` : 'Working draft'
      doc.text(`${versionLabel} · Generated: ${new Date().toLocaleString('en-GB')}`, 15, 40)

      // Build a versioned filename: '<Project> - Programme - v3 - 2026-04-27.pdf' or '... - draft - ...'
      const verPart = activeVersion ? `v${activeVersion.version_number}` : 'draft'
      const datePart = new Date().toISOString().slice(0, 10)
      const rawFileName = `${projectName} - Programme - ${verPart} - ${datePart}.pdf`
      // Strip filesystem-unsafe characters for both download and storage paths
      const safeFileName = rawFileName.replace(/[\/\\<>:"|?*]+/g, '').replace(/\s+/g, ' ').trim() || 'Programme.pdf'

      if (flat.length === 0) {
        doc.setFont('helvetica', 'italic'); doc.setTextColor(150, 150, 150)
        doc.text('No tasks in this programme yet.', pageW / 2, 80, { align: 'center' })
        doc.save(safeFileName)
        return
      }

      // Layout: PDF table-list-with-bars approach.
      // Left column: task names (~70mm). Right: timeline drawn as vector bars.
      const startY = 46
      const bottomY = pageH - 14
      const taskColW = 80  // mm, task name column
      const timelineX0 = 15 + taskColW + 4
      const timelineW = pageW - timelineX0 - 15
      const rowH = 5.5  // mm per task row
      const headerH = 12

      // Compute date range for the bars
      const minDate = bounds.min, maxDate = bounds.max
      const totalD = diffDays(minDate, maxDate) + 1
      const mmPerDay = timelineW / totalD

      const dayToXmm = (d) => timelineX0 + diffDays(minDate, parseDate(d)) * mmPerDay
      const todayDt = new Date()
      const todayInRange = todayDt >= minDate && todayDt <= maxDate
      const todayXmm = todayInRange ? timelineX0 + diffDays(minDate, todayDt) * mmPerDay : null

      // Draw header row (axis labels) — zoom-aware: matches the screen view's day/week/month setting
      const drawAxis = (yTop) => {
        // Box around axis row
        doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.2)
        doc.line(15, yTop, pageW - 15, yTop)  // top line
        doc.line(15, yTop + headerH, pageW - 15, yTop + headerH)  // bottom line
        // Vertical separator between task col and timeline
        doc.line(timelineX0 - 4, yTop, timelineX0 - 4, yTop + headerH)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(45, 45, 45)
        doc.text('Task', 17, yTop + 7.5)
        // Tick + label spacing per zoom level (mm of horizontal room each label needs to avoid overlap)
        const minLabelGapMm = 8
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(90, 90, 90)
        let lastLabelX = -100
        for (let i = 0; i < totalD; i++) {
          const d = addDays(minDate, i)
          const dow = d.getUTCDay()
          const dayOfMonth = d.getUTCDate()
          const x = timelineX0 + i * mmPerDay

          // Decide whether THIS day is a tick under the active zoom
          let isTick = false
          let label = null
          if (zoom === 'day') {
            // Tick every day; label every day if there's room
            isTick = true
            label = String(dayOfMonth)
            // Bold + month name on day-1 to give context
            if (dayOfMonth === 1) {
              label = d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric', timeZone: 'UTC' })
            }
          } else if (zoom === 'week') {
            // Tick on every Monday (and the very first day, in case range starts mid-week)
            if (dow === 1 || i === 0) {
              isTick = true
              label = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
            }
          } else {
            // month — tick on 1st of each month
            if (dayOfMonth === 1) {
              isTick = true
              label = d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
            }
          }

          if (!isTick) continue

          // Draw the tick line
          doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.1)
          doc.line(x, yTop, x, yTop + headerH)

          // Draw the label only if there's room since the last label (avoids overlap when range is large)
          if (label && (x - lastLabelX) > minLabelGapMm) {
            doc.setDrawColor(220, 220, 220)  // keep tick colour
            doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(90, 90, 90)
            doc.text(label, x + 1, yTop + 7.5)
            lastLabelX = x
          }
        }
      }

      // Draw each task page-by-page
      let cursorY = startY
      drawAxis(cursorY)
      cursorY += headerH

      for (let i = 0; i < flat.length; i++) {
        if (cursorY + rowH > bottomY) {
          doc.addPage()
          drawLetterhead()
          cursorY = 34
          drawAxis(cursorY)
          cursorY += headerH
        }
        const t = flat[i]
        // Row separator
        doc.setDrawColor(230, 230, 230); doc.setLineWidth(0.1)
        doc.line(15, cursorY + rowH, pageW - 15, cursorY + rowH)
        // Vertical separator
        doc.line(timelineX0 - 4, cursorY, timelineX0 - 4, cursorY + rowH)
        // Today line
        if (todayXmm !== null) {
          doc.setDrawColor(204, 0, 0); doc.setLineWidth(0.3)
          doc.setLineDashPattern([1, 1], 0)
          doc.line(todayXmm, cursorY, todayXmm, cursorY + rowH)
          doc.setLineDashPattern([], 0)
        }
        // Task name (with indent)
        doc.setFont('helvetica', t._hasChildren ? 'bold' : 'normal'); doc.setFontSize(8); doc.setTextColor(45, 45, 45)
        const nameX = 17 + t._depth * 3
        const nameMaxW = taskColW - (nameX - 15) - 4
        const nameLines = doc.splitTextToSize(t.name || '(untitled)', nameMaxW)
        doc.text(nameLines[0], nameX, cursorY + 4)
        // Bar
        const x = dayToXmm(t.start_date)
        const w = Math.max(0.6, durationFromDates(parseDate(t.start_date), parseDate(t.end_date)) * mmPerDay)
        // Convert hex color to RGB
        const hex = (t.color || '#448a40').replace('#', '')
        const r = parseInt(hex.substring(0, 2), 16) || 68
        const g = parseInt(hex.substring(2, 4), 16) || 138
        const b = parseInt(hex.substring(4, 6), 16) || 64
        if (t._hasChildren) {
          // Group bar — black bracket-style
          doc.setFillColor(60, 60, 60)
          doc.rect(x, cursorY + 1.5, w, 1.2, 'F')
          doc.setFillColor(60, 60, 60)
          doc.rect(x, cursorY + 0.5, 0.8, 3, 'F')
          doc.rect(x + w - 0.8, cursorY + 0.5, 0.8, 3, 'F')
        } else {
          doc.setFillColor(r, g, b)
          doc.roundedRect(x, cursorY + 1.5, w, rowH - 3, 0.5, 0.5, 'F')
          // Progress overlay
          if (t.progress > 0) {
            doc.setFillColor(0, 0, 0)
            doc.setGState(new doc.GState({ opacity: 0.25 }))
            doc.roundedRect(x, cursorY + 1.5, Math.max(0.3, w * (t.progress / 100)), rowH - 3, 0.5, 0.5, 'F')
            doc.setGState(new doc.GState({ opacity: 1 }))
          }
          // Date label after the bar (if there's room)
          if (w >= 8) {
            doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(255, 255, 255)
            const lbl = `${fmtDateUK(t.start_date)} → ${fmtDateUK(t.end_date)}`
            const textW = doc.getTextWidth(lbl)
            if (textW < w - 2) {
              doc.text(lbl, x + 1.5, cursorY + 4.2)
            }
          }
        }
        cursorY += rowH
      }

      // Footer on every page
      const pageCount = doc.internal.getNumberOfPages()
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(160, 160, 160)
        doc.text('City Construction Group', pageW / 2, pageH - 8, { align: 'center' })
        doc.text(`Page ${i} of ${pageCount}`, pageW - 15, pageH - 8, { align: 'right' })
      }

      doc.save(safeFileName)

      // Auto-save the same PDF into the project's '06. Project Programme' folder.
      // Failures are swallowed quietly — the user already has the download in hand.
      try {
        const arrayBuffer = doc.output('arraybuffer')
        const fileSize = arrayBuffer.byteLength
        const storagePath = `projects/${projectId}/06-project-programme/${Date.now()}-${safeFileName}`
        const blob = new Blob([arrayBuffer], { type: 'application/pdf' })
        const { error: upErr } = await supabase.storage.from('project-docs').upload(storagePath, blob, {
          contentType: 'application/pdf',
          upsert: false,
        })
        if (upErr) {
          console.warn('[Gantt] PDF auto-upload to storage failed:', upErr.message || upErr)
        } else {
          const { error: dbErr } = await supabase.from('project_doc_files').insert({
            project_id: projectId,
            folder_key: '06-project-programme',
            file_name: safeFileName,
            file_size: fileSize,
            storage_path: storagePath,
          })
          if (dbErr) console.warn('[Gantt] PDF auto-upload DB insert failed:', dbErr.message || dbErr)
        }
      } catch (e) {
        console.warn('[Gantt] PDF auto-upload threw:', e?.message || e)
      }
    } catch (err) {
      console.error('[Gantt] export PDF failed:', err)
      alert('Export failed: ' + (err?.message || err))
    }
  }

  // Add new task at root
  function addTask() {
    const t = newTask({})
    setTasks(prev => [...prev, t])
    setSelectedTaskId(t.id)
  }

  function updateTask(id, patch) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
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

  const selectedTask = tasks.find(t => t.id === selectedTaskId) || null

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
          <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ⏱ Live Programme — {projectName}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            {activeVersion ? `Version ${activeVersion.version_number} · ${fmtDateUK(activeVersion.created_at)}` : 'No saved versions yet'}
            {isDirty && <span style={{ color: '#b87a00', marginLeft: 8, fontWeight: 600 }}>• unsaved changes</span>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 0, border: '0.5px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}>
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
              style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, minWidth: 280, maxHeight: 320, overflow: 'auto', zIndex: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
              {versions.length === 0 && <div style={{ padding: 12, fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>No versions saved yet.</div>}
              {versions.map(v => (
                <div key={v.id} onClick={() => loadVersion(v.id)}
                  style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '0.5px solid var(--border)', background: activeVersion?.id === v.id ? 'var(--surface2)' : undefined }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>Version {v.version_number}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)' }}>{fmtDateUK(v.created_at)} · {v.profiles?.full_name || 'Unknown'}</div>
                  {v.notes && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2, fontStyle: 'italic' }}>"{v.notes}"</div>}
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
        <div ref={timelineScrollRef} style={{ flex: 1, overflow: 'auto', position: 'relative', background: 'var(--surface)' }}>
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
                  {/* The bar */}
                  <div title={`${t.name} · ${fmtDateUK(t.start_date)} → ${fmtDateUK(t.end_date)}`}
                    style={{
                      position: 'absolute', left: pos.x, top: 6, width: pos.w, height: ROW_HEIGHT - 12,
                      background: isGroup ? '#333' : (t.color || '#448a40'),
                      borderRadius: isGroup ? 0 : 4,
                      borderLeft: isGroup ? `4px solid ${t.color || '#000'}` : 'none',
                      borderRight: isGroup ? `4px solid ${t.color || '#000'}` : 'none',
                      display: 'flex', alignItems: 'center', paddingLeft: 6,
                      fontSize: 10, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden',
                      boxShadow: isSelected ? '0 0 0 2px var(--accent)' : 'none',
                    }}>
                    {/* Progress overlay */}
                    {t.progress > 0 && !isGroup && (
                      <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${t.progress}%`, background: 'rgba(0,0,0,0.25)', borderRadius: 4 }} />
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
      <div style={{ background: 'var(--bg)', borderRadius: 8, width: '100%', maxWidth: 1700, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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

function TaskEditPanel({ task, allTasks, onChange, onDelete, onIndent, onOutdent, onMoveUp, onMoveDown, onClose }) {
  const dur = durationFromDates(parseDate(task.start_date), parseDate(task.end_date))

  return (
    <div style={{ width: 320, flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Task Details</div>
        <button className="btn btn-sm" onClick={onClose}>✕</button>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field label="Name">
          <input value={task.name} onChange={e => onChange({ name: e.target.value })} autoFocus />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Start">
            <input type="date" value={task.start_date}
              onChange={e => {
                const newStart = e.target.value
                const newEnd = endFromStartAndDuration(newStart, dur)
                onChange({ start_date: newStart, end_date: fmtDate(newEnd) })
              }} />
          </Field>
          <Field label="End">
            <input type="date" value={task.end_date} onChange={e => onChange({ end_date: e.target.value })} />
          </Field>
        </div>
        <Field label={`Duration (${dur} days)`}>
          <input type="number" min="1" value={dur}
            onChange={e => {
              const n = Math.max(1, parseInt(e.target.value, 10) || 1)
              const newEnd = endFromStartAndDuration(task.start_date, n)
              onChange({ end_date: fmtDate(newEnd) })
            }} />
        </Field>
        <Field label="Progress (%)">
          <input type="range" min="0" max="100" value={task.progress || 0}
            onChange={e => onChange({ progress: parseInt(e.target.value, 10) })} />
          <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center', marginTop: 4 }}>{task.progress || 0}%</div>
        </Field>
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
