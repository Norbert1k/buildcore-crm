import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { formatDate } from '../lib/utils'
import { Spinner } from '../components/ui'

const CATEGORIES = [
  { key: 'logo',           icon: '🏢', label: 'Logo & Branding',   color: '#448a40', bg: '#e8f5e7' },
  { key: 'policies',       icon: '📋', label: 'Policies',           color: '#378ADD', bg: '#E6F1FB' },
  { key: 'insurance',      icon: '🛡️', label: 'Insurance',    color: '#BA7517', bg: '#FAEEDA' },
  { key: 'vat',            icon: '💰', label: 'VAT & Tax',          color: '#888780', bg: '#F1EFE8' },
  { key: 'bank',           icon: '🏦', label: 'Bank Details',       color: '#448a40', bg: '#e8f5e7' },
  { key: 'certifications', icon: '📜', label: 'Certifications',     color: '#534AB7', bg: '#EEEDFE' },
  { key: 'fleet',          icon: '🚗', label: 'Car Fleet',          color: '#993C1D', bg: '#FAECE7' },
  { key: 'templates',      icon: '📝', label: 'Templates',          color: '#0F6E56', bg: '#E1F5EE' },
  { key: 'site_folder',    icon: '📁', label: 'Site Folder',        color: '#888780', bg: '#F1EFE8' },
]

function fmtSize(b) {
  if (!b) return ''
  if (b < 1024) return b + 'B'
  if (b < 1048576) return (b / 1024).toFixed(0) + 'KB'
  return (b / 1048576).toFixed(1) + 'MB'
}

function fileExt(name) { return name?.split('.').pop()?.toUpperCase().slice(0, 4) || 'FILE' }

// ── Confirm Dialog ───────────────────────────────────────────────────────────
function Confirm({ message, onOk, onCancel }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onCancel}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 360, width: '90%' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 14, marginBottom: 20, color: 'var(--text)' }}>{message}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '8px 16px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'var(--text)' }}>Cancel</button>
          <button onClick={onOk} style={{ padding: '8px 16px', borderRadius: 6, background: 'var(--red)', border: 'none', cursor: 'pointer', fontSize: 13, color: '#fff', fontWeight: 600 }}>Delete</button>
        </div>
      </div>
    </div>
  )
}

// ── Download helper ──────────────────────────────────────────────────────────
async function triggerDownload(signedUrl, fileName) {
  try {
    const res = await fetch(signedUrl)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  } catch {
    const a = document.createElement('a')
    a.href = signedUrl
    a.download = fileName
    a.click()
  }
}

