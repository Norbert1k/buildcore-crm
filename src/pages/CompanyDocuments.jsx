import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { formatDate } from '../lib/utils'
import { Spinner, ConfirmDialog } from '../components/ui'

const CATEGORIES = [
  { key: 'logo',           icon: '🏢', label: 'Logo & Branding',  color: '#448a40', bg: '#e8f5e7' },
  { key: 'policies',       icon: '📋', label: 'Policies',          color: '#378ADD', bg: '#E6F1FB' },
  { key: 'insurance',      icon: '🛡️', label: 'Insurance',         color: '#BA7517', bg: '#FAEEDA' },
  { key: 'vat',            icon: '💰', label: 'VAT & Tax',         color: '#888780', bg: '#F1EFE8' },
  { key: 'bank',           icon: '🏦', label: 'Bank Details',      color: '#448a40', bg: '#e8f5e7' },
  { key: 'certifications', icon: '📜', label: 'Certifications',    color: '#534AB7', bg: '#EEEDFE' },
  { key: 'fleet',          icon: '🚗', label: 'Car Fleet',         color: '#993C1D', bg: '#FAECE7' },
  { key: 'templates',      icon: '📝', label: 'Templates',         color: '#0F6E56', bg: '#E1F5EE' },
  { key: 'site_folder',    icon: '📁', label: 'Site Folder',       color: '#888780', bg: '#F1EFE8' },
]

function fmtSize(b) {
  if (!b) return ''
  if (b < 1024) return b + 'B'
  if (b < 1048576) return (b / 1024).toFixed(0) + 'KB'
  return (b / 1048576).toFixed(1) + 'MB'
}

function fileExt(name) { return name?.split('.').pop()?.toUpperCase().slice(0, 4) || 'FILE' }

function fileColor(type) {
  if (!type) return '#808080'
  if (type.includes('pdf')) return '#E24B4A'
  if (type.includes('spreadsheet') || type.includes('excel')) return '#1D7B45'
  if (type.includes('presentation') || type.includes('powerpoint')) return '#C55A25'
  if (type.includes('word') || type.includes('document')) return '#1B5EAE'
  if (type.includes('image')) return '#448a40'
  return '#808080'
}

