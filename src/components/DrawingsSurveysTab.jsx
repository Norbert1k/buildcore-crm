import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Drawings & surveys — CRM ⇄ Design portal link (first build).
//
//  • Linked project (CRM project_ref, or the design_code override, matches a
//    Design portal project code): the Design portal's own Documents view is
//    embedded here, view-only, signed in via a short-lived hand-off.
//  • The CRM's existing "01. Drawings" and "02. Surveys & Reports" folders are
//    ALWAYS still shown underneath — read-only here, managed in Documents —
//    because jobs are moving into the Design portal bit by bit.
//  • drawings_source = 'design' only collapses them into an archive section.
//
//  • "Send to Design portal" COPIES ticked CRM files into the Design portal's
//    own intake (AI reads title blocks; you review before filing). The CRM
//    originals are never deleted, moved or renamed.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT_KEYS = { drawings: '01. Drawings', reports: '02. Surveys & Reports' }

function fmtSize(b) {
  if (!b) return ''
  if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB'
  return (b / (1024 * 1024)).toFixed(1) + ' MB'
}

// Pass the CRM's light/dark state to the embedded Design view so they match.
const DARK_THEMES = new Set(['dark', 'forest', 'slate', 'blueprint'])
function withTheme(url) {
  const t = document.documentElement.getAttribute('data-theme') || 'light'
  return url + (url.includes('?') ? '&' : '?') + 'theme=' + (DARK_THEMES.has(t) ? 'dark' : 'light')
}

