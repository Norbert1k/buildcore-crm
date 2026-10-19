import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Spinner } from './ui'
import { HS_STRUCTURE } from './HSHandover'
import { analyse, isHRB, DOC_TYPES } from '../lib/omFacts'
import { readDocument, composePack, renderPack } from '../lib/omApi'
import { renderOmHtml } from '../lib/omRender'
import { revisionMoves, collectDropped } from '../lib/handoverFiling'

// ─────────────────────────────────────────────────────────────────────────────
// H&S File & O&M — the top half of Project › Handover (the folder tree sits
// underneath, see HandoverFile.jsx).
//
// Mostly automatic:
//   1. Everything already on the job is picked up — Handover folders and
//      project Documents. Anything not yet read is read by Claude (once).
//   2. Files or whole folders dropped here are read and filed into the right
//      Handover folder. Drawings go into Record Drawings by what they show;
//      an older revision of the same drawing moves to Superseded.
//   3. What's ready, what's missing and where documents disagree is shown;
//      people only make the decisions.
//   4. Issuing prints the manuals in the CCG standard layout into Section 8.
// Nothing is ever deleted here.
// ─────────────────────────────────────────────────────────────────────────────

const LEADS = ['admin', 'project_manager', 'operations_manager', 'project_director']
// Auto-rebuild starts off: the first draft is always built by hand (Claude costs)
const DEFAULT_OPTIONS = { type: 'package', warranty: true, tenant: false, golden_thread: false, auto: false, building: {} }
// Anything that changes what the manual says → the draft must be rebuilt
const draftKey = p => JSON.stringify({ t: p?.options?.type, w: !!p?.options?.warranty, te: !!p?.options?.tenant, g: !!p?.options?.golden_thread, b: p?.options?.building || {}, o: p?.overrides || {} })