// ── File Card ────────────────────────────────────────────────────────────────
function FileCard({ doc, onPreview, onDelete, canDelete, selected, onSelect, selectionMode }) {
  const [url, setUrl] = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const isImage = doc.file_type?.includes('image')
  const isPdf = doc.file_type?.includes('pdf')

  useEffect(() => {
    supabase.storage.from('company-docs').createSignedUrl(doc.storage_path, 3600)
      .then(({ data }) => { if (data?.signedUrl) setUrl(data.signedUrl) })
  }, [doc.storage_path])

  function handleDragStart(e) {
    if (selectionMode) { e.preventDefault(); return }
    e.dataTransfer.setData('text/plain', doc.id)
    e.dataTransfer.effectAllowed = 'move'
    const ghost = document.createElement('div')
    ghost.style.cssText = 'position:fixed;top:-999px;left:-999px;background:#1a1d27;border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:8px 12px;display:flex;align-items:center;gap:8px;font-size:12px;color:#e8e9f0;white-space:nowrap;'
    ghost.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9a9db0" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span>' + doc.file_name.slice(0,35) + '</span>'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 16, 20)
    setTimeout(() => document.body.removeChild(ghost), 0)
  }

  return (
    <>
      <div
        draggable={!selected}
        onDragStart={handleDragStart}
        onClick={() => onPreview(doc)}
        style={{ border: selected ? '2px solid var(--accent)' : '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: selected ? 'var(--accent-light)' : 'var(--surface)', cursor: 'grab', position: 'relative' }}
      >
        <div onClick={e => { e.stopPropagation(); onSelect(doc.id) }}
          style={{ position: 'absolute', top: 6, left: 6, zIndex: 1, width: 18, height: 18, borderRadius: 4, border: '2px solid ' + (selected ? 'var(--accent)' : 'rgba(255,255,255,0.5)'), background: selected ? 'var(--accent)' : 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          {selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
        </div>
        <div style={{ height: 130, background: 'var(--surface2)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {isImage && url
            ? <img src={url} alt={doc.file_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : isPdf && url
            ? <iframe src={url + '#page=1&toolbar=0&navpanes=0&scrollbar=0'} style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }} title={doc.file_name} />
            : <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          }
          <div style={{ position: 'absolute', top: 5, right: 5, background: 'rgba(0,0,0,0.55)', color: 'white', fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3 }}>
            {fileExt(doc.file_name)}
          </div>
        </div>
        <div style={{ padding: '7px 9px' }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }} title={doc.file_name}>
            {doc.file_name}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 6 }}>
            {fmtSize(doc.file_size)}{doc.file_size ? ' · ' : ''}{formatDate(doc.created_at)}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
              {url && <button onClick={e => { e.stopPropagation(); onPreview(doc) }} style={{ flex: 1, fontSize: 10, padding: '3px 0', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>View</button>}
              {url && <button onClick={e => { e.stopPropagation(); triggerDownload(url, doc.file_name) }} style={{ flex: 1, fontSize: 10, padding: '3px 0', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>↓</button>}
              {canDelete && <button onClick={e => { e.stopPropagation(); setConfirmDel(true) }} style={{ fontSize: 10, padding: '3px 6px', border: '0.5px solid var(--red-border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--red)' }}>✕</button>}
          </div>
        </div>
      </div>
      {confirmDel && <Confirm message={'Delete "' + doc.file_name + '"?'} onOk={() => { setConfirmDel(false); onDelete(doc) }} onCancel={() => setConfirmDel(false)} />}
    </>
  )
}

// ── Bulk Action Bar ───────────────────────────────────────────────────────────
function BulkBar({ selected, files, subfolders, onZip, onMove, onClear }) {
  const [showMove, setShowMove] = useState(false)
  if (!selected.size) return null
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 100, background: 'var(--accent)', color: '#fff', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.size} selected</span>
      <button onClick={onZip} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.4)', background: 'transparent', color: '#fff', cursor: 'pointer' }}>
        ↓ Download ZIP
      </button>
      {subfolders.length > 0 && (
        <div style={{ position: 'relative' }}>
          <button onClick={() => setShowMove(v => !v)} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.4)', background: 'transparent', color: '#fff', cursor: 'pointer' }}>
            Move to ▾
          </button>
          {showMove && (
            <div style={{ position: 'absolute', top: '110%', left: 0, background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, minWidth: 180, boxShadow: '0 4px 20px rgba(0,0,0,0.2)', zIndex: 200 }}>
              <div onClick={() => { onMove(null); setShowMove(false) }} style={{ padding: '9px 14px', fontSize: 13, cursor: 'pointer', color: 'var(--text)', borderBottom: '0.5px solid var(--border)' }}>
                General files (no subfolder)
              </div>
              {subfolders.map(sf => (
                <div key={sf.folder_key} onClick={() => { onMove(sf.folder_key); setShowMove(false) }} style={{ padding: '9px 14px', fontSize: 13, cursor: 'pointer', color: 'var(--text)' }}>
                  📁 {sf.label}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <button onClick={onClear} style={{ marginLeft: 'auto', fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.4)', background: 'transparent', color: '#fff', cursor: 'pointer' }}>
        ✕ Clear
      </button>
    </div>
  )
}

// ── Sub-folder section ────────────────────────────────────────────────────────
function SubfolderSection({ subfolder, categoryKey, color, canManage, onPreview, onReload }) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [selectionMode, setSelectionMode] = useState(false)

  useEffect(() => { if (open) loadFiles() }, [open])

  async function loadFiles() {
    const { data } = await supabase.from('company_documents')
      .select('*, profiles(full_name)').eq('category', categoryKey).eq('subfolder_key', subfolder.key)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: false })
    setFiles(data || [])
  }

  async function moveFile(docId) {
    await supabase.from('company_documents').update({ subfolder_key: subfolder.key }).eq('id', docId)
    loadFiles()
    if (onReload) onReload(docId)
  }

  async function upload(fileList) {
    if (!fileList.length) return
    setUploading(true)
    for (const file of fileList) {
      const path = 'company/' + categoryKey + '/' + subfolder.key + '/' + Date.now() + '-' + file.name
      const { error } = await supabase.storage.from('company-docs').upload(path, file)
      if (!error) await supabase.from('company_documents').insert({ category: categoryKey, subfolder_key: subfolder.key, file_name: file.name, file_type: file.type, file_size: file.size, storage_path: path })
    }
    setUploading(false)
    loadFiles()
  }

  async function deleteDoc(doc) {
    await supabase.storage.from('company-docs').remove([doc.storage_path])
    await supabase.from('company_documents').delete().eq('id', doc.id)
    setFiles(prev => prev.filter(f => f.id !== doc.id))
  }

  async function bulkZip() {
    const chosen = files.filter(f => selected.has(f.id))
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    s.onload = async () => {
      const zip = new window.JSZip()
      for (const f of chosen) {
        const { data } = await supabase.storage.from('company-docs').createSignedUrl(f.storage_path, 120)
        if (data?.signedUrl) { const res = await fetch(data.signedUrl); zip.file(f.file_name, await res.blob()) }
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = subfolder.label + '.zip'; a.click()
    }
    document.head.appendChild(s)
  }

  async function bulkMove(targetSubfolder) {
    for (const id of selected) {
      await supabase.from('company_documents').update({ subfolder_key: targetSubfolder }).eq('id', id)
    }
    setSelected(new Set()); setSelectionMode(false); loadFiles()
    if (onReload) selected.forEach(id => onReload(id))
  }

  function onDrop(e) {
    e.preventDefault(); e.stopPropagation()
    const id = e.dataTransfer.getData('text/plain')
    if (id) { moveFile(id); return }
    const f = Array.from(e.dataTransfer.files); if (f.length) upload(f)
  }

  return (
    <div style={{ marginBottom: 3 }}>
      <div
        onClick={() => setOpen(o => !o)}
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 6, cursor: 'pointer', background: open ? 'var(--surface2)' : 'transparent', transition: 'background .1s' }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--surface2)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent' }}
      >
        <div style={{ width: 28, height: 28, borderRadius: 6, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 14 }}>📁</div>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{subfolder.label}</span>
        <span style={{ fontSize: 10, color: 'var(--text3)', marginRight: 4 }}>{files.length > 0 && open ? files.length + ' files' : ''}</span>

        {canManage && (
          <label onClick={e => e.stopPropagation()} style={{ fontSize: 10, padding: '2px 8px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text3)', flexShrink: 0 }}>
            {uploading ? '...' : '+ Upload'}
            <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} />
          </label>
        )}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      {open && (
        <div onDragOver={e => e.preventDefault()} onDrop={onDrop}
          style={{ marginLeft: 14, paddingLeft: 12, borderLeft: '1.5px solid ' + color + '30', paddingTop: 8, paddingBottom: 8 }}>
          <BulkBar selected={selected} files={files} subfolders={[]} onZip={bulkZip} onMove={bulkMove} onClear={() => { setSelected(new Set()); setSelectionMode(false) }} />
          {files.length === 0 ? (
            <label onDragOver={e => e.preventDefault()} onDrop={onDrop}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 60, border: '0.5px dashed var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text3)', fontSize: 11 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Drop files here or click to upload
              <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} />
            </label>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
              {files.map(f => (
                <FileCard key={f.id} doc={f} onPreview={onPreview} canDelete={canManage}
                  onDelete={deleteDoc} selected={selected.has(f.id)}
                  onSelect={id => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })} />
              ))}
              {canManage && !selectionMode && (
                <label onDragOver={e => e.preventDefault()} onDrop={onDrop}
                  style={{ border: '0.5px dashed var(--border)', borderRadius: 8, minHeight: 80, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, cursor: 'pointer', color: 'var(--text3)', fontSize: 11 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Drop or click to add
                  <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} />
                </label>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Category Folder ───────────────────────────────────────────────────────────
function CategoryFolder({ cat, canManage, onPreview }) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState([])
  const [subfolders, setSubfolders] = useState([])
  const [uploading, setUploading] = useState(false)
  const [showAddSub, setShowAddSub] = useState(false)
  const [newSubName, setNewSubName] = useState('')
  const [savingSub, setSavingSub] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const [selected, setSelected] = useState(new Set())
  const [selectionMode, setSelectionMode] = useState(false)

  useEffect(() => { if (open) { loadFiles(); loadSubfolders() } }, [open])
  useEffect(() => {
    supabase.from('company_documents').select('id', { count: 'exact' }).eq('category', cat.key)
      .then(({ count }) => setTotalCount(count || 0))
  }, [cat.key, open])

  async function loadFiles() {
    const { data } = await supabase.from('company_documents')
      .select('*, profiles(full_name)').eq('category', cat.key).is('subfolder_key', null)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: false })
    setFiles(data || [])
  }
  async function loadSubfolders() {
    const { data } = await supabase.from('company_doc_subfolders').select('*').eq('category_key', cat.key).order('label')
    setSubfolders(data || [])
  }
  async function moveToRoot(docId) {
    await supabase.from('company_documents').update({ subfolder_key: null }).eq('id', docId)
    loadFiles()
  }
  async function upload(fileList) {
    if (!fileList.length) return
    setUploading(true)
    for (const file of fileList) {
      const path = 'company/' + cat.key + '/' + Date.now() + '-' + file.name
      const { error } = await supabase.storage.from('company-docs').upload(path, file)
      if (!error) await supabase.from('company_documents').insert({ category: cat.key, file_name: file.name, file_type: file.type, file_size: file.size, storage_path: path })
    }
    setUploading(false); loadFiles()
  }
  async function deleteDoc(doc) {
    await supabase.storage.from('company-docs').remove([doc.storage_path])
    await supabase.from('company_documents').delete().eq('id', doc.id)
    setFiles(prev => prev.filter(f => f.id !== doc.id))
    setTotalCount(c => c - 1)
  }
  async function addSubfolder() {
    if (!newSubName.trim()) return
    setSavingSub(true)
    const key = cat.key + '-sub-' + Date.now()
    await supabase.from('company_doc_subfolders').insert({ category_key: cat.key, folder_key: key, label: newSubName.trim() })
    setNewSubName(''); setShowAddSub(false); setSavingSub(false); loadSubfolders()
  }
  async function zipFolder() {
    setZipping(true)
    const { data: allFiles } = await supabase.from('company_documents').select('*').eq('category', cat.key)
    if (!allFiles?.length) { alert('No files in this folder.'); setZipping(false); return }
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    s.onload = async () => {
      const zip = new window.JSZip()
      for (const f of allFiles) {
        const { data } = await supabase.storage.from('company-docs').createSignedUrl(f.storage_path, 300)
        if (data?.signedUrl) { const res = await fetch(data.signedUrl); zip.file(f.subfolder_key ? f.subfolder_key + '/' + f.file_name : f.file_name, await res.blob()) }
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = cat.label + '.zip'; a.click()
      setZipping(false)
    }
    document.head.appendChild(s)
  }
  async function bulkZip() {
    const chosen = files.filter(f => selected.has(f.id))
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    s.onload = async () => {
      const zip = new window.JSZip()
      for (const f of chosen) {
        const { data } = await supabase.storage.from('company-docs').createSignedUrl(f.storage_path, 120)
        if (data?.signedUrl) { const res = await fetch(data.signedUrl); zip.file(f.file_name, await res.blob()) }
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = cat.label + '-selected.zip'; a.click()
    }
    document.head.appendChild(s)
  }
  async function bulkMove(targetSubfolder) {
    for (const id of selected) await supabase.from('company_documents').update({ subfolder_key: targetSubfolder }).eq('id', id)
    setSelected(new Set()); setSelectionMode(false); loadFiles()
  }
  function onDropFolder(e) { e.preventDefault(); e.stopPropagation(); const f = Array.from(e.dataTransfer.files); if (f.length) upload(f) }
  function onDropBody(e) { e.preventDefault(); e.stopPropagation(); const id = e.dataTransfer.getData('text/plain'); if (id) { moveToRoot(id); return } const f = Array.from(e.dataTransfer.files); if (f.length) upload(f) }

  return (
    <div style={{ marginBottom: 6 }}>
      <div
        onClick={() => setOpen(o => !o)}
        onDragOver={e => e.preventDefault()}
        onDrop={onDropFolder}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 8, cursor: 'pointer', background: open ? 'var(--surface2)' : 'var(--surface)', border: '0.5px solid var(--border)', borderLeft: '3px solid ' + cat.color, transition: 'background .1s' }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--surface2)' }}
        onMouseLeave={e => { e.currentTarget.style.background = open ? 'var(--surface2)' : 'var(--surface)' }}
      >
        <div style={{ width: 36, height: 36, borderRadius: 8, background: cat.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18 }}>{cat.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{cat.label}</div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>
            {totalCount > 0 ? totalCount + ' file' + (totalCount !== 1 ? 's' : '') : 'Empty'}
            {subfolders.length > 0 ? ' · ' + subfolders.length + ' sub-folder' + (subfolders.length !== 1 ? 's' : '') : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <button onClick={zipFolder} disabled={zipping} style={{ fontSize: 11, padding: '4px 10px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
            {zipping ? '...' : 'Zip'}
          </button>
          {canManage && (
            <label onClick={e => e.stopPropagation()} style={{ fontSize: 11, padding: '4px 10px', border: '0.5px solid #448a40', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: '#448a40' }}>
              {uploading ? '...' : '+ Upload'}
              <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} />
            </label>
          )}
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', marginLeft: 4, flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      {open && (
        <div onDragOver={e => e.preventDefault()} onDrop={onDropBody}
          style={{ marginLeft: 16, paddingLeft: 12, borderLeft: '1.5px solid ' + cat.color + '30', paddingTop: 8, paddingBottom: 8 }}>

          <BulkBar selected={selected} files={files} subfolders={subfolders} onZip={bulkZip} onMove={bulkMove} onClear={() => { setSelected(new Set()); setSelectionMode(false) }} />
          {subfolders.map(sf => (
            <SubfolderSection key={sf.folder_key} subfolder={{ key: sf.folder_key, label: sf.label }}
              categoryKey={cat.key} color={cat.color} canManage={canManage} onPreview={onPreview}
              onReload={docId => setFiles(prev => prev.filter(f => f.id !== docId))} />
          ))}
          {files.length > 0 && (
            <div style={{ marginTop: subfolders.length > 0 ? 10 : 0 }}>
              {subfolders.length > 0 && <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>General files</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                {files.map(f => (
                  <FileCard key={f.id} doc={f} onPreview={onPreview} canDelete={canManage}
                    onDelete={deleteDoc} selected={selected.has(f.id)}
                    onSelect={id => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })} />
                ))}
              </div>
            </div>
          )}
          {files.length === 0 && subfolders.length === 0 && (
            <label onDragOver={e => e.preventDefault()} onDrop={onDropFolder}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 60, border: '0.5px dashed var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text3)', fontSize: 11 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Drop files here or click to upload
              <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} />
            </label>
          )}
          {canManage && (
            <div style={{ marginTop: 10 }}>
              {showAddSub ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input value={newSubName} onChange={e => setNewSubName(e.target.value)} placeholder="Subfolder name" autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') addSubfolder(); if (e.key === 'Escape') setShowAddSub(false) }}
                    style={{ flex: 1, fontSize: 12, padding: '5px 8px', border: '0.5px solid var(--border)', borderRadius: 5, background: 'var(--surface2)', color: 'var(--text)' }} />
                  <button onClick={addSubfolder} disabled={savingSub} style={{ fontSize: 11, padding: '5px 10px', border: '0.5px solid #448a40', borderRadius: 5, background: 'transparent', color: '#448a40', cursor: 'pointer' }}>{savingSub ? '...' : 'Add'}</button>
                  <button onClick={() => setShowAddSub(false)} style={{ fontSize: 11, padding: '5px 8px', border: '0.5px solid var(--border)', borderRadius: 5, background: 'transparent', color: 'var(--text3)', cursor: 'pointer' }}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => setShowAddSub(true)} style={{ fontSize: 11, padding: '4px 10px', border: '0.5px dashed var(--border)', borderRadius: 5, background: 'transparent', color: 'var(--text3)', cursor: 'pointer' }}>+ Add sub-folder</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CompanyDocuments() {
  const { can } = useAuth()
  const [previewDoc, setPreviewDoc] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const canManage = can('manage_documents')

  useEffect(() => {
    const prevent = e => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => { window.removeEventListener('dragover', prevent); window.removeEventListener('drop', prevent) }
  }, [])

  async function openPreview(doc) {
    setPreviewDoc(doc); setPreviewLoading(true); setPreviewUrl(null)
    const { data } = await supabase.storage.from('company-docs').createSignedUrl(doc.storage_path, 3600)
    if (data?.signedUrl) setPreviewUrl(data.signedUrl)
    setPreviewLoading(false)
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Company Documents</h2>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>Upload and manage company-wide documents — accessible to all staff</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {CATEGORIES.map(cat => <CategoryFolder key={cat.key} cat={cat} canManage={canManage} onPreview={openPreview} />)}
      </div>
      {previewDoc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setPreviewDoc(null)}>
          <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 8 }}>
            {previewUrl && (
              <button onClick={e => { e.stopPropagation(); triggerDownload(previewUrl, previewDoc.file_name) }}
                style={{ fontSize: 12, padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>
                ↓ Download
              </button>
            )}
            <button onClick={() => setPreviewDoc(null)} style={{ fontSize: 12, padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>✕ Close</button>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginBottom: 12 }}>{previewDoc.file_name}</div>
          {previewLoading ? <Spinner /> : previewUrl
            ? previewDoc.file_type?.includes('image')
              ? <img src={previewUrl} alt={previewDoc.file_name} style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 8 }} onClick={e => e.stopPropagation()} />
              : <iframe src={previewUrl} style={{ width: '85vw', height: '80vh', border: 'none', borderRadius: 8 }} title={previewDoc.file_name} />
            : <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Unable to preview this file</div>
          }
        </div>
      )}
    </div>
  )
}