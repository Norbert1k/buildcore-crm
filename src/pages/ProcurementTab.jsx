import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

// ── Project Procurement tab ──────────────────────────────────────────────────
// Staged trade tracker, one per project. Mirrors the CCG build-sequence
// template. Each trade tracks materials/labour procured, who from, status,
// target date and notes. Stages and trades can be added, deleted and reordered.
//
// Merton is a special case: 3 buildings in one project (Residential Block,
// Sports Hall, Changing Room), each with its own independent tracker shown
// under sub-tabs.
//
// Auto-feed: "Procured from" can be filled by matching a trade name to an
// appointed subcontractor / design-team company already on the project.
//
// Persistence: the whole tracker is one JSONB document in project_procurement.
//   • normal project:      { stages: [...] }
//   • multi-building (Merton): { buildings: { residential: {stages}, ... } }
// Autosaves shortly after any edit.

const STATUS_OPTIONS = ['Not started', 'Quoting', 'Ordered', 'On site', 'Complete']

// Merton's fixed building set. Detected by project name containing "Merton".
const MERTON_BUILDINGS = [
  { key: 'residential', label: 'Residential Block' },
  { key: 'sports_hall', label: 'Sports Hall' },
  { key: 'changing_room', label: 'Changing Room' },
]
function isMerton(project) {
  return /merton/i.test(project?.project_name || '')
}

// Default template — mirrors CCG_Procurement_Tracker_Template.xlsx. Seeded the
// first time a project's Procurement tab is opened.
const TEMPLATE = [
  ['Stage 1 · Design team', ['Architect', 'Structural engineer', 'M&E / services engineer', 'Civil engineer', 'Principal designer (CDM)', 'Quantity surveyor']],
  ['Stage 2 · Reports & surveys', ['Topographical survey', 'Ground investigation / soil report', 'Measured building survey', 'Asbestos survey', 'Arboricultural survey', 'Drainage / CCTV survey', 'Party wall surveyor']],
  ['Stage 3 · Enabling & demolition', ['Site setup / hoarding / welfare', 'Scaffolding', 'Demolition', 'Site clearance', 'Temporary works']],
  ['Stage 4 · Groundworks & civils', ['Excavation & muck away', 'Foundations & concrete', 'Drainage below ground', 'Ground floor slab', 'Substructure brick/block', 'External services / ducting']],
  ['Stage 5 · Structure', ['Structural steelwork', 'Structural timber / frame', 'Masonry superstructure', 'Precast / beam & block floors', 'Roof structure', 'Staircases']],
  ['Stage 6 · Envelope & weatherproofing', ['Roof covering', 'Windows & external doors', 'Cladding / render', 'Brickwork / facing', 'Rainwater goods', 'External waterproofing / tanking']],
  ['Stage 7 · First fix', ['First fix carpentry', 'First fix electrical', 'First fix plumbing & heating', 'Mechanical ventilation', 'Underfloor heating', 'Insulation']],
  ['Stage 8 · Second fix & finishes', ['Plastering / drylining', 'Second fix carpentry', 'Second fix electrical', 'Second fix plumbing', 'Kitchens', 'Tiling', 'Decoration', 'Flooring']],
  ['Stage 9 · External works & landscaping', ['Hard landscaping / paving', 'Soft landscaping', 'Boundary walls & fencing', 'Drainage above ground', 'Road / driveway surfacing', 'External lighting']],
  ['Stage 10 · Completion & handover', ['Commissioning M&E', 'Building control sign-off', 'Snagging', 'As-built drawings / O&M manuals', 'Cleaning', 'Handover']],
]

const uid = () => Math.random().toString(36).slice(2, 10)

function makeTrade(name) {
  return { id: uid(), name, materials: false, labour: false, procured_from: '', status: 'Not started', target_date: '', notes: '' }
}
function buildTemplate() {
  return { stages: TEMPLATE.map(([name, trades]) => ({ id: uid(), name, trades: trades.map(makeTrade) })) }
}

