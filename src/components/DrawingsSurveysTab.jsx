import { useEffect, useState } from 'react'
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
// This component never deletes, moves or renames anything — it only reads.
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
    if (data.status === 'ok') setEmbed({ state: 'ok', url: withTheme(data.url), message: '' })
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
    const keys = []
    for (const [root, label] of Object.entries(ROOT_KEYS)) {
      const stack = [[root, label]]
      while (stack.length) {
        const [k, p] = stack.pop()
        pathOf[k] = p; keys.push(k)
        rows.filter(r => r.parent_key === k).forEach(r => stack.push([r.folder_key, p + ' › ' + r.label]))
      }
    }
    const { data: files } = await supabase.from('project_doc_files')
      .select('id, file_name, file_size, storage_path, subfolder_key, created_at')
      .eq('project_id', projectId).in('subfolder_key', keys)
      .order('created_at', { ascending: false })
    const byPath = {}
    ;(files || []).forEach(f => { const p = pathOf[f.subfolder_key] || 'Other'; (byPath[p] ||= []).push(f) })
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

  const fileCount = groups.reduce((a, g) => a + g.files.length, 0)
  const isDesignSource = proj?.drawings_source === 'design'
  const linked = !!link?.linked

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
        <button className="btn btn-sm" onClick={e => { e.stopPropagation(); onOpenDocuments?.() }}>Open in Documents</button>
        {linked && isDesignSource && <span style={{ color: 'var(--text3)' }}>{archiveOpen ? '▴' : '▾'}</span>}
      </div>
      {(!linked || !isDesignSource || archiveOpen) && !crmLoading && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '6px 14px 12px' }}>
          {groups.length === 0 && <div style={{ fontSize: 12, color: 'var(--text3)', padding: '8px 0' }}>No drawings or surveys stored in the CRM for this project.</div>}
          {groups.map(g => (
            <div key={g.path} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>{g.path} · {g.files.length}</div>
              {g.files.map(f => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderTop: '1px solid var(--border)', fontSize: 12.5 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name}</span>
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
            <iframe title="Design portal drawings" src={embed.url}
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