// ── File Card (same design as Project Documentation) ─────────
function FileCard({ doc, onPreview, onDownload, onDelete, canDelete }) {
  const [url, setUrl] = useState(null)
  const isImage = doc.file_type?.includes('image')
  const isPdf = doc.file_type?.includes('pdf')

  useEffect(() => {
    supabase.storage.from('company-docs').createSignedUrl(doc.storage_path, 3600)
      .then(({ data }) => { if (data?.signedUrl) setUrl(data.signedUrl) })
  }, [doc.storage_path])

  function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', doc.id)
    e.dataTransfer.effectAllowed = 'move'
    const ghost = document.createElement('div')
    ghost.style.cssText = 'position:fixed;top:-999px;background:#1a1d27;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 12px;display:flex;align-items:center;gap:8px;font-size:12px;color:#e8e9f0;white-space:nowrap;'
    ghost.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9a9db0" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span>' + doc.file_name.slice(0, 30) + (doc.file_name.length > 30 ? '...' : '') + '</span>'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 16, 20)
    setTimeout(() => document.body.removeChild(ghost), 0)
  }

  return (
    <div draggable={true} onDragStart={handleDragStart} style={{ border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)', cursor: 'grab' }}>
      <div style={{ height: 130, background: 'var(--surface2)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer' }}
        onClick={() => onPreview(doc)}>
        {isImage && url
          ? <img src={url} alt={doc.file_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : isPdf && url
          ? <iframe src={url + '#page=1&toolbar=0&navpanes=0&scrollbar=0'} style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }} title={doc.file_name} />
          : <div style={{ textAlign: 'center' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1" style={{ marginBottom: 4, display: 'block', margin: '0 auto 4px' }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
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
          {url && <button onClick={() => window.open(url, '_blank')} style={{ flex: 1, fontSize: 10, padding: '3px 0', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>View</button>}
          <button onClick={onDownload} style={{ flex: 1, fontSize: 10, padding: '3px 0', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>↓</button>
          {canDelete && <button onClick={onDelete} style={{ fontSize: 10, padding: '3px 6px', border: '0.5px solid var(--red-border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--red)' }}>✕</button>}
        </div>
      </div>
    </div>
  )
}

// ── Sub-folder section ────────────────────────────────────────
function SubfolderSection({ subfolder, categoryKey, color, canManage, onPreview, onReload }) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const { profile } = useAuth()

  useEffect(() => { if (open) loadFiles() }, [open])

  async function loadFiles() {
    const { data } = await supabase.from('company_documents')
      .select('*, profiles(full_name)')
      .eq('category', categoryKey)
      .eq('subfolder_key', subfolder.key)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
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
      const path = `company/${categoryKey}/${subfolder.key}/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('company-docs').upload(path, file)
      if (!error) {
        const { data: ex } = await supabase.from('company_documents').select('sort_order')
          .eq('category', categoryKey).eq('subfolder_key', subfolder.key)
          .order('sort_order', { ascending: false }).limit(1).single()
        await supabase.from('company_documents').insert({
          category: categoryKey, subfolder_key: subfolder.key,
          file_name: file.name, file_size: file.size, file_type: file.type,
          storage_path: path, uploaded_by: profile?.id, sort_order: (ex?.sort_order || 0) + 1,
        })
      }
    }
    setUploading(false)
    loadFiles()
  }

  async function download(doc) {
    const { data } = await supabase.storage.from('company-docs').createSignedUrl(doc.storage_path, 60)
    if (data?.signedUrl) { const a = document.createElement('a'); a.href = data.signedUrl; a.download = doc.file_name; a.click() }
  }

  async function deleteDoc(doc) {
    await supabase.storage.from('company-docs').remove([doc.storage_path])
    await supabase.from('company_documents').delete().eq('id', doc.id)
    setConfirmDelete(null)
    setFiles(prev => prev.filter(f => f.id !== doc.id))
  }

  return (
    <div style={{ marginBottom: 3 }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 6, cursor: 'pointer', background: open ? 'var(--surface2)' : 'transparent', transition: 'all .1s', outline: 'none' }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--surface2)' }}
        onMouseLeave={e => { e.currentTarget.style.background = open ? 'var(--surface2)' : 'transparent'; e.currentTarget.style.outline = 'none' }}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.style.background = 'rgba(68,138,64,0.15)'; e.currentTarget.style.outline = '2px dashed #448a40' }}
        onDragLeave={e => { e.currentTarget.style.background = open ? 'var(--surface2)' : 'transparent'; e.currentTarget.style.outline = 'none' }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.style.background = open ? 'var(--surface2)' : 'transparent'; e.currentTarget.style.outline = 'none'; const docId = e.dataTransfer.getData('text/plain'); if (docId) moveFile(docId) }}>
        <div style={{ width: 28, height: 28, borderRadius: 6, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 14 }}>
          📁
        </div>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{subfolder.label}</span>
        <span style={{ fontSize: 10, color: 'var(--text3)' }}>{files.length > 0 ? `${files.length} file${files.length !== 1 ? 's' : ''}` : open ? '0 files' : ''}</span>
        {open && canManage && (
          <label onClick={e => e.stopPropagation()} style={{ fontSize: 10, padding: '2px 7px', border: '0.5px solid #448a40', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: '#448a40', flexShrink: 0 }}>
            {uploading ? '...' : '+ Upload'}
            <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} disabled={uploading} />
          </label>
        )}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2"
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>

      {open && (
        <div
          onDragOver={e => { e.preventDefault(); e.currentTarget.style.outline = '2px dashed #448a40'; e.currentTarget.style.borderRadius = '6px' }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.style.outline = '' }}
          onDrop={e => { e.preventDefault(); e.currentTarget.style.outline = ''; const docId = e.dataTransfer.getData('text/plain'); if (docId) { moveFile(docId); return } const f = Array.from(e.dataTransfer.files); if (f.length) upload(f) }}
        onDragOver={e => { e.preventDefault(); e.currentTarget.style.outline = '2px dashed #448a40'; e.currentTarget.style.borderRadius = '6px' }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.style.outline = '' }}
          onDrop={e => { e.preventDefault(); e.currentTarget.style.outline = ''; const docId = e.dataTransfer.getData('text/plain'); if (docId) { moveFile(docId); return } const f = Array.from(e.dataTransfer.files); if (f.length) upload(f) }}
          style={{ marginLeft: 14, paddingLeft: 12, borderLeft: `1.5px solid ${color}30`, paddingTop: 8, paddingBottom: 8 }}>
          {files.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text3)', padding: '8px 0', textAlign: 'center' }}>
              Empty — {canManage ? 'click + Upload above to add files' : 'no files yet'}
            </div>
          ) : (
            <div onDragOver={e => { e.preventDefault(); e.currentTarget.style.background = 'rgba(68,138,64,0.1)'; e.currentTarget.style.outline = '2px dashed #448a40'; e.currentTarget.style.borderRadius = '6px' }}
              onDragLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.outline = '' }}
              onDrop={e => {
                e.preventDefault(); e.currentTarget.style.background = ''; e.currentTarget.style.outline = ''
                const docId = e.dataTransfer.getData('text/plain')
                if (docId) { moveFile(docId); return }
                const f = Array.from(e.dataTransfer.files); if (f.length) upload(f)
              }}
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, padding: 4, borderRadius: 6, transition: 'all .15s' }}>
              {files.map(f => (
                <FileCard key={f.id} doc={f} onPreview={onPreview}
                  onDownload={async () => download(f)}
                  onDelete={() => setConfirmDelete(f)}
                  canDelete={canManage} />
              ))}
              {canManage && (
                <label onDragOver={e => { e.preventDefault(); e.currentTarget.style.background='rgba(68,138,64,0.1)'; e.currentTarget.style.borderColor='#448a40' }}
                  onDragLeave={e => { e.currentTarget.style.background=''; e.currentTarget.style.borderColor='' }}
                  onDrop={e => { e.preventDefault(); e.currentTarget.style.background=''; e.currentTarget.style.borderColor=''; const f=Array.from(e.dataTransfer.files); if(f.length) upload(f) }}
                  style={{ border: '0.5px dashed var(--border)', borderRadius: 8, minHeight: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, cursor: 'pointer', color: 'var(--text3)', fontSize: 11, transition: 'all .15s' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Drop or click to add
                  <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} />
                </label>
              )}
            </div>
          )}
        </div>
      )}

      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setConfirmDelete(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 24, maxWidth: 360, width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Delete file?</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>"{confirmDelete.file_name}" will be permanently deleted.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => deleteDoc(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Category folder row ───────────────────────────────────────
function CategoryFolder({ cat, canManage, onPreview }) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState([])
  const [subfolders, setSubfolders] = useState([])
  const [uploading, setUploading] = useState(false)
  const [showAddSub, setShowAddSub] = useState(false)
  const [newSubName, setNewSubName] = useState('')
  const [savingSub, setSavingSub] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [zipping, setZipping] = useState(false)
  const { profile } = useAuth()

  useEffect(() => {
    if (open) { loadFiles(); loadSubfolders() }
  }, [open])

  async function loadFiles() {
    const { data } = await supabase.from('company_documents')
      .select('*, profiles(full_name)')
      .eq('category', cat.key)
      .is('subfolder_key', null)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
    setFiles(data || [])
  }

  async function loadSubfolders() {
    const { data } = await supabase.from('company_doc_subfolders')
      .select('*').eq('category_key', cat.key).order('created_at')
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
      const path = `company/${cat.key}/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('company-docs').upload(path, file)
      if (!error) {
        const { data: ex } = await supabase.from('company_documents').select('sort_order')
          .eq('category', cat.key).is('subfolder_key', null)
          .order('sort_order', { ascending: false }).limit(1).single()
        await supabase.from('company_documents').insert({
          category: cat.key, file_name: file.name, file_size: file.size,
          file_type: file.type, storage_path: path, uploaded_by: profile?.id,
          sort_order: (ex?.sort_order || 0) + 1,
        })
      }
    }
    setUploading(false)
    loadFiles()
  }

  async function download(doc) {
    const { data } = await supabase.storage.from('company-docs').createSignedUrl(doc.storage_path, 60)
    if (data?.signedUrl) { const a = document.createElement('a'); a.href = data.signedUrl; a.download = doc.file_name; a.click() }
  }

  async function deleteDoc(doc) {
    await supabase.storage.from('company-docs').remove([doc.storage_path])
    await supabase.from('company_documents').delete().eq('id', doc.id)
    setConfirmDelete(null)
    setFiles(prev => prev.filter(f => f.id !== doc.id))
  }

  async function addSubfolder() {
    if (!newSubName.trim()) return
    setSavingSub(true)
    const key = `${cat.key}-sub-${Date.now()}`
    await supabase.from('company_doc_subfolders').insert({ category_key: cat.key, folder_key: key, label: newSubName.trim() })
    setNewSubName('')
    setShowAddSub(false)
    setSavingSub(false)
    loadSubfolders()
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
        if (data?.signedUrl) {
          const res = await fetch(data.signedUrl)
          const subPath = f.subfolder_key ? `${f.subfolder_key}/${f.file_name}` : f.file_name
          zip.file(subPath, await res.blob())
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${cat.label}.zip`; a.click()
      setZipping(false)
    }
    document.head.appendChild(s)
  }

  // Total file count including subfolders
  const [totalCount, setTotalCount] = useState(0)
  useEffect(() => {
    supabase.from('company_documents').select('id', { count: 'exact' }).eq('category', cat.key)
      .then(({ count }) => setTotalCount(count || 0))
  }, [cat.key, open])

  return (
    <div style={{ marginBottom: 6 }}>
      {/* Folder row */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
          borderRadius: 8, cursor: 'pointer',
          background: open ? 'var(--surface2)' : 'var(--surface)',
          border: '0.5px solid var(--border)',
          borderLeft: `3px solid ${cat.color}`,
          transition: 'background .1s',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--surface2)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = open ? 'var(--surface2)' : 'var(--surface)' }}
      >
        {/* Icon in coloured circle */}
        <div style={{ width: 36, height: 36, borderRadius: 8, background: cat.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18 }}>
          {cat.icon}
        </div>

        {/* Name + count */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{cat.label}</div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>
            {totalCount > 0 ? `${totalCount} file${totalCount !== 1 ? 's' : ''}` : 'Empty'}
            {subfolders.length > 0 ? ` · ${subfolders.length} sub-folder${subfolders.length !== 1 ? 's' : ''}` : ''}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <button onClick={zipFolder} disabled={zipping} style={{ fontSize: 11, padding: '4px 10px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
            {zipping ? '...' : 'Zip'}
          </button>
          {canManage && (
            <label onClick={e => e.stopPropagation()} style={{ fontSize: 11, padding: '4px 10px', border: '0.5px solid #448a40', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: '#448a40' }}>
              {uploading ? '...' : '+ Upload'}
              <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} disabled={uploading} />
            </label>
          )}
        </div>

        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', marginLeft: 4, flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      {/* Open content */}
      {open && (
        <div
          onDragOver={e => { e.preventDefault(); e.currentTarget.style.outline = '2px dashed #448a40'; e.currentTarget.style.borderRadius = '6px' }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.style.outline = '' }}
          onDrop={e => { e.preventDefault(); e.currentTarget.style.outline = ''; const docId = e.dataTransfer.getData('text/plain'); if (docId) return; const f = Array.from(e.dataTransfer.files); if (f.length) upload(f) }}
        onDragOver={e => { e.preventDefault(); e.currentTarget.style.outline = '2px dashed #448a40'; e.currentTarget.style.borderRadius = '6px' }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.style.outline = '' }}
          onDrop={e => { e.preventDefault(); e.currentTarget.style.outline = ''; const docId = e.dataTransfer.getData('text/plain'); if (docId) return; const f = Array.from(e.dataTransfer.files); if (f.length) upload(f) }}
          style={{ marginLeft: 16, paddingLeft: 12, borderLeft: `1.5px solid ${cat.color}30`, paddingTop: 8, paddingBottom: 8 }}>

          {/* Sub-folders */}
          {subfolders.map(sf => (
            <SubfolderSection key={sf.folder_key} subfolder={{ key: sf.folder_key, label: sf.label }}
              categoryKey={cat.key} color={cat.color} canManage={canManage} onPreview={onPreview}
              onReload={(docId) => { setFiles(prev => prev.filter(f => f.id !== docId)) }} />
          ))}

          {/* Direct files in this folder (no subfolder) */}
          {files.length > 0 && (
            <div style={{ marginTop: subfolders.length > 0 ? 10 : 0 }}>
              {subfolders.length > 0 && (
                <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>General files</div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                {files.map(f => (
                  <FileCard key={f.id} doc={f} onPreview={onPreview}
                    onDownload={async () => download(f)}
                    onDelete={() => setConfirmDelete(f)}
                    canDelete={canManage} />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {files.length === 0 && subfolders.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text3)', padding: '16px 0', textAlign: 'center' }}>
              Empty folder — {canManage ? 'upload files or add sub-folders below' : 'no files yet'}
            </div>
          )}

          {/* Upload drop area when empty and no subfolders */}
          {files.length === 0 && subfolders.length === 0 && canManage && (
            <label onDragOver={e => { e.preventDefault(); e.currentTarget.style.background='rgba(68,138,64,0.1)'; e.currentTarget.style.borderColor='#448a40'; e.currentTarget.style.color='#448a40' }}
              onDragLeave={e => { e.currentTarget.style.background=''; e.currentTarget.style.borderColor=''; e.currentTarget.style.color='' }}
              onDrop={e => { e.preventDefault(); e.currentTarget.style.background=''; e.currentTarget.style.borderColor=''; e.currentTarget.style.color=''; const f=Array.from(e.dataTransfer.files); if(f.length) upload(f) }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 60, border: '0.5px dashed var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text3)', fontSize: 11, marginTop: 4, transition: 'all .15s' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Drop files or click to upload
              <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} />
            </label>
          )}

          {/* Add sub-folder */}
          {canManage && (
            <div style={{ marginTop: 8 }}>
              {showAddSub ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input autoFocus value={newSubName} onChange={e => setNewSubName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addSubfolder(); if (e.key === 'Escape') setShowAddSub(false) }}
                    placeholder="Sub-folder name..."
                    style={{ flex: 1, fontSize: 12, padding: '5px 10px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text)' }} />
                  <button onClick={addSubfolder} disabled={savingSub || !newSubName.trim()}
                    style={{ fontSize: 11, padding: '5px 10px', background: '#448a40', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                    {savingSub ? '...' : 'Add'}
                  </button>
                  <button onClick={() => setShowAddSub(false)}
                    style={{ fontSize: 11, padding: '5px 10px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowAddSub(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '5px 10px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text3)' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Add sub-folder
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setConfirmDelete(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 24, maxWidth: 360, width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Delete file?</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>"{confirmDelete.file_name}" will be permanently deleted.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => deleteDoc(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────
export default function CompanyDocuments() {
  const { can } = useAuth()
  useEffect(() => {
    const prevent = e => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])
  const [previewDoc, setPreviewDoc] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const canManage = can('manage_subcontractors')

  async function openPreview(doc) {
    setPreviewDoc(doc); setPreviewLoading(true); setPreviewUrl(null)
    const { data } = await supabase.storage.from('company-docs').createSignedUrl(doc.storage_path, 300)
    setPreviewUrl(data?.signedUrl || null)
    setPreviewLoading(false)
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Company Documents</h2>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>Upload and manage company-wide documents — accessible to all staff</p>
      </div>

      {/* Folder rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {CATEGORIES.map(cat => (
          <CategoryFolder key={cat.key} cat={cat} canManage={canManage} onPreview={openPreview} />
        ))}
      </div>

      {/* Preview Modal */}
      {previewDoc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => { setPreviewDoc(null); setPreviewUrl(null) }}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 900, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previewDoc.file_name}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtSize(previewDoc.file_size)} · {formatDate(previewDoc.created_at)}</div>
              </div>
              {previewUrl && (
                <a href={previewUrl} download={previewDoc.file_name} className="btn btn-sm btn-primary">↓ Download</a>
              )}
              <button className="btn btn-sm" onClick={() => { setPreviewDoc(null); setPreviewUrl(null) }} style={{ fontSize: 16, padding: '4px 12px' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111', minHeight: 300 }}>
              {previewLoading ? (
                <div style={{ color: 'white', fontSize: 13 }}>Loading preview...</div>
              ) : !previewUrl ? (
                <div style={{ color: '#aaa', fontSize: 13 }}>Could not load preview</div>
              ) : previewDoc.file_type?.includes('image') ? (
                <img src={previewUrl} alt={previewDoc.file_name} style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }} />
              ) : previewDoc.file_type?.includes('pdf') ? (
                <iframe src={previewUrl + '#toolbar=1'} style={{ width: '100%', height: '80vh', border: 'none' }} title={previewDoc.file_name} />
              ) : previewDoc.file_type?.includes('video') ? (
                <video controls src={previewUrl} style={{ maxWidth: '100%', maxHeight: '80vh' }} />
              ) : (previewDoc.file_type?.includes('word') || previewDoc.file_type?.includes('spreadsheet') || previewDoc.file_name?.match(/\.(docx?|xlsx?|pptx?)$/i)) ? (
                <iframe src={`https://docs.google.com/viewer?url=${encodeURIComponent(previewUrl)}&embedded=true`} style={{ width: '100%', height: '80vh', border: 'none' }} title={previewDoc.file_name} />
              ) : (
                <div style={{ color: 'white', textAlign: 'center', padding: 40 }}>
                  <div style={{ fontSize: 56, marginBottom: 16 }}>📄</div>
                  <div style={{ fontSize: 14, marginBottom: 24 }}>{previewDoc.file_name}</div>
                  {previewUrl && <a href={previewUrl} download={previewDoc.file_name} className="btn btn-primary">↓ Download File</a>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
