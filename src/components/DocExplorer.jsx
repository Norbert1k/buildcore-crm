import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ─────────────────────────────────────────────────────────────────────────────
// DocExplorer — two-panel "Windows-style" file explorer for project documents.
//
// SHELL STAGE: navigation + view + download + bulk-select only. It reads the
// SAME data as the classic browser (project_doc_files + project_doc_folders,
// project-docs bucket) and never writes — so it cannot disrupt any files.
// Write actions (upload/rename/delete/move/zip/publish) are ported in a later
// stage. Shown behind a toggle next to the classic browser.
//
// Mirrors the classic browser's structure constants so the tree is identical.
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATE_FOLDERS = [
  {
    key: '00-project-information', label: '00. Project Information', color: '#448a40',
    subfolders: [
      { key: 'drawings', label: '01. Drawings' },
      { key: 'reports', label: '02. Surveys & Reports' },
      { key: 'csa', label: '03. CSA' },
      { key: 'cff', label: '04. CFF - Cashflow Forecast' },
      { key: 'f10', label: '05. F10' },
      { key: 'hs', label: '06. Health & Safety' },
      { key: 'pci', label: '07. PCI — Pre-Construction Information' },
      { key: 'cpp', label: '08. CPP — Construction Phase Plan' },
      { key: 'planning', label: '09. Planning' },
      { key: 'utilities', label: '10. Utilities' },
      { key: 'meetings', label: '11. Meetings' },
      { key: 'photos', label: '12. Project Photos' },
    ],
  },
  { key: '01-project-order', label: '01. Project Order', color: '#378ADD', subfolders: [] },
  { key: '02-payment-application', label: '02. Payment Application', color: '#BA7517', subfolders: [] },
  { key: '03-payment-notice', label: '03. Payment Notice (Client)', color: '#BA7517', subfolders: [] },
  { key: '04-variations', label: '04. Variations', color: '#993C1D', subfolders: [] },
  { key: '05-progress-report', label: '05. Project Progress Report', color: '#3B6D11', subfolders: [] },
  { key: '06-project-programme', label: '06. Project Programme', color: '#534AB7', subfolders: [] },
]

const EXT_META = {
  pdf: { c: '#E24B4A', t: 'PDF', prev: true },
  xlsx: { c: '#1D9E75', t: 'XLS', prev: false }, xls: { c: '#1D9E75', t: 'XLS', prev: false },
  docx: { c: '#378ADD', t: 'DOC', prev: false }, doc: { c: '#378ADD', t: 'DOC', prev: false },
  dwg: { c: '#BA7517', t: 'DWG', prev: false },
  png: { c: '#534AB7', t: 'IMG', prev: true }, jpg: { c: '#534AB7', t: 'IMG', prev: true }, jpeg: { c: '#534AB7', t: 'IMG', prev: true },
}
function extMeta(name) {
  const m = (name || '').split('.').pop().toLowerCase()
  return EXT_META[m] || { c: '#888780', t: (m || 'FILE').slice(0, 4).toUpperCase(), prev: false }
}
function fmtSize(b) {
  if (!b) return ''
  if (b < 1024) return b + 'B'
  if (b < 1048576) return (b / 1024).toFixed(0) + 'KB'
  return (b / 1048576).toFixed(1) + 'MB'
}
function fmtDate(d) {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return '' }
}
const byLabel = (a, b) => (a.label || '').localeCompare(b.label || '', undefined, { numeric: true, sensitivity: 'base' })
const byName = (a, b) => (a.file_name || '').localeCompare(b.file_name || '', undefined, { numeric: true, sensitivity: 'base' })

async function triggerDownload(signedUrl, fileName) {
  try {
    const res = await fetch(signedUrl)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = fileName || 'file'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  } catch (e) { console.warn('download failed', e) }
}

// ── PDF.js loader (CDN, once) — used to render real first-page thumbnails ─────
let _pdfjsPromise = null
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib)
  if (_pdfjsPromise) return _pdfjsPromise
  _pdfjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
    s.onload = () => {
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
        resolve(window.pdfjsLib)
      } catch (e) { reject(e) }
    }
    s.onerror = reject
    document.head.appendChild(s)
  })
  return _pdfjsPromise
}

