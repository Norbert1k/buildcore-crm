import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { formatDate } from '../lib/utils'
import UploadProgress from './UploadProgress'

const SUB_DOC_FOLDERS = [
  { key: 'purchase-order',       label: '01. Purchase Order',             icon: '📋', color: '#185FA5', bg: '#E6F1FB' },
  { key: 'payment-applications', label: '02. Payment Applications',      icon: '💰', color: '#854F0B', bg: '#FAEEDA' },
  { key: 'variations',           label: '03. Variations',                icon: '📝', color: '#993C1D', bg: '#FAECE7' },
  { key: 'correspondence',       label: '04. Correspondence',            icon: '✉️',  color: '#534AB7', bg: '#EEEDFE' },
  { key: 'rams',                 label: '05. RAMS & Method Statements',  icon: '📄', color: '#0F6E56', bg: '#E1F5EE' },
  { key: 'other',                label: '06. Other',                     icon: '📁', color: '#888780', bg: '#F1EFE8' },
]

function fmtSize(b) {
  if (!b) return ''
  if (b < 1024) return b + 'B'
  if (b < 1048576) return (b / 1024).toFixed(0) + 'KB'
  return (b / 1048576).toFixed(1) + 'MB'
}
function fileExt(name) { return name?.split('.').pop()?.toUpperCase().slice(0, 4) || 'FILE' }
function naturalSort(arr) {
  return [...arr].sort((a, b) => (a.file_name || '').localeCompare(b.file_name || '', undefined, { numeric: true, sensitivity: 'base' }))
}

const EXT_COLORS = {
  PDF: { bg: '#FCEBEB', color: '#A32D2D' }, XLSX: { bg: '#E1F5EE', color: '#0F6E56' }, XLS: { bg: '#E1F5EE', color: '#0F6E56' },
  DOC: { bg: '#E6F1FB', color: '#185FA5' }, DOCX: { bg: '#E6F1FB', color: '#185FA5' },
  JPG: { bg: '#FAEEDA', color: '#854F0B' }, JPEG: { bg: '#FAEEDA', color: '#854F0B' }, PNG: { bg: '#FAEEDA', color: '#854F0B' },
  DWG: { bg: '#EEEDFE', color: '#534AB7' }, CSV: { bg: '#E1F5EE', color: '#0F6E56' },
}

async function triggerDownload(signedUrl, fileName) {
  try {
    const res = await fetch(signedUrl); const blob = await res.blob()
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  } catch { const a = document.createElement('a'); a.href = signedUrl; a.download = fileName; a.click() }
}

// ── View toggle ──────────────────────────────────────────────
function ViewToggle({ viewMode, setView }) {
  const modes = [
    { mode: 'grid', icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg> },
    { mode: 'compact', icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="0" y="0" width="5" height="5" rx="1"/><rect x="6" y="0" width="5" height="5" rx="1"/><rect x="12" y="0" width="4" height="5" rx="1"/><rect x="0" y="6" width="5" height="5" rx="1"/><rect x="6" y="6" width="5" height="5" rx="1"/><rect x="12" y="6" width="4" height="5" rx="1"/></svg> },
    { mode: 'list', icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="0" y="1" width="16" height="2.5" rx="1"/><rect x="0" y="5.5" width="16" height="2.5" rx="1"/><rect x="0" y="10" width="16" height="2.5" rx="1"/></svg> },
  ]
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {modes.map(({ mode, icon }) => (
        <button key={mode} onClick={() => setView(mode)}
          style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '0.5px solid ' + (viewMode === mode ? 'var(--accent)' : 'var(--border)'), borderRadius: 4, background: viewMode === mode ? 'var(--accent)' : 'transparent', cursor: 'pointer', color: viewMode === mode ? '#fff' : 'var(--text3)', padding: 0 }}>
          {icon}
        </button>
      ))}
    </div>
  )
}