export default function ProcurementTab({ projectId, project, appointed = [] }) {
  const merton = isMerton(project)
  const [activeBuilding, setActiveBuilding] = useState(MERTON_BUILDINGS[0].key)
  const [doc, setDoc] = useState(null)          // full persisted document
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState('')   // '', 'saving', 'saved'
  const [collapsed, setCollapsed] = useState({})   // stageId -> bool
  const saveTimer = useRef(null)
  const firstLoad = useRef(true)

  // The active stages array depends on whether this is a multi-building project.
  const data = merton
    ? (doc?.buildings?.[activeBuilding] || { stages: [] })
    : (doc || { stages: [] })

  useEffect(() => { load() }, [projectId])

  // Autosave shortly after any doc change (skip the very first set from load).
  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return }
    if (!doc) return
    setSaveState('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(save, 800)
    return () => clearTimeout(saveTimer.current)
  }, [doc])

  async function load() {
    setLoading(true); setError('')
    const { data: row, error: e } = await supabase
      .from('project_procurement')
      .select('data')
      .eq('project_id', projectId)
      .maybeSingle()
    if (e) { setError('Could not load procurement: ' + e.message); setLoading(false); return }
    firstLoad.current = true
    if (merton) {
      // Seed any missing buildings with the template.
      const existing = row?.data?.buildings || {}
      const buildings = {}
      for (const b of MERTON_BUILDINGS) {
        buildings[b.key] = existing[b.key]?.stages?.length ? existing[b.key] : buildTemplate()
      }
      setDoc({ buildings })
    } else {
      if (row?.data?.stages?.length) setDoc(row.data)
      else setDoc(buildTemplate())
    }
    setLoading(false)
  }

  async function save() {
    const { error: e } = await supabase
      .from('project_procurement')
      .upsert({ project_id: projectId, data: doc, updated_at: new Date().toISOString() }, { onConflict: 'project_id' })
    if (e) { setError('Save failed: ' + e.message); setSaveState(''); return }
    setSaveState('saved')
    setTimeout(() => setSaveState(''), 1500)
  }

  // Write a new stages array back into the document, respecting building shape.
  function setStages(updater) {
    setDoc(d => {
      if (merton) {
        const cur = d.buildings[activeBuilding] || { stages: [] }
        const nextStages = typeof updater === 'function' ? updater(cur.stages) : updater
        return { ...d, buildings: { ...d.buildings, [activeBuilding]: { stages: nextStages } } }
      } else {
        const nextStages = typeof updater === 'function' ? updater(d.stages) : updater
        return { ...d, stages: nextStages }
      }
    })
  }

  // ── Mutators (all produce a fresh object so autosave fires) ──
  function updateTrade(si, ti, field, value) {
    setStages(stages => stages.map((s, i) => i !== si ? s : {
      ...s, trades: s.trades.map((t, j) => j !== ti ? t : { ...t, [field]: value }),
    }))
  }
  function addTrade(si) {
    setStages(stages => stages.map((s, i) => i !== si ? s : { ...s, trades: [...s.trades, makeTrade('')] }))
  }
  function removeTrade(si, ti) {
    setStages(stages => stages.map((s, i) => i !== si ? s : { ...s, trades: s.trades.filter((_, j) => j !== ti) }))
  }
  function moveTrade(si, ti, dir) {
    setStages(stages => {
      const s = stages[si]; const arr = [...s.trades]; const ni = ti + dir
      if (ni < 0 || ni >= arr.length) return stages
      ;[arr[ti], arr[ni]] = [arr[ni], arr[ti]]
      return stages.map((x, i) => i === si ? { ...x, trades: arr } : x)
    })
  }
  function addStage() {
    setStages(stages => [...stages, { id: uid(), name: `Stage ${stages.length + 1} · New stage`, trades: [] }])
  }
  function removeStage(si) {
    if (!confirm('Delete this whole stage and its trades?')) return
    setStages(stages => stages.filter((_, i) => i !== si))
  }
  function renameStage(si, name) {
    setStages(stages => stages.map((s, i) => i === si ? { ...s, name } : s))
  }
  function moveStage(si, dir) {
    setStages(stages => {
      const arr = [...stages]; const ni = si + dir
      if (ni < 0 || ni >= arr.length) return stages
      ;[arr[si], arr[ni]] = [arr[ni], arr[si]]
      return arr
    })
  }
  function resetToTemplate() {
    if (!confirm('Reset to the default CCG template? This replaces the current list for this' + (merton ? ' building.' : ' project.'))) return
    firstLoad.current = false
    setStages(buildTemplate().stages)
  }

  // Auto-feed: fill empty "Procured from" by matching the trade name to an
  // appointed company. Never overwrites an existing value.
  function autoFeed() {
    setStages(stages => stages.map(s => ({
      ...s,
      trades: s.trades.map(t => {
        if (t.procured_from && t.procured_from.trim()) return t
        const match = matchAppointed(t.name, appointed)
        return match ? { ...t, procured_from: match } : t
      }),
    })))
  }

  // ── Exports ──
  function exportCSV() {
    const rows = [['Stage', 'Trade / element', 'Materials', 'Labour', 'Procured from', 'Status', 'Target date', 'Notes']]
    for (const s of data.stages) for (const t of s.trades) {
      rows.push([s.name, t.name, t.materials ? 'Y' : 'N', t.labour ? 'Y' : 'N', t.procured_from || '', t.status || '', t.target_date || '', t.notes || ''])
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(project?.project_name || 'project')}_procurement${merton ? '_' + activeBuilding : ''}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function exportPDF() {
    try {
      if (!window.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
      if (!window.jspdf?.jsPDF?.API?.autoTable) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js')
      const { jsPDF } = window.jspdf
      const docPdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const pageW = docPdf.internal.pageSize.getWidth()
      docPdf.setFont('helvetica', 'bold'); docPdf.setFontSize(14); docPdf.setTextColor(45, 45, 45)
      docPdf.text('City Construction Group', 15, 16)
      docPdf.setFont('helvetica', 'normal'); docPdf.setFontSize(7.5); docPdf.setTextColor(90, 90, 90)
      docPdf.text('One Canada Square, Canary Wharf, London E14 5AA', 15, 22)
      docPdf.setFont('helvetica', 'bold'); docPdf.setFontSize(11); docPdf.setTextColor(68, 138, 64)
      const heading = `Procurement — ${project?.project_name || ''}${merton ? ' · ' + (MERTON_BUILDINGS.find(b => b.key === activeBuilding)?.label || '') : ''}`
      docPdf.text(heading, 15, 32)

      const body = []
      for (const s of data.stages) {
        body.push([{ content: s.name, colSpan: 7, styles: { fontStyle: 'bold', fillColor: [232, 240, 231], textColor: [47, 94, 44] } }])
        for (const t of s.trades) {
          body.push([t.name, t.materials ? 'Y' : '', t.labour ? 'Y' : '', t.procured_from || '', t.status || '', t.target_date || '', t.notes || ''])
        }
      }
      docPdf.autoTable({
        startY: 38,
        head: [['Trade / element', 'Mat', 'Lab', 'Procured from', 'Status', 'Target', 'Notes']],
        body,
        styles: { fontSize: 8, cellPadding: 1.5 },
        headStyles: { fillColor: [68, 138, 64], textColor: 255, fontSize: 8 },
        columnStyles: { 1: { halign: 'center', cellWidth: 12 }, 2: { halign: 'center', cellWidth: 12 } },
        margin: { left: 15, right: 15 },
      })
      docPdf.save(`${(project?.project_name || 'project')}_procurement${merton ? '_' + activeBuilding : ''}.pdf`)
    } catch (e) {
      setError('PDF export failed: ' + e.message)
    }
  }

  if (loading) return <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13 }}>Loading procurement…</div>
  if (!doc) return null

  // Progress: count materials+labour ticks done vs total.
  let done = 0, total = 0
  for (const s of data.stages) for (const t of s.trades) { total += 2; if (t.materials) done++; if (t.labour) done++ }
  const pct = total ? Math.round((done / total) * 100) : 0

  return (
    <div style={{ padding: '4px 0 24px' }}>
      {error && <div style={{ padding: '9px 12px', borderRadius: 6, background: '#FAECE7', color: '#993C1D', fontSize: 12, marginBottom: 12 }}>{error}</div>}

      {/* Merton building sub-tabs */}
      {merton && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '0.5px solid var(--border)' }}>
          {MERTON_BUILDINGS.map(b => (
            <div key={b.key} onClick={() => setActiveBuilding(b.key)}
              style={{
                padding: '7px 14px', fontSize: 13, cursor: 'pointer',
                fontWeight: activeBuilding === b.key ? 600 : 400,
                color: activeBuilding === b.key ? 'var(--text)' : 'var(--text3)',
                borderBottom: activeBuilding === b.key ? '2px solid #185FA5' : '2px solid transparent',
              }}>
              {b.label}
            </div>
          ))}
        </div>
      )}

      {/* Header + progress */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 10, background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', minWidth: pct > 0 ? 4 : 0, background: pct === 100 ? 'var(--green, #5cb85c)' : '#185FA5', transition: 'width .2s' }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: pct > 0 ? 'var(--text)' : 'var(--text2)', whiteSpace: 'nowrap' }}>{pct}%</span>
            <span style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{done}/{total} procured</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {saveState === 'saving' && <span style={{ fontSize: 11, color: 'var(--text3)' }}>Saving…</span>}
          {saveState === 'saved' && <span style={{ fontSize: 11, color: 'var(--green)' }}>Saved</span>}
          {appointed.length > 0 && <button className="btn btn-sm" onClick={autoFeed} title="Fill 'Procured from' from the appointed team & subcontractors">⤵ Auto-fill from team</button>}
          <button className="btn btn-sm" onClick={exportCSV}>Export Excel</button>
          <button className="btn btn-sm" onClick={exportPDF}>Export PDF</button>
          <button className="btn btn-sm" onClick={addStage}>+ Stage</button>
          <button className="btn btn-sm" onClick={resetToTemplate}>Reset</button>
        </div>
      </div>

      {/* Stages */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.stages.map((stage, si) => {
          const isC = collapsed[stage.id]
          let sd = 0, st = 0
          for (const t of stage.trades) { st += 2; if (t.materials) sd++; if (t.labour) sd++ }
          return (
            <div key={stage.id} style={{ border: '0.5px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              {/* Stage header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--surface2)' }}>
                <button onClick={() => setCollapsed(c => ({ ...c, [stage.id]: !isC }))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text2)', fontSize: 13, padding: 0, width: 16 }}>
                  {isC ? '▸' : '▾'}
                </button>
                <input value={stage.name} onChange={e => renameStage(si, e.target.value)}
                  style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, background: 'none', border: 'none', padding: '2px 4px' }} />
                <span style={{ fontSize: 11, color: sd === st && st > 0 ? 'var(--green)' : 'var(--text3)', whiteSpace: 'nowrap' }}>{sd}/{st}</span>
                <div style={{ display: 'flex', gap: 2 }}>
                  <button onClick={() => moveStage(si, -1)} disabled={si === 0} style={iconBtn}>↑</button>
                  <button onClick={() => moveStage(si, 1)} disabled={si === data.stages.length - 1} style={iconBtn}>↓</button>
                  <button onClick={() => removeStage(si)} style={{ ...iconBtn, color: 'var(--red)' }}>✕</button>
                </div>
              </div>

              {!isC && (
                <div>
                  {/* Column header */}
                  <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 6, padding: '6px 10px', fontSize: 10, color: 'var(--text3)', borderTop: '0.5px solid var(--border)' }}>
                    <span>TRADE / ELEMENT</span>
                    <span style={{ textAlign: 'center' }}>MAT</span>
                    <span style={{ textAlign: 'center' }}>LAB</span>
                    <span>PROCURED FROM</span>
                    <span>STATUS</span>
                    <span>TARGET</span>
                    <span>NOTES</span>
                    <span></span>
                  </div>
                  {stage.trades.length === 0 && (
                    <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text3)' }}>No trades in this stage yet.</div>
                  )}
                  {stage.trades.map((t, ti) => (
                    <div key={t.id} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 6, padding: '5px 10px', borderTop: '0.5px solid var(--border)', alignItems: 'center' }}>
                      <input value={t.name} onChange={e => updateTrade(si, ti, 'name', e.target.value)} placeholder="trade / element" style={{ fontSize: 12 }} />
                      <span style={{ textAlign: 'center' }}><Tick on={t.materials} onClick={() => updateTrade(si, ti, 'materials', !t.materials)} /></span>
                      <span style={{ textAlign: 'center' }}><Tick on={t.labour} onClick={() => updateTrade(si, ti, 'labour', !t.labour)} /></span>
                      <input value={t.procured_from} onChange={e => updateTrade(si, ti, 'procured_from', e.target.value)} placeholder="supplier / subbie" style={{ fontSize: 12 }} />
                      <select value={t.status} onChange={e => updateTrade(si, ti, 'status', e.target.value)} style={{ fontSize: 12 }}>
                        {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                      <input type="date" value={t.target_date || ''} onChange={e => updateTrade(si, ti, 'target_date', e.target.value)} style={{ fontSize: 11 }} />
                      <input value={t.notes} onChange={e => updateTrade(si, ti, 'notes', e.target.value)} placeholder="—" style={{ fontSize: 12 }} />
                      <div style={{ display: 'flex', gap: 2 }}>
                        <button onClick={() => moveTrade(si, ti, -1)} disabled={ti === 0} style={iconBtn}>↑</button>
                        <button onClick={() => moveTrade(si, ti, 1)} disabled={ti === stage.trades.length - 1} style={iconBtn}>↓</button>
                        <button onClick={() => removeTrade(si, ti)} style={{ ...iconBtn, color: 'var(--red)' }}>✕</button>
                      </div>
                    </div>
                  ))}
                  <div style={{ padding: '6px 10px', borderTop: '0.5px solid var(--border)' }}>
                    <button className="btn btn-sm" onClick={() => addTrade(si)}>+ Add trade</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Custom tick box — explicit size + appearance so the global input{width:100%}
// CSS can't blow it up.
function Tick({ on, onClick }) {
  return (
    <button onClick={onClick} aria-pressed={on}
      style={{
        width: 18, height: 18, borderRadius: 4, cursor: 'pointer', padding: 0,
        border: `1.5px solid ${on ? 'var(--green, #5cb85c)' : 'var(--border)'}`,
        background: on ? 'var(--green, #5cb85c)' : 'transparent',
        color: '#fff', fontSize: 12, lineHeight: '14px', display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center',
      }}>
      {on ? '✓' : ''}
    </button>
  )
}

const GRID = '1.6fr 36px 36px 1.2fr 1fr 1fr 1.4fr 56px'
const iconBtn = {
  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)',
  fontSize: 12, padding: '2px 4px', lineHeight: 1,
}

// Match a trade name to an appointed company by overlapping words against the
// company's trade/role. `appointed` = [{ company, trade }]. Returns the best
// company name or null. Conservative: needs a real word overlap, ignores
// short/common words.
function matchAppointed(tradeName, appointed) {
  if (!tradeName || !appointed?.length) return null
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
  const stop = new Set(['and', 'the', 'of', 'to', 'for', 'works', 'work', 'fix', 'first', 'second', 'below', 'above', 'ground', 'external', 'internal'])
  const tnWords = new Set(norm(tradeName).split(/\s+/).filter(w => w.length > 2 && !stop.has(w)))
  if (tnWords.size === 0) return null
  let best = null, bestScore = 0
  for (const a of appointed) {
    const roleWords = norm(a.trade).split(/\s+/).filter(w => w.length > 2 && !stop.has(w))
    let score = 0
    for (const w of roleWords) if (tnWords.has(w)) score++
    if (score > bestScore) { bestScore = score; best = a.company }
  }
  return bestScore >= 1 ? best : null
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src; s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })
}