// Renders the first page of a PDF (or shows an image) as a thumbnail, lazily —
// only starts work once the card scrolls into view. Falls back to a type icon
// for non-previewable files or on error.
function FilePreview({ file, signedUrlFor, height = 130 }) {
  const e = extMeta(file.file_name)
  const ref = useRef(null)
  const [img, setImg] = useState(null)
  const [state, setState] = useState('idle') // idle | loading | done | fail

  useEffect(() => {
    if (!e.prev) return
    const el = ref.current
    if (!el) return
    let cancelled = false
    const io = new IntersectionObserver(async (entries) => {
      if (!entries[0].isIntersecting || state !== 'idle') return
      io.disconnect()
      setState('loading')
      try {
        const signedUrl = await signedUrlFor(file)
        if (!signedUrl) throw new Error('no url')
        if (e.t === 'IMG') { if (!cancelled) { setImg(signedUrl); setState('done') } return }
        const pdfjs = await loadPdfJs()
        const doc = await pdfjs.getDocument(signedUrl).promise
        const page = await doc.getPage(1)
        const vp0 = page.getViewport({ scale: 1 })
        const scale = (height * 2) / vp0.height   // 2x for crispness
        const vp = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = vp.width; canvas.height = vp.height
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
        if (!cancelled) { setImg(canvas.toDataURL('image/png')); setState('done') }
      } catch (err) { if (!cancelled) setState('fail') }
    }, { rootMargin: '120px' })
    io.observe(el)
    return () => { cancelled = true; io.disconnect() }
  }, [file.id])

  const iconFallback = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 34, color: e.c }}>▤</span>
      <span style={{ fontSize: 10, fontWeight: 600, color: e.c }}>{e.t}</span>
    </div>
  )

  return (
    <div ref={ref} style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '0.5px solid var(--border)', background: img ? '#f3f3f1' : e.c + '14', overflow: 'hidden' }}>
      {img
        ? <img src={img} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        : state === 'loading'
          ? <span style={{ fontSize: 11, color: 'var(--text3)' }}>…</span>
          : iconFallback}
    </div>
  )
}