// ── File card (grid / compact) ───────────────────────────────
function FileCard({ file, canManage, onPreview, onDelete, selected, onSelect, compact }) {
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const ext = fileExt(file.file_name)
  const ec = EXT_COLORS[ext] || { bg: '#F1EFE8', color: '#888780' }
  const isSent = file.direction === 'sent'
  async function renameFile() {
    if (!renameVal.trim() || renameVal.trim() === file.file_name) { setRenaming(false); return }
    await supabase.from('project_sub_files').update({ file_name: renameVal.trim() }).eq('id', file.id)
    file.file_name = renameVal.trim(); setRenaming(false)
  }
  return (
    <div style={{ background: 'var(--surface)', border: selected ? '1.5px solid var(--accent)' : '0.5px solid var(--border)', borderRadius: 'var(--radius)', padding: compact ? '6px 8px' : '8px 10px', cursor: 'pointer', position: 'relative', transition: 'border-color .1s' }}
      onClick={() => onPreview(file)} onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border2)'} onMouseLeave={e => e.currentTarget.style.borderColor = selected ? 'var(--accent)' : 'var(--border)'}>
      <div style={{ position: 'absolute', top: 4, left: 4 }} onClick={e => { e.stopPropagation(); onSelect(file.id) }}>
        <div style={{ width: 14, height: 14, borderRadius: 3, border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border2)'}`, background: selected ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {selected && <svg width="8" height="8" viewBox="0 0 12 12"><path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>}
        </div>
      </div>
      <div style={{ position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 600, background: isSent ? '#e8f5e7' : '#E6F1FB', color: isSent ? '#448a40' : '#185FA5' }}>{isSent ? '↑' : '↓'}</div>
      <div style={{ width: '100%', display: 'flex', justifyContent: 'center', marginBottom: compact ? 4 : 6, marginTop: compact ? 2 : 4 }}>
        <div style={{ width: compact ? 30 : 36, height: compact ? 30 : 36, borderRadius: 6, background: ec.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: compact ? 8 : 9, fontWeight: 700, color: ec.color }}>{ext}</div>
      </div>
      {renaming ? (
        <input value={renameVal} autoFocus onChange={e => setRenameVal(e.target.value)} onClick={e => e.stopPropagation()}
          onKeyDown={e => { if (e.key === 'Enter') renameFile(); if (e.key === 'Escape') setRenaming(false) }}
          style={{ fontSize: 10, padding: '2px 4px', width: '100%', border: '1px solid var(--accent)', borderRadius: 3, background: 'var(--surface2)', color: 'var(--text)' }} />
      ) : (
        <div style={{ fontSize: compact ? 9 : 10, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center', color: 'var(--text)' }}
          onDoubleClick={e => { if (canManage) { e.stopPropagation(); setRenameVal(file.file_name); setRenaming(true) } }}
          title={file.file_name + (canManage ? ' — double-click to rename' : '')}>{file.file_name}</div>
      )}
      <div style={{ fontSize: 8, color: 'var(--text3)', textAlign: 'center', marginTop: 2 }}>{fmtSize(file.file_size)}{file.file_size ? ' · ' : ''}{formatDate(file.created_at)}</div>
    </div>
  )
}

// ── File row (list view) ─────────────────────────────────────
function FileListRow({ file, canManage, onPreview, onDelete, selected, onSelect }) {
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const ext = fileExt(file.file_name)
  const ec = EXT_COLORS[ext] || { bg: '#F1EFE8', color: '#888780' }
  const isSent = file.direction === 'sent'
  async function renameFile() {
    if (!renameVal.trim() || renameVal.trim() === file.file_name) { setRenaming(false); return }
    await supabase.from('project_sub_files').update({ file_name: renameVal.trim() }).eq('id', file.id)
    file.file_name = renameVal.trim(); setRenaming(false)
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '0.5px solid var(--border)', fontSize: 12, cursor: 'pointer' }} onClick={() => onPreview(file)}>
      <div onClick={e => { e.stopPropagation(); onSelect(file.id) }} style={{ cursor: 'pointer' }}>
        <div style={{ width: 16, height: 16, borderRadius: 3, border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border2)'}`, background: selected ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {selected && <svg width="8" height="8" viewBox="0 0 12 12"><path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>}
        </div>
      </div>
      <div style={{ width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 600, flexShrink: 0, background: isSent ? '#e8f5e7' : '#E6F1FB', color: isSent ? '#448a40' : '#185FA5' }}>{isSent ? '↑' : '↓'}</div>
      <div style={{ width: 24, height: 24, borderRadius: 4, background: ec.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: ec.color, flexShrink: 0 }}>{ext}</div>
      {renaming ? (
        <input value={renameVal} autoFocus onChange={e => setRenameVal(e.target.value)} onClick={e => e.stopPropagation()}
          onKeyDown={e => { if (e.key === 'Enter') renameFile(); if (e.key === 'Escape') setRenaming(false) }}
          style={{ flex: 1, fontSize: 12, padding: '2px 6px', border: '1px solid var(--accent)', borderRadius: 3 }} />
      ) : (
        <div style={{ flex: 1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          onDoubleClick={e => { if (canManage) { e.stopPropagation(); setRenameVal(file.file_name); setRenaming(true) } }}
          title={file.file_name + (canManage ? ' — double-click to rename' : '')}>{file.file_name}</div>
      )}
      <div style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0, whiteSpace: 'nowrap' }}>{fmtSize(file.file_size)}</div>
      <div style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>{formatDate(file.created_at)}</div>
      {canManage && <button onClick={e => { e.stopPropagation(); onDelete(file) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 11, padding: '2px 4px', fontFamily: 'inherit' }}>✕</button>}
    </div>
  )
}

// ── Files grid ───────────────────────────────────────────────
function FilesGrid({ files, viewMode, canManage, onPreview, onDelete, selected, onSelect, onDrop, onUpload }) {
  if (viewMode === 'list') {
    return (
      <div style={{ border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        {files.map(f => <FileListRow key={f.id} file={f} canManage={canManage} onPreview={onPreview} onDelete={onDelete} selected={selected.has(f.id)} onSelect={onSelect} />)}
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: viewMode === 'compact' ? 'repeat(auto-fill, minmax(100px, 1fr))' : 'repeat(auto-fill, minmax(140px, 1fr))', gap: viewMode === 'compact' ? 6 : 8 }}>
      {files.map(f => <FileCard key={f.id} file={f} canManage={canManage} onPreview={onPreview} onDelete={onDelete} selected={selected.has(f.id)} onSelect={onSelect} compact={viewMode === 'compact'} />)}
      {canManage && (
        <label onDragOver={e => e.preventDefault()} onDrop={onDrop}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--border)', borderRadius: 'var(--radius)', minHeight: viewMode === 'compact' ? 60 : 80, cursor: 'pointer', fontSize: 11, color: 'var(--text3)' }}>
          + Upload<input type="file" multiple style={{ display: 'none' }} onChange={e => onUpload(Array.from(e.target.files))} />
        </label>
      )}
    </div>
  )
}

// ── Folder section ───────────────────────────────────────────
function FolderSection({ folder, projectId, projectSubId, canManage, viewMode, onPreview, onReload }) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState([])
  const [childFolders, setChildFolders] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [showAddSub, setShowAddSub] = useState(false)
  const [newSubName, setNewSubName] = useState('')
  const [savingSub, setSavingSub] = useState(false)
  const [direction, setDirection] = useState('received')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ active: false, files: [], current: 0, total: 0, errors: [] })
  const [dragOver, setDragOver] = useState(false)
  const { profile } = useAuth()

  useEffect(() => { if (open) { loadFiles(); loadChildFolders() } }, [open])

  async function loadFiles() {
    const { data } = await supabase.from('project_sub_files').select('*')
      .eq('project_id', projectId).eq('project_sub_id', projectSubId)
      .eq('folder_key', folder.key).order('created_at', { ascending: false })
    setFiles(naturalSort(data || []))
  }

  async function loadChildFolders() {
    const { data } = await supabase.from('project_sub_folders').select('*')
      .eq('project_sub_id', projectSubId).eq('parent_key', folder.key).order('created_at')
    setChildFolders(data || [])
  }

  function toggleSelect(id) { setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }) }

  async function uploadFiles(fileList) {
    if (!fileList.length) return
    const fileArr = Array.from(fileList)
    setUploading(true)
    setUploadProgress({ active: true, files: fileArr.map(f => f.name), current: 0, total: fileArr.length, errors: [] })
    const errors = []
    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i]
      setUploadProgress(prev => ({ ...prev, current: i }))
      const path = `projects/${projectId}/subs/${projectSubId}/${folder.key}/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('project-docs').upload(path, file)
      if (!error) {
        await supabase.from('project_sub_files').insert({
          project_id: projectId, project_sub_id: projectSubId, folder_key: folder.key,
          file_name: file.name, file_size: file.size, storage_path: path,
          direction, uploaded_by: profile?.id,
        })
      } else { errors.push(file.name) }
    }
    setUploading(false)
    setUploadProgress({ active: false, files: fileArr.map(f => f.name), current: fileArr.length, total: fileArr.length, errors })
    loadFiles(); onReload()
  }

  async function deleteFile(file) {
    await supabase.storage.from('project-docs').remove([file.storage_path])
    await supabase.from('project_sub_files').delete().eq('id', file.id)
    loadFiles(); onReload()
  }

  function onDrop(e) { e.preventDefault(); e.stopPropagation(); setDragOver(false); if (!canManage) return; const f = Array.from(e.dataTransfer?.files || []); if (f.length) uploadFiles(f) }

  async function addChildFolder() {
    if (!newSubName.trim()) return; setSavingSub(true)
    const key = 'sub-' + Date.now()
    await supabase.from('project_sub_folders').insert({ project_sub_id: projectSubId, project_id: projectId, parent_key: folder.key, folder_key: key, label: newSubName.trim() })
    setNewSubName(''); setShowAddSub(false); setSavingSub(false); loadChildFolders()
  }

  async function bulkZip() {
    const filesToZip = selected.size > 0 ? files.filter(f => selected.has(f.id)) : files
    if (!filesToZip.length) return
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; document.head.appendChild(s); await new Promise(r => s.onload = r)
    const zip = new window.JSZip()
    for (const f of filesToZip) {
      const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 300)
      if (data?.signedUrl) { const res = await fetch(data.signedUrl); zip.file(f.file_name, await res.blob()) }
    }
    const blob = await zip.generateAsync({ type: 'blob' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = folder.label.replace(/[^a-zA-Z0-9 ]/g, '').trim() + '.zip'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  return (
    <div>
      <div onClick={() => setOpen(o => !o)}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={canManage ? onDrop : undefined}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
          background: dragOver ? 'var(--accent-light, #e8f5e7)' : open ? 'var(--surface2)' : 'transparent',
          border: dragOver ? '1.5px dashed var(--accent)' : '1.5px solid transparent', transition: 'background .1s' }}
        onMouseEnter={e => { if (!open && !dragOver) e.currentTarget.style.background = 'var(--surface2)' }}
        onMouseLeave={e => { if (!open && !dragOver) e.currentTarget.style.background = open ? 'var(--surface2)' : 'transparent' }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={folder.color} strokeWidth="2"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}><polyline points="6 9 12 15 18 9"/></svg>
        <div style={{ width: 24, height: 24, borderRadius: 6, background: folder.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>{folder.icon}</div>
        <div style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{folder.label}</div>
        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, fontWeight: 500, background: files.length > 0 ? folder.bg : 'transparent', color: files.length > 0 ? folder.color : 'var(--text3)' }}>{files.length || ''}</span>
      </div>

      {open && (
        <div style={{ padding: '6px 10px 10px 46px' }}>
          <UploadProgress uploadState={uploadProgress} />

          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, fontSize: 10, color: 'var(--text3)' }}>{files.length} file{files.length !== 1 ? 's' : ''}</div>
            {selected.size > 0 && <button onClick={() => setSelected(new Set())} style={{ fontSize: 9, padding: '2px 8px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'var(--surface2)', cursor: 'pointer', color: 'var(--text2)', fontFamily: 'inherit' }}>{selected.size} selected · Clear</button>}
            {files.length > 0 && (
              <button onClick={bulkZip} style={{ fontSize: 9, padding: '2px 8px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'var(--surface2)', cursor: 'pointer', color: 'var(--text2)', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
                {selected.size > 0 ? 'Zip selected' : 'Zip all'}
              </button>
            )}
            {canManage && <button onClick={() => setShowAddSub(true)} style={{ fontSize: 9, padding: '2px 8px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'var(--surface2)', cursor: 'pointer', color: 'var(--text2)', fontFamily: 'inherit' }}>+ Subfolder</button>}
          </div>

          {/* Add subfolder */}
          {showAddSub && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <input value={newSubName} autoFocus onChange={e => setNewSubName(e.target.value)} placeholder="Subfolder name"
                onKeyDown={e => { if (e.key === 'Enter') addChildFolder(); if (e.key === 'Escape') setShowAddSub(false) }}
                style={{ flex: 1, fontSize: 12, padding: '4px 8px' }} />
              <button className="btn btn-sm btn-primary" onClick={addChildFolder} disabled={savingSub}>{savingSub ? '...' : 'Add'}</button>
              <button className="btn btn-sm" onClick={() => setShowAddSub(false)}>Cancel</button>
            </div>
          )}

          {/* Child folders */}
          {childFolders.map(cf => (
            <ChildFolder key={cf.folder_key} cf={cf} folder={folder} projectId={projectId} projectSubId={projectSubId}
              canManage={canManage} viewMode={viewMode} onPreview={onPreview} onReload={() => { loadFiles(); loadChildFolders(); onReload() }} />
          ))}

          {/* Files */}
          {files.length === 0 && childFolders.length === 0 ? (
            <label onDragOver={e => e.preventDefault()} onDrop={canManage ? onDrop : undefined}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, height: 60, border: '1px dashed var(--border)', borderRadius: 6, cursor: canManage ? 'pointer' : 'default', color: 'var(--text3)', fontSize: 11 }}>
              {canManage ? <>Drop files here or click to upload<input type="file" multiple style={{ display: 'none' }} onChange={e => uploadFiles(Array.from(e.target.files))} /></> : 'No files'}
            </label>
          ) : (
            <FilesGrid files={files} viewMode={viewMode} canManage={canManage} onPreview={onPreview}
              onDelete={deleteFile} selected={selected} onSelect={toggleSelect} onDrop={onDrop} onUpload={uploadFiles} />
          )}

          {/* Upload bar */}
          {canManage && files.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 0, border: '0.5px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                <button onClick={() => setDirection('sent')} style={{ fontSize: 9, padding: '3px 8px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: direction === 'sent' ? '#448a40' : 'var(--surface)', color: direction === 'sent' ? 'white' : 'var(--text2)' }}>↑ Sent</button>
                <button onClick={() => setDirection('received')} style={{ fontSize: 9, padding: '3px 8px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: direction === 'received' ? '#448a40' : 'var(--surface)', color: direction === 'received' ? 'white' : 'var(--text2)' }}>↓ Received</button>
              </div>
              <label style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: 6, border: '1px dashed var(--border)', borderRadius: 4, fontSize: 10, color: 'var(--text2)', cursor: 'pointer' }}
                onDragOver={e => e.preventDefault()} onDrop={onDrop}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#448a40'; e.currentTarget.style.color = '#448a40' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text2)' }}>
                {uploading ? 'Uploading...' : '+ Drop files or click to upload'}
                <input type="file" multiple style={{ display: 'none' }} onChange={e => uploadFiles(Array.from(e.target.files))} disabled={uploading} />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Child folder (recursive) ─────────────────────────────────
function ChildFolder({ cf, folder, projectId, projectSubId, canManage, viewMode, onPreview, onReload }) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState([])
  const [children, setChildren] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState(cf.label)
  const [label, setLabel] = useState(cf.label)
  const [showAddSub, setShowAddSub] = useState(false)
  const [newSubName, setNewSubName] = useState('')
  const [direction, setDirection] = useState('received')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ active: false, files: [], current: 0, total: 0, errors: [] })
  const { profile } = useAuth()

  useEffect(() => { if (open) { loadFiles(); loadChildren() } }, [open])

  async function loadFiles() {
    const { data } = await supabase.from('project_sub_files').select('*')
      .eq('project_sub_id', projectSubId).eq('folder_key', cf.folder_key).order('created_at', { ascending: false })
    setFiles(naturalSort(data || []))
  }
  async function loadChildren() {
    const { data } = await supabase.from('project_sub_folders').select('*')
      .eq('project_sub_id', projectSubId).eq('parent_key', cf.folder_key).order('created_at')
    setChildren(data || [])
  }
  function toggleSelect(id) { setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }) }

  async function uploadFiles(fileList) {
    if (!fileList.length) return; const fileArr = Array.from(fileList)
    setUploading(true); setUploadProgress({ active: true, files: fileArr.map(f => f.name), current: 0, total: fileArr.length, errors: [] })
    for (let i = 0; i < fileArr.length; i++) {
      setUploadProgress(prev => ({ ...prev, current: i }))
      const file = fileArr[i]; const path = `projects/${projectId}/subs/${projectSubId}/${cf.folder_key}/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('project-docs').upload(path, file)
      if (!error) await supabase.from('project_sub_files').insert({ project_id: projectId, project_sub_id: projectSubId, folder_key: cf.folder_key, file_name: file.name, file_size: file.size, storage_path: path, direction, uploaded_by: profile?.id })
    }
    setUploading(false); setUploadProgress({ active: false, files: fileArr.map(f => f.name), current: fileArr.length, total: fileArr.length, errors: [] })
    loadFiles(); onReload()
  }
  async function deleteFile(file) { await supabase.storage.from('project-docs').remove([file.storage_path]); await supabase.from('project_sub_files').delete().eq('id', file.id); loadFiles(); onReload() }
  function onDrop(e) { e.preventDefault(); e.stopPropagation(); if (!canManage) return; const f = Array.from(e.dataTransfer?.files || []); if (f.length) uploadFiles(f) }
  async function renameFolder() { if (!renameVal.trim()) return; await supabase.from('project_sub_folders').update({ label: renameVal.trim() }).eq('folder_key', cf.folder_key).eq('project_sub_id', projectSubId); setLabel(renameVal.trim()); setRenaming(false) }
  async function addChild() { if (!newSubName.trim()) return; const key = 'sub-' + Date.now(); await supabase.from('project_sub_folders').insert({ project_sub_id: projectSubId, project_id: projectId, parent_key: cf.folder_key, folder_key: key, label: newSubName.trim() }); setNewSubName(''); setShowAddSub(false); loadChildren() }

  return (
    <div style={{ marginLeft: 16 }}>
      <div onClick={() => setOpen(o => !o)} onDragOver={e => e.preventDefault()} onDrop={canManage ? onDrop : undefined}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 5, cursor: 'pointer', background: open ? 'var(--surface2)' : 'transparent', transition: 'background .1s' }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--surface2)' }} onMouseLeave={e => { if (!open) e.currentTarget.style.background = open ? 'var(--surface2)' : 'transparent' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}><polyline points="6 9 12 15 18 9"/></svg>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={folder.color} strokeWidth="1.6" style={{ flexShrink: 0 }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        {renaming ? (
          <input value={renameVal} autoFocus onChange={e => setRenameVal(e.target.value)} onClick={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === 'Enter') renameFolder(); if (e.key === 'Escape') setRenaming(false) }}
            style={{ flex: 1, fontSize: 11, padding: '2px 6px', border: '1px solid var(--accent)', borderRadius: 3 }} />
        ) : (
          <div style={{ flex: 1, fontSize: 11, fontWeight: 500, color: 'var(--text)' }}
            onDoubleClick={e => { if (canManage) { e.stopPropagation(); setRenameVal(label); setRenaming(true) } }}
            title={canManage ? 'Double-click to rename' : ''}>{label}</div>
        )}
        <span style={{ fontSize: 9, color: 'var(--text3)' }}>{files.length || ''}</span>
      </div>
      {open && (
        <div style={{ padding: '4px 8px 8px 32px' }}>
          <UploadProgress uploadState={uploadProgress} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <div style={{ flex: 1 }} />
            {canManage && <button onClick={() => setShowAddSub(true)} style={{ fontSize: 9, padding: '2px 8px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'var(--surface2)', cursor: 'pointer', color: 'var(--text2)', fontFamily: 'inherit' }}>+ Subfolder</button>}
          </div>
          {showAddSub && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input value={newSubName} autoFocus onChange={e => setNewSubName(e.target.value)} placeholder="Subfolder name"
                onKeyDown={e => { if (e.key === 'Enter') addChild(); if (e.key === 'Escape') setShowAddSub(false) }}
                style={{ flex: 1, fontSize: 11, padding: '3px 6px' }} />
              <button className="btn btn-sm btn-primary" onClick={addChild}>Add</button>
              <button className="btn btn-sm" onClick={() => setShowAddSub(false)}>Cancel</button>
            </div>
          )}
          {children.map(ch => <ChildFolder key={ch.folder_key} cf={ch} folder={folder} projectId={projectId} projectSubId={projectSubId} canManage={canManage} viewMode={viewMode} onPreview={onPreview} onReload={() => { loadFiles(); loadChildren(); onReload() }} />)}
          {files.length === 0 && children.length === 0 ? (
            <label onDragOver={e => e.preventDefault()} onDrop={canManage ? onDrop : undefined}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, height: 50, border: '1px dashed var(--border)', borderRadius: 6, cursor: canManage ? 'pointer' : 'default', color: 'var(--text3)', fontSize: 10 }}>
              {canManage ? <>Drop files or click to upload<input type="file" multiple style={{ display: 'none' }} onChange={e => uploadFiles(Array.from(e.target.files))} /></> : 'No files'}
            </label>
          ) : (
            <FilesGrid files={files} viewMode={viewMode} canManage={canManage} onPreview={onPreview} onDelete={deleteFile} selected={selected} onSelect={toggleSelect} onDrop={onDrop} onUpload={uploadFiles} />
          )}
          {canManage && files.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <div style={{ display: 'flex', gap: 0, border: '0.5px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                <button onClick={() => setDirection('sent')} style={{ fontSize: 9, padding: '2px 6px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: direction === 'sent' ? '#448a40' : 'var(--surface)', color: direction === 'sent' ? 'white' : 'var(--text2)' }}>↑ Sent</button>
                <button onClick={() => setDirection('received')} style={{ fontSize: 9, padding: '2px 6px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: direction === 'received' ? '#448a40' : 'var(--surface)', color: direction === 'received' ? 'white' : 'var(--text2)' }}>↓ Received</button>
              </div>
              <label style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: 5, border: '1px dashed var(--border)', borderRadius: 4, fontSize: 10, color: 'var(--text2)', cursor: 'pointer' }}
                onDragOver={e => e.preventDefault()} onDrop={onDrop}>
                {uploading ? 'Uploading...' : '+ Upload'}
                <input type="file" multiple style={{ display: 'none' }} onChange={e => uploadFiles(Array.from(e.target.files))} disabled={uploading} />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────
export default function SubcontractorDocs({ projectId, projectSubId, subFiles, onReload, canManage }) {
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('sub-doc-view') || 'grid')
  const [previewFile, setPreviewFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)

  function setView(mode) { setViewMode(mode); localStorage.setItem('sub-doc-view', mode) }

  async function previewFileAction(file) {
    const { data } = await supabase.storage.from('project-docs').createSignedUrl(file.storage_path, 3600)
    if (data?.signedUrl) { setPreviewFile(file); setPreviewUrl(data.signedUrl) }
  }

  return (
    <div style={{ padding: '10px 16px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 6 }}>
        <ViewToggle viewMode={viewMode} setView={setView} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {SUB_DOC_FOLDERS.map(folder => (
          <FolderSection key={folder.key} folder={folder}
            projectId={projectId} projectSubId={projectSubId}
            canManage={canManage} viewMode={viewMode} onPreview={previewFileAction} onReload={onReload} />
        ))}
      </div>

      {/* Preview modal */}
      {previewFile && previewUrl && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => { setPreviewFile(null); setPreviewUrl(null) }}>
          <div style={{ width: '100%', maxWidth: 900, maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previewFile.file_name}</div>
              <button onClick={async () => { const { data } = await supabase.storage.from('project-docs').createSignedUrl(previewFile.storage_path, 120); if (data?.signedUrl) triggerDownload(data.signedUrl, previewFile.file_name) }}
                style={{ fontSize: 11, padding: '3px 8px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'var(--surface2)', cursor: 'pointer', color: 'var(--text2)', fontFamily: 'inherit' }}>Download</button>
              <button onClick={() => { setPreviewFile(null); setPreviewUrl(null) }}
                style={{ fontSize: 14, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text2)', fontFamily: 'inherit', padding: '2px 6px' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
              {previewFile.file_name.match(/\.(jpg|jpeg|png|gif|webp)$/i)
                ? <img src={previewUrl} alt={previewFile.file_name} style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }} />
                : previewFile.file_name.match(/\.pdf$/i)
                ? <iframe src={previewUrl} style={{ width: '100%', height: '80vh', border: 'none' }} title={previewFile.file_name} />
                : <div style={{ textAlign: 'center', padding: 40, color: 'var(--text3)', fontSize: 13 }}>
                    <div style={{ fontSize: 40, marginBottom: 10 }}>📄</div>Preview not available — click Download to view</div>
              }
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
