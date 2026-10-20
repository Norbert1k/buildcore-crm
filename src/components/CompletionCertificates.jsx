import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Modal, Pill } from './ui'
import { formatDate, formatMoney } from '../lib/utils'

// Proof of completion, checked by Claude (certificate-ai) before it's accepted.
//
//  • SubCompletionModal / CompletedBadge — a subcontractor on a job is only
//    "Completed" once the Final Account certificate signed by BOTH parties is
//    uploaded. The file goes in their 02. Payment Applications folder; the
//    green "Completed" badge opens it.
//  • PracticalCompletionFact / PCModal — the project's PC certificate: Claude
//    reads the PC date, the file is filed in Documents › 00. Project
//    Information › 13. Practical Completion, and the date shows in the header.
//
// The file is checked before anything is uploaded, so Cancel leaves nothing.
// Without 039_completion_certificates.sql the status still saves and the file
// is still filed; only the link from the badge needs the new columns.

const LEADS = ['admin', 'project_manager', 'operations_manager', 'project_director']
const SUB_FOLDER = 'payment-applications'
const FA_NOTE = 'Final account certificate'
const PC_FOLDER = { parent: '00-project-information', key: 'completion', label: '13. Practical Completion' }
const MAX = 15_000_000           // same cap as the server (Claude's request limit)

const safeName = n => String(n).replace(/[—–]/g, '-').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\x20-\x7E]/g, '').replace(/[#?%{}\\^~[\]`>|<]/g, '-').replace(/\s{2,}/g, ' ').trim() || 'certificate.pdf'
const ukToIso = d => { const m = String(d || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '' }
const todayIso = () => new Date().toISOString().slice(0, 10)
const okType = f => /\.(pdf|png|jpe?g|webp)$/i.test(f?.name || '')

function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result).split(',')[1] || '')
    r.onerror = () => rej(r.error)
    r.readAsDataURL(file)
  })
}

// Ask Claude. Returns { reading } or { error } — never throws.
export async function checkCertificate(file, kind, { projectId, expect } = {}) {
  try {
    if (file.size > MAX) return { error: 'File is over 15 MB — too large to check; upload a smaller scan' }
    const file_base64 = await toBase64(file)
    const { data, error } = await supabase.functions.invoke('certificate-ai', { body: { kind, file_base64, file_name: file.name, project_id: projectId, expect } })
    if (error) {
      let msg = error.message || 'Check failed'
      try { const j = await error.context?.json?.(); if (j?.error) msg = j.error } catch { /* keep message */ }
      return { error: /not found|failed to send|404/i.test(msg) ? 'The certificate check isn’t set up yet' : msg }
    }
    if (!data?.reading) return { error: data?.error || 'No answer from the check' }
    return { reading: data.reading }
  } catch (e) { return { error: e?.message || 'Check failed' } }
}

// Open a stored file in a new tab. Call blankTab() first thing in the click
// handler (before any await) so pop-up blockers — Safari especially — allow it.
export const blankTab = () => { try { return window.open('', '_blank') } catch { return null } }
export async function openStored(bucket, path, w) {
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 600)
  if (!data?.signedUrl) { w?.close(); alert('Could not open the certificate'); return }
  if (w && !w.closed) w.location = data.signedUrl
  else { const a = document.createElement('a'); a.href = data.signedUrl; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove() }
}
// RLS can refuse an update without an error (0 rows changed) — treat that as a failure
const NO_RIGHTS = 'You don’t have permission to change this — ask an admin or the project manager.'

// ── Shared: drop / choose a file ───────────────────────────────────────────
function DropFile({ label, hint, onFile, busy }) {
  const ref = useRef(null)
  const [over, setOver] = useState(false)
  const take = f => { if (f) okType(f) ? onFile(f) : alert('Upload a PDF or a photo of the certificate') }
  return (
    <div className={`cc-drop${over ? ' over' : ''}${busy ? ' busy' : ''}`}
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); setOver(true) }} onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); e.stopPropagation(); setOver(false); take(e.dataTransfer.files?.[0]) }}
      onClick={() => !busy && ref.current?.click()} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ref.current?.click() } }}>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/></svg>
      <b>{label}</b>
      <span>{hint}</span>
      <input ref={ref} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" hidden onChange={e => { take(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}