export default function DocExplorer({ projectId, projectName }) {
  const { role } = useAuth()
  const [files, setFiles] = useState([])           // all project_doc_files rows
  const [customFolders, setCustomFolders] = useState([]) // all project_doc_folders rows
  const [loading, setLoading] = useState(true)
  const [selectedKey, setSelectedKey] = useState(null)    // tree node id (folder_key or subfolder key)
  const [expanded, setExpanded] = useState(() => new Set(['00-project-information']))
  const [viewMode, setViewMode] = useState('list')
  const [picked, setPicked] = useState(() => new Set())
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => { loadAll() }, [projectId])

  async function loadAll() {
    setLoading(true)
    const [{ data: f }, { data: cf }] = await Promise.all([
      supabase.from('project_doc_files').select('*').eq('project_id', projectId),
      supabase.from('project_doc_folders').select('*').eq('project_id', projectId),
    ])
    setFiles(f || [])
    setCustomFolders(cf || [])
    setLoading(false)
  }

  // Build the navigable tree. Each node: { id, label, color, kind:'folder',
  // parentId, children:[], fileKey:{folder_key, subfolder_key} }
  // Files attach to a node by matching folder_key + subfolder_key.
  const tree = useMemo(() => {
    const customTop = customFolders.filter(c => c.parent_key == null)
    const topFolders = [
      ...TEMPLATE_FOLDERS,
      ...customTop.map(c => ({ key: c.folder_key, label: c.label, color: '#888780', subfolders: [], custom: true })),
    ]

    // Index custom folders by parent_key for recursion
    const childrenByParent = {}
    for (const c of customFolders) {
      (childrenByParent[c.parent_key] = childrenByParent[c.parent_key] || []).push(c)
    }

    function buildCustomChildren(parentKey, topKey) {
      const kids = (childrenByParent[parentKey] || []).slice().sort(byLabel)
      return kids.map(k => ({
        id: k.folder_key,
        label: k.label,
        kind: 'folder',
        color: null,
        fileKey: { folder_key: topKey, subfolder_key: k.folder_key },
        children: buildCustomChildren(k.folder_key, topKey),
      }))
    }

    return topFolders.map(tf => {
      // template subfolders (fixed) + custom subfolders whose parent is one of them or the top folder
      const templateSubs = (tf.subfolders || []).map(sf => ({
        id: sf.key,
        label: sf.label,
        kind: 'folder',
        color: tf.color,
        special: sf.key === 'photos' ? 'photos' : null,
        fileKey: { folder_key: tf.key, subfolder_key: sf.key },
        children: buildCustomChildren(sf.key, tf.key),
      }))
      // custom subfolders created directly under the top folder (parent_key === tf.key)
      const directCustom = buildCustomChildren(tf.key, tf.key)
      return {
        id: tf.key,
        label: tf.label,
        kind: 'folder',
        color: tf.color,
        top: true,
        fileKey: { folder_key: tf.key, subfolder_key: null },
        children: [...templateSubs, ...directCustom],
      }
    })
  }, [customFolders])

  // Count files under a node (including descendants).
  const filesByNode = useMemo(() => {
    // map "folder_key|subfolder_key" -> files[]
    const m = {}
    for (const f of files) {
      const k = f.folder_key + '|' + (f.subfolder_key || '')
      ;(m[k] = m[k] || []).push(f)
    }
    return m
  }, [files])

  function nodeFiles(node) {
    if (!node) return []
    const k = node.fileKey.folder_key + '|' + (node.fileKey.subfolder_key || '')
    return (filesByNode[k] || []).slice().sort(byName)
  }
  function countFiles(node) {
    let n = nodeFiles(node).length
    for (const c of (node.children || [])) n += countFiles(c)
    return n
  }
  function findNode(id, nodes) {
    for (const n of nodes) {
      if (n.id === id) return n
      const r = n.children && findNode(id, n.children)
      if (r) return r
    }
    return null
  }
  function pathTo(id, nodes, trail = []) {
    for (const n of nodes) {
      const t = [...trail, n]
      if (n.id === id) return t
      const r = n.children && pathTo(id, n.children, t)
      if (r) return r
    }
    return null
  }

  const selectedNode = selectedKey ? findNode(selectedKey, tree) : null

  function toggleExpand(id) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function selectNode(id) {
    // Pure selection — does NOT change expansion. The tree row's own click
    // handles expand/collapse; mixing the two here caused a same-tick race
    // that immediately re-closed a folder you just opened.
    setSelectedKey(id); setPicked(new Set()); setSearch('')
  }
  // Used by the breadcrumb: jump to a node AND make sure it (and its ancestors,
  // already open by definition of being in the trail) are expanded.
  function selectAndExpand(id) {
    setSelectedKey(id); setPicked(new Set()); setSearch('')
    setExpanded(prev => { const n = new Set(prev); n.add(id); return n })
  }
  function togglePick(id) {
    setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function openFile(file) {
    const { data } = await supabase.storage.from('project-docs').createSignedUrl(file.storage_path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  async function signedUrlFor(file) {
    const { data } = await supabase.storage.from('project-docs').createSignedUrl(file.storage_path, 3600)
    return data?.signedUrl || null
  }
  async function downloadFile(file) {
    const url = await signedUrlFor(file)
    if (url) await triggerDownload(url, file.file_name)
  }

  // ── Rename (write) — same call Classic uses: update file_name on the row ────
  async function renameFile(file, newName) {
    const name = (newName || '').trim()
    if (!name || name === file.file_name) return
    const { error } = await supabase.from('project_doc_files').update({ file_name: name }).eq('id', file.id)
    if (error) { alert('Rename failed: ' + error.message); return }
    setFiles(prev => prev.map(f => f.id === file.id ? { ...f, file_name: name } : f))
  }

  // ── Drag-drop upload (write) — mirrors Classic's path + insert exactly ──────
  // Confirms before saving. Uploads into the currently-selected folder node.
  async function uploadToSelected(fileList) {
    if (!selectedNode) { alert('Pick a folder on the left first.'); return }
    if (selectedNode.special === 'photos') { alert('Project Photos are managed in the Classic view.'); return }
    const arr = Array.from(fileList).filter(Boolean)
    if (!arr.length) return
    const { folder_key, subfolder_key } = selectedNode.fileKey
    const names = arr.map(f => f.name).join(', ')
    if (!window.confirm(`Upload ${arr.length} file${arr.length === 1 ? '' : 's'} to "${selectedNode.label}"?\n\n${names}`)) return

    setBusy(true)
    const added = []
    for (const file of arr) {
      const ts = Date.now()
      const path = subfolder_key
        ? `projects/${projectId}/${folder_key}/${subfolder_key}/${ts}-${file.name}`
        : `projects/${projectId}/${folder_key}/${ts}-${file.name}`
      const { error } = await supabase.storage.from('project-docs').upload(path, file)
      if (error) { console.error('upload failed', error.message); continue }
      const row = { project_id: projectId, folder_key, subfolder_key: subfolder_key || null, file_name: file.name, file_size: file.size, storage_path: path }
      const { data: ins, error: dbErr } = await supabase.from('project_doc_files').insert(row).select().single()
      if (dbErr) { console.error('db insert failed', dbErr.message); continue }
      if (ins) added.push(ins)
    }
    setBusy(false)
    if (added.length) setFiles(prev => [...prev, ...added])
  }
  async function downloadPicked() {
    if (!selectedNode) return
    setBusy(true)
    const list = nodeFiles(selectedNode).filter(f => picked.has(f.id))
    for (const f of list) await downloadFile(f)
    setBusy(false)
  }

  // Global search across all files in the project
  const searchResults = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return null
    // build a label-path for each file
    const labelOf = (folderKey, subKey) => {
      const top = tree.find(t => t.id === folderKey)
      if (!top) return ''
      if (!subKey) return top.label
      const sub = findNode(subKey, [top])
      const trail = sub ? pathTo(subKey, [top]) : null
      return trail ? trail.map(n => n.label).join(' / ') : top.label
    }
    return files
      .filter(f => (f.file_name || '').toLowerCase().includes(q))
      .map(f => ({ ...f, _path: labelOf(f.folder_key, f.subfolder_key) }))
      .sort(byName)
  }, [search, files, tree])

  if (loading) return <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13 }}>Loading documents…</div>

  const shownFiles = searchResults || (selectedNode ? nodeFiles(selectedNode) : [])
  const isSearch = !!searchResults
  const trail = selectedNode ? pathTo(selectedKey, tree) : null

  return (
    <div>
      {/* Header row: title + search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 140 }}>Project documents</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, border: '0.5px solid var(--border)', borderRadius: 6, padding: '5px 9px', background: 'var(--surface)', minWidth: 180 }}>
          <span style={{ color: 'var(--text3)', fontSize: 13 }}>⌕</span>
          <input value={search} onChange={e => { setSearch(e.target.value); setPicked(new Set()) }}
            placeholder="Search this project"
            style={{ border: 'none', background: 'transparent', flex: 1, fontSize: 12.5, outline: 'none', padding: 0, width: 'auto' }} />
        </div>
      </div>

      {/* Breadcrumb */}
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span>Project documents</span>
        {trail && trail.map(n => (
          <span key={n.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color: 'var(--text3)' }}>/</span>
            <span onClick={() => selectAndExpand(n.id)} style={{ cursor: 'pointer', color: n.id === selectedKey ? 'var(--text)' : 'var(--text3)', fontWeight: n.id === selectedKey ? 600 : 400 }}>{n.label}</span>
          </span>
        ))}
      </div>

      {/* Two-panel body */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,0.8fr) minmax(0,1.55fr)', border: '0.5px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface)', minHeight: 640 }}>
        {/* Tree pane */}
        <div style={{ borderRight: '0.5px solid var(--border)', padding: '6px 0', overflow: 'auto', maxHeight: '78vh' }}>
          {tree.map(node => (
            <TreeNode key={node.id} node={node} depth={0} expanded={expanded} selectedKey={selectedKey}
              onToggle={toggleExpand} onSelect={selectNode} countFiles={countFiles} />
          ))}
        </div>

        {/* File pane */}
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}
          onDragOver={e => { if (selectedNode && selectedNode.special !== 'photos' && !isSearch) { e.preventDefault(); setDragOver(true) } }}
          onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false) }}
          onDrop={e => {
            e.preventDefault(); setDragOver(false)
            if (e.dataTransfer?.files?.length) uploadToSelected(e.dataTransfer.files)
          }}>
          {/* Toolbar */}
          {picked.size > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '0.5px solid var(--border)', background: 'var(--surface2)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--blue, #185FA5)', flex: 1 }}>{picked.size} selected</span>
              <button onClick={downloadPicked} disabled={busy} style={tbtn}>{busy ? 'Downloading…' : '↓ Download'}</button>
              <button onClick={() => setPicked(new Set())} style={tbtn}>Clear</button>
              <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>(move &amp; delete coming next)</span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '8px 10px', borderBottom: '0.5px solid var(--border)', flexWrap: 'wrap' }}>
              {!isSearch && selectedNode && selectedNode.special !== 'photos' && (
                <>
                  <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
                    onChange={e => { if (e.target.files?.length) uploadToSelected(e.target.files); e.target.value = '' }} />
                  <button onClick={() => fileInputRef.current?.click()} disabled={busy} style={{ ...tbtn, borderColor: '#448a40', color: '#448a40' }}>
                    {busy ? 'Uploading…' : '↑ Upload'}
                  </button>
                  <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px' }} />
                </>
              )}
              {!isSearch && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => setViewMode('list')} style={vmb(viewMode === 'list')} aria-label="List view">≣</button>
                  <button onClick={() => setViewMode('grid')} style={vmb(viewMode === 'grid')} aria-label="Grid view">▦</button>
                </div>
              )}
            </div>
          )}

          {/* Files */}
          {viewMode === 'grid' && !isSearch ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10, padding: 12 }}>
              {shownFiles.map(f => (
                <GridCard key={f.id} file={f} picked={picked.has(f.id)} onPick={() => togglePick(f.id)} onOpen={() => openFile(f)} onDownload={() => downloadFile(f)} onRename={renameFile} signedUrlFor={signedUrlFor} />
              ))}
              {shownFiles.length === 0 && <Empty isSearch={isSearch} node={selectedNode} />}
            </div>
          ) : (
            <div>
              {shownFiles.map(f => (
                <ListRow key={f.id} file={f} picked={picked.has(f.id)} onPick={() => togglePick(f.id)} onOpen={() => openFile(f)} onDownload={() => downloadFile(f)} onRename={renameFile} showPath={isSearch} />
              ))}
              {shownFiles.length === 0 && <Empty isSearch={isSearch} node={selectedNode} />}
            </div>
          )}

          <div style={{ marginTop: 'auto', padding: '7px 12px', borderTop: '0.5px solid var(--border)', fontSize: 11, color: 'var(--text3)' }}>
            {isSearch ? `${shownFiles.length} result${shownFiles.length === 1 ? '' : 's'}`
              : selectedNode ? `${shownFiles.length} file${shownFiles.length === 1 ? '' : 's'}`
              : 'Select a folder on the left'}
            {selectedNode && selectedNode.special !== 'photos' && !isSearch && <span> · drag files here to upload</span>}
            {selectedNode?.special === 'photos' && <span> · Project Photos open in the classic view</span>}
          </div>

          {/* Drop overlay */}
          {dragOver && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(68,138,64,0.12)', border: '2px dashed #448a40', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5, pointerEvents: 'none' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#448a40' }}>Drop to upload to "{selectedNode?.label}"</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TreeNode({ node, depth, expanded, selectedKey, onToggle, onSelect, countFiles }) {
  const isOpen = expanded.has(node.id)
  const hasChildren = node.children && node.children.length > 0
  const sel = selectedKey === node.id
  return (
    <>
      <div onClick={() => { onSelect(node.id); if (hasChildren) onToggle(node.id) }}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', paddingLeft: 6 + depth * 14, cursor: 'pointer', fontSize: 12.5, color: sel ? 'var(--blue, #185FA5)' : 'var(--text2)', background: sel ? 'var(--surface2)' : 'transparent', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', userSelect: 'none' }}>
        <span style={{ width: 12, flexShrink: 0, color: 'var(--text3)', fontSize: 11 }}>{hasChildren ? (isOpen ? '▾' : '▸') : ''}</span>
        <span style={{ width: 3, height: 14, borderRadius: 2, flexShrink: 0, background: node.color || '#888780' }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: node.top ? 600 : 400, color: node.top ? 'var(--text)' : undefined }}>{node.label}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>{countFiles(node)}</span>
      </div>
      {hasChildren && isOpen && node.children.map(c => (
        <TreeNode key={c.id} node={c} depth={depth + 1} expanded={expanded} selectedKey={selectedKey} onToggle={onToggle} onSelect={onSelect} countFiles={countFiles} />
      ))}
    </>
  )
}