function folderLabels() {
  const map = { _inbox: 'To file' }
  ;(function walk(nodes, path) {
    nodes.forEach(n => { const p = path ? `${path} › ${n.label.replace(/^Section \d+ \| /, '')}` : n.label.replace(/ \|.*/, ''); map[n.key] = p; walk(n.children || [], p) })
  })(HS_STRUCTURE, '')
  return map
}
const fmt = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
// Storage keys reject em/en dashes and other non-ASCII characters ("Invalid key")
const safeName = n => String(n).replace(/[\u2014\u2013]/g, '-').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\x20-\x7E]/g, '').replace(/[#?%{}\\^~\[\]`>|<]/g, '-').replace(/\s{2,}/g, ' ').trim() || 'file'
const changed = keys => window.dispatchEvent(new CustomEvent('hs-moved', { detail: { keys } }))

export default function OmBuilder({ projectId, project, readiness }) {
  const { can, role, profile } = useAuth()
  // Settings, decisions, drafts (and the Claude reads they trigger): project leads.
  // Dropping documents: anyone who can upload to the Handover folders.
  const canEdit = LEADS.includes(role)
  const canDrop = can('manage_projects')
  const canIssue = LEADS.includes(role)
  const [files, setFiles] = useState(null)
  const [pack, setPack] = useState(null)            // om_packs row
  const [issues, setIssues] = useState([])
  const [reading, setReading] = useState(null)      // { done, total, label }
  const [composing, setComposing] = useState(false)
  const [preview, setPreview] = useState(null)      // { tab }
  const [issuing, setIssuing] = useState(false)
  const [toast, setToast] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [panel, setPanel] = useState(null)          // 'settings' | 'details' | null
  const [recent, setRecent] = useState([])          // what the last drop did
  const inputRef = useRef(null)
  const folderRef = useRef(null)
  const labels = useMemo(folderLabels, [])

  useEffect(() => { load(true) }, [projectId])
  // Uploads made directly into the folder tree are read in the background;
  // refresh when that finishes so the status stays current.
  useEffect(() => {
    const on = () => load(false)
    window.addEventListener('hs-files-read', on)
    return () => window.removeEventListener('hs-files-read', on)
  }, [projectId])

  async function load(catchUp) {
    const [hs, docs, pk, iss] = await Promise.all([
      supabase.from('hs_files').select('*').eq('project_id', projectId),
      supabase.from('project_doc_files').select('*').eq('project_id', projectId),
      supabase.from('om_packs').select('*').eq('project_id', projectId).maybeSingle(),
      supabase.from('om_issues').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
    ])
    // Manuals issued here are not source material for the next one
    const all = [
      ...(hs.data || []).filter(f => f.origin !== 'om_builder').map(f => ({ ...f, _table: 'hs_files', _source: 'Handover' })),
      ...(docs.data || []).map(f => ({ ...f, _table: 'project_doc_files', _source: 'Documents' })),
    ]
    setFiles(all)
    setPack(p => p || pk.data || { project_id: projectId, options: { ...DEFAULT_OPTIONS }, overrides: {}, draft: null, draft_at: null })
    setIssues(iss.data || [])
    // Catch-up: read Handover files not read yet (never the Documents tab — invoices etc.)
    const unread = all.filter(f => f._table === 'hs_files' && !f.ai && f.folder_key !== '_inbox' && /\.(pdf|png|jpe?g)$/i.test(f.file_name || ''))
    if (catchUp && unread.length && canEdit) readAll(unread, all)
  }

  async function readAll(list, all) {
    setReading({ done: 0, total: list.length, label: 'Reading what\'s on the job' })
    let current = all
    for (let i = 0; i < list.length; i++) {
      try {
        const ai = await readDocument(list[i], list[i]._table, labels)
        current = current.map(f => f.id === list[i].id ? { ...f, ai } : f)
        setFiles(current)
      } catch (e) { console.error('[handover] read', e) }
      setReading(r => ({ ...r, done: i + 1 }))
    }
    setReading(null)
  }

  // Settings and decisions: always applied to the latest state, then saved.
  // (The draft is saved on its own, so a slow draft can't undo a decision.)
  const saveTimer = useRef(null)
  function updatePack(fn, { delay = 0 } = {}) {
    setPack(prev => {
      const next = fn(prev)
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        const { error } = await supabase.from('om_packs').upsert({ project_id: projectId, options: next.options, overrides: next.overrides, updated_at: new Date().toISOString() }, { onConflict: 'project_id' })
        if (error) setToast('Could not save: ' + error.message)
      }, delay)
      return next
    })
  }
  const savePack = next => updatePack(() => next)
  const packRef = useRef(null)
  useEffect(() => { packRef.current = pack }, [pack])
  const setOpt = patch => updatePack(p => ({ ...p, options: { ...p.options, ...patch } }))
  const setOverride = (k, v) => updatePack(p => { const o = { ...(p.overrides || {}) }; if (v == null) delete o[k]; else o[k] = v; return { ...p, overrides: o } })
  const setBuilding = patch => updatePack(p => {
    const b = { ...(p.options.building || {}), ...patch }
    // Golden Thread follows the higher-risk test, tenant O&M follows 2+ flats — unless set by hand
    const gt = p.options.gt_manual ? p.options.golden_thread : isHRB(b)
    const tenant = p.options.tenant_manual ? p.options.tenant : Number(b.units) >= 2
    return { ...p, options: { ...p.options, building: b, golden_thread: gt, tenant } }
  }, { delay: 700 })

  // ── Drop anything: upload → read → file (drawings by type, revisions) ───
  async function addDropped(items) {
    const list = items.filter(x => x.file?.size)
    if (!list.length) return
    setReading({ done: 0, total: list.length, label: 'Uploading' })
    const added = []
    for (const { file, path: rel } of list) {
      const path = `projects/${projectId}/hs/_inbox/${Date.now()}-${safeName(file.name)}`
      const { error: upErr } = await supabase.storage.from('hs-handover').upload(path, file)
      if (upErr) { setToast(`Couldn't upload ${file.name}`); continue }
      const { data } = await supabase.from('hs_files').insert({ project_id: projectId, folder_key: '_inbox', file_name: file.name, file_size: file.size, storage_path: path }).select().single()
      if (data) added.push({ ...data, _hint: rel, _table: 'hs_files', _source: 'Handover' })
      setReading(r => ({ ...r, done: added.length }))
    }
    let current = [...(files || []), ...added]
    setFiles(current)
    setReading({ done: 0, total: added.length, label: 'Reading and filing' })
    const log = []
    for (let i = 0; i < added.length; i++) {
      const f = added[i]
      try {
        const ai = await readDocument({ ...f, hint: f._hint }, 'hs_files', labels)
        let folder = f.folder_key
        if (ai?.suggested_folder && labels[ai.suggested_folder] && ai.confidence !== 'low' && ai.client_facing !== false) {
          folder = ai.suggested_folder
          await supabase.from('hs_files').update({ folder_key: folder }).eq('id', f.id)
        }
        let me = { ...f, ai, folder_key: folder }
        current = current.map(x => x.id === f.id ? me : x)
        // Revisions: older copy of the same drawing goes to Superseded
        for (const mv of revisionMoves(HS_STRUCTURE, me, current)) {
          await supabase.from('hs_files').update({ folder_key: mv.to }).eq('id', mv.file.id)
          current = current.map(x => x.id === mv.file.id ? { ...x, folder_key: mv.to } : x)
          log.push({ id: mv.file.id, from: mv.file.folder_key, name: mv.file.file_name, to: labels[mv.to], note: mv.why })
          if (mv.file.id === me.id) me = { ...me, folder_key: mv.to }
          changed([mv.to, mv.file.folder_key])
        }
        log.push({ id: f.id, from: '_inbox', name: f.file_name, to: me.folder_key === '_inbox' ? null : labels[me.folder_key], type: DOC_TYPES[ai?.doc_type]?.label })
        setFiles(current)
        changed([me.folder_key])
      } catch (e) { console.error('[handover] read', e); log.push({ name: f.file_name, to: null }) }
      setReading(r => ({ ...r, done: i + 1 }))
    }
    setReading(null)
    setRecent(log)
    const filed = log.filter(l => l.to && !l.note).length
    setToast(`${filed} of ${added.length} filed automatically${added.length - filed ? ` · ${added.length - filed} to check` : ''}`)
  }

  async function undoMove(entry) {
    await supabase.from('hs_files').update({ folder_key: entry.from }).eq('id', entry.id)
    setFiles(fs => fs.map(x => x.id === entry.id ? { ...x, folder_key: entry.from } : x))
    setRecent(r => r.filter(x => x !== entry))
    changed([entry.from])
  }

  async function fileTo(f, key) {
    await supabase.from(f._table).update({ folder_key: key }).eq('id', f.id)
    setFiles(fs => fs.map(x => x.id === f.id ? { ...x, folder_key: key } : x))
    changed([key])
  }

  async function download(i) {
    const q = supabase.from('hs_files').select('storage_path').eq('project_id', projectId)
    const { data: rows } = await (i.hs_file_id ? q.eq('id', i.hs_file_id) : q.eq('file_name', i.file_name).order('created_at', { ascending: false }).limit(1))
    const row = rows?.[0]
    if (!row) return setToast('File not found in the folders')
    const { data } = await supabase.storage.from('hs-handover').createSignedUrl(row.storage_path, 300, { download: i.file_name })
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }

  // ── Draft and issue ─────────────────────────────────────────────────────
  // Staff names — a document naming our own PM as "owner" is not the owner
  const [staffNames, setStaffNames] = useState([])
  useEffect(() => { supabase.from('profiles').select('full_name').then(({ data }) => setStaffNames((data || []).map(p => p.full_name).filter(Boolean))) }, [])
  const analysis = useMemo(() => files && pack ? analyse({ project, files: files.filter(f => f.folder_key !== '_inbox' || f.ai), options: pack.options, staffNames }) : null, [files, pack, project, staffNames])
  const [ownValue, setOwnValue] = useState({})   // decision typed by hand, per conflict
  // Out of date when a Handover document was read after the draft, or the settings/decisions changed
  const lastChange = useMemo(() => (files || []).filter(f => f._table === 'hs_files' && f.ai && !f.ai.error)
    .reduce((m, f) => Math.max(m, new Date(f.ai.read_at || 0).getTime()), 0), [files])
  const draftStale = !!pack?.draft && (!pack.draft_at || new Date(pack.draft_at).getTime() < lastChange || pack.draft.key !== draftKey(pack))
  const openDecisions = (analysis?.conflicts || []).filter(c => pack?.overrides?.[c.key] == null)

  const composingRef = useRef(false)
  async function compose(open) {
    if (composingRef.current) return
    composingRef.current = true
    setComposing(true)
    const key = draftKey(pack)
    try {
      const res = await composePack(projectId, pack.options, pack.overrides)
      const draft = { ...res, key }, draft_at = new Date().toISOString()
      // Save only the draft — never overwrite settings or decisions made meanwhile
      setPack(p => ({ ...p, draft, draft_at }))
      const { data: upd, error } = await supabase.from('om_packs').update({ draft, draft_at }).eq('project_id', projectId).select('id')
      if (!error && !(upd || []).length) {
        const cur = packRef.current || pack
        await supabase.from('om_packs').upsert({ project_id: projectId, options: cur.options, overrides: cur.overrides, draft, draft_at }, { onConflict: 'project_id' })
      }
      if (error) setToast('Draft built but not saved: ' + error.message)
      if (open && res?.status === 'ok') setPreview({ tab: 'om' })
    } catch (e) { setToast('Could not build the draft: ' + e.message) }
    composingRef.current = false
    setComposing(false)
  }

  // Auto mode: once a first draft exists, rebuild it quietly when documents or
  // settings change (never issues)
  useEffect(() => {
    if (!pack?.options?.auto || !canEdit || reading || composing || !analysis?.read) return
    if (!pack.draft || !draftStale) return
    const t = setTimeout(() => compose(false), 1200)
    return () => clearTimeout(t)
  }, [pack?.options?.auto, draftStale, reading, analysis?.read])

  async function issue() {
    if (!pack?.draft?.packs?.om) return
    if (draftStale) { setToast('The draft is out of date — rebuild it before issuing'); return }
    setIssuing(true)
    try {
      const out = await renderPack(projectId, pack.draft.packs, { approvedBy: profile?.full_name })
      setToast(`${out.issue_no} issued — saved to ${labels[out.folder_key] || 'Section 8'}`)
      setPreview(null)
      changed([out.folder_key])
      load(false)
    } catch (e) { setToast('Issue failed: ' + e.message) }
    setIssuing(false)
  }

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t) } }, [toast])

  if (!files || !pack || !analysis) return <Spinner />
  const o = pack.options
  const b = o.building || {}
  const hrb = isHRB(b)
  const inbox = files.filter(f => f.folder_key === '_inbox')
  const typed = files.filter(f => f.ai)
  const groups = Object.entries(typed.reduce((acc, f) => { (acc[f.ai.doc_type] ||= []).push(f); return acc }, {}))
    .sort((a, b2) => Object.keys(DOC_TYPES).indexOf(a[0]) - Object.keys(DOC_TYPES).indexOf(b2[0]))
  const draftOk = pack.draft?.status === 'ok'
  const lastIssue = issues.find(i => i.kind === 'om')
  const packsOn = [o.type === 'building' ? 'Building O&M' : 'Package O&M', o.warranty && 'Warranty', o.tenant && 'Tenant O&M', o.golden_thread && 'Golden Thread'].filter(Boolean)
  const toggle = p => setPanel(cur => cur === p ? null : p)

  return (
    <div className="om">
      {/* ── Status card ─────────────────────────────────────────── */}
      <div className="om-head card">
        <div className="om-head-main">
          <div className="om-title">H&S File & O&M</div>
          <div className="om-sub">Everything for handover in one place. Drop documents or whole folders below — each is read and filed into the right folder, and the O&M manuals are kept up to date.</div>
          <div className="om-packs">{packsOn.map(p => <span key={p} className={`pill ${p === 'Golden Thread' ? 'pill-amber' : 'pill-gray'}`}>{p}</span>)}
            {canEdit && <button className="om-link" onClick={() => toggle('settings')}>{panel === 'settings' ? 'Close settings' : 'Change'}</button>}</div>
        </div>
        <div className="om-head-side">
          <div className="om-state">
            {reading ? <span className="pill pill-blue">{reading.label} {reading.done}/{reading.total}…</span>
              : composing ? <span className="pill pill-blue">Writing draft…</span>
              : draftOk && !draftStale ? <span className="pill pill-green">Draft up to date</span>
              : draftOk ? <span className="pill pill-amber">Draft out of date</span>
              : pack.draft?.status === 'insufficient' ? <span className="pill pill-amber">Needs more documents</span>
              : <span className="pill pill-gray">No draft yet</span>}
            {analysis.missing > 0 && <button className="pill pill-amber om-pillbtn" onClick={() => toggle('details')}>{analysis.missing} missing</button>}
            {analysis.warnings.length > 0 && <button className="pill pill-gray om-pillbtn" onClick={() => toggle('details')}>{analysis.warnings.length} to check</button>}
            {lastIssue && <span className="pill pill-gray">{lastIssue.issue_no} · {fmt(lastIssue.created_at)}</span>}
            {readiness && <span className={`pill ${readiness.outstanding ? 'pill-gray' : 'pill-green'}`} title={`${readiness.outstanding} expected documents not found yet`}>H&S file {readiness.pct}% · {readiness.signed}/{readiness.total} signed off</span>}
          </div>
          <div className="om-actions">
            <button className="btn btn-sm" onClick={() => toggle('details')}>{panel === 'details' ? 'Hide details' : 'Details'}</button>
            {canEdit && <button className="btn btn-sm" onClick={() => compose(true)} disabled={composing || !!reading}>{draftOk ? 'Rebuild' : 'Build draft'}</button>}
            <button className="btn btn-sm btn-primary" disabled={!draftOk} onClick={() => setPreview({ tab: 'om' })}>Preview & issue</button>
          </div>
        </div>
      </div>

      {/* ── Decisions (always visible when there are any) ───────── */}
      {openDecisions.map(c => (
        <div key={c.key} className="card om-card om-decide">
          <div className="om-card-h">Needs a decision — {c.label.toLowerCase()} differs between documents</div>
          <div className="om-conf-row">
            {c.values.map(v => (
              <button key={v.value} className="om-conf-v" disabled={!canEdit} onClick={() => setOverride(c.key, v.value)}>
                <b>{v.value}</b><span>{v.source}</span>
              </button>
            ))}
          </div>
          {canEdit && (
            <div className="om-conf-own">
              <input value={ownValue[c.key] || ''} onChange={e => setOwnValue(t => ({ ...t, [c.key]: e.target.value }))} placeholder={`None of these — type the correct ${c.label.toLowerCase()}`} />
              <button className="btn btn-sm" disabled={!(ownValue[c.key] || '').trim()} onClick={() => setOverride(c.key, ownValue[c.key].trim())}>Use this</button>
            </div>
          )}
          <div className="om-conf-hint">Pick the right one — it's used throughout the manuals. Ask the issuer to correct the other document.</div>
        </div>
      ))}
      {(analysis?.units?.length || 0) > 1 && openDecisions.length === 0 && (
        <div className="om-units">{analysis.units.length} home / plot addresses found on this job — they're kept as the individual properties, not treated as a conflict.</div>
      )}

      {/* ── Settings ─────────────────────────────────────────────── */}
      {panel === 'settings' && (
        <section className="card om-card">
          <div className="om-card-h">What to produce for this job</div>
          <div className="om-seg" role="radiogroup">
            {[['package', 'Package O&M', 'One trade or package — e.g. roofing'], ['building', 'Building O&M', 'Whole building — all systems']].map(([k, l, s]) => (
              <button key={k} role="radio" aria-checked={o.type === k} className={`om-seg-b${o.type === k ? ' on' : ''}`} onClick={() => setOpt({ type: k })}>
                <b>{l}</b><span>{s}</span>
              </button>
            ))}
          </div>
          <div className="om-checks">
            <label className="om-check"><input type="checkbox" checked={!!o.warranty} onChange={e => setOpt({ warranty: e.target.checked })} />
              <span><b>CCG workmanship warranty</b><em>Bound in as Appendix A</em></span></label>
            <label className="om-check"><input type="checkbox" checked={!!o.tenant} onChange={e => setOpt({ tenant: e.target.checked, tenant_manual: true })} />
              <span><b>Tenant O&M</b><em>One home guide per flat, from the unit schedule</em></span></label>
            <label className="om-check gt"><input type="checkbox" checked={!!o.golden_thread} onChange={e => { const v = e.target.checked; updatePack(p => ({ ...p, options: { ...p.options, golden_thread: v, gt_manual: true } })) }} />
              <span><b>Golden Thread</b><em>Higher-risk building — duty holders, regulation 38 handover, safety-critical register</em></span></label>
            <label className="om-check"><input type="checkbox" checked={!!o.auto} onChange={e => setOpt({ auto: e.target.checked })} />
              <span><b>Keep the draft up to date automatically</b><em>Issuing always needs approval</em></span></label>
          </div>
          <div className="om-hrb">
            <div className="om-hrb-f">
              <label>Height (m)<input type="number" min="0" step="0.1" value={b.height_m ?? ''} onChange={e => setBuilding({ height_m: e.target.value })} /></label>
              <label>Storeys<input type="number" min="0" value={b.storeys ?? ''} onChange={e => setBuilding({ storeys: e.target.value })} /></label>
              <label>Flats<input type="number" min="0" value={b.units ?? ''} onChange={e => setBuilding({ units: e.target.value })} /></label>
              {o.golden_thread && <label>BSR registration<input type="text" value={b.bsr_ref ?? ''} onChange={e => setBuilding({ bsr_ref: e.target.value })} /></label>}
            </div>
            <div className={`om-hrb-r${hrb ? ' yes' : ''}`}>{
              b.height_m || b.storeys || b.units
                ? hrb ? 'Higher-risk building (18 m+ or 7+ storeys, 2+ flats) — Golden Thread needed' : 'Not a higher-risk building — Golden Thread optional'
                : 'Add height, storeys and flats — Golden Thread and Tenant O&M tick themselves when they apply'}</div>
          </div>
        </section>
      )}

      {/* ── Drop zone ───────────────────────────────────────────── */}
      {canDrop && (
        <div className={`om-drop big${dragOver ? ' over' : ''}`}
          onDragOver={e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragOver(true) } }}
          onDragLeave={() => setDragOver(false)}
          onDrop={async e => { if (!e.dataTransfer?.types?.includes('Files')) return; e.preventDefault(); e.stopPropagation(); setDragOver(false); addDropped(await collectDropped(e.dataTransfer)) }}>
          <b>Drop files or whole folders here</b>
          <span>Each document is read and filed into the right folder below. Drawings go into Record Drawings by what they show — floor plans, elevations, fire strategy, services — and an older revision of the same drawing moves to Superseded.</span>
          <div className="om-drop-btns">
            <button className="btn btn-sm" onClick={() => inputRef.current?.click()}>Choose files</button>
            <button className="btn btn-sm" onClick={() => folderRef.current?.click()}>Choose a folder</button>
          </div>
          <input ref={inputRef} type="file" multiple hidden onChange={e => { addDropped(Array.from(e.target.files).map(file => ({ file, path: '' }))); e.target.value = '' }} />
          <input ref={folderRef} type="file" multiple hidden webkitdirectory="" directory="" onChange={e => { addDropped(Array.from(e.target.files).map(file => ({ file, path: (file.webkitRelativePath || '').split('/').slice(0, -1).join('/') }))); e.target.value = '' }} />
        </div>
      )}

      {recent.length > 0 && (
        <section className="card om-card">
          <div className="om-card-h">Just filed <button className="om-link" onClick={() => setRecent([])}>Clear</button></div>
          {recent.map((r, i) => (
            <div key={i} className="om-doc">
              <div className="om-doc-main"><div className="om-doc-n">{r.name}</div><div className="om-doc-s">{r.note || r.type || ''}</div></div>
              <div className="om-doc-where">{r.to ? `→ ${r.to}` : <span className="pill pill-amber">To file</span>}</div>
              {r.to && canDrop && <button className="om-link" onClick={() => undoMove(r)}>Undo</button>}
            </div>
          ))}
        </section>
      )}

      {inbox.length > 0 && (
        <section className="card om-card om-inbox">
          <div className="om-card-h">To file — Claude wasn't sure <span className="pill pill-amber">{inbox.length}</span></div>
          {inbox.map(f => (
            <div key={f.id} className="om-doc">
              <div className="om-doc-main"><div className="om-doc-n">{f.file_name}</div><div className="om-doc-s">{f.ai ? `${DOC_TYPES[f.ai.doc_type]?.label || 'Other'}${f.ai.client_facing === false ? ' · internal — not for the client' : ''}` : 'Reading…'}</div></div>
              {canDrop && <select className="om-sel" value="" onChange={e => e.target.value && fileTo(f, e.target.value)}>
                <option value="">File to…</option>
                {f.ai?.suggested_folder && labels[f.ai.suggested_folder] && <option value={f.ai.suggested_folder}>Suggested: {labels[f.ai.suggested_folder]}</option>}
                {Object.entries(labels).filter(([k]) => k !== '_inbox').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>}
            </div>
          ))}
        </section>
      )}

      {/* ── Details ─────────────────────────────────────────────── */}
      {panel === 'details' && (
        <div className="om-grid">
          <div className="om-col">
            <section className="card om-card">
              <div className="om-card-h">Ready to build {analysis.missing === 0 ? <span className="pill pill-green">All found</span> : <span className="pill pill-amber">{analysis.missing} missing</span>}</div>
              {analysis.readiness.map(g => (
                <div key={g.group} className="om-ready">
                  <div className="om-mini-h">{g.group}</div>
                  {g.items.map(i => (
                    <div key={i.key} className={`om-ri s-${i.status}`}>
                      <span className="om-ri-i">{i.status === 'ok' ? '✓' : i.status === 'optional' ? '–' : '!'}</span>
                      <span className="om-ri-l">{i.label}</span>
                      <span className="om-ri-d">{i.detail}</span>
                    </div>
                  ))}
                </div>
              ))}
              {Object.keys(pack.overrides || {}).length > 0 && (
                <div className="om-ready">
                  <div className="om-mini-h">Decided</div>
                  {Object.entries(pack.overrides).map(([k, v]) => (
                    <div key={k} className="om-ri s-ok"><span className="om-ri-i">✓</span><span className="om-ri-l">{k === 'owner_address' ? 'Owner address' : k === 'owner' ? 'Building owner' : k}</span><span className="om-ri-d">{v} {canEdit && <button className="om-link" onClick={() => setOverride(k, null)}>change</button>}</span></div>
                  ))}
                </div>
              )}
            </section>
            {analysis.warnings.length > 0 && (
              <section className="card om-card">
                <div className="om-card-h">Worth checking <span className="pill pill-amber">{analysis.warnings.length}</span></div>
                {analysis.warnings.map((w, i) => <div key={i} className="om-warn"><div>{w.msg}</div><span>{w.file.file_name}</span></div>)}
              </section>
            )}
            <section className="card om-card">
              <div className="om-card-h">Issued</div>
              {issues.length === 0 && <div className="om-empty">Nothing issued yet.</div>}
              {issues.map(i => (
                <div key={i.id} className="om-issue"><b>{i.issue_no}</b><span>{fmt(i.created_at)}{i.pages ? ` · ${i.pages} pages` : ''}{i.approved_by ? ` · ${i.approved_by}` : ''}</span>
                  <button className="om-link" onClick={() => download(i)}>Download</button><em>{i.file_name}</em></div>
              ))}
            </section>
          </div>
          <div className="om-col">
            <section className="card om-card">
              <div className="om-card-h">What Claude found <span className="om-count">{files.length} documents · {analysis.read} read</span></div>
              <div className="om-docs">
                {groups.length === 0 && !reading && <div className="om-empty">Nothing read yet.</div>}
                {groups.map(([type, list]) => (
                  <div key={type} className="om-dgroup">
                    <div className="om-mini-h"><span className={`om-dot t-${DOC_TYPES[type]?.tone || 'gray'}`} />{DOC_TYPES[type]?.label || type} <span>{list.length}</span></div>
                    {list.map(f => (
                      <div key={f.id} className="om-doc">
                        <div className="om-doc-main">
                          <div className="om-doc-n">{f.ai.title || f.file_name}</div>
                          <div className="om-doc-s">{[f.ai.issuer, f.ai.reference, f.ai.dates?.expiry && `to ${f.ai.dates.expiry}`].filter(Boolean).join(' · ')}</div>
                        </div>
                        <div className="om-doc-where">{f.ai.client_facing === false ? <span className="pill pill-gray">Internal</span> : <span title={labels[f.folder_key]}>{f._source === 'Documents' ? 'Documents tab' : (labels[f.folder_key] || f.folder_key)}</span>}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {pack.draft?.status === 'insufficient' && panel === 'details' && (
        <div className="om-note">Not enough on this job yet to write the manual: {(pack.draft.missing || []).join(', ')}.</div>
      )}

      {preview && draftOk && (
        <PreviewOverlay draft={pack.draft} tab={preview.tab} setTab={t => setPreview({ tab: t })} onClose={() => setPreview(null)}
          canIssue={canIssue && openDecisions.length === 0} issuing={issuing} onIssue={issue} blocked={openDecisions.length} missing={analysis.missing} />
      )}
      {toast && <div className="om-toast">{toast}</div>}
    </div>
  )
}

function PreviewOverlay({ draft, tab, setTab, onClose, canIssue, issuing, onIssue, blocked, missing }) {
  const packs = draft.packs || {}
  const tabs = [['om', 'O&M manual'], packs.tenant && ['tenant', 'Tenant O&M'], packs.warranty && ['warranty', 'Warranty']].filter(Boolean)
  const html = useMemo(() => packs[tab] ? renderOmHtml(packs[tab], { screen: true }) : '', [tab, draft])
  const frame = useRef(null)
  useEffect(() => {
    const k = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])
  return (
    <div className="om-ov" data-no-remap>
      <div className="om-ov-bar">
        <div className="om-ov-tabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
        <div className="om-ov-act">
          {blocked > 0 && <span className="om-ov-msg">{blocked} decision{blocked === 1 ? '' : 's'} needed before issue</span>}
          {!blocked && missing > 0 && <span className="om-ov-msg">{missing} item{missing === 1 ? '' : 's'} still missing — issue anyway or wait</span>}
          <button className="btn btn-sm" onClick={() => frame.current?.contentWindow?.print()}>Print</button>
          <button className="btn btn-sm btn-primary" disabled={!canIssue || issuing} onClick={onIssue}>{issuing ? 'Issuing…' : 'Issue PDF'}</button>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close preview">Close</button>
        </div>
      </div>
      {/* sandbox: the manual is shown without running any script it might contain */}
      <iframe ref={frame} className="om-ov-frame" title="Manual preview" sandbox="allow-same-origin allow-modals" srcDoc={html} />
    </div>
  )
}
