import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { formatDate, initials, avatarColor } from '../lib/utils'
import UploadProgress from './UploadProgress'

// ── Constants ────────────────────────────────────────────────
const SUB_DOC_FOLDERS = [
  { key: 'purchase-order',       label: '01. Purchase Order',             icon: '📋', color: '#185FA5', bg: '#E6F1FB' },
  { key: 'payment-applications', label: '02. Payment Applications',      icon: '💰', color: '#854F0B', bg: '#FAEEDA' },
  { key: 'variations',           label: '03. Variations',                icon: '📝', color: '#993C1D', bg: '#FAECE7' },
  { key: 'correspondence',       label: '04. Correspondence',            icon: '✉️',  color: '#534AB7', bg: '#EEEDFE' },
  { key: 'rams',                 label: '05. RAMS & Method Statements',  icon: '📄', color: '#0F6E56', bg: '#E1F5EE' },
  { key: 'other',                label: '06. Other',                     icon: '📁', color: '#888780', bg: '#F1EFE8' },
]

// ── Utilities ────────────────────────────────────────────────
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
    const res = await fetch(signedUrl)
    const blob = await res.blob()
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  } catch { const a = document.createElement('a'); a.href = signedUrl; a.download = fileName; a.click() }
}

// ── File card (grid view) ────────────────────────────────────
function FileCard({ file, canManage, onPreview, onDelete, selected, onSelect }) {
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const ext = fileExt(file.file_name)
  const ec = EXT_COLORS[ext] || { bg: '#F1EFE8', color: '#888780' }
  const isSent = file.direction === 'sent'

  async function renameFile() {
    if (!renameVal.trim() || renameVal.trim() === file.file_name) { setRenaming(false); return }
    await supabase.from('project_sub_files').update({ file_name: renameVal.trim() }).eq('id', file.id)
    file.file_name = renameVal.trim()
    setRenaming(false)
  }

  return (
    <div style={{
      background: 'var(--surface)', border: selected ? '1.5px solid var(--accent)' : '0.5px solid var(--border)',
      borderRadius: 'var(--radius)', padding: '8px 10px', cursor: 'pointer', position: 'relative', transition: 'border-color .1s',
    }}
      onClick={() => onPreview(file)}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border2)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = selected ? 'var(--accent)' : 'var(--border)'}
    >
      {/* Select checkbox */}
      <div style={{ position: 'absolute', top: 6, left: 6 }} onClick={e => { e.stopPropagation(); onSelect(file.id) }}>
        <div style={{ width: 16, height: 16, borderRadius: 3, border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border2)'}`, background: selected ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {selected && <svg width="9" height="9" viewBox="0 0 12 12"><path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>}
        </div>
      </div>
      {/* Direction badge */}
      <div style={{ position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 600, background: isSent ? '#e8f5e7' : '#E6F1FB', color: isSent ? '#448a40' : '#185FA5' }}>
        {isSent ? '↑' : '↓'}
      </div>
      {/* Extension badge */}
      <div style={{ width: '100%', display: 'flex', justifyContent: 'center', marginBottom: 6, marginTop: 4 }}>
        <div style={{ width: 40, height: 40, borderRadius: 6, background: ec.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: ec.color }}>{ext}</div>
      </div>
      {/* Filename */}
      {renaming ? (
        <input value={renameVal} autoFocus onChange={e => setRenameVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') renameFile(); if (e.key === 'Escape') setRenaming(false) }}
          onClick={e => e.stopPropagation()}
          style={{ fontSize: 11, padding: '2px 4px', width: '100%', border: '1px solid var(--accent)', borderRadius: 3, background: 'var(--surface2)', color: 'var(--text)' }} />
      ) : (
        <div style={{ fontSize: 11, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center', color: 'var(--text)' }}
          onDoubleClick={e => { if (canManage) { e.stopPropagation(); setRenameVal(file.file_name); setRenaming(true) } }}
          title={file.file_name}>
          {file.file_name}
        </div>
      )}
      <div style={{ fontSize: 9, color: 'var(--text3)', textAlign: 'center', marginTop: 2 }}>
        {fmtSize(file.file_size)}{file.file_size ? ' · ' : ''}{formatDate(file.created_at)}
      </div>
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
    file.file_name = renameVal.trim()
    setRenaming(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '0.5px solid var(--border)', fontSize: 12, cursor: 'pointer' }}
      onClick={() => onPreview(file)}>
      <div onClick={e => { e.stopPropagation(); onSelect(file.id) }} style={{ cursor: 'pointer' }}>
        <div style={{ width: 16, height: 16, borderRadius: 3, border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border2)'}`, background: selected ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {selected && <svg width="9" height="9" viewBox="0 0 12 12"><path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>}
        </div>
      </div>
      <div style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 600, flexShrink: 0, background: isSent ? '#e8f5e7' : '#E6F1FB', color: isSent ? '#448a40' : '#185FA5' }}>
        {isSent ? '↑' : '↓'}
      </div>
      <div style={{ width: 26, height: 26, borderRadius: 4, background: ec.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: ec.color, flexShrink: 0 }}>{ext}</div>
      {renaming ? (
        <input value={renameVal} autoFocus onChange={e => setRenameVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') renameFile(); if (e.key === 'Escape') setRenaming(false) }}
          onClick={e => e.stopPropagation()}
          style={{ flex: 1, fontSize: 12, padding: '2px 6px', border: '1px solid var(--accent)', borderRadius: 3 }} />
      ) : (
        <div style={{ flex: 1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          onDoubleClick={e => { if (canManage) { e.stopPropagation(); setRenameVal(file.file_name); setRenaming(true) } }}
          title={file.file_name}>{file.file_name}</div>
      )}
      <div style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0, whiteSpace: 'nowrap' }}>{fmtSize(file.file_size)}</div>
      <div style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>{formatDate(file.created_at)}</div>
      {canManage && (
        <button onClick={e => { e.stopPropagation(); onDelete(file) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 11, padding: '2px 4px', fontFamily: 'inherit' }}>✕</button>
      )}
    </div>
  )
}

// ── View toggle ──────────────────────────────────────────────
function ViewToggle({ viewMode, setView }) {
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {[{ mode: 'grid', icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg> },
        { mode: 'list', icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="0" y="1" width="16" height="2.5" rx="1"/><rect x="0" y="5.5" width="16" height="2.5" rx="1"/><rect x="0" y="10" width="16" height="2.5" rx="1"/></svg> }
      ].map(({ mode, icon }) => (
        <button key={mode} onClick={() => setView(mode)}
          style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '0.5px solid ' + (viewMode === mode ? 'var(--accent)' : 'var(--border)'), borderRadius: 4, background: viewMode === mode ? 'var(--accent)' : 'transparent', cursor: 'pointer', color: viewMode === mode ? '#fff' : 'var(--text3)', padding: 0 }}>
          {icon}
        </button>
      ))}
    </div>
  )
}