function Checking({ name }) {
  return <div className="cc-checking"><span className="cc-spin" /> Checking <b>{name}</b>…</div>
}

function FileLine({ file, onChange }) {
  return (
    <div className="cc-file">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span className="cc-file-n">{file.name}</span>
      {onChange && <button type="button" className="cc-link" onClick={onChange}>Use another file</button>}
    </div>
  )
}

const Tick = ({ ok }) => ok
  ? <span className="cc-ok" aria-label="Signed">✓</span>
  : <span className="cc-no" aria-label="Not signed">✕</span>

// ── Subcontractor: final account ────────────────────────────────────────────
// Who signed for each side, from Claude's reading
function sides(reading, subName) {
  const sigs = Array.isArray(reading?.signatures) ? reading.signatures : []
  const pick = party => sigs.find(s => s?.party === party && s.signed) || sigs.find(s => s?.party === party) || null
  return [
    { key: 'contractor', who: 'City Construction Group', ok: !!reading?.signed_by_contractor, sig: pick('contractor') },
    { key: 'subcontractor', who: reading?.subcontractor || subName, ok: !!reading?.signed_by_subcontractor, sig: pick('subcontractor') },
  ]
}
const latestDate = reading => (reading?.signatures || []).map(s => ukToIso(s?.date)).filter(Boolean).sort().pop() || ''

