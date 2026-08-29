import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { zipProgressShow, zipProgressUpdate, zipProgressHide } from '../lib/zipProgress'

// ─────────────────────────────────────────────────────────────────────────────
// FitOutHandover — the Fit-Out division's handover pack (Stage 7).
// All option-B decisions: per-project section toggles, named checklist per
// section, two-step sign-off (SM check → lead sign-off), rolling per-section
// client release. Files live in project_doc_files under folder_key
// 'fitout_handover' with subfolder_key = section key, so storage, sanitised
// filenames and signed-URL preview all reuse the existing machinery.
// Portal rendering of released sections is phase 2 (needs current portal repo);
// the release flags recorded here are what it will read.
// ─────────────────────────────────────────────────────────────────────────────

const FOLDER_KEY = 'fitout_handover'

const SECTIONS = [
  { key: 'statutory',   label: '1. Statutory & Sign-off' },
  { key: 'electrical',  label: '2. Electrical' },
  { key: 'mechanical',  label: '3. Mechanical & Commissioning' },
  { key: 'firestop',    label: '4. Fire Stopping & Compartmentation' },
  { key: 'asbuilt',     label: '5. As-Built Information' },
  { key: 'warranties',  label: '6. Products, Warranties & Guarantees' },
  { key: 'maintenance', label: '7. Cleaning & Maintenance' },
  { key: 'access',      label: '8. Keys, Access & Demonstrations' },
  { key: 'aftercare',   label: '9. Aftercare & Defects' },
]

const DEFAULT_CHECKS = {
  statutory:   ['Building Control completion certificate', 'Fire risk assessment (as handed over)', 'Fire alarm commissioning certificate', 'Emergency lighting certificate', 'Landlord / licence-to-alter sign-offs'],
  electrical:  ['EIC / NICEIC certificates', 'Circuit charts', 'Emergency lighting test sheets', 'Data & comms test results'],
  mechanical:  ['HVAC commissioning records', 'Water / plumbing test certificates', 'Gas Safe certificates', 'BMS setpoints & handover notes'],
  firestop:    ['Fire stopping certificates', 'Photo register', 'Damper test records', 'Passive protection records'],
  asbuilt:     ['As-built / marked-up drawings', 'Reflected ceiling plans', 'Services routes', 'Finishes schedules by area'],
  warranties:  ['Manufacturer warranties', 'Product data sheets', 'COSHH sheets for applied finishes'],
  maintenance: ['Care instructions per finish', 'Recommended maintenance schedule', 'Specialist cleaning contacts'],
  access:      ['Key / fob schedule', 'Access codes handover record', 'Client demonstration sign-off'],
  aftercare:   ['Defects liability period & process', 'Emergency contacts', 'Subcontractor directory for the works'],
}

const LEAD_ROLES = ['admin', 'project_manager', 'operations_manager', 'project_director']

