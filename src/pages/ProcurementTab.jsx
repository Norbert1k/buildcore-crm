import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

// ── Project Procurement tab ──────────────────────────────────────────────────
// Staged trade tracker, one per project. Mirrors the CCG build-sequence
// template. Each trade tracks materials/labour procured, who from, status,
// target date and notes. Stages and trades can be added, deleted and reordered.
//
// Persistence: the whole tracker is one JSONB document in project_procurement.
// Autosaves shortly after any edit.

const STATUS_OPTIONS = ['Not started', 'Quoting', 'Ordered', 'On site', 'Complete']

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

export default function ProcurementTab({ projectId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState('')   // '', 'saving', 'saved'
  const [collapsed, setCollapsed] = useState({})   // stageId -> bool
  const saveTimer = useRef(null)
  const firstLoad = useRef(true)

  useEffect(() => { load() }, [projectId])

  // Autosave shortly after any data change (skip the very first set from load).
  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return }
    if (!data) return
    setSaveState('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(save, 800)
    return () => clearTimeout(saveTimer.current)
  }, [data])

  async function load() {
    setLoading(true); setError('')
    const { data: row, error: e } = await supabase
      .from('project_procurement')
      .select('data')
      .eq('project_id', projectId)
      .maybeSingle()
    if (e) { setError('Could not load procurement: ' + e.message); setLoading(false); return }
    firstLoad.current = true
    if (row?.data?.stages?.length) {
      setData(row.data)
    } else {
      // First open — seed the template (not yet persisted; saves on first edit
      // or via the explicit Save button).
      setData(buildTemplate())
    }
    setLoading(false)
  }

  async function save() {
    const { error: e } = await supabase
      .from('project_procurement')
      .upsert({ project_id: projectId, data, updated_at: new Date().toISOString() }, { onConflict: 'project_id' })
    if (e) { setError('Save failed: ' + e.message); setSaveState(''); return }
    setSaveState('saved')
    setTimeout(() => setSaveState(''), 1500)
  }

  // ── Mutators (all produce a fresh object so autosave fires) ──
  function updateTrade(si, ti, field, value) {
    setData(d => {
      const stages = d.stages.map((s, i) => i !== si ? s : {
        ...s, trades: s.trades.map((t, j) => j !== ti ? t : { ...t, [field]: value }),
      })
      return { ...d, stages }
    })
  }
  function addTrade(si) {
    setData(d => ({ ...d, stages: d.stages.map((s, i) => i !== si ? s : { ...s, trades: [...s.trades, makeTrade('')] }) }))
  }
  function removeTrade(si, ti) {
    setData(d => ({ ...d, stages: d.stages.map((s, i) => i !== si ? s : { ...s, trades: s.trades.filter((_, j) => j !== ti) }) }))
  }
  function moveTrade(si, ti, dir) {
    setData(d => {
      const s = d.stages[si]; const arr = [...s.trades]; const ni = ti + dir
      if (ni < 0 || ni >= arr.length) return d
      ;[arr[ti], arr[ni]] = [arr[ni], arr[ti]]
      return { ...d, stages: d.stages.map((x, i) => i === si ? { ...x, trades: arr } : x) }
    })
  }
  function addStage() {
    setData(d => ({ ...d, stages: [...d.stages, { id: uid(), name: `Stage ${d.stages.length + 1} · New stage`, trades: [] }] }))
  }
  function removeStage(si) {
    if (!confirm('Delete this whole stage and its trades?')) return
    setData(d => ({ ...d, stages: d.stages.filter((_, i) => i !== si) }))
  }
  function renameStage(si, name) {
    setData(d => ({ ...d, stages: d.stages.map((s, i) => i === si ? { ...s, name } : s) }))
  }
  function moveStage(si, dir) {
    setData(d => {
      const arr = [...d.stages]; const ni = si + dir
      if (ni < 0 || ni >= arr.length) return d
      ;[arr[si], arr[ni]] = [arr[ni], arr[si]]
      return { ...d, stages: arr }
    })
  }
  function resetToTemplate() {
    if (!confirm('Reset to the default CCG template? This replaces the current list for this project.')) return
    firstLoad.current = false
    setData(buildTemplate())
  }

  if (loading) return <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13 }}>Loading procurement…</div>
  if (!data) return null

  // Progress: count materials+labour ticks done vs total.
  let done = 0, total = 0
  for (const s of data.stages) for (const t of s.trades) { total += 2; if (t.materials) done++; if (t.labour) done++ }
  const pct = total ? Math.round((done / total) * 100) : 0

  return (
    <div style={{ padding: '4px 0 24px' }}>
      {error && <div style={{ padding: '9px 12px', borderRadius: 6, background: '#FAECE7', color: '#993C1D', fontSize: 12, marginBottom: 12 }}>{error}</div>}

      {/* Header + progress */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--green, #5cb85c)' }} />
            </div>
            <span style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{pct}% procured</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {saveState === 'saving' && <span style={{ fontSize: 11, color: 'var(--text3)' }}>Saving…</span>}
          {saveState === 'saved' && <span style={{ fontSize: 11, color: 'var(--green)' }}>Saved</span>}
          <button className="btn btn-sm" onClick={addStage}>+ Stage</button>
          <button className="btn btn-sm" onClick={resetToTemplate}>Reset template</button>
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