export function SubCompletionModal({ ps, project, onClose, onDone }) {
  const { profile, role } = useAuth()
  const subName = ps?.subcontractors?.company_name || 'the subcontractor'
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)              // { reading } | { error }
  const [byHand, setByHand] = useState(false)       // "I've checked it's signed by both"
  const [showHand, setShowHand] = useState(false)
  const [date, setDate] = useState(todayIso())
  const [saving, setSaving] = useState(false)
  const lead = LEADS.includes(role)

  async function pick(f) {
    setFile(f); setRes(null); setByHand(false); setShowHand(false); setBusy(true)
    const r = await checkCertificate(f, 'final_account', { projectId: project?.id, expect: { subcontractor: subName, project: project?.project_name } })
    setRes(r); setBusy(false)
    const d = r.reading && latestDate(r.reading)
    if (d) setDate(d)
  }

  const reading = res?.reading
  const both = !!reading?.both_signed || (!!reading?.signed_by_contractor && !!reading?.signed_by_subcontractor)
  const wrongDoc = reading && !['final_account', 'payment_certificate'].includes(reading.doc_type)
  const ok = file && !busy && ((both && !wrongDoc) || byHand)
  const missing = reading ? sides(reading, subName).filter(s => !s.ok).map(s => s.who) : []

  async function save() {
    if (!ok) return
    setSaving(true)
    try {
      const path = `projects/${ps.project_id}/subs/${ps.id}/${SUB_FOLDER}/${Date.now()}-${safeName(file.name)}`
      const { error: upErr } = await supabase.storage.from('project-docs').upload(path, file)
      if (upErr) throw upErr
      const { data: row, error: fErr } = await supabase.from('project_sub_files').insert({
        project_id: ps.project_id, project_sub_id: ps.id, folder_key: SUB_FOLDER, file_name: file.name, file_size: file.size,
        storage_path: path, uploaded_by: profile?.id || null, direction: 'received', notes: `${FA_NOTE} — signed by both parties`,
      }).select('id').single()
      if (fErr) throw fErr
      const check = {
        ...(reading || { error: res?.error || null }),
        confirmed_by_hand: byHand && !(both && !wrongDoc) ? true : undefined,
        checked_by: profile?.full_name || null, checked_at: new Date().toISOString(),
      }
      let { data: upd, error } = await supabase.from('project_subcontractors')
        .update({ status: 'completed', completed_on: date || todayIso(), completion_file_id: row.id, completion_check: check }).eq('id', ps.id).select('id')
      // 039 not run yet — still complete it; the badge finds the file by its note
      if (error && /column|schema cache/i.test(error.message || '')) ({ data: upd, error } = await supabase.from('project_subcontractors').update({ status: 'completed' }).eq('id', ps.id).select('id'))
      if (error) throw error
      if (!upd?.length) throw new Error(NO_RIGHTS + ' (The certificate is saved in Payment Applications.)')
      onDone?.()
    } catch (e) {
      alert('Could not complete: ' + (e?.message || e))
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={saving ? () => {} : onClose} title={`Complete — ${subName}`} size="sm"
      footer={<>
        <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!ok || saving}>{saving ? 'Saving…' : 'Mark complete'}</button>
      </>}>
      <div className="cc">
        {!file && <>
          <p className="cc-lead">Upload the <b>Final Account certificate signed by both parties</b>. It's checked for both signatures, then filed in {subName}'s Payment Applications.</p>
          <DropFile label="Drop the signed final account" hint="PDF or a photo · or click to choose" onFile={pick} />
        </>}
        {file && <FileLine file={file} onChange={busy || saving ? null : () => { setFile(null); setRes(null) }} />}
        {busy && <Checking name="signatures" />}

        {reading && (
          <div className="cc-result">
            {sides(reading, subName).map(s => (
              <div key={s.key} className={`cc-sig ${s.ok ? 'ok' : 'no'}`}>
                <Tick ok={s.ok} />
                <div>
                  <div className="cc-sig-w">{s.who}</div>
                  <div className="cc-sig-s">{s.ok
                    ? [s.sig?.name, s.sig?.date, s.sig?.how && s.sig.how !== 'handwritten' ? s.sig.how : null].filter(Boolean).join(' · ') || 'Signed'
                    : 'Not signed'}</div>
                </div>
              </div>
            ))}
            {(reading.final_account_sum != null || reading.reference) && (
              <div className="cc-facts">
                {reading.final_account_sum != null && <span>Final account <b>{formatMoney(reading.final_account_sum)}</b></span>}
                {reading.final_balance != null && <span>Balance <b>{formatMoney(reading.final_balance)}</b>{reading.option_elected ? ` · ${reading.option_elected}` : ''}</span>}
                {reading.reference && <span>{reading.reference}</span>}
              </div>
            )}
            {wrongDoc && <div className="cc-bad">This doesn't look like a final account certificate.</div>}
            {!both && !wrongDoc && <div className="cc-bad">Not signed by {missing.join(' or ')}. Upload the copy signed by both parties.</div>}
            {both && !wrongDoc && <div className="cc-good">Signed by both parties</div>}
            {(reading.flags || []).filter(Boolean).slice(0, 3).map((f, i) => <div key={i} className="cc-flag">{f}</div>)}
          </div>
        )}

        {res?.error && (
          <div className="cc-warn">Couldn't check it automatically — {res.error}.{!lead && ' A project lead can confirm it by hand.'}</div>
        )}
        {file && !busy && lead && (res?.error || (reading && (!both || wrongDoc))) && (
          res?.error || showHand
            ? <label className="cc-hand"><input type="checkbox" checked={byHand} onChange={e => setByHand(e.target.checked)} /> I've checked it — it's the final account, signed by both parties</label>
            : <button type="button" className="cc-link cc-hand-link" onClick={() => setShowHand(true)}>It is signed — I've checked it myself</button>
        )}

        {file && !busy && (
          <label className="cc-date">Completed on <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        )}
      </div>
    </Modal>
  )
}