function ts() { return new Date().toISOString() }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '' }
function safeStorageName(name) {
  return String(name)
    .replace(/[\u2014\u2013]/g, '-')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[#?%{}\\^~\[\]`>|<]/g, '-')
    .replace(/\s{2,}/g, ' ').trim() || 'file'
}

export default function FitOutHandover({ projectId, projectName }) {
  const { profile, role, can } = useAuth()
  const isLead = LEAD_ROLES.includes(role)
  const canEdit = isLead || role === 'site_manager'
  const [sections, setSections] = useState([])   // fitout_handover_sections rows
  const [checks, setChecks] = useState([])       // fitout_handover_checks rows
  const [files, setFiles] = useState([])         // project_doc_files rows for our folder
  const [loading, setLoading] = useState(true)
  const [openKeys, setOpenKeys] = useState(() => new Set())
  const [names, setNames] = useState({})         // profile id → full_name
  const fileInputs = useRef({})

  useEffect(() => { init() }, [projectId])

  async function init() {
    setLoading(true)
    let { data: secRows } = await supabase.from('fitout_handover_sections').select('*').eq('project_id', projectId)
    // First open on a project: seed the nine sections + their checklists.
    if (!secRows || secRows.length === 0) {
      const seedSections = SECTIONS.map(s => ({ project_id: projectId, section_key: s.key, enabled: true }))
      const seedChecks = SECTIONS.flatMap(s => (DEFAULT_CHECKS[s.key] || []).map((label, i) => ({
        project_id: projectId, section_key: s.key, item_key: `${s.key}_${i}`, label, sort: i,
      })))
      await supabase.from('fitout_handover_sections').insert(seedSections)
      await supabase.from('fitout_handover_checks').insert(seedChecks)
      secRows = (await supabase.from('fitout_handover_sections').select('*').eq('project_id', projectId)).data || []
    }
    const [{ data: chkRows }, { data: fileRows }, { data: profRows }] = await Promise.all([
      supabase.from('fitout_handover_checks').select('*').eq('project_id', projectId).order('sort'),
      supabase.from('project_doc_files').select('*').eq('project_id', projectId).eq('folder_key', FOLDER_KEY).order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name'),
    ])
    setSections(secRows || [])
    setChecks(chkRows || [])
    setFiles(fileRows || [])
    setNames(Object.fromEntries((profRows || []).map(p => [p.id, p.full_name])))
    setLoading(false)
  }

  function secRow(key) { return sections.find(s => s.section_key === key) }
  function secChecks(key) { return checks.filter(c => c.section_key === key) }
  function secFiles(key) { return files.filter(f => f.subfolder_key === key) }

  async function toggleSection(key, enabled) {
    if (!isLead) return
    setSections(prev => prev.map(s => s.section_key === key ? { ...s, enabled } : s))
    await supabase.from('fitout_handover_sections').update({ enabled }).eq('project_id', projectId).eq('section_key', key)
  }

  async function toggleCheck(item) {
    if (!canEdit) return
    const done = !item.done
    setChecks(prev => prev.map(c => c.id === item.id ? { ...c, done, done_by: done ? profile?.id : null, done_at: done ? ts() : null } : c))
    await supabase.from('fitout_handover_checks').update({ done, done_by: done ? profile?.id : null, done_at: done ? ts() : null }).eq('id', item.id)
  }

  // ── Two-step sign-off: SM check first, lead counter-sign second.
  //    Leads can perform either step; only leads can lead-sign or release.
  async function smCheck(key) {
    if (!canEdit) return
    const patch = { sm_checked_by: profile?.id, sm_checked_at: ts() }
    setSections(prev => prev.map(s => s.section_key === key ? { ...s, ...patch } : s))
    await supabase.from('fitout_handover_sections').update(patch).eq('project_id', projectId).eq('section_key', key)
  }
  async function leadSign(key) {
    if (!isLead) return
    const patch = { lead_signed_by: profile?.id, lead_signed_at: ts() }
    setSections(prev => prev.map(s => s.section_key === key ? { ...s, ...patch } : s))
    await supabase.from('fitout_handover_sections').update(patch).eq('project_id', projectId).eq('section_key', key)
  }
  async function reopen(key) {
    if (!isLead) return
    if (!window.confirm('Reopen this section? Sign-offs are cleared and the section is withdrawn from client release.')) return
    const patch = { sm_checked_by: null, sm_checked_at: null, lead_signed_by: null, lead_signed_at: null, released: false, released_at: null }
    setSections(prev => prev.map(s => s.section_key === key ? { ...s, ...patch } : s))
    await supabase.from('fitout_handover_sections').update(patch).eq('project_id', projectId).eq('section_key', key)
  }
  async function setReleased(key, released) {
    if (!isLead) return
    const patch = { released, released_at: released ? ts() : null }
    setSections(prev => prev.map(s => s.section_key === key ? { ...s, ...patch } : s))
    await supabase.from('fitout_handover_sections').update(patch).eq('project_id', projectId).eq('section_key', key)
  }

  // ── Files — project_doc_files under our folder; storage path mirrors the
  //    documents system so signed URLs and portal phase 2 both just work.
  async function uploadFiles(key, fileList) {
    const arr = Array.from(fileList || []).filter(Boolean)
    if (!arr.length) return
    for (const file of arr) {
      const path = `projects/${projectId}/${FOLDER_KEY}/${key}/${Date.now()}-${safeStorageName(file.name)}`
      const { error } = await supabase.storage.from('project-docs').upload(path, file)
      if (error) { alert(`${file.name} did not upload: ${error.message}`); continue }
      const row = { project_id: projectId, folder_key: FOLDER_KEY, subfolder_key: key, file_name: file.name, file_size: file.size, storage_path: path }
      const { data: ins, error: dbErr } = await supabase.from('project_doc_files').insert(row).select().single()
      if (dbErr) { alert(`${file.name} did not save: ${dbErr.message}`); continue }
      if (ins) setFiles(prev => [ins, ...prev])
    }
  }
  async function deleteFile(f) {
    if (!canEdit) return
    if (!window.confirm(`Delete "${f.file_name}"?`)) return
    await supabase.storage.from('project-docs').remove([f.storage_path])
    await supabase.from('project_doc_files').delete().eq('id', f.id)
    setFiles(prev => prev.filter(x => x.id !== f.id))
  }
  async function openFile(f) {
    const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  async function zipSection(key, label) {
    const list = secFiles(key)
    if (!list.length) { alert('No files in this section yet.'); return }
    zipProgressShow('Preparing zip')
    if (!window.JSZip) {
      const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
      document.head.appendChild(s); await new Promise(r => s.onload = r)
    }
    const zip = new window.JSZip()
    let i = 0
    for (const f of list) {
      i++; zipProgressUpdate({ current: i, total: list.length, fileName: f.file_name })
      const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 300)
      if (!data?.signedUrl) continue
      const res = await fetch(data.signedUrl); if (!res.ok) continue
      zip.file(f.file_name, await res.blob())
    }
    const blob = await zip.generateAsync({ type: 'blob' }, m => zipProgressUpdate({ percent: m.percent, label: 'Compressing zip' }))
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `${projectName || 'Handover'} - ${label}.zip`
    document.body.appendChild(a); a.click(); zipProgressHide(); document.body.removeChild(a)
  }

  // ── Rollup for the header ──
  const enabledSecs = sections.filter(s => s.enabled)
  const signedCount = enabledSecs.filter(s => s.lead_signed_at).length
  const releasedCount = enabledSecs.filter(s => s.released).length
  const enabledKeys = new Set(enabledSecs.map(s => s.section_key))
  const enabledChecks = checks.filter(c => enabledKeys.has(c.section_key))
  const doneChecks = enabledChecks.filter(c => c.done).length

  if (loading) return <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13 }}>Loading handover pack…</div>

  return (
    <div>
      {/* ── Header rollup ── */}
      <div className="card card-pad" style={{ marginBottom: 14, display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Fit-Out Handover Pack</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{signedCount}/{enabledSecs.length} sections signed off</div>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${enabledChecks.length ? Math.round((doneChecks / enabledChecks.length) * 100) : 0}%`, height: '100%', background: 'var(--accent)' }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{doneChecks}/{enabledChecks.length} checklist items complete · {releasedCount} section{releasedCount === 1 ? '' : 's'} released to client</div>
        </div>
      </div>

      {/* ── Sections ── */}
      {SECTIONS.map(def => {
        const s = secRow(def.key)
        if (!s) return null
        const items = secChecks(def.key)
        const sfiles = secFiles(def.key)
        const open = openKeys.has(def.key)
        const done = items.filter(i => i.done).length
        const status = !s.enabled ? 'off' : s.released ? 'released' : s.lead_signed_at ? 'signed' : s.sm_checked_at ? 'awaiting-lead' : 'open'
        return (
          <div key={def.key} className="card" style={{ marginBottom: 10, opacity: s.enabled ? 1 : 0.55 }}>
            {/* Section header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}
              onClick={() => setOpenKeys(prev => { const n = new Set(prev); n.has(def.key) ? n.delete(def.key) : n.add(def.key); return n })}>
              <div style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{def.label}</div>
              {s.enabled && items.length > 0 && (
                <span style={{ fontSize: 11, color: done === items.length ? 'var(--green)' : 'var(--text3)' }}>{done}/{items.length}</span>
              )}
              {s.enabled && sfiles.length > 0 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{sfiles.length} file{sfiles.length === 1 ? '' : 's'}</span>}
              {status === 'released' && <span className="pill pill-green" style={{ fontSize: 10 }}>Visible to client</span>}
              {status === 'signed' && <span className="pill pill-teal" style={{ fontSize: 10 }}>Signed off</span>}
              {status === 'awaiting-lead' && <span className="pill pill-amber" style={{ fontSize: 10 }}>Awaiting lead</span>}
              {status === 'off' && <span className="pill pill-gray" style={{ fontSize: 10 }}>Not on this job</span>}
              {isLead && (
                <label onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text3)', cursor: 'pointer' }}>
                  <input type="checkbox" style={{ width: 15, height: 15, flex: '0 0 auto', margin: 0, accentColor: 'var(--accent)' }} checked={s.enabled} onChange={e => toggleSection(def.key, e.target.checked)} /> on this job
                </label>
              )}
            </div>

            {open && s.enabled && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '12px 14px' }}>
                {/* Checklist */}
                {items.map(item => (
                  <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12.5, cursor: canEdit ? 'pointer' : 'default' }}>
                    <input type="checkbox" style={{ width: 15, height: 15, flex: '0 0 auto', margin: 0, accentColor: 'var(--accent)' }} checked={item.done} disabled={!canEdit} onChange={() => toggleCheck(item)} />
                    <span style={{ flex: 1, textDecoration: item.done ? 'none' : 'none', color: item.done ? 'var(--text)' : 'var(--text2)' }}>{item.label}</span>
                    {item.done && item.done_at && <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>{names[item.done_by] || ''} · {fmtDate(item.done_at)}</span>}
                  </label>
                ))}

                {/* Files */}
                <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  {sfiles.map(f => (
                    <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '3px 8px', fontSize: 11.5 }}>
                      <a onClick={() => openFile(f)} style={{ cursor: 'pointer', color: 'var(--accent)' }}>{f.file_name}</a>
                      {canEdit && <a onClick={() => deleteFile(f)} style={{ cursor: 'pointer', color: 'var(--red)' }} title="Delete">×</a>}
                    </span>
                  ))}
                  {canEdit && (
                    <>
                      <input type="file" multiple style={{ display: 'none' }} ref={el => fileInputs.current[def.key] = el}
                        onChange={e => { uploadFiles(def.key, e.target.files); e.target.value = '' }} />
                      <button className="btn btn-sm" onClick={() => fileInputs.current[def.key]?.click()}>+ Upload</button>
                    </>
                  )}
                  {sfiles.length > 0 && <button className="btn btn-sm" onClick={() => zipSection(def.key, def.label)}>Zip section</button>}
                </div>

                {/* Two-step sign-off + release */}
                <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
                  {!s.sm_checked_at ? (
                    canEdit && <button className="btn btn-sm" onClick={() => smCheck(def.key)}>✓ SM check complete</button>
                  ) : (
                    <span style={{ fontSize: 11.5, color: 'var(--green)' }}>✓ SM checked — {names[s.sm_checked_by] || ''} · {fmtDate(s.sm_checked_at)}</span>
                  )}
                  {s.sm_checked_at && !s.lead_signed_at && (
                    isLead ? <button className="btn btn-sm btn-primary" onClick={() => leadSign(def.key)}>Sign off section</button>
                           : <span style={{ fontSize: 11.5, color: 'var(--amber)' }}>Awaiting lead sign-off</span>
                  )}
                  {s.lead_signed_at && (
                    <span style={{ fontSize: 11.5, color: 'var(--green)' }}>✓ Signed off — {names[s.lead_signed_by] || ''} · {fmtDate(s.lead_signed_at)}</span>
                  )}
                  {s.lead_signed_at && isLead && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, cursor: 'pointer' }}>
                      <input type="checkbox" style={{ width: 15, height: 15, flex: '0 0 auto', margin: 0, accentColor: 'var(--accent)' }} checked={s.released} onChange={e => setReleased(def.key, e.target.checked)} />
                      Release to client portal
                    </label>
                  )}
                  {(s.sm_checked_at || s.lead_signed_at) && isLead && (
                    <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => reopen(def.key)}>Reopen</button>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
      <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>
        Released sections become visible in the client portal (portal-side rendering ships in the next portal update; releases recorded now are honoured then).
      </p>
    </div>
  )
}
