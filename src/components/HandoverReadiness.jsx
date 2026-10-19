import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { autoMatch } from '../lib/handoverChecks'

// ─────────────────────────────────────────────────────────────────────────────
// Handover readiness, folded into the section rows of the folder list.
// Same tables and records as before (fitout_handover_sections / _checks, keys
// cs1–cs11), so ticks, sign-offs and client releases already made are kept.
// New: items tick themselves when a matching document is on the job.
// ─────────────────────────────────────────────────────────────────────────────

export const SECTIONS = [
  { key: 'cs1', label: 'Section 1 | H&S File' }, { key: 'cs2', label: 'Section 2 | Project Directory' },
  { key: 'cs3', label: 'Section 3 | Record Drawings' }, { key: 'cs4', label: 'Section 4 | Construction Materials' },
  { key: 'cs5', label: 'Section 5 | Health and Safety' }, { key: 'cs6', label: 'Section 6 | Structural Design' },
  { key: 'cs7', label: 'Section 7 | Services' }, { key: 'cs8', label: 'Section 8 | O&M Manuals' },
  { key: 'cs9', label: 'Section 9 | Commissioning Documents' }, { key: 'cs10', label: 'Section 10 | Operating Documents' },
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
const ts = () => new Date().toISOString()
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''
export const csFor = folderSectionKey => 'c' + folderSectionKey   // 's3' → 'cs3'

export function useHandoverReadiness(projectId) {
  const { profile, role } = useAuth()
  const isLead = LEAD_ROLES.includes(role)
  const canEdit = isLead || role === 'site_manager'
  const [sections, setSections] = useState([])
  const [checks, setChecks] = useState([])
  const [names, setNames] = useState({})
  const [files, setFiles] = useState([])
  const [job, setJob] = useState({})
  const [ready, setReady] = useState(false)

  useEffect(() => { init() }, [projectId])
  useEffect(() => {
    const on = () => loadFiles()
    window.addEventListener('hs-moved', on); window.addEventListener('hs-files-read', on)
    return () => { window.removeEventListener('hs-moved', on); window.removeEventListener('hs-files-read', on) }
  }, [projectId])

  async function loadFiles() {
    const [{ data: hs }, { data: subs }, { data: iss }] = await Promise.all([
      supabase.from('hs_files').select('id, file_name, folder_key, ai, origin').eq('project_id', projectId),
      supabase.from('project_subcontractors').select('id, category').eq('project_id', projectId),
      supabase.from('om_issues').select('issue_no, kind').eq('project_id', projectId).order('created_at', { ascending: false }),
    ])
    // Only the Handover folders count — the Documents tab holds invoices, quotes etc.
    setFiles(hs || [])
    setJob({
      subs: (subs || []).filter(s => s.category !== 'design_team').length,
      designTeam: (subs || []).filter(s => s.category === 'design_team').length,
      omIssued: (iss || []).find(i => i.kind === 'om')?.issue_no || null,
    })
  }

  async function init() {
    const keys = SECTIONS.map(s => s.key)
    let { data: secRows } = await supabase.from('fitout_handover_sections').select('*').eq('project_id', projectId).in('section_key', keys)
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
      loadFiles(),
    ])
    setSections(secRows || [])
    setChecks(chkRows || [])
    setNames(Object.fromEntries((profRows || []).map(p => [p.id, p.full_name])))
    setReady(true)
  }

  // Each item: ticked by hand, or found automatically
  const items = useMemo(() => checks.map(c => {
    const auto = c.done ? null : autoMatch(c.label, files, job)
    return { ...c, auto, ok: c.done || !!auto }
  }), [checks, files, job])

  const forSection = k => items.filter(i => i.section_key === k)
  const secRow = k => sections.find(s => s.section_key === k)

  async function toggleCheck(item) {
    if (!canEdit || item.auto) return
    const done = !item.done
    setChecks(prev => prev.map(c => c.id === item.id ? { ...c, done, done_by: done ? profile?.id : null, done_at: done ? ts() : null } : c))
    await supabase.from('fitout_handover_checks').update({ done, done_by: done ? profile?.id : null, done_at: done ? ts() : null }).eq('id', item.id)
  }
  async function patchSection(key, patch) {
    setSections(prev => prev.map(s => s.section_key === key ? { ...s, ...patch } : s))
    await supabase.from('fitout_handover_sections').update(patch).eq('project_id', projectId).eq('section_key', key)
  }
  const actions = {
    toggleCheck,
    smCheck: k => canEdit && patchSection(k, { sm_checked_by: profile?.id, sm_checked_at: ts() }),
    leadSign: k => isLead && patchSection(k, { lead_signed_by: profile?.id, lead_signed_at: ts() }),
    setReleased: (k, released) => isLead && patchSection(k, { released, released_at: released ? ts() : null }),
    reopen: k => {
      if (!isLead || !window.confirm('Reopen this section? Sign-offs are cleared and it is withdrawn from client release.')) return
      patchSection(k, { sm_checked_by: null, sm_checked_at: null, lead_signed_by: null, lead_signed_at: null, released: false, released_at: null })
    },
  }
  const okCount = items.filter(i => i.ok).length
  const summary = {
    pct: items.length ? Math.round(okCount / items.length * 100) : 0,
    outstanding: items.length - okCount,
    signed: sections.filter(s => s.lead_signed_at).length,
    released: sections.filter(s => s.released).length,
    total: SECTIONS.length,
  }
  return { ready, forSection, secRow, actions, names, isLead, canEdit, summary }
}

