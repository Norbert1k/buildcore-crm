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

// ── Is a CRM file already in the Design portal? (heuristic, read-only) ──
// Matches on the filename without extension, or on a drawing-number token
// (e.g. 294-4GA-01) where one starts with the other — so "294-4GA-01-P3"
// matches the portal's "294-4GA-01 Ground floor GA".
const DESIGN_ORIGIN = 'https://design.cltd.co.uk'
const stem = n => String(n || '').replace(/\.[a-z0-9]{1,5}$/i, '').trim().toLowerCase()
const tokensOf = n => (stem(n).replace(/_/g, '-').match(/[a-z0-9]+(?:-[a-z0-9]+){2,}/g) || []).filter(t => t.length >= 6)
function buildInventory(names) {
  return { stems: new Set(names.map(stem)), tokens: names.flatMap(tokensOf) }
}
function inDesign(inv, name) {
  if (!inv) return null
  if (inv.stems.has(stem(name))) return true
  const mine = tokensOf(name)
  return mine.some(t => inv.tokens.some(d => d.startsWith(t) || t.startsWith(d)))
}

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

  useEffect(() => {
    function onMessage(e) {
      if (e.origin !== DESIGN_ORIGIN) return
      const m = e.data || {}
      if (m.type === 'ccg-ready') { setDesignReady(true); askInventory() }
      if (m.type === 'ccg-inventory-result') setInventory(buildInventory(m.names || []))
      if (m.type === 'ccg-intake-result') setSendMsg(m.ok ? 'Sent — choose where they go in the Design view above.' : (m.message || 'The Design portal refused the files.'))
      if (m.type === 'ccg-intake-done') { setSendMsg('Filed in the Design portal. CRM copies kept.'); setPicked(new Set()); askInventory() }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
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
    ;(files || []).forEach(f => { const p = pathOf[f.subfolder_key] || 'Other'; (byPath[p] ||= []).push({ ...f, root: rootOf[f.subfolder_key] }) })
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
    let failed = 0
    for (const f of all) {
      const { data, error } = await supabase.storage.from('project-docs').download(f.storage_path)
      if (error || !data) { failed++; continue }
      files.push(new File([data], f.file_name, { type: data.type || 'application/octet-stream' }))
    }
    setSending(false)
    if (!files.length) { setSendMsg('Couldn’t read those files from the CRM.'); return }
    const hint = all.every(f => f.root === 'reports') ? 'reports' : 'drawings'
    iframeRef.current.contentWindow?.postMessage({ type: 'ccg-intake', files, hint }, DESIGN_ORIGIN)
    iframeRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setSendMsg(`Sending ${files.length} file${files.length === 1 ? '' : 's'}…${failed ? ` (${failed} couldn’t be read)` : ''}`)
  }

  const fileCount = groups.reduce((a, g) => a + g.files.length, 0)
  const isDesignSource = proj?.drawings_source === 'design'
  const linked = !!link?.linked
  const canSend = linked && embed.state === 'ok' && designReady
  const allFiles = groups.flatMap(g => g.files)
  const notInDesign = inventory ? allFiles.filter(f => !inDesign(inventory, f.file_name)) : []
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
            {crmLoading ? 'Loading…' : `${fileCount} file${fileCount === 1 ? '' : 's'} in Project Information › Drawings / Surveys & Reports`}
            {' · '}uploads and changes are made in Documents
          </div>
        </div>
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
          {groups.map(g => (
            <div key={g.path} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>{g.path} · {g.files.length}</div>
              {g.files.map(f => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderTop: '1px solid var(--border)', fontSize: 12.5 }}>
                  {canSend && <input type="checkbox" checked={picked.has(f.id)} onChange={() => togglePick(f.id)} />}
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name}</span>
                  {inventory && (inDesign(inventory, f.file_name)
                    ? <span className="pill pill-green" style={{ fontSize: 10, flexShrink: 0 }}>In Design</span>
                    : <span className="pill pill-amber" style={{ fontSize: 10, flexShrink: 0 }}>Not in Design</span>)}
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
