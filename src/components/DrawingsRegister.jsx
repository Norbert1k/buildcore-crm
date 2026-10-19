import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import DrawingsSurveysTab, { buildInventory, designStatus, parseDrawing } from './DrawingsSurveysTab'

// ─────────────────────────────────────────────────────────────────────────────
// Drawings — a read-only mirror of the Design portal's drawing register.
//
// The Design portal stays the one home of drawings (stages, discipline
// folders, revisions). The CRM asks it, through the existing secure link
// (design-link → crm-handoff, server to server), for this project's folders
// and files and shows them natively: same folder tree as Design, current
// revision by default, superseded on request, preview without leaving the page.
//
//   design-link { action: 'list' }     → { status:'ok', project, folders[], files[] }
//   design-link { action: 'file_url', file_id } → { url, kind }
//
// Until the Design side answers 'list', this falls back to the existing tab,
// so nothing changes for anyone on the live system.
//
// CRM drawings still waiting to move are matched against what Design already
// holds (drawing number + revision rules shared with DrawingsSurveysTab), so
// only the ones genuinely missing are flagged.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT_KEYS = { drawings: '01. Drawings', reports: '02. Surveys & Reports' }
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })

function FolderTree({ folders, counts, selected, onSelect, open, setOpen }) {
  const byParent = useMemo(() => {
    const m = {}
    folders.forEach(f => { (m[f.parent_id || 'root'] ||= []).push(f) })
    Object.values(m).forEach(list => list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || natural(a.name, b.name)))
    return m
  }, [folders])
  function node(f, depth) {
    const kids = byParent[f.id] || []
    const isOpen = open.has(f.id)
    return (
      <div key={f.id}>
        <div className={`dr-node${selected === f.id ? ' on' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}>
          <button type="button" className="dr-twist" aria-label={isOpen ? 'Collapse' : 'Expand'} disabled={!kids.length}
            onClick={() => setOpen(s => { const n = new Set(s); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n })}>
            {kids.length ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}><polyline points="9 6 15 12 9 18"/></svg> : null}
          </button>
          <button type="button" className="dr-node-label" onClick={() => { onSelect(f.id); if (kids.length) setOpen(s => new Set(s).add(f.id)) }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <span className="dr-node-name">{f.name}</span>
            <span className="dr-node-count">{counts[f.id] || 0}</span>
          </button>
        </div>
        {isOpen && kids.map(k => node(k, depth + 1))}
      </div>
    )
  }
  return (
    <nav className="dr-tree" aria-label="Design folders">
      <div className={`dr-node${selected === 'all' ? ' on' : ''}`} style={{ paddingLeft: 8 }}>
        <span className="dr-twist" />
        <button type="button" className="dr-node-label" onClick={() => onSelect('all')}>
          <span className="dr-node-name"><b>All drawings</b></span>
          <span className="dr-node-count">{counts.all || 0}</span>
        </button>
      </div>
      {(byParent.root || []).map(f => node(f, 0))}
    </nav>
  )
}

export default function DrawingsRegister({ projectId, canManage, onOpenDocuments }) {
  const [state, setState] = useState({ phase: 'loading' })       // loading | ok | fallback
  const [selected, setSelected] = useState('all')
  const [open, setOpen] = useState(() => new Set())
  const [search, setSearch] = useState('')
  const [showSuperseded, setShowSuperseded] = useState(false)
  const [preview, setPreview] = useState(null)                     // { file, url, kind, loading }
  const [crm, setCrm] = useState([])                               // CRM drawings (still in Documents)
  const [showTransfer, setShowTransfer] = useState(false)
  const [workspace, setWorkspace] = useState(null)                  // full-screen Design intake
  const [checkedAt, setCheckedAt] = useState(null)

  useEffect(() => { load(); loadCrm() }, [projectId])

  async function load() {
    setState(s => s.phase === 'ok' ? s : { phase: 'loading' })
    const { data, error } = await supabase.functions.invoke('design-link', { body: { project_id: projectId, action: 'list' } })
    if (error || !data || data.status !== 'ok' || !Array.isArray(data.folders)) { setState({ phase: 'fallback' }); return }
    setState({ phase: 'ok', project: data.project, folders: data.folders, files: data.files || [] })
    setCheckedAt(new Date())
    // Open the first level so the stages are visible straight away.
    setOpen(prev => prev.size ? prev : new Set(data.folders.filter(f => !f.parent_id).map(f => f.id)))
  }

  async function loadCrm() {
    const { data: rows } = await supabase.from('project_doc_folders').select('folder_key, parent_key, label').eq('project_id', projectId)
    const keys = []
    for (const root of Object.keys(ROOT_KEYS)) {
      const stack = [root]
      while (stack.length) { const k = stack.pop(); keys.push(k); (rows || []).filter(r => r.parent_key === k).forEach(r => stack.push(r.folder_key)) }
    }
    const { data: files } = await supabase.from('project_doc_files').select('id, file_name, subfolder_key').eq('project_id', projectId).in('subfolder_key', keys)
    setCrm(files || [])
  }

  async function openPreview(file) {
    setPreview({ file, loading: true })
    const { data } = await supabase.functions.invoke('design-link', { body: { project_id: projectId, action: 'file_url', file_id: file.id } })
    setPreview({ file, url: data?.url || null, kind: data?.kind || (/\.pdf$/i.test(file.file_name || '') ? 'pdf' : /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.file_name || '') ? 'image' : 'other'), loading: false })
  }

  async function openDesign(intake) {
    if (intake) { setWorkspace({ loading: true }) }
    // Open the tab before the await so pop-up blockers allow it (as the old tab did)
    const w = intake ? null : window.open('', '_blank')
    if (w) w.opener = null
    const { data } = await supabase.functions.invoke('design-link', { body: { project_id: projectId, action: 'handoff', embed: !!intake } })
    if (intake) setWorkspace({ url: data?.status === 'ok' ? data.url : null })
    else if (w) w.location.href = data?.status === 'ok' ? data.url : 'https://design.cltd.co.uk'
  }

  if (state.phase === 'fallback') return <DrawingsSurveysTab projectId={projectId} canManage={canManage} onOpenDocuments={onOpenDocuments} />
  if (state.phase === 'loading') return <div className="dr-loading">Loading drawings from the Design portal…</div>

  const { folders, files, project } = state
  // Folder subtree helper
  const childrenOf = {}
  folders.forEach(f => { (childrenOf[f.parent_id || 'root'] ||= []).push(f.id) })
  const subtree = id => { const out = new Set([id]); const st = [id]; while (st.length) { const k = st.pop(); (childrenOf[k] || []).forEach(c => { out.add(c); st.push(c) }) } return out }
  const current = files.filter(f => f.status !== 'superseded')
  const counts = { all: current.length }
  folders.forEach(f => { const sub = subtree(f.id); counts[f.id] = current.filter(x => sub.has(x.folder_id)).length })
  const inScope = selected === 'all' ? null : subtree(selected)
  const q = search.trim().toLowerCase()
  const shown = files
    .filter(f => showSuperseded || f.status !== 'superseded')
    .filter(f => !inScope || inScope.has(f.folder_id))
    .filter(f => !q || [f.number, f.title, f.file_name].some(v => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => natural(a.number || a.file_name, b.number || b.file_name) || (a.status === 'superseded') - (b.status === 'superseded'))
  const supersededCount = files.filter(f => f.status === 'superseded' && (!inScope || inScope.has(f.folder_id))).length
  const folderName = id => folders.find(f => f.id === id)?.name || ''
  const pathOf = id => { const parts = []; let f = folders.find(x => x.id === id); while (f) { parts.unshift(f.name); f = folders.find(x => x.id === f.parent_id) } return parts.join(' › ') }
  const selectedLabel = selected === 'all' ? 'All drawings' : pathOf(selected)

  // What the CRM still holds that Design doesn't (same matching rules as before)
  const inv = buildInventory(files.map(f => f.file_name))
  const crmStatus = crm.map(f => ({ f, st: designStatus(inv, f.file_name)?.status }))
  const crmMissing = crmStatus.filter(x => x.st === 'missing' || x.st === 'newer' || x.st === 'check').length
  const crmAlready = crmStatus.length - crmMissing

  // Folder options for the phone picker
  const flat = []
  ;(function walk(parent, depth) { (childrenOf[parent] || []).map(id => folders.find(f => f.id === id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || natural(a.name, b.name)).forEach(f => { flat.push({ id: f.id, label: ' '.repeat(depth) + f.name }); walk(f.id, depth + 1) }) })('root', 0)

  return (
    <div className="dr">
      <div className="dr-head">
        <div className="dr-source">
          <span className="dr-source-dot" />
          <span>Mirrored from the Design portal{project?.code ? ` · ${project.code}` : ''}</span>
          {checkedAt && <span className="dr-muted">· updated {checkedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>}
          <button type="button" className="dr-link" onClick={load}>Refresh</button>
        </div>
        <div className="dr-head-actions">
          <button className="btn btn-sm" onClick={() => openDesign(false)}>Open in Design ↗</button>
          {canManage && <button className="btn btn-sm btn-primary" onClick={() => openDesign(true)}>+ Add drawings</button>}
        </div>
      </div>

      {crm.length > 0 && (
        <div className={`dr-banner${crmMissing ? '' : ' ok'}`}>
          <div>
            <b>{crmMissing ? `${crmMissing} CRM drawing${crmMissing === 1 ? '' : 's'} not in Design yet` : 'Every CRM drawing is already in Design'}</b>
            <span> · {crmAlready} already there{crmMissing ? ' · nothing is deleted from the CRM' : ''}</span>
          </div>
          {crmMissing > 0 && canManage && <button className="btn btn-sm" onClick={() => setShowTransfer(v => !v)}>{showTransfer ? 'Hide' : 'Review & transfer'}</button>}
        </div>
      )}
      {showTransfer && <div className="dr-transfer"><DrawingsSurveysTab projectId={projectId} canManage={canManage} onOpenDocuments={onOpenDocuments} /></div>}

      <div className="dr-body">
        <aside className="dr-side">
          <FolderTree folders={folders} counts={counts} selected={selected} onSelect={id => { setSelected(id); setPreview(null) }} open={open} setOpen={setOpen} />
        </aside>
        <section className="dr-main">
          <div className="dr-tools">
            <select className="dr-picker" value={selected} onChange={e => setSelected(e.target.value)} aria-label="Folder">
              <option value="all">All drawings ({counts.all})</option>
              {flat.map(o => <option key={o.id} value={o.id}>{o.label} ({counts[o.id] || 0})</option>)}
            </select>
            <div className="dr-crumb">{selectedLabel}</div>
            <div className="dr-search">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.742 10.344a6.5 6.5 0 10-1.397 1.398l3.85 3.85a1 1 0 001.415-1.414l-3.868-3.834zm-5.24 1.4a5 5 0 110-10 5 5 0 010 10z"/></svg>
              <input id="dr-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Number or title" />
            </div>
            <label className="dr-toggle"><input type="checkbox" checked={showSuperseded} onChange={e => setShowSuperseded(e.target.checked)} /> Superseded ({supersededCount})</label>
          </div>

          {shown.length === 0
            ? <div className="dr-empty">{files.length ? 'No drawings in this folder.' : 'The Design portal has no drawings for this project yet.'}</div>
            : (
              <div className="dr-table" role="table">
                <div className="dr-row dr-row-h" role="row"><span>Number</span><span>Title</span><span>Rev</span><span>Folder</span><span>Issued</span><span /></div>
                {shown.map(f => (
                  <button key={f.id} type="button" role="row" className={`dr-row${f.status === 'superseded' ? ' sup' : ''}${preview?.file?.id === f.id ? ' on' : ''}`} onClick={() => openPreview(f)}>
                    <span className="dr-num">{f.number || parseDrawing(f.file_name).key || '—'}</span>
                    <span className="dr-title">{f.title || f.file_name}</span>
                    <span className="dr-rev">{f.rev ? <span className={`dr-rev-chip${f.status === 'superseded' ? ' old' : ''}`}>{f.rev}</span> : '—'}</span>
                    <span className="dr-folder">{folderName(f.folder_id)}</span>
                    <span className="dr-date">{fmtDate(f.issued_at)}</span>
                    <span className="dr-state">{f.status === 'superseded' ? 'Superseded' : ''}</span>
                  </button>
                ))}
              </div>
            )}
        </section>

        {preview && (
          <aside className="dr-preview">
            <div className="dr-preview-head">
              <div>
                <div className="dr-preview-num">{preview.file.number || preview.file.file_name}{preview.file.rev ? ` · Rev ${preview.file.rev}` : ''}</div>
                <div className="dr-preview-title">{preview.file.title}</div>
              </div>
              <button type="button" className="dr-x" aria-label="Close preview" onClick={() => setPreview(null)}>✕</button>
            </div>
            <div className="dr-preview-body">
              {preview.loading ? <div className="dr-muted">Loading…</div>
                : !preview.url ? <div className="dr-muted">Preview not available.</div>
                : preview.kind === 'pdf' ? <iframe title="Drawing preview" src={preview.url + '#toolbar=0&view=FitH'} />
                : preview.kind === 'image' ? <img alt={preview.file.title || ''} src={preview.url} />
                : <div className="dr-muted">No preview for this file type — <a href={preview.url} target="_blank" rel="noreferrer">download it</a> or open it in Design.</div>}
            </div>
            <div className="dr-preview-meta">
              <div><span>Folder</span>{pathOf(preview.file.folder_id)}</div>
              <div><span>Issued</span>{fmtDate(preview.file.issued_at)}</div>
              {preview.url && <div><span>File</span><a href={preview.url} target="_blank" rel="noreferrer">Open / download ↗</a></div>}
              {(() => {
                const key = preview.file.number
                const hist = files.filter(x => x.number && x.number === key).sort((a, b) => natural(b.rev || '', a.rev || ''))
                return hist.length > 1 ? <div><span>Revisions</span>{hist.map(h => h.rev).join(' · ')}</div> : null
              })()}
            </div>
            <div className="dr-preview-actions">
              {preview.url && <a className="btn btn-sm" href={preview.url} target="_blank" rel="noopener noreferrer">Open full size</a>}
            </div>
          </aside>
        )}
      </div>

      {workspace && (
        <div className="dr-workspace" role="dialog" aria-label="Design portal">
          <div className="dr-workspace-bar">
            <button className="btn btn-sm" onClick={() => { setWorkspace(null); load() }}>← Back to project</button>
            <span>Design portal · add and sort drawings</span>
          </div>
          {workspace.loading ? <div className="dr-workspace-msg">Opening the Design portal…</div>
            : workspace.url ? <iframe title="Design portal" src={workspace.url} />
            : <div className="dr-workspace-msg">The Design portal's upload and auto-sort opens here, full screen. It isn't available in this preview.</div>}
        </div>
      )}
    </div>
  )
}