// The status on a job's subcontractor row. Completed → opens the signed final account.
export function CompletedBadge({ ps, canManage, onAddProof }) {
  const [opening, setOpening] = useState(false)
  if (ps.status !== 'completed') return <Pill cls={ps.status === 'active' ? 'pill-green' : 'pill-gray'}>{(ps.status || '').replace('_', ' ')}</Pill>
  const signedOn = ps.completed_on ? formatDate(ps.completed_on) : null
  async function open(e) {
    e.stopPropagation()
    const w = blankTab()                 // before any await, or the browser blocks it
    setOpening(true)
    let row = null
    if (ps.completion_file_id) row = (await supabase.from('project_sub_files').select('storage_path').eq('id', ps.completion_file_id).maybeSingle()).data
    if (!row) {
      const { data } = await supabase.from('project_sub_files').select('storage_path, notes, created_at').eq('project_sub_id', ps.id).order('created_at', { ascending: false })
      row = (data || []).find(f => String(f.notes || '').startsWith(FA_NOTE)) || null
    }
    setOpening(false)
    if (row?.storage_path) return openStored('project-docs', row.storage_path, w)
    w?.close()
    if (canManage) onAddProof?.(ps)
    else alert('No signed final account has been uploaded for this subcontractor yet.')
  }
  // completion_check: undefined = 039 not run (look the file up by its note); null = completed before proof was needed
  const noProof = ps.completion_check === null && !ps.completion_file_id
  return (
    <button type="button" className={`cc-badge${noProof ? ' nofile' : ''}`} onClick={open} disabled={opening}
      title={noProof ? (canManage ? 'No signed final account yet — click to add it' : 'No signed final account uploaded')
        : `Signed final account${signedOn ? ' · completed ' + signedOn : ''} — click to open`}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
      Completed
      <svg className="cc-badge-doc" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    </button>
  )
}

// ── Project: practical completion ───────────────────────────────────────────
export function PracticalCompletionFact({ project, canManage, onSaved }) {
  const [open, setOpen] = useState(false)
  if (!project || project.status === 'tender') return null
  if (!project.pc_date && !canManage) return null
  async function view() {
    if (!project.pc_file_id) { if (canManage) setOpen(true); return }
    const w = blankTab()
    const path = (await supabase.from('project_doc_files').select('storage_path').eq('id', project.pc_file_id).maybeSingle()).data?.storage_path
    if (path) openStored('project-docs', path, w)
    else { w?.close(); if (canManage) setOpen(true) }
  }
  return (
    <div className="proj-fact">
      <span className="proj-fact-label" title="Practical completion">PC</span>
      {project.pc_date
        ? <span className="pc-fact">
            <button type="button" className="pc-date" onClick={view} title={project.pc_file_id ? 'Open the PC certificate' : 'PC date'}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
              {formatDate(project.pc_date)}
            </button>
            {canManage && <button type="button" className="pc-edit" onClick={() => setOpen(true)} title="Replace the PC certificate">Change</button>}
          </span>
        : <button type="button" className="pc-add" onClick={() => setOpen(true)}>+ Add PC certificate</button>}
      {open && <PCModal project={project} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onSaved?.() }} />}
    </div>
  )
}