function ListRow({ file, picked, onPick, onOpen, onDownload, onRename, showPath }) {
  const e = extMeta(file.file_name)
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(file.file_name)
  function commit() { setEditing(false); if (val.trim() && val !== file.file_name) onRename(file, val) }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 12px', borderTop: '0.5px solid var(--border)', fontSize: 12.5, background: picked ? 'var(--surface2)' : 'transparent' }}>
      <input type="checkbox" checked={picked} onChange={onPick} style={{ width: 14, height: 14, flexShrink: 0, appearance: 'auto' }} />
      <span style={{ width: 26, height: 26, borderRadius: 4, background: e.c, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 7, fontWeight: 700 }}>{e.t}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input autoFocus value={val} onChange={ev => setVal(ev.target.value)} onBlur={commit}
            onKeyDown={ev => { if (ev.key === 'Enter') commit(); if (ev.key === 'Escape') { setVal(file.file_name); setEditing(false) } }}
            style={{ width: '100%', fontSize: 12.5, padding: '1px 5px', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text)' }} />
        ) : (
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.file_name}</div>
        )}
        {showPath && file._path && <div style={{ fontSize: 10, color: 'var(--text3)' }}>{file._path}</div>}
      </div>
      <span style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>{fmtSize(file.file_size)}{file.created_at ? ' · ' + fmtDate(file.created_at) : ''}</span>
      <div className="facts" style={{ display: 'flex', gap: 3, opacity: 1, flexShrink: 0 }}>
        <button onClick={onOpen} style={fabtn}>View</button>
        <button onClick={onDownload} style={fabtn} title="Download">↓</button>
        {onRename && <button onClick={() => { setVal(file.file_name); setEditing(true) }} style={fabtn} title="Rename">✎</button>}
      </div>
    </div>
  )
}

