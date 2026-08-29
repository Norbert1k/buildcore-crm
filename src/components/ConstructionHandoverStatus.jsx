import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ─────────────────────────────────────────────────────────────────────────────
// ConstructionHandoverStatus — the completeness / sign-off / release layer for
// the CONSTRUCTION H&S Handover. Rides ABOVE the existing folder tree:
//   • HSHandover.jsx is not modified; hs_files / hs_folders are never touched
//   • expected-documents checklist per top-level section → live completeness
//   • two-step sign-off (SM check → lead counter-sign), as in fit-out
//   • per-section client release flag (recorded now; portal render = phase 2)
// State lives in the same tables as the fit-out pack (fitout_handover_* — the
// name is historical; keys 'cs*' never collide with fit-out's section keys).
// ─────────────────────────────────────────────────────────────────────────────

const SECTIONS = [
  { key: 'cs1',  label: 'Section 1 | H&S File' },
  { key: 'cs2',  label: 'Section 2 | Project Directory' },
  { key: 'cs3',  label: 'Section 3 | Record Drawings' },
  { key: 'cs4',  label: 'Section 4 | Construction Materials' },
  { key: 'cs5',  label: 'Section 5 | Health and Safety' },
  { key: 'cs6',  label: 'Section 6 | Structural Design' },
  { key: 'cs7',  label: 'Section 7 | Services' },
  { key: 'cs8',  label: 'Section 8 | O&M Manuals' },
  { key: 'cs9',  label: 'Section 9 | Commissioning Documents' },
  { key: 'cs10', label: 'Section 10 | Operating Documents' },
  { key: 'cs11', label: 'Section 11 | Certificates' },
]

const DEFAULT_CHECKS = {
  cs1:  ['Construction phase plan (as final)', 'Residual risks register', 'F10 notification copy', 'Asbestos survey / register', 'Pre-construction information (archived)'],
  cs2:  ['Contractor directory', 'Consultant directory', 'Key contacts & emergency numbers'],
  cs3:  ['As-built architectural drawings', 'Structural as-builts', 'M&E as-builts', 'Fire strategy drawings'],
  cs4:  ['External envelope materials & specs', 'Internal materials & finishes schedule', 'COSHH data sheets'],
  cs5:  ['Fire risk assessment (handover)', 'Fire stopping records', 'Working-at-height / access strategy for maintenance'],
  cs6:  ['Structural calculations (as-built)', 'Structural certificates & warranties'],
  cs7:  ['Mechanical installation records', 'Electrical installation certificates (EIC)', 'Public health / drainage records'],
  cs8:  ['O&M manuals — mechanical', 'O&M manuals — electrical', 'O&M manuals — lifts / specialist plant'],
  cs9:  ['HVAC commissioning records', 'Water treatment & flushing certificates', 'Fire alarm commissioning'],
  cs10: ['User guides', 'Maintenance schedules', 'Cleaning regimes'],
  cs11: ['Building Control completion certificate', 'Gas certificates', 'Electrical certificates', 'Warranties & guarantees schedule'],
}

const LEAD_ROLES = ['admin', 'project_manager', 'operations_manager', 'project_director']
function ts() { return new Date().toISOString() }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '' }