// ── Is a CRM file already in the Design portal? (read-only) ──
// Same drawing-number + revision rules as the Design portal (src/lib/revision.ts):
//   Design has the same or a NEWER revision → 'in'     (hidden here)
//   CRM copy is NEWER than Design           → 'newer'  (needs moving)
//   both have revisions that can't compare  → 'check'
//   not found at all                        → 'missing'
// Files without a drawing number fall back to name matching.
const DESIGN_ORIGIN = 'https://design.cltd.co.uk'
const stripExt = n => String(n || '').replace(/\.[a-z0-9]{1,5}$/i, '').trim()
const stem = n => stripExt(n).toLowerCase()
const loose = n => stem(n).replace(/\(\d+\)$/, '').replace(/[^a-z0-9]+/g, '')
const REV_PATTERNS = [
  /\brev(?:ision)?[\s._-]*([A-Z]{1,2}\d{0,3}|\d{1,3})\b/i,
  /[\s([_-]((?:P|T|C)\d{1,3})[\])]?\s*$/i,
  /[\s([_-]((?:P|T|C)\d{2})(?=[\s._-])/i,
]
function parseRevision(name) {
  const base = stripExt(name)
  for (const re of REV_PATTERNS) {
    const m = base.match(re)
    if (m) return { rev: m[1].toUpperCase().replace(/^([PTC])0+(\d)/, '$1$2').replace(/^0+(\d)/, '$1'), base: (base.slice(0, m.index) + base.slice(m.index + m[0].length)).trim() }
  }
  return { rev: null, base }
}
function parseDrawing(name) {
  const { rev, base } = parseRevision(name)
  const tokens = (base.match(/[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)+/g) || [])
    .filter(t => /\d/.test(t) && t.replace(/[^A-Za-z0-9]/g, '').length >= 5)
    .sort((a, b) => b.length - a.length)
  return tokens.length ? { key: tokens[0].toUpperCase().replace(/[_.]/g, '-'), rev, byNumber: true } : { key: null, rev, byNumber: false }
}
function revParts(r) {
  const s = r.toUpperCase()
  let m = s.match(/^([PTC])(\d+)$/); if (m) return { kind: 'coded', rank: 'PTC'.indexOf(m[1]), n: Number(m[2]) }
  m = s.match(/^([A-Z]{1,2})$/); if (m) return { kind: 'letter', rank: 0, n: s.length * 100 + (s.charCodeAt(s.length - 1) - 64) + (s.length > 1 ? (s.charCodeAt(0) - 64) * 26 : 0) }
  m = s.match(/^(\d+)$/); if (m) return { kind: 'number', rank: 0, n: Number(m[1]) }
  return null
}
function compareRev(a, b) {
  if (!a || !b) return null
  if (a.toUpperCase() === b.toUpperCase()) return 0
  const pa = revParts(a), pb = revParts(b)
  if (!pa || !pb || pa.kind !== pb.kind) return null
  if (pa.rank !== pb.rank) return pa.rank > pb.rank ? 1 : -1
  return pa.n === pb.n ? 0 : pa.n > pb.n ? 1 : -1
}
function buildInventory(names) {
  const byKey = new Map()   // drawing number → newest revision in Design
  for (const n of names) {
    const p = parseDrawing(n)
    if (!p.byNumber) continue
    const cur = byKey.get(p.key)
    if (cur === undefined || compareRev(p.rev, cur) === 1 || (cur === null && p.rev)) byKey.set(p.key, p.rev)
  }
  return { stems: new Set(names.map(stem)), loose: new Set(names.map(loose)), byKey }
}
function designStatus(inv, name) {
  if (!inv) return null
  const p = parseDrawing(name)
  if (p.byNumber && inv.byKey.has(p.key)) {
    const dRev = inv.byKey.get(p.key)
    if (!p.rev || !dRev) return { status: 'in' }
    const c = compareRev(p.rev, dRev)
    if (c === 1) return { status: 'newer', designRev: dRev }
    if (c === null) return { status: 'check', designRev: dRev }
    return { status: 'in' }
  }
  if (inv.stems.has(stem(name)) || inv.loose.has(loose(name))) return { status: 'in' }
  return { status: 'missing' }
}
const inDesign = (inv, name) => designStatus(inv, name)?.status === 'in'

export default function DrawingsSurveysTab({ projectId, canManage, onOpenDocuments }) {
  const [proj, setProj] = useState(null)
  const [link, setLink] = useState(null)            // { linked, project?, code }
  const [embed, setEmbed] = useState({ state: 'idle', url: null, message: '' })
  const [groups, setGroups] = useState([])          // [{ path, files: [...] }]
  const [crmLoading, setCrmLoading] = useState(true)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [showLinkSettings, setShowLinkSettings] = useState(false)
  const [codeDraft, setCodeDraft] = useState('')
  const [saving, setSaving] = useState(false)
  // ── Send-to-Design bridge ──
  const iframeRef = useRef(null)
  const [designReady, setDesignReady] = useState(false)
  const [inventory, setInventory] = useState(null)     // { stems, tokens } from the portal
  const [picked, setPicked] = useState(() => new Set())
  const [sendMsg, setSendMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [openGroups, setOpenGroups] = useState(() => new Set())   // collapsed by default
  const [checkedAt, setCheckedAt] = useState(null)
  const [showDone, setShowDone] = useState(false)   // files already in Design are hidden by default (display only)

  useEffect(() => {
    function onMessage(e) {
      if (e.origin !== DESIGN_ORIGIN) return
      const m = e.data || {}
      if (m.type === 'ccg-ready') { setDesignReady(true); askInventory() }
      if (m.type === 'ccg-inventory-result') { setInventory(buildInventory(m.names || [])); setCheckedAt(new Date()) }
      if (m.type === 'ccg-intake-result') setSendMsg(m.ok ? 'Sent — check the auto-sort plan in the Design view above, then start.' : (m.message || 'The Design portal refused the files.'))
      if (m.type === 'ccg-intake-done') { setSendMsg('Filed in the Design portal. CRM copies kept.'); setPicked(new Set()); askInventory() }
    }
    window.addEventListener('message', onMessage)
    const onVisible = () => { if (document.visibilityState === 'visible') askInventory() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      window.removeEventListener('message', onMessage)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  function askInventory() {
    iframeRef.current?.contentWindow?.postMessage({ type: 'ccg-inventory' }, DESIGN_ORIGIN)
  }

  useEffect(() => { loadProject(); loadCrmDrawings() }, [projectId])

  async function loadProject() {
    const { data } = await supabase.from('projects')
      .select('id, project_ref, design_code, drawings_source').eq('id', projectId).maybeSingle()
    setProj(data || null)
    setCodeDraft(data?.design_code || '')
    resolveLink()
  }

  async function resolveLink() {
    setLink(null); setEmbed({ state: 'idle', url: null, message: '' })
    const { data, error } = await supabase.functions.invoke('design-link', { body: { project_id: projectId, action: 'resolve' } })
    if (error || !data) { setLink({ linked: false, error: true }); return }
    setLink(data)
    if (data.linked) openEmbed()
  }

  async function openEmbed() {
    setEmbed({ state: 'loading', url: null, message: '' })
    const { data, error } = await supabase.functions.invoke('design-link', { body: { project_id: projectId, action: 'handoff', embed: true } })
    if (error || !data) { setEmbed({ state: 'error', url: null, message: 'Couldn’t reach the Design portal.' }); return }
    if (data.status === 'ok') { setDesignReady(false); setInventory(null); setEmbed({ state: 'ok', url: withTheme(data.url), message: '' }) }
    else if (data.status === 'no_account') setEmbed({ state: 'no_account', url: null, message: '' })
    else if (data.status === 'no_access') setEmbed({ state: 'no_access', url: null, message: '' })
    else setEmbed({ state: 'error', url: null, message: data.message || 'Couldn’t open the Design portal.' })
  }

  async function openFullPortal() {
    // Open the tab synchronously (avoids pop-up blockers), then point it.
    const w = window.open('', '_blank')
    const { data } = await supabase.functions.invoke('design-link', { body: { project_id: projectId, action: 'handoff', embed: false } })
    if (data?.status === 'ok' && w) w.location.href = data.url
    else if (w) w.location.href = 'https://design.cltd.co.uk'
  }

  // ── CRM drawings & surveys: read-only listing of the existing folders ──
  async function loadCrmDrawings() {
    setCrmLoading(true)
    const { data: folderRows } = await supabase.from('project_doc_folders')
      .select('folder_key, parent_key, label').eq('project_id', projectId)
    const rows = folderRows || []
    // Walk descendants of each root, building label paths.
    const pathOf = {}
    const rootOf = {}
    const keys = []
    for (const [root, label] of Object.entries(ROOT_KEYS)) {
      const stack = [[root, label]]
      while (stack.length) {
        const [k, p] = stack.pop()
        pathOf[k] = p; rootOf[k] = root; keys.push(k)
        rows.filter(r => r.parent_key === k).forEach(r => stack.push([r.folder_key, p + ' › ' + r.label]))
      }
    }
    const { data: files } = await supabase.from('project_doc_files')
      .select('id, file_name, file_size, storage_path, subfolder_key, created_at')
      .eq('project_id', projectId).in('subfolder_key', keys)
      .order('created_at', { ascending: false })
    const byPath = {}
    ;(files || []).forEach(f => { const p = pathOf[f.subfolder_key] || 'Other'; (byPath[p] ||= []).push({ ...f, root: rootOf[f.subfolder_key], path: p }) })
    setGroups(Object.keys(byPath).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map(p => ({ path: p, files: byPath[p].sort((a, b) => a.file_name.localeCompare(b.file_name, undefined, { numeric: true })) })))
    setCrmLoading(false)
  }

  async function openCrmFile(f, download) {
    const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 600, download ? { download: f.file_name } : undefined)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function setSource(v) {
    setSaving(true)
    await supabase.from('projects').update({ drawings_source: v }).eq('id', projectId)
    setProj(p => ({ ...p, drawings_source: v })); setSaving(false)
  }

  async function saveCode() {
    setSaving(true)
    const v = codeDraft.trim() || null
    await supabase.from('projects').update({ design_code: v }).eq('id', projectId)
    setProj(p => ({ ...p, design_code: v })); setSaving(false); setShowLinkSettings(false)
    resolveLink()
  }

  // Copy ticked CRM files into the embedded portal's intake (read + post only).
  async function sendToDesign() {
    const all = groups.flatMap(g => g.files).filter(f => picked.has(f.id))
    if (!all.length || !iframeRef.current) return
    setSending(true); setSendMsg(`Preparing ${all.length} file${all.length === 1 ? '' : 's'}…`)
    const files = []
    const meta = []   // CRM folder path per file — lets the portal auto-sort
    let failed = 0
    for (const f of all) {
      const { data, error } = await supabase.storage.from('project-docs').download(f.storage_path)
      if (error || !data) { failed++; continue }
      files.push(new File([data], f.file_name, { type: data.type || 'application/octet-stream' }))
      meta.push({ path: f.path || '', root: f.root || '' })
    }
    setSending(false)
    if (!files.length) { setSendMsg('Couldn’t read those files from the CRM.'); return }
    const hint = all.every(f => f.root === 'reports') ? 'reports' : 'drawings'
    iframeRef.current.contentWindow?.postMessage({ type: 'ccg-intake', files, meta, hint }, DESIGN_ORIGIN)
    iframeRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setSendMsg(`Sending ${files.length} file${files.length === 1 ? '' : 's'}…${failed ? ` (${failed} couldn’t be read)` : ''}`)
  }

  const fileCount = groups.reduce((a, g) => a + g.files.length, 0)
  const isDesignSource = proj?.drawings_source === 'design'
  const linked = !!link?.linked
  const canSend = linked && embed.state === 'ok' && designReady
  const allFiles = groups.flatMap(g => g.files)
  const notInDesign = inventory ? allFiles.filter(f => !inDesign(inventory, f.file_name)) : []
  // Hide what's already in the Design portal — purely a view filter, the CRM
  // files themselves are untouched.
  const hideDone = !!inventory && !showDone
  const doneCount = inventory ? allFiles.length - notInDesign.length : 0
  const shownGroups = groups
    .map(g => ({ ...g, shown: hideDone ? g.files.filter(f => !inDesign(inventory, f.file_name)) : g.files }))
    .filter(g => g.shown.length > 0)
  const togglePick = id => setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  // ── CRM section (shared by every state) ──
  const crmSection = (
    <div className="card" style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: linked && isDesignSource ? 'pointer' : 'default' }}
        onClick={() => linked && isDesignSource && setArchiveOpen(o => !o)}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            {!linked ? 'Drawings & surveys (CRM)' : isDesignSource ? 'Archive — CRM drawings' : 'CRM drawings — not yet moved to the Design portal'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            {crmLoading ? 'Loading…' : inventory
              ? `${notInDesign.length} still to move · ${doneCount} already in Design${hideDone ? ' (hidden)' : ''}`
              : `${fileCount} file${fileCount === 1 ? '' : 's'} in Project Information › Drawings / Surveys & Reports`}
            {' · '}uploads and changes are made in Documents
          </div>
        </div>
        {canSend && (
          <button className="btn btn-sm" onClick={e => { e.stopPropagation(); askInventory() }} title={checkedAt ? `Last checked ${checkedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Check the Design portal again'}>↻ Recheck</button>
        )}
        {inventory && doneCount > 0 && (
          <button className="btn btn-sm" onClick={e => { e.stopPropagation(); setShowDone(v => !v) }}>{showDone ? 'Hide' : 'Show'} {doneCount} in Design</button>
        )}
        {shownGroups.length > 1 && (
          <button className="btn btn-sm" onClick={e => { e.stopPropagation(); setOpenGroups(prev => prev.size ? new Set() : new Set(shownGroups.map(g => g.path))) }}>{openGroups.size ? 'Collapse all' : 'Expand all'}</button>
        )}
        {canSend && inventory && notInDesign.length > 0 && (
          <button className="btn btn-sm" onClick={e => { e.stopPropagation(); setPicked(new Set(notInDesign.map(f => f.id))) }}>Select {notInDesign.length} not in Design</button>
        )}
        {canSend && picked.size > 0 && (
          <button className="btn btn-sm btn-primary" disabled={sending} onClick={e => { e.stopPropagation(); sendToDesign() }}>Send {picked.size} to Design portal</button>
        )}
        <button className="btn btn-sm" onClick={e => { e.stopPropagation(); onOpenDocuments?.() }}>Open in Documents</button>
        {linked && isDesignSource && <span style={{ color: 'var(--text3)' }}>{archiveOpen ? '▴' : '▾'}</span>}
      </div>
      {sendMsg && <div style={{ padding: '0 14px 8px', fontSize: 12, color: 'var(--text2)' }}>{sendMsg}</div>}
      {(!linked || !isDesignSource || archiveOpen) && !crmLoading && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '6px 14px 12px' }}>
          {groups.length === 0 && <div style={{ fontSize: 12, color: 'var(--text3)', padding: '8px 0' }}>No drawings or surveys stored in the CRM for this project.</div>}
          {groups.length > 0 && shownGroups.length === 0 && <div style={{ fontSize: 12, color: 'var(--green)', padding: '8px 0' }}>Everything here is already in the Design portal.</div>}
          {shownGroups.map(g => (
            <div key={g.path} style={{ marginTop: 6 }}>
              {(() => {
                const isOpen = openGroups.has(g.path)
                const missing = inventory ? g.files.filter(f => !inDesign(inventory, f.file_name)) : []
                const allPicked = missing.length > 0 && missing.every(f => picked.has(f.id))
                return (
                  <div onClick={() => setOpenGroups(prev => { const n = new Set(prev); n.has(g.path) ? n.delete(g.path) : n.add(g.path); return n })}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer', borderTop: '1px solid var(--border)' }}>
                    <span style={{ width: 12, color: 'var(--text3)', fontSize: 11 }}>{isOpen ? '▾' : '▸'}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.path}>{g.path} · {g.shown.length}</span>
                    {inventory && (missing.length
                      ? <span className="pill pill-amber" style={{ fontSize: 10, flexShrink: 0 }}>{missing.length} not in Design</span>
                      : <span className="pill pill-green" style={{ fontSize: 10, flexShrink: 0 }}>All in Design</span>)}
                    {canSend && missing.length > 0 && (
                      <button className="btn btn-sm" style={{ flexShrink: 0 }} onClick={e => { e.stopPropagation(); setPicked(prev => { const n = new Set(prev); missing.forEach(f => allPicked ? n.delete(f.id) : n.add(f.id)); return n }) }}>{allPicked ? 'Unselect' : 'Select'} {missing.length}</button>
                    )}
                  </div>
                )
              })()}
              {openGroups.has(g.path) && g.shown.map(f => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderTop: '1px solid var(--border)', fontSize: 12.5 }}>
                  {canSend && <input type="checkbox" checked={picked.has(f.id)} onChange={() => togglePick(f.id)} />}
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name}</span>
                  {inventory && (() => {
                    const st = designStatus(inventory, f.file_name)
                    if (st.status === 'in') return <span className="pill pill-green" style={{ fontSize: 10, flexShrink: 0 }}>In Design</span>
                    if (st.status === 'newer') return <span className="pill pill-amber" style={{ fontSize: 10, flexShrink: 0 }} title="This CRM copy is a later revision than the Design portal's">Newer than Design (Rev {st.designRev})</span>
                    if (st.status === 'check') return <span className="pill pill-amber" style={{ fontSize: 10, flexShrink: 0 }} title="Same drawing number, revisions can't be compared">Check revision · Design Rev {st.designRev}</span>
                    return <span className="pill pill-amber" style={{ fontSize: 10, flexShrink: 0 }}>Not in Design</span>
                  })()}
                  <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>{fmtSize(f.file_size)}</span>
                  <a onClick={() => openCrmFile(f, false)} style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: 12, flexShrink: 0 }}>View</a>
                  <a onClick={() => openCrmFile(f, true)} style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: 12, flexShrink: 0 }}>Download</a>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div>
      {/* ── Link header ── */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', flexWrap: 'wrap' }}>
        <span style={{ width: 26, height: 26, borderRadius: 'var(--radius)', background: '#428B40', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>D</span>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            {link === null ? 'Checking the Design portal…'
              : linked ? <>Linked to Design · {link.project?.name} <span style={{ color: 'var(--text3)', fontWeight: 400 }}>({link.project?.code})</span></>
              : link.error ? 'Design portal unavailable right now'
              : 'No Design portal project found'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            {linked ? 'Live from design.cltd.co.uk · uploads here go straight into the Design portal'
              : link && !link.error ? `Looked for code “${proj?.design_code || proj?.project_ref || '—'}” — showing CRM drawings only`
              : ''}
          </div>
        </div>
        {linked && canManage && (
          <select value={proj?.drawings_source || 'migrating'} disabled={saving} onChange={e => setSource(e.target.value)}
            style={{ width: 'auto', padding: '5px 8px', fontSize: 12 }} title="Where this job's drawings live">
            <option value="migrating">Drawings source: migrating (both)</option>
            <option value="design">Drawings source: Design portal</option>
          </select>
        )}
        {linked && <button className="btn btn-sm" onClick={openFullPortal}>Open full portal ↗</button>}
        {canManage && <button className="btn btn-sm" onClick={() => setShowLinkSettings(s => !s)}>Link settings</button>}
      </div>

      {showLinkSettings && canManage && (
        <div className="card" style={{ marginTop: 8, padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>Design portal code</span>
          <input value={codeDraft} onChange={e => setCodeDraft(e.target.value)} placeholder={proj?.project_ref || 'e.g. 2026-002'}
            style={{ width: 180, padding: '6px 10px', fontSize: 12 }} />
          <button className="btn btn-sm btn-primary" disabled={saving} onClick={saveCode}>Save</button>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>Leave blank to match by project reference ({proj?.project_ref || '—'}).</span>
        </div>
      )}

      {/* ── Embedded Design portal ── */}
      {linked && (
        <div className="card" style={{ marginTop: 14, overflow: 'hidden', padding: 0 }}>
          {embed.state === 'ok' ? (
            <iframe ref={iframeRef} title="Design portal drawings" src={embed.url}
              style={{ width: '100%', height: 'calc(100vh - 230px)', minHeight: 640, border: 'none', display: 'block' }} />
          ) : (
            <div style={{ padding: 24, fontSize: 13, color: 'var(--text2)', textAlign: 'center' }}>
              {embed.state === 'loading' && 'Opening the Design portal…'}
              {embed.state === 'no_account' && 'You don’t have a Design portal account yet. Ask a CCG admin to invite you in the Design portal — the CRM drawings below are still available.'}
              {embed.state === 'no_access' && 'Your Design portal account isn’t a member of this project. Ask a CCG admin to add you there.'}
              {embed.state === 'error' && <>{embed.message} <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={openEmbed}>Retry</button></>}
            </div>
          )}
        </div>
      )}

      {crmSection}
    </div>
  )
}
