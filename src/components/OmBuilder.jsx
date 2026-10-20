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
// DD/MM/YYYY (how dates are kept in the manual) ⇄ YYYY-MM-DD (date inputs)
const toIso = d => { const m = String(d || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : '' }
const fromIso = d => { const [y, m, dd] = String(d).split('-'); return `${dd}/${m}/${y}` }
const changed = keys => window.dispatchEvent(new CustomEvent('hs-moved', { detail: { keys } }))
// The project's Practical Completion date (from the PC certificate on the
// project) is the default completion date; a date typed in the O&M still wins.
const withPc = (ov, project) => project?.pc_date && !ov?.practical_completion
  ? { ...(ov || {}), practical_completion: fromIso(String(project.pc_date).slice(0, 10)) } : (ov || {})

// Which building a Handover file belongs to: 'b1'… / 'site' / null (not tagged)
const inBuilding = (f, key) => f._table !== 'hs_files' || !f.building || f.building === 'site' || f.building === key
// Tag untagged files by the building's name appearing in the file name or reading
export function guessBuilding(f, buildings) {
  const text = [f.file_name, f.ai?.title, f.ai?.system, f._hint].filter(Boolean).join(' ').toLowerCase()
  const hits = buildings.filter(b => b.name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !['building', 'block', 'phase', 'the'].includes(w)).some(w => text.includes(w)))
  return hits.length === 1 ? hits[0].key : null
}