export default function ConstructionHandoverStatus({ projectId }) {
  const { profile, role } = useAuth()
  const isLead = LEAD_ROLES.includes(role)
  const canEdit = isLead || role === 'site_manager'
  const [sections, setSections] = useState([])
  const [checks, setChecks] = useState([])
  const [names, setNames] = useState({})
  const [open, setOpen] = useState(false)          // whole strip collapsed by default
  const [openKeys, setOpenKeys] = useState(() => new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => { init() }, [projectId])

  async function init() {
    setLoading(true)
    const keys = SECTIONS.map(s => s.key)
    let { data: secRows } = await supabase.from('fitout_handover_sections')
      .select('*').eq('project_id', projectId).in('section_key', keys)
    if (!secRows || secRows.length === 0) {
      await supabase.from('fitout_handover_sections').insert(SECTIONS.map(s => ({ project_id: projectId, section_key: s.key, enabled: true })))
      await supabase.from('fitout_handover_checks').insert(SECTIONS.flatMap(s => (DEFAULT_CHECKS[s.key] || []).map((label, i) => ({
        project_id: projectId, section_key: s.key, item_key: `${s.key}_${i}`, label, sort: i,
      }))))
      secRows = (await supabase.from('fitout_handover_sections').select('*').eq('project_id', projectId).in('section_key', keys)).data || []
    }
    const [{ data: chkRows }, { data: profRows }] = await Promise.all([
      supabase.from('fitout_handover_checks').select('*').eq('project_id', projectId).in('section_key', keys).order('sort'),
      supabase.from('profiles').select('id, full_name'),
    ])
    setSections(secRows || [])
    setChecks(chkRows || [])
    setNames(Object.fromEntries((profRows || []).map(p => [p.id, p.full_name])))
    setLoading(false)
  }

  const secRow = k => sections.find(s => s.section_key === k)
  const secChecks = k => checks.filter(c => c.section_key === k)

  async function toggleCheck(item) {
    if (!canEdit) return
    const done = !item.done
    setChecks(prev => prev.map(c => c.id === item.id ? { ...c, done, done_by: done ? profile?.id : null, done_at: done ? ts() : null } : c))
    await supabase.from('fitout_handover_checks').update({ done, done_by: done ? profile?.id : null, done_at: done ? ts() : null }).eq('id', item.id)
  }
  async function patchSection(key, patch) {
    setSections(prev => prev.map(s => s.section_key === key ? { ...s, ...patch } : s))
    await supabase.from('fitout_handover_sections').update(patch).eq('project_id', projectId).eq('section_key', key)
  }
  const smCheck = k => canEdit && patchSection(k, { sm_checked_by: profile?.id, sm_checked_at: ts() })
  const leadSign = k => isLead && patchSection(k, { lead_signed_by: profile?.id, lead_signed_at: ts() })
  const setReleased = (k, released) => isLead && patchSection(k, { released, released_at: released ? ts() : null })
  function reopen(k) {
    if (!isLead) return
    if (!window.confirm('Reopen this section? Sign-offs are cleared and it is withdrawn from client release.')) return
    patchSection(k, { sm_checked_by: null, sm_checked_at: null, lead_signed_by: null, lead_signed_at: null, released: false, released_at: null })
  }

  const allChecks = checks
  const doneCount = allChecks.filter(c => c.done).length
  const signedCount = sections.filter(s => s.lead_signed_at).length
  const releasedCount = sections.filter(s => s.released).length
  const pct = allChecks.length ? Math.round((doneCount / allChecks.length) * 100) : 0
  const missing = allChecks.filter(c => !c.done)

  if (loading) return null

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      {/* Rollup header — always visible */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px', cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Handover readiness</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{pct}% complete · {signedCount}/{SECTIONS.length} sections signed off</div>
        </div>
        <div style={{ flex: 1, minWidth: 120 }}>
          <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: pct + '%', height: '100%', background: pct === 100 ? 'var(--green)' : 'var(--accent)' }} />
          </div>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>{missing.length} item{missing.length === 1 ? '' : 's'} outstanding · {releasedCount} released to client</span>
        <span style={{ color: 'var(--text3)' }}>{open ? '▴' : '▾'}</span>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px' }}>
          <p style={{ fontSize: 11, color: 'var(--text3)', margin: '0 0 10px' }}>
            Checklist tracks what the pack should contain; the folder tree below holds the files themselves. Ticks, sign-offs and releases never move or alter files.
          </p>
          {SECTIONS.map(def => {
            const s = secRow(def.key); if (!s) return null
            const items = secChecks(def.key)
            const done = items.filter(i => i.done).length
            const kOpen = openKeys.has(def.key)
            const status = s.released ? 'released' : s.lead_signed_at ? 'signed' : s.sm_checked_at ? 'awaiting-lead' : 'open'
            return (
              <div key={def.key} style={{ borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', cursor: 'pointer' }}
                  onClick={() => setOpenKeys(prev => { const n = new Set(prev); n.has(def.key) ? n.delete(def.key) : n.add(def.key); return n })}>
                  <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>{def.label}</span>
                  <span style={{ fontSize: 11, color: done === items.length && items.length ? 'var(--green)' : 'var(--text3)' }}>{done}/{items.length}</span>
                  {status === 'released' && <span className="pill pill-green" style={{ fontSize: 10 }}>Visible to client</span>}
                  {status === 'signed' && <span className="pill pill-teal" style={{ fontSize: 10 }}>Signed off</span>}
                  {status === 'awaiting-lead' && <span className="pill pill-amber" style={{ fontSize: 10 }}>Awaiting lead</span>}
                </div>
                {kOpen && (
                  <div style={{ padding: '2px 0 10px 8px' }}>
                    {items.map(item => (
                      <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12, cursor: canEdit ? 'pointer' : 'default' }}>
                        <input type="checkbox" style={{ width: 15, height: 15, flex: '0 0 auto', margin: 0, accentColor: 'var(--accent)' }} checked={item.done} disabled={!canEdit} onChange={() => toggleCheck(item)} />
                        <span style={{ flex: 1, color: item.done ? 'var(--text)' : 'var(--text2)' }}>{item.label}</span>
                        {item.done && item.done_at && <span style={{ fontSize: 10, color: 'var(--text3)' }}>{names[item.done_by] || ''} · {fmtDate(item.done_at)}</span>}
                      </label>
                    ))}
                    <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      {!s.sm_checked_at ? (
                        canEdit && <button className="btn btn-sm" onClick={e => { e.stopPropagation(); smCheck(def.key) }}>✓ SM check complete</button>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--green)' }}>✓ SM checked — {names[s.sm_checked_by] || ''} · {fmtDate(s.sm_checked_at)}</span>
                      )}
                      {s.sm_checked_at && !s.lead_signed_at && (
                        isLead ? <button className="btn btn-sm btn-primary" onClick={e => { e.stopPropagation(); leadSign(def.key) }}>Sign off section</button>
                               : <span style={{ fontSize: 11, color: 'var(--amber)' }}>Awaiting lead sign-off</span>
                      )}
                      {s.lead_signed_at && <span style={{ fontSize: 11, color: 'var(--green)' }}>✓ Signed off — {names[s.lead_signed_by] || ''} · {fmtDate(s.lead_signed_at)}</span>}
                      {s.lead_signed_at && isLead && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer' }} onClick={e => e.stopPropagation()}>
                          <input type="checkbox" style={{ width: 15, height: 15, flex: '0 0 auto', margin: 0, accentColor: 'var(--accent)' }} checked={s.released} onChange={e => setReleased(def.key, e.target.checked)} />
                          Release to client portal
                        </label>
                      )}
                      {(s.sm_checked_at || s.lead_signed_at) && isLead && (
                        <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={e => { e.stopPropagation(); reopen(def.key) }}>Reopen</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