function GridCard({ file, picked, onPick, onOpen, onDownload, onRename, signedUrlFor }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(file.file_name)
  function commit() { setEditing(false); if (val.trim() && val !== file.file_name) onRename(file, val) }
  return (
    <div style={{ position: 'relative', border: '0.5px solid ' + (picked ? 'var(--blue, #185FA5)' : 'var(--border)'), borderRadius: 10, overflow: 'hidden', background: 'var(--surface)', cursor: 'pointer' }}>
      <div onClick={onOpen}>
        <FilePreview file={file} signedUrlFor={signedUrlFor} height={130} />
      </div>
      <input type="checkbox" checked={picked} onChange={onPick} style={{ position: 'absolute', top: 7, left: 7, width: 16, height: 16, zIndex: 2, appearance: 'auto' }} />
      <div className="gacts" style={{ position: 'absolute', top: 7, right: 7, display: 'flex', gap: 3, opacity: 1, zIndex: 2 }}>
        <button onClick={onDownload} style={{ ...fabtn, background: 'var(--surface)' }} title="Download">↓</button>
        {onRename && <button onClick={() => { setVal(file.file_name); setEditing(true) }} style={{ ...fabtn, background: 'var(--surface)' }} title="Rename">✎</button>}
      </div>
      <div style={{ padding: '7px 9px' }}>
        {editing ? (
          <input autoFocus value={val} onChange={ev => setVal(ev.target.value)} onBlur={commit}
            onKeyDown={ev => { if (ev.key === 'Enter') commit(); if (ev.key === 'Escape') { setVal(file.file_name); setEditing(false) } }}
            style={{ width: '100%', fontSize: 11.5, padding: '1px 5px', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text)' }} />
        ) : (
          <div style={{ fontSize: 11.5, lineHeight: 1.3, wordBreak: 'break-word' }}>{file.file_name}</div>
        )}
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{fmtSize(file.file_size)}{file.created_at ? ' · ' + fmtDate(file.created_at) : ''}</div>
      </div>
    </div>
  )
}

function Empty({ isSearch, node }) {
  let msg = 'Select a folder on the left.'
  if (node) {
    if (node.special === 'photos') msg = 'Project Photos live in the classic view (Telegram-fed albums).'
    else if (node.children && node.children.length) msg = 'Pick a sub-folder on the left to see its files.'
    else msg = 'No files in this folder yet.'
  }
  if (isSearch) msg = 'No files match your search.'
  return <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>{msg}</div>
}

const tbtn = { fontSize: 11.5, padding: '4px 9px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }
const fabtn = { fontSize: 10, lineHeight: '20px', padding: '0 7px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }
function vmb(on) {
  return { width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '0.5px solid ' + (on ? 'var(--accent)' : 'var(--border)'), background: on ? 'var(--accent)' : 'transparent', cursor: 'pointer', color: on ? '#fff' : 'var(--text3)', borderRadius: 6, padding: 0 }
}