function statusOf(s) {
  if (!s) return null
  return s.released ? 'released' : s.lead_signed_at ? 'signed' : s.sm_checked_at ? 'awaiting' : null
}

// Shown on the section row itself
export function SectionChips({ r, folderKey }) {
  const k = csFor(folderKey)
  const list = r.forSection(k)
  if (!r.ready || !list.length) return null
  const ok = list.filter(i => i.ok).length
  const st = statusOf(r.secRow(k))
  return (
    <span className="hr-chips" onClick={e => e.stopPropagation()}>
      <span className={`hr-count${ok === list.length ? ' done' : ''}`} title={`${ok} of ${list.length} expected documents found`}>{ok === list.length ? '✓ ' : ''}{ok}/{list.length}</span>
      {st === 'released' && <span className="pill pill-green">Visible to client</span>}
      {st === 'signed' && <span className="pill pill-teal">Signed off</span>}
      {st === 'awaiting' && <span className="pill pill-amber">Awaiting lead</span>}
    </span>
  )
}

// Shown when the section row is opened, above its folders
export function SectionPanel({ r, folderKey }) {
  const k = csFor(folderKey)
  const list = r.forSection(k)
  const s = r.secRow(k)
  if (!r.ready || !s) return null
  const { actions: a, names, isLead, canEdit } = r
  return (
    <div className="hr-panel" onClick={e => e.stopPropagation()}>
      <div className="hr-items">
        {list.map(item => (
          <label key={item.id} className={`hr-item${item.ok ? ' ok' : ''}`}>
            {item.auto
              ? <span className="hr-tick" title="Ticked automatically — a matching document is on the job">✓</span>
              : <input type="checkbox" checked={item.ok} disabled={!canEdit} onChange={() => a.toggleCheck(item)} />}
            <span className="hr-l">{item.label}</span>
            <span className="hr-src">{item.auto ? <><b>Found</b> · {item.auto.reason}</> : item.done ? `${names[item.done_by] || 'Ticked'} · ${fmtDate(item.done_at)}` : 'Not found yet'}</span>
          </label>
        ))}
      </div>
      <div className="hr-sign">
        {!s.sm_checked_at
          ? canEdit && <button className="btn btn-sm" onClick={() => a.smCheck(k)}>✓ SM check complete</button>
          : <span className="hr-done">✓ SM checked — {names[s.sm_checked_by] || ''} · {fmtDate(s.sm_checked_at)}</span>}
        {s.sm_checked_at && !s.lead_signed_at && (isLead
          ? <button className="btn btn-sm btn-primary" onClick={() => a.leadSign(k)}>Sign off section</button>
          : <span className="hr-wait">Awaiting lead sign-off</span>)}
        {s.lead_signed_at && <span className="hr-done">✓ Signed off — {names[s.lead_signed_by] || ''} · {fmtDate(s.lead_signed_at)}</span>}
        {s.lead_signed_at && isLead && (
          <label className="hr-release"><input type="checkbox" checked={!!s.released} onChange={e => a.setReleased(k, e.target.checked)} /> Release to client portal</label>
        )}
        {(s.sm_checked_at || s.lead_signed_at) && isLead && <button className="btn btn-sm hr-reopen" onClick={() => a.reopen(k)}>Reopen</button>}
      </div>
    </div>
  )
}