export function PCModal({ project, onClose, onSaved }) {
  const { profile } = useAuth()
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)
  const [date, setDate] = useState(project?.pc_date || '')
  const [markDone, setMarkDone] = useState(project?.status !== 'completed')
  const [saving, setSaving] = useState(false)

  async function pick(f) {
    setFile(f); setRes(null); setBusy(true)
    const r = await checkCertificate(f, 'pc', { projectId: project.id, expect: { project: project.project_name } })
    setRes(r); setBusy(false)
    const d = ukToIso(r.reading?.pc_date)          // never the issue date — that's a different date
    setDate(d || '')
  }
  const reading = res?.reading
  const notPc = reading && !['practical_completion', 'sectional_completion', 'partial_possession'].includes(reading.doc_type)
  const ok = file && !busy && !!date

  async function save() {
    if (!ok) return
    setSaving(true)
    try {
      // Filed in Documents › 00. Project Information › 13. Practical Completion
      const { data: have } = await supabase.from('project_doc_folders').select('folder_key').eq('project_id', project.id).eq('folder_key', PC_FOLDER.key)
      if (!have?.length) await supabase.from('project_doc_folders').insert({ project_id: project.id, parent_key: PC_FOLDER.parent, folder_key: PC_FOLDER.key, label: PC_FOLDER.label })
      const path = `projects/${project.id}/${PC_FOLDER.parent}/${PC_FOLDER.key}/${Date.now()}-${safeName(file.name)}`
      const { error: upErr } = await supabase.storage.from('project-docs').upload(path, file)
      if (upErr) throw upErr
      const { data: row, error: fErr } = await supabase.from('project_doc_files').insert({
        project_id: project.id, folder_key: PC_FOLDER.parent, subfolder_key: PC_FOLDER.key, file_name: file.name, file_size: file.size, storage_path: path,
      }).select('id').single()
      if (fErr) throw fErr
      const patch = { pc_date: date, pc_file_id: row.id, pc_check: { ...(reading || { error: res?.error || null }), checked_by: profile?.full_name || null, checked_at: new Date().toISOString() } }
      if (markDone) patch.status = 'completed'
      const { data: upd, error } = await supabase.from('projects').update(patch).eq('id', project.id).select('id')
      if (error) {
        if (/column|schema cache/i.test(error.message || '')) {
          if (markDone) await supabase.from('projects').update({ status: 'completed' }).eq('id', project.id)
          alert('The certificate is filed in Documents, but the PC date can’t be stored yet — run 039_completion_certificates.sql in Supabase.')
          onSaved?.(); return
        }
        throw error
      }
      if (!upd?.length) throw new Error(NO_RIGHTS + ' (The certificate is filed in Documents.)')
      onSaved?.()
    } catch (e) {
      alert('Could not save: ' + (e?.message || e))
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={saving ? () => {} : onClose} title="Practical Completion" size="sm"
      footer={<>
        <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!ok || saving}>{saving ? 'Saving…' : 'Save PC'}</button>
      </>}>
      <div className="cc">
        {!file && <>
          <p className="cc-lead">Upload the <b>Practical Completion certificate</b>. The PC date is read from it and the certificate is filed in Documents › 00. Project Information › 13. Practical Completion.</p>
          <DropFile label="Drop the PC certificate" hint="PDF or a photo · or click to choose" onFile={pick} />
        </>}
        {file && <FileLine file={file} onChange={busy || saving ? null : () => { setFile(null); setRes(null) }} />}
        {busy && <Checking name="the certificate" />}
        {reading && (
          <div className="cc-result">
            <div className="cc-facts">
              {reading.issued_by && <span>Certified by <b>{reading.issued_by}</b></span>}
              {reading.certificate_date && <span>Issued {reading.certificate_date}</span>}
              {reading.section && <span>Covers: {reading.section}</span>}
              {reading.rectification_period_ends && <span>Rectification period ends {reading.rectification_period_ends}</span>}
              {reading.reference && <span>{reading.reference}</span>}
            </div>
            {notPc && <div className="cc-bad">This doesn't look like a Practical Completion certificate — check before saving.</div>}
            {!notPc && reading.signed === false && <div className="cc-warn">It doesn't appear to be signed.</div>}
            {!notPc && !reading.pc_date && <div className="cc-warn">No PC date found on it — enter the date below.</div>}
            {(reading.flags || []).filter(Boolean).slice(0, 3).map((f, i) => <div key={i} className="cc-flag">{f}</div>)}
          </div>
        )}
        {res?.error && <div className="cc-warn">Couldn't read it automatically — {res.error}. Enter the PC date below.</div>}
        {file && !busy && <>
          <label className="cc-date big">Practical completion <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          {project.status !== 'completed' && <label className="cc-hand"><input type="checkbox" checked={markDone} onChange={e => setMarkDone(e.target.checked)} /> Set the project to Completed</label>}
        </>}
      </div>
    </Modal>
  )
}