export default function OmBuilder({ projectId, project, readiness, multi = false, has038 = false, buildings = [], building = null, onPickBuilding }) {
  // Multi-building job: bkey is the building in view; null = the all-buildings overview
  const bkey = multi ? (building?.key || null) : ''
  // Once 038 has run, settings are saved per job AND building ('' = the whole job,
  // which every single-building job uses) — the old one-per-job rule is gone
  const perBuilding = has038
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
  const [detailsTab, setDetailsTab] = useState(null) // open Details on a given tab
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

  const [allPacks, setAllPacks] = useState([])      // multi-building: every building's settings
  const [allIssues, setAllIssues] = useState([])
  async function load(catchUp) {
    const [hs, docs, pkAll, iss] = await Promise.all([
      supabase.from('hs_files').select('*').eq('project_id', projectId),
      supabase.from('project_doc_files').select('*').eq('project_id', projectId),
      supabase.from('om_packs').select('*').eq('project_id', projectId),
      supabase.from('om_issues').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
    ])
    const packRows = pkAll.data || []
    setAllPacks(packRows)
    const pk = { data: multi ? packRows.find(r => (r.building || '') === (bkey || '')) || null : packRows.find(r => !r.building) || packRows[0] || null }
    // Manuals issued here are not source material for the next one
    const all = [
      ...(hs.data || []).filter(f => f.origin !== 'om_builder').map(f => ({ ...f, _table: 'hs_files', _source: 'Handover' })),
      ...(docs.data || []).map(f => ({ ...f, _table: 'project_doc_files', _source: 'Documents' })),
    ]
    setFiles(all)
    // A building of a multi-building job defaults to a whole-building O&M
    setPack(p => p || pk.data || { project_id: projectId, options: { ...DEFAULT_OPTIONS, ...(multi ? { type: 'building' } : {}) }, overrides: {}, draft: null, draft_at: null })
    setIssues(multi ? (iss.data || []).filter(i => (i.building || '') === (bkey || '')) : (iss.data || []))
    setAllIssues(iss.data || [])
    // Catch-up: read Handover files not read yet (never the Documents tab — invoices etc.)
    const unread = all.filter(f => f._table === 'hs_files' && !f.ai && f.folder_key !== '_inbox' && /\.(pdf|png|jpe?g)$/i.test(f.file_name || ''))
    if (catchUp && unread.length && canEdit) readAll(unread, all)
  }

  async function readAll(list, all) {
    setReading({ done: 0, total: list.length, label: 'Reading what\'s on the job' })
    let current = all
    for (let i = 0; i < list.length; i++) {
      try {
        const ai = await readDocument(list[i], list[i]._table, labels, multi ? buildings : undefined)
        current = current.map(f => f.id === list[i].id ? { ...f, ai, building: f.building || ai?.building || null } : f)
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
        const row = { project_id: projectId, options: next.options, overrides: next.overrides, updated_at: new Date().toISOString() }
        if (perBuilding) row.building = bkey || ''
        const { error } = await supabase.from('om_packs').upsert(row, { onConflict: perBuilding ? 'project_id,building' : 'project_id' })
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
  // Dropped anywhere on the Handover page (or here): Claude picks the folder.
  // Dropped onto a section (e.g. Record Drawings): Claude picks the folder
  // inside that section. Only invoices / internal papers, and files Claude
  // can't place at all, wait in "To file".
  async function addDropped(items, { within = null } = {}) {
    const list = items.filter(x => x.file?.size)
    if (!list.length) return
    const start = within && labels[within] ? within : '_inbox'
    setReading({ done: 0, total: list.length, label: 'Uploading' })
    const added = []
    for (const { file, path: rel } of list) {
      const path = `projects/${projectId}/hs/_inbox/${Date.now()}-${safeName(file.name)}`
      const { error: upErr } = await supabase.storage.from('hs-handover').upload(path, file)
      if (upErr) { setToast(`Couldn't upload ${file.name}`); continue }
      const row = { project_id: projectId, folder_key: start, file_name: file.name, file_size: file.size, storage_path: path }
      if (multi && bkey) row.building = bkey      // dropped while viewing a building → that building
      const { data } = await supabase.from('hs_files').insert(row).select().single()
      if (data) added.push({ ...data, _hint: rel, _table: 'hs_files', _source: 'Handover' })
      setReading(r => ({ ...r, done: added.length }))
    }
    let current = [...(files || []), ...added]
    // Two drops can run at once (page + section): merge by id, never replace the list
    const touched = new Set(added.map(f => f.id))
    const publish = () => setFiles(fs => {
      const byId = new Map(current.map(x => [x.id, x]))
      const have = new Set((fs || []).map(x => x.id))
      return [...(fs || []).map(x => touched.has(x.id) && byId.has(x.id) ? byId.get(x.id) : x), ...current.filter(x => touched.has(x.id) && !have.has(x.id))]
    })
    publish()
    if (start !== '_inbox') changed([start])
    // Read three at a time (a dropped folder can hold dozens); file in order
    setReading({ done: 0, total: added.length, label: 'Reading and filing' })
    const readings = new Array(added.length)
    let next = 0, doneN = 0
    await Promise.all(Array.from({ length: Math.min(3, added.length) }, async () => {
      while (next < added.length) {
        const i = next++
        try { readings[i] = { ai: await readDocument({ ...added[i], hint: added[i]._hint }, 'hs_files', labels, multi ? buildings : undefined) } }
        catch (e) { console.error('[handover] read', e); readings[i] = { err: true } }
        setReading(r => r && ({ ...r, done: ++doneN }))
      }
    }))
    const log = []
    for (let i = 0; i < added.length; i++) {
      const f = added[i]
      const { ai, err } = readings[i] || {}
      if (err) { log.push({ name: f.file_name, to: start === '_inbox' ? null : labels[start] }); continue }
      try {
        const sug = ai?.suggested_folder && ai.suggested_folder !== '_inbox' && labels[ai.suggested_folder] ? ai.suggested_folder : null
        const inScope = k => !within || k === within || k.startsWith(within + '-')
        let folder = start, alt = null
        if (ai?.client_facing === false) folder = '_inbox'       // invoices, quotes, letters: never into the client's file — a person decides
        else if (sug && inScope(sug)) folder = sug
        else if (sug) alt = sug                                   // Claude thinks it belongs in another section
        if (folder !== f.folder_key) await supabase.from('hs_files').update({ folder_key: folder }).eq('id', f.id)
        let me = { ...f, ai, folder_key: folder, building: f.building || ai?.building || null }
        current = current.map(x => x.id === f.id ? me : x)
        // Revisions: older copy of the same drawing goes to Superseded
        for (const mv of revisionMoves(HS_STRUCTURE, me, current)) {
          await supabase.from('hs_files').update({ folder_key: mv.to }).eq('id', mv.file.id)
          current = current.map(x => x.id === mv.file.id ? { ...x, folder_key: mv.to } : x)
          touched.add(mv.file.id)
          log.push({ id: mv.file.id, from: mv.file.folder_key, name: mv.file.file_name, to: labels[mv.to], note: mv.why })
          if (mv.file.id === me.id) me = { ...me, folder_key: mv.to }
          changed([mv.to, mv.file.folder_key])
        }
        log.push({ id: f.id, from: start, name: f.file_name, to: me.folder_key === '_inbox' ? null : labels[me.folder_key], type: DOC_TYPES[ai?.doc_type]?.label,
          check: me.folder_key !== start && ai?.confidence === 'low', alt: alt && labels[alt] ? { key: alt, label: labels[alt] } : null })
        publish()
        changed([me.folder_key, start])
      } catch (e) { console.error('[handover] file', e); log.push({ name: f.file_name, to: null }) }
    }
    setReading(null)
    setRecent(r => [...log, ...r].slice(0, 60))
    const filed = log.filter(l => l.to && !l.note && !l.alt && (within ? l.to !== labels[within] : true)).length
    const left = added.length - filed
    setToast(`${filed} of ${added.length} filed automatically${left ? ` · ${left} to check` : ''}`)
  }
  // Drops from anywhere on the Handover page / onto a section of the folder tree
  const dropRef = useRef(addDropped)
  dropRef.current = addDropped
  useEffect(() => {
    if (!canDrop) return
    const on = e => dropRef.current(e.detail?.items || [], { within: e.detail?.within || null })
    window.addEventListener('hs-auto-file', on)
    window.__hsAutoFile = (window.__hsAutoFile || 0) + 1
    return () => { window.removeEventListener('hs-auto-file', on); window.__hsAutoFile = Math.max(0, (window.__hsAutoFile || 1) - 1) }
  }, [canDrop])

  async function moveTo(entry, key) {
    if (!entry.id) return
    await supabase.from('hs_files').update({ folder_key: key }).eq('id', entry.id)
    setFiles(fs => fs.map(x => x.id === entry.id ? { ...x, folder_key: key } : x))
    setRecent(r => r.map(x => x === entry ? { ...x, to: labels[key], alt: null, check: false } : x))
    changed([key])
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
  // A building's manual uses its own documents plus whole-site and untagged ones
  const scoped = useMemo(() => !files ? null : multi && bkey ? files.filter(f => inBuilding(f, bkey)) : files, [files, multi, bkey])
  const analysis = useMemo(() => scoped && pack ? analyse({ project, files: scoped.filter(f => f.folder_key !== '_inbox' || f.ai), options: pack.options, overrides: withPc(pack.overrides, project), staffNames }) : null, [scoped, pack, project, staffNames])
  const untagged = multi ? (files || []).filter(f => f._table === 'hs_files' && !f.building && f.origin !== 'om_builder') : []
  async function setFileBuilding(f, key) {
    const { error } = await supabase.from('hs_files').update({ building: key || null }).eq('id', f.id)
    if (error) return setToast('Could not tag: ' + error.message)
    setFiles(fs => fs.map(x => x.id === f.id ? { ...x, building: key || null } : x))
  }
  async function autoTag() {
    let n = 0
    for (const f of untagged) {
      const k = guessBuilding(f, buildings)
      if (!k) continue
      const { error } = await supabase.from('hs_files').update({ building: k }).eq('id', f.id).is('building', null)
      if (!error) { n++; setFiles(fs => fs.map(x => x.id === f.id ? { ...x, building: k } : x)) }
    }
    setToast(n ? `${n} document${n === 1 ? '' : 's'} tagged by name · ${untagged.length - n} left to tag by hand` : 'No building names found in the file names — tag them by hand in Details › Documents')
  }
  const [ownValue, setOwnValue] = useState({})   // decision typed by hand, per conflict
  // Out of date when a Handover document was read after the draft, or the settings/decisions changed
  const lastChange = useMemo(() => (scoped || []).filter(f => f._table === 'hs_files' && f.ai && !f.ai.error)
    .reduce((m, f) => Math.max(m, new Date(f.ai.read_at || 0).getTime()), 0), [scoped])
  const draftStale = !!pack?.draft && (!pack.draft_at || new Date(pack.draft_at).getTime() < lastChange || pack.draft.key !== draftKey({ ...pack, overrides: withPc(pack.overrides, project) }))
  const openDecisions = (analysis?.conflicts || []).filter(c => pack?.overrides?.[c.key] == null)

  const composingRef = useRef(false)
  async function compose(open) {
    if (composingRef.current) return
    composingRef.current = true
    setComposing(true)
    const key = draftKey({ ...pack, overrides: withPc(pack.overrides, project) })
    try {
      const res = await composePack(projectId, pack.options, withPc(pack.overrides, project), multi && bkey ? building : undefined)
      const draft = { ...res, key }, draft_at = new Date().toISOString()
      // Save only the draft — never overwrite settings or decisions made meanwhile
      setPack(p => ({ ...p, draft, draft_at }))
      let uq = supabase.from('om_packs').update({ draft, draft_at }).eq('project_id', projectId)
      if (perBuilding) uq = uq.eq('building', bkey || '')
      const { data: upd, error } = await uq.select('id')
      if (!error && !(upd || []).length) {
        const cur = packRef.current || pack
        const row = { project_id: projectId, options: cur.options, overrides: cur.overrides, draft, draft_at }
        if (perBuilding) row.building = bkey || ''
        await supabase.from('om_packs').upsert(row, { onConflict: perBuilding ? 'project_id,building' : 'project_id' })
      }
      if (error) setToast('Draft built but not saved: ' + error.message)
      else if (!(upd || []).length) { const { data: chk } = await (perBuilding ? supabase.from('om_packs').select('id').eq('project_id', projectId).eq('building', bkey || '') : supabase.from('om_packs').select('id').eq('project_id', projectId)); if (!(chk || []).length) setToast('Draft built but not saved — try Rebuild') }
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
      const out = await renderPack(projectId, pack.draft.packs, { approvedBy: profile?.full_name, building: multi && bkey ? building : undefined })
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
  const typed = scoped.filter(f => f.ai)
  const groups = Object.entries(typed.reduce((acc, f) => { (acc[f.ai.doc_type] ||= []).push(f); return acc }, {}))
    .sort((a, b2) => Object.keys(DOC_TYPES).indexOf(a[0]) - Object.keys(DOC_TYPES).indexOf(b2[0]))
  const draftOk = pack.draft?.status === 'ok'
  const lastIssue = issues.find(i => i.kind === 'om')
  const packsOn = [o.type === 'building' ? 'Building O&M' : 'Package O&M', o.warranty && 'Warranty', o.tenant && 'Tenant O&M', o.golden_thread && 'Golden Thread'].filter(Boolean)
  const toggle = p => setPanel(cur => cur === p ? null : p)
  const overview = multi && !bkey

  return (
    <div className="om">
      {overview ? (
        <BuildingsOverview buildings={buildings} files={files} allPacks={allPacks} allIssues={allIssues} project={project} staffNames={staffNames}
          onPick={onPickBuilding} reading={reading} canDrop={canDrop} untagged={untagged} setFileBuilding={setFileBuilding} labels={labels} onAutoTag={autoTag} />
      ) : (<>
      {/* ── Status card ─────────────────────────────────────────── */}
      <div className="om-head card">
        <div className="om-head-main">
          <div className="om-title">H&S File & O&M{building ? <span className="om-title-b"> — {building.name}</span> : null}</div>
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
            {analysis.warnings.length > 0 && <button className="pill pill-gray om-pillbtn" onClick={() => toggle('details')}>{new Set(analysis.warnings.map(w => w.file.id)).size} documents to query</button>}
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

      </>)}
      {multi && !overview && untagged.length > 0 && (
        <div className="om-untagged">
          <span><b>{untagged.length} document{untagged.length === 1 ? '' : 's'}</b> not tagged to a building yet — {overview ? 'tag them below' : "they're included in every building's manual until tagged"}.</span>
          {canDrop && <button className="btn btn-sm" onClick={autoTag}>Tag by name</button>}
          {!overview && <button className="btn btn-sm" onClick={() => { setPanel('details'); setDetailsTab('docs') }}>Tag by hand</button>}
        </div>
      )}
      {/* ── Drop zone ───────────────────────────────────────────── */}
      {canDrop && (
        <div className={`om-drop big${dragOver ? ' over' : ''}`}
          onDragOver={e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragOver(true) } }}
          onDragLeave={() => setDragOver(false)}
          onDrop={async e => { if (!e.dataTransfer?.types?.includes('Files')) return; e.preventDefault(); e.stopPropagation(); setDragOver(false); addDropped(await collectDropped(e.dataTransfer)) }}>
          <b>Drop files or whole folders here — or anywhere on this page</b>
          <span>Each document is read and filed into the right folder below; no need to pick one. Drawings go into Record Drawings by what they show — floor plans, elevations, fire strategy, services — and an older revision of the same drawing moves to Superseded.</span>
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
              <div className="om-doc-main"><div className="om-doc-n">{r.name}</div><div className="om-doc-s">{r.alt ? `Claude suggests ${r.alt.label}` : r.note || r.type || ''}</div></div>
              <div className="om-doc-where">{r.to ? `→ ${r.to}` : <span className="pill pill-amber">To file</span>}{r.check && <span className="pill pill-amber om-check">check</span>}</div>
              {r.alt && canDrop && <button className="om-link" onClick={() => moveTo(r, r.alt.key)}>Move there</button>}
              {canDrop && r.id && r.to && !r.alt && r.to !== labels[r.from] && <button className="om-link" onClick={() => undoMove(r)}>Undo</button>}
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
              {canDrop && f.ai?.suggested_folder && labels[f.ai.suggested_folder] && f.ai.suggested_folder !== '_inbox' && (
                <button className="btn btn-sm om-accept" title={labels[f.ai.suggested_folder]} onClick={() => fileTo(f, f.ai.suggested_folder)}>✓ {labels[f.ai.suggested_folder].split(' › ').pop()}</button>
              )}
              {canDrop && <select className="om-sel" value="" onChange={e => e.target.value && fileTo(f, e.target.value)}>
                <option value="">{f.ai?.suggested_folder && f.ai.suggested_folder !== '_inbox' && labels[f.ai.suggested_folder] ? 'Other…' : 'File to…'}</option>
                {f.ai?.suggested_folder && f.ai.suggested_folder !== '_inbox' && labels[f.ai.suggested_folder] && <option value={f.ai.suggested_folder}>Suggested: {labels[f.ai.suggested_folder]}</option>}
                {Object.entries(labels).filter(([k]) => k !== '_inbox').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>}
            </div>
          ))}
        </section>
      )}

      {/* ── Details ─────────────────────────────────────────────── */}
      {panel === 'details' && !overview && (
        <DetailsPanel analysis={analysis} pack={pack} canEdit={canEdit} setOverride={setOverride} files={scoped} groups={groups}
          labels={labels} issues={issues} download={download} projectId={projectId} reading={reading}
          multi={multi} buildings={buildings} setFileBuilding={canDrop ? setFileBuilding : null} startTab={detailsTab} key={detailsTab || 'd'} />
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

// Tag a Handover file to a building (or the whole site)
function BuildingSelect({ f, buildings, onChange }) {
  if (!onChange) {
    const b = buildings.find(x => x.key === f.building)
    return <span className="om-btag">{b ? b.name : f.building === 'site' ? 'Whole site' : 'Not tagged'}</span>
  }
  return (
    <select className={`om-bsel${f.building ? '' : ' none'}`} value={f.building || ''} onChange={e => onChange(f, e.target.value)} title="Which building this document is for">
      <option value="">Not tagged</option>
      <option value="site">Whole site</option>
      {buildings.map(b => <option key={b.key} value={b.key}>{b.name}</option>)}
    </select>
  )
}

// All buildings at a glance — each building's own manual, then anything untagged
function BuildingsOverview({ buildings, files, allPacks, allIssues, project, staffNames, onPick, reading, canDrop, untagged, setFileBuilding, labels, onAutoTag }) {
  const [showAll, setShowAll] = useState(false)
  const site = files.filter(f => f._table === 'hs_files' && f.building === 'site').length
  return (
    <>
      <div className="om-head card">
        <div className="om-head-main">
          <div className="om-title">H&S File & O&M — all buildings</div>
          <div className="om-sub">Each building has its own O&M manual. Documents tagged to a building go into its manual; whole-site documents go into all of them. Drop documents below — Claude reads each one and says which building it's for.</div>
        </div>
        <div className="om-head-side"><div className="om-state">
          {reading && <span className="pill pill-blue">{reading.label} {reading.done}/{reading.total}…</span>}
          <span className="pill pill-gray">{site} whole-site document{site === 1 ? '' : 's'}</span>
        </div></div>
      </div>
      <div className="om-bgrid">
        {buildings.map(b => {
          const pk = allPacks.find(p => p.building === b.key)
          const o = pk?.options || DEFAULT_OPTIONS
          const own = files.filter(f => f._table === 'hs_files' && f.building === b.key)
          const scope = files.filter(f => inBuilding(f, b.key))
          const a = analyse({ project, files: scope.filter(f => f.folder_key !== '_inbox' || f.ai), options: o, overrides: withPc(pk?.overrides, project), staffNames })
          const last = allIssues.find(i => i.building === b.key && i.kind === 'om')
          const packs = [o.type === 'building' ? 'Building O&M' : 'Package O&M', o.tenant && 'Tenant O&M', o.golden_thread && 'Golden Thread'].filter(Boolean)
          return (
            <button key={b.key} type="button" className="card om-bcard" onClick={() => onPick?.(b.key)}>
              <span className="om-bcard-n">{b.name}</span>
              <span className="om-bcard-p">{pk ? packs.join(' · ') : 'Not set up yet'}</span>
              <span className="om-bcard-s">
                <span>{own.length} document{own.length === 1 ? '' : 's'}</span>
                {a.missing > 0 ? <span className="om-bad">{a.missing} missing</span> : <span className="om-good">✓ ready</span>}
                <span>{pk?.draft?.status === 'ok' ? 'Draft built' : 'No draft'}</span>
                <span>{last ? `${last.issue_no} issued` : 'Not issued'}</span>
              </span>
              <span className="om-bcard-go">Open →</span>
            </button>
          )
        })}
      </div>
      {untagged.length > 0 && (
        <section className="card om-card">
          <div className="om-card-h">Not tagged to a building <span className="pill pill-amber">{untagged.length}</span>
            {canDrop && <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={onAutoTag}>Tag by name</button>}</div>
          <div className="om-pane-note" style={{ marginBottom: 6 }}>Untagged documents go into every building's manual. Pick a building, or "Whole site" for things like site drainage and utilities.</div>
          {(showAll ? untagged : untagged.slice(0, 12)).map(f => (
            <div key={f.id} className="om-doc">
              <div className="om-doc-main"><div className="om-doc-n">{f.ai?.title || f.file_name}</div><div className="om-doc-s">{labels[f.folder_key] || f.folder_key}</div></div>
              <BuildingSelect f={f} buildings={buildings} onChange={canDrop ? setFileBuilding : null} />
            </div>
          ))}
          {untagged.length > 12 && <button className="om-more" onClick={() => setShowAll(v => !v)}>{showAll ? 'Show fewer' : `Show all ${untagged.length}`}</button>}
        </section>
      )}
    </>
  )
}

// ── Details: four tabs instead of one long page ─────────────────────────────
// To do · Queries (grouped, hideable) · Documents (collapsed by type) · Issued
const QUERY_GROUPS = [
  ['dates',   'Dates to check',            /\b(future|date|dated|year|expir|out of date|older|newer)\b/i],
  ['generic', 'Generic, not job-specific', /\b(generic|template|terms and conditions|marketing|brochure|copy\b|copyright|standard trading|not project[- ]specific)\b/i],
  ['missing', 'Missing on the document',   /\b(no |not (specified|identified|shown|provided|stated|included|filled)|missing|blank|without|n\/a)\b/i],
  ['other',   'Other queries',             /[\s\S]*/],
]
function DetailsPanel({ analysis, pack, canEdit, setOverride, files, groups, labels, issues, download, projectId, reading, multi, buildings, setFileBuilding, startTab }) {
  const [tab, setTab] = useState(startTab || 'todo')
  const [showOk, setShowOk] = useState(false)
  const [openDoc, setOpenDoc] = useState(null)
  const [openType, setOpenType] = useState(null)
  const hideKey = `om:hidden:${projectId}`
  const [hidden, setHidden] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem(hideKey) || '[]')) } catch { return new Set() } })
  const hide = id => setHidden(h => { const n = new Set(h); n.add(id); try { localStorage.setItem(hideKey, JSON.stringify([...n])) } catch { /* ignore */ } return n })
  const unhideAll = () => { setHidden(new Set()); try { localStorage.removeItem(hideKey) } catch { /* ignore */ } }

  const items = analysis.readiness.flatMap(g => g.items.map(it => ({ ...it, group: g.group })))
  const todo = items.filter(i => i.status === 'missing')
  const done = items.filter(i => i.status !== 'missing')
  // Queries: one row per document, grouped by kind of query
  const byDoc = new Map()
  analysis.warnings.forEach(w => { if (!hidden.has(w.file.id)) { const e = byDoc.get(w.file.id) || { file: w.file, msgs: [] }; e.msgs.push(w.msg); byDoc.set(w.file.id, e) } })
  const qGroups = QUERY_GROUPS.map(([key, label]) => ({ key, label, docs: [] }))
  for (const d of byDoc.values()) {
    const kinds = d.msgs.map(m => (QUERY_GROUPS.find(([, , re]) => re.test(String(m || ''))) || QUERY_GROUPS[3])[0])
    const main = ['generic', 'dates', 'missing', 'other'].find(k => kinds.includes(k))
    qGroups.find(g => g.key === main).docs.push(d)
  }
  const qCount = byDoc.size
  const decided = Object.entries(pack.overrides || {})
  const nameOf = k => ({ owner_address: 'Owner address', owner: 'Building owner', practical_completion: 'Practical completion' })[k] || k
  const TABS = [['todo', 'To do', todo.length], ['queries', 'Queries', qCount], ['docs', 'Documents', analysis.read], ['issued', 'Issued', issues.length]]

  return (
    <section className="card om-card om-details">
      <div className="om-tabs" role="tablist">
        {TABS.map(([k, l, n]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}{n ? <span>{n}</span> : null}</button>)}
      </div>

      {tab === 'todo' && (
        <div className="om-pane">
          {todo.length === 0 ? <div className="om-allgood">✓ Everything needed for the manual has been found.</div> : todo.map(i => (
            <div key={i.group + i.key} className="om-todo">
              <span className="om-todo-i">!</span>
              <div className="om-todo-b">
                <b>{i.label}</b> <small>{i.group}</small>
                <div className="om-todo-d">{i.detail}</div>
                {i.action === 'completion' && canEdit && (
                  <label className="om-ri-date">Practical completion (applies to all systems):
                    <input type="date" value={toIso(pack.overrides?.practical_completion)} onChange={e => setOverride('practical_completion', e.target.value ? fromIso(e.target.value) : null)} />
                  </label>
                )}
              </div>
            </div>
          ))}
          {decided.length > 0 && (
            <div className="om-decided">
              {decided.map(([k, v]) => <span key={k} className="om-chip-ok">✓ {nameOf(k)}: <b>{v}</b>{canEdit && <button className="om-link" onClick={() => setOverride(k, null)}>change</button>}</span>)}
            </div>
          )}
          <button type="button" className="om-more" onClick={() => setShowOk(v => !v)}>{showOk ? 'Hide' : 'Show'} the {done.length} item{done.length === 1 ? '' : 's'} already found</button>
          {showOk && done.map(i => (
            <div key={i.group + i.key} className="om-okrow"><span>✓</span><b>{i.label}</b><em>{i.detail}</em></div>
          ))}
        </div>
      )}

      {tab === 'queries' && (
        <div className="om-pane">
          <div className="om-pane-note">Points Claude noticed while reading — for you to check with the issuer. They don't stop you issuing.{hidden.size > 0 && <> · <button className="om-link" onClick={unhideAll}>show {hidden.size} hidden</button></>}</div>
          {qCount === 0 && <div className="om-allgood">✓ Nothing to query.</div>}
          {qGroups.filter(g => g.docs.length).map(g => (
            <div key={g.key} className="om-qgroup">
              <div className="om-qgroup-h">{g.label} <span>{g.docs.length}</span></div>
              {g.docs.map(d => (
                <div key={d.file.id} className={`om-qdoc${openDoc === d.file.id ? ' open' : ''}`}>
                  <button type="button" className="om-qdoc-h" onClick={() => setOpenDoc(openDoc === d.file.id ? null : d.file.id)}>
                    <span className="om-qdoc-n">{d.file.ai?.title || d.file.file_name}</span>
                    <span className="om-qdoc-c">{d.msgs.length} point{d.msgs.length === 1 ? '' : 's'}</span>
                  </button>
                  {openDoc === d.file.id && (
                    <div className="om-qdoc-b">
                      <ul>{d.msgs.map((m, i) => <li key={i}>{m}</li>)}</ul>
                      <div className="om-qdoc-f"><span>{d.file.file_name}</span><button className="om-link" onClick={() => hide(d.file.id)}>Hide — checked</button></div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === 'docs' && (
        <div className="om-pane">
          <div className="om-pane-note">{files.length} documents {multi ? 'for this building (its own, whole-site and untagged)' : 'on the job'} · {analysis.read} read by Claude{reading ? ' · reading…' : ''}</div>
          {groups.length === 0 && <div className="om-empty">Nothing read yet.</div>}
          {groups.sort((a, b) => b[1].length - a[1].length).map(([type, list]) => (
            <div key={type} className={`om-tgroup${openType === type ? ' open' : ''}`}>
              <button type="button" className="om-tgroup-h" onClick={() => setOpenType(openType === type ? null : type)}>
                <span className={`om-dot t-${DOC_TYPES[type]?.tone || 'gray'}`} />{DOC_TYPES[type]?.label || type}<span className="om-tgroup-n">{list.length}</span><span className="om-tgroup-x">{openType === type ? '▴' : '▾'}</span>
              </button>
              {openType === type && list.map(f => (
                <div key={f.id} className="om-doc">
                  <div className="om-doc-main">
                    <div className="om-doc-n">{f.ai.title || f.file_name}</div>
                    <div className="om-doc-s">{[f.ai.issuer, f.ai.reference, f.ai.dates?.expiry && `to ${f.ai.dates.expiry}`].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div className="om-doc-where">{f.ai.client_facing === false ? <span className="pill pill-gray">Internal</span> : <span title={labels[f.folder_key]}>{f._source === 'Documents' ? 'Documents tab' : (labels[f.folder_key] || f.folder_key)}</span>}</div>
                  {multi && f._table === 'hs_files' && <BuildingSelect f={f} buildings={buildings} onChange={setFileBuilding} />}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === 'issued' && (
        <div className="om-pane">
          {issues.length === 0 && <div className="om-empty">Nothing issued yet.</div>}
          {issues.map(i => (
            <div key={i.id} className="om-issue"><b>{i.issue_no}</b><span>{fmt(i.created_at)}{i.pages ? ` · ${i.pages} pages` : ''}{i.approved_by ? ` · ${i.approved_by}` : ''}</span>
              <button className="om-link" onClick={() => download(i)}>Download</button><em>{i.file_name}</em></div>
          ))}
        </div>
      )}
    </section>
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