// ── Folder section (expandable with all features) ────────────
function FolderSection({ folder, files, projectId, projectSubId, canManage, onReload }) {
  const [open, setOpen] = useState(false)
  const [direction, setDirection] = useState('received')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ active: false, files: [], current: 0, total: 0, errors: [] })
  const [selected, setSelected] = useState(new Set())
  const [viewMode, setViewMode] = useState('grid')
  const [previewFile, setPreviewFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const { profile } = useAuth()

  const folderFiles = naturalSort(files.filter(f => f.folder_key === folder.key))
  const count = folderFiles.length

  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

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
    onReload()
  }

  async function onDrop(e) {
    e.preventDefault(); e.stopPropagation(); setDragOver(false)
    const droppedFiles = Array.from(e.dataTransfer?.files || [])
    if (droppedFiles.length) uploadFiles(droppedFiles)
  }

  async function downloadFile(file) {
    const { data } = await supabase.storage.from('project-docs').createSignedUrl(file.storage_path, 120)
    if (data?.signedUrl) triggerDownload(data.signedUrl, file.file_name)
  }

  async function deleteFile(file) {
    await supabase.storage.from('project-docs').remove([file.storage_path])
    await supabase.from('project_sub_files').delete().eq('id', file.id)
    onReload()
  }

  async function previewFileAction(file) {
    const { data } = await supabase.storage.from('project-docs').createSignedUrl(file.storage_path, 3600)
    if (data?.signedUrl) { setPreviewFile(file); setPreviewUrl(data.signedUrl) }
  }

  async function zipFolder() {
    if (!folderFiles.length) return
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    document.head.appendChild(script)
    await new Promise(r => script.onload = r)
    const zip = new window.JSZip()
    const filesToZip = selected.size > 0 ? folderFiles.filter(f => selected.has(f.id)) : folderFiles
    for (const f of filesToZip) {
      const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 300)
      if (data?.signedUrl) {
        const res = await fetch(data.signedUrl)
        zip.file(f.file_name, await res.blob())
      }
    }
    const blob = await zip.generateAsync({ type: 'blob' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = folder.label.replace(/[^a-zA-Z0-9 ]/g, '') + '.zip'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  return (
    <div>
      <div
        onClick={() => setOpen(o => !o)}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={canManage ? onDrop : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
          borderRadius: 6, cursor: 'pointer',
          background: dragOver ? 'var(--accent-light, #e8f5e7)' : open ? 'var(--surface2)' : 'transparent',
          border: dragOver ? '1.5px dashed var(--accent)' : '1.5px solid transparent',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { if (!open && !dragOver) e.currentTarget.style.background = 'var(--surface2)' }}
        onMouseLeave={e => { if (!open && !dragOver) e.currentTarget.style.background = 'transparent' }}
      >
        <div style={{ width: 26, height: 26, borderRadius: 6, background: folder.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>{folder.icon}</div>
        <div style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{folder.label}</div>
        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, fontWeight: 500, background: count > 0 ? folder.bg : 'var(--surface2)', color: count > 0 ? folder.color : 'var(--text3)' }}>{count}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}><polyline points="6 9 12 15 18 9"/></svg>
      </div>

      {open && (
        <div style={{ margin: '4px 0 8px 36px', padding: '8px 12px', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface)' }}>
          <UploadProgress uploadState={uploadProgress} />

          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1, fontSize: 11, color: 'var(--text3)' }}>{count} file{count !== 1 ? 's' : ''}</div>
            {selected.size > 0 && (
              <button onClick={() => setSelected(new Set())} style={{ fontSize: 10, padding: '2px 8px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'var(--surface2)', cursor: 'pointer', color: 'var(--text2)', fontFamily: 'inherit' }}>
                {selected.size} selected · Clear
              </button>
            )}
            {count > 0 && (
              <button onClick={zipFolder} style={{ fontSize: 10, padding: '2px 8px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'var(--surface2)', cursor: 'pointer', color: 'var(--text2)', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
                {selected.size > 0 ? 'Zip selected' : 'Zip all'}
              </button>
            )}
            <ViewToggle viewMode={viewMode} setView={setViewMode} />
          </div>

          {/* Files */}
          {folderFiles.length === 0 ? (
            <label
              onDragOver={e => e.preventDefault()} onDrop={canManage ? onDrop : undefined}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 60, border: '1px dashed var(--border)', borderRadius: 6, cursor: canManage ? 'pointer' : 'default', color: 'var(--text3)', fontSize: 11 }}>
              {canManage ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Drop files here or click to upload
                  <input type="file" multiple style={{ display: 'none' }} onChange={e => uploadFiles(Array.from(e.target.files))} />
                </>
              ) : 'No files'}
            </label>
          ) : viewMode === 'list' ? (
            <div style={{ border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
              {folderFiles.map(f => (
                <FileListRow key={f.id} file={f} canManage={canManage}
                  onPreview={previewFileAction} onDelete={deleteFile}
                  selected={selected.has(f.id)} onSelect={toggleSelect} />
              ))}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
              {folderFiles.map(f => (
                <FileCard key={f.id} file={f} canManage={canManage}
                  onPreview={previewFileAction} onDelete={deleteFile}
                  selected={selected.has(f.id)} onSelect={toggleSelect} />
              ))}
            </div>
          )}

          {/* Upload controls */}
          {canManage && folderFiles.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 0, border: '0.5px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                <button onClick={() => setDirection('sent')}
                  style={{ fontSize: 10, padding: '3px 10px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: direction === 'sent' ? '#448a40' : 'var(--surface)', color: direction === 'sent' ? 'white' : 'var(--text2)' }}>↑ Sent</button>
                <button onClick={() => setDirection('received')}
                  style={{ fontSize: 10, padding: '3px 10px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: direction === 'received' ? '#448a40' : 'var(--surface)', color: direction === 'received' ? 'white' : 'var(--text2)' }}>↓ Received</button>
              </div>
              <label style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8, border: '1px dashed var(--border)', borderRadius: 6, fontSize: 11, color: 'var(--text2)', cursor: 'pointer' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#448a40'; e.currentTarget.style.color = '#448a40' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text2)' }}>
                {uploading ? 'Uploading...' : '+ Upload files'}
                <input type="file" multiple style={{ display: 'none' }} onChange={e => uploadFiles(Array.from(e.target.files))} disabled={uploading} />
              </label>
            </div>
          )}
        </div>
      )}

      {/* File preview modal */}
      {previewFile && previewUrl && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => { setPreviewFile(null); setPreviewUrl(null) }}>
          <div style={{ width: '100%', maxWidth: 900, maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previewFile.file_name}</div>
              <button onClick={() => triggerDownload(previewUrl, previewFile.file_name)}
                style={{ fontSize: 11, padding: '4px 10px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'var(--surface2)', cursor: 'pointer', color: 'var(--text2)', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download
              </button>
              <button onClick={() => { setPreviewFile(null); setPreviewUrl(null) }}
                style={{ fontSize: 14, padding: '4px 8px', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text2)', fontFamily: 'inherit' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
              {previewFile.file_name.match(/\.(jpg|jpeg|png|gif|webp)$/i)
                ? <img src={previewUrl} alt={previewFile.file_name} style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }} />
                : previewFile.file_name.match(/\.pdf$/i)
                ? <iframe src={previewUrl} style={{ width: '100%', height: '80vh', border: 'none' }} title={previewFile.file_name} />
                : <div style={{ textAlign: 'center', padding: 40, color: 'var(--text3)', fontSize: 13 }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>📄</div>
                    <div>Preview not available for this file type</div>
                    <button onClick={() => triggerDownload(previewUrl, previewFile.file_name)}
                      style={{ marginTop: 12, fontSize: 12, padding: '6px 14px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'var(--accent)', color: 'white', cursor: 'pointer', fontFamily: 'inherit' }}>Download to view</button>
                  </div>
              }
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Subcontractor accordion row ──────────────────────────────
function SubAccordion({ ps, files, projectId, canManage, onReload }) {
  const [open, setOpen] = useState(false)
  const subName = ps.subcontractors?.company_name || 'Unknown'
  const trade = ps.trade_on_project || ps.subcontractors?.trade || ''
  const category = ps.category === 'design_team' ? 'Design Team' : 'Contractual Work'
  const col = avatarColor(subName)
  const subFiles = files.filter(f => f.project_sub_id === ps.id)
  const docCount = subFiles.length

  return (
    <div style={{ borderBottom: '0.5px solid var(--border)' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', cursor: 'pointer', transition: 'background 0.1s', background: open ? 'var(--surface2)' : 'transparent' }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--surface2)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = open ? 'var(--surface2)' : 'transparent' }}
      >
        <div style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, flexShrink: 0, background: col.bg, color: col.color }}>
          {initials(subName)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{subName}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{trade} · {category}</div>
        </div>
        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 500, background: docCount > 0 ? '#E6F1FB' : 'var(--surface2)', color: docCount > 0 ? '#185FA5' : 'var(--text3)' }}>
          {docCount} doc{docCount !== 1 ? 's' : ''}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      {open && (
        <div style={{ padding: '4px 14px 12px 56px' }}>
          {SUB_DOC_FOLDERS.map(folder => (
            <FolderSection key={folder.key} folder={folder} files={subFiles}
              projectId={projectId} projectSubId={ps.id} canManage={canManage} onReload={onReload} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────
export default function SubcontractorDocs({ projectId, subs }) {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const { can } = useAuth()
  const canManage = can('manage_projects') || can('manage_documents')

  useEffect(() => { loadFiles() }, [projectId])

  async function loadFiles() {
    setLoading(true)
    const { data } = await supabase.from('project_sub_files').select('*').eq('project_id', projectId).order('created_at', { ascending: false })
    setFiles(data || [])
    setLoading(false)
  }

  if (!subs || subs.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13, padding: 20 }}>
        No subcontractors assigned — assign subcontractors above to manage their documents.
      </div>
    )
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Subcontractor documents</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Click a subcontractor to manage their project documents · Drag & drop files into folders</div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{files.length} total files</div>
      </div>
      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {subs.map(ps => (
          <SubAccordion key={ps.id} ps={ps} files={files} projectId={projectId} canManage={canManage} onReload={loadFiles} />
        ))}
      </div>
    </div>
  )
}
