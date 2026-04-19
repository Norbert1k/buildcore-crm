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

const EXT_COLORS = {
  PDF: { bg: '#FCEBEB', color: '#A32D2D' }, XLSX: { bg: '#E1F5EE', color: '#0F6E56' }, XLS: { bg: '#E1F5EE', color: '#0F6E56' },
  DOC: { bg: '#E6F1FB', color: '#185FA5' }, DOCX: { bg: '#E6F1FB', color: '#185FA5' },
  JPG: { bg: '#FAEEDA', color: '#854F0B' }, JPEG: { bg: '#FAEEDA', color: '#854F0B' }, PNG: { bg: '#FAEEDA', color: '#854F0B' },
  DWG: { bg: '#EEEDFE', color: '#534AB7' }, CSV: { bg: '#E1F5EE', color: '#0F6E56' },
}

// ── Folder section ───────────────────────────────────────────
function FolderSection({ folder, files, projectId, projectSubId, canManage, onReload }) {
  const [open, setOpen] = useState(false)
  const [direction, setDirection] = useState('received')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ active: false, files: [], current: 0, total: 0, errors: [] })
  const [previewFile, setPreviewFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const { profile } = useAuth()

  const folderFiles = files.filter(f => f.folder_key === folder.key)
    .sort((a, b) => (a.file_name || '').localeCompare(b.file_name || '', undefined, { numeric: true, sensitivity: 'base' }))
  const count = folderFiles.length

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

  function onDrop(e) {
    e.preventDefault(); e.stopPropagation(); setDragOver(false)
    if (!canManage) return
    const droppedFiles = Array.from(e.dataTransfer?.files || [])
    if (droppedFiles.length) uploadFiles(droppedFiles)
  }

  async function downloadFile(file) {
    const { data } = await supabase.storage.from('project-docs').createSignedUrl(file.storage_path, 120)
    if (data?.signedUrl) {
      try {
        const res = await fetch(data.signedUrl); const blob = await res.blob()
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.file_name
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(a.href), 2000)
      } catch { window.open(data.signedUrl, '_blank') }
    }
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

  async function renameFile(file, newName) {
    if (!newName.trim() || newName.trim() === file.file_name) return
    await supabase.from('project_sub_files').update({ file_name: newName.trim() }).eq('id', file.id)
    onReload()
  }

  async function zipFolder() {
    if (!folderFiles.length) return
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    document.head.appendChild(script)
    await new Promise(r => script.onload = r)
    const zip = new window.JSZip()
    for (const f of folderFiles) {
      const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 300)
      if (data?.signedUrl) { const res = await fetch(data.signedUrl); zip.file(f.file_name, await res.blob()) }
    }
    const blob = await zip.generateAsync({ type: 'blob' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = folder.label.replace(/[^a-zA-Z0-9 ]/g, '').trim() + '.zip'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  return (
    <div>
      <div
        onClick={() => setOpen(o => !o)}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 5, cursor: 'pointer',
          background: dragOver ? 'var(--accent-light, #e8f5e7)' : open ? 'var(--surface)' : 'transparent',
          border: dragOver ? '1px dashed var(--accent)' : '1px solid transparent', transition: 'background .1s',
        }}
        onMouseEnter={e => { if (!open && !dragOver) e.currentTarget.style.background = 'var(--surface)' }}
        onMouseLeave={e => { if (!open && !dragOver) e.currentTarget.style.background = open ? 'var(--surface)' : 'transparent' }}
      >
        <div style={{ width: 22, height: 22, borderRadius: 5, background: folder.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>{folder.icon}</div>
        <div style={{ flex: 1, fontSize: 11, fontWeight: 500, color: 'var(--text)' }}>{folder.label}</div>
        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, fontWeight: 500, background: count > 0 ? folder.bg : 'transparent', color: count > 0 ? folder.color : 'var(--text3)' }}>{count}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2.5"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}><polyline points="6 9 12 15 18 9"/></svg>
      </div>

      {open && (
        <div style={{ margin: '2px 0 6px 30px', padding: '6px 10px', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface)' }}>
          <UploadProgress uploadState={uploadProgress} />

          {/* Toolbar */}
          {count > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <div style={{ flex: 1, fontSize: 10, color: 'var(--text3)' }}>{count} file{count !== 1 ? 's' : ''}</div>
              <button onClick={zipFolder} style={{ fontSize: 9, padding: '2px 6px', border: '0.5px solid var(--border)', borderRadius: 3, background: 'var(--surface2)', cursor: 'pointer', color: 'var(--text2)', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
                Zip
              </button>
            </div>
          )}

          {/* Files list */}
          {folderFiles.length === 0 ? (
            <label onDragOver={e => e.preventDefault()} onDrop={canManage ? onDrop : undefined}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, border: '1px dashed var(--border)', borderRadius: 5, cursor: canManage ? 'pointer' : 'default', color: 'var(--text3)', fontSize: 10 }}>
              {canManage ? <>Drop files or click to upload<input type="file" multiple style={{ display: 'none' }} onChange={e => uploadFiles(Array.from(e.target.files))} /></> : 'No files'}
            </label>
          ) : (
            <div>
              {folderFiles.map(f => (
                <FileRow key={f.id} file={f} canManage={canManage} onDownload={() => downloadFile(f)} onDelete={() => deleteFile(f)} onPreview={() => previewFileAction(f)} onRename={renameFile} />
              ))}
            </div>
          )}

          {/* Upload bar */}
          {canManage && count > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <div style={{ display: 'flex', gap: 0, border: '0.5px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                <button onClick={() => setDirection('sent')} style={{ fontSize: 9, padding: '2px 8px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: direction === 'sent' ? '#448a40' : 'var(--surface)', color: direction === 'sent' ? 'white' : 'var(--text2)' }}>↑ Sent</button>
                <button onClick={() => setDirection('received')} style={{ fontSize: 9, padding: '2px 8px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: direction === 'received' ? '#448a40' : 'var(--surface)', color: direction === 'received' ? 'white' : 'var(--text2)' }}>↓ Received</button>
              </div>
              <label style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: 6, border: '1px dashed var(--border)', borderRadius: 4, fontSize: 10, color: 'var(--text2)', cursor: 'pointer' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#448a40'; e.currentTarget.style.color = '#448a40' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text2)' }}>
                {uploading ? 'Uploading...' : '+ Upload'}
                <input type="file" multiple style={{ display: 'none' }} onChange={e => uploadFiles(Array.from(e.target.files))} disabled={uploading} />
              </label>
            </div>
          )}
        </div>
      )}

      {/* Preview modal */}
      {previewFile && previewUrl && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => { setPreviewFile(null); setPreviewUrl(null) }}>
          <div style={{ width: '100%', maxWidth: 900, maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previewFile.file_name}</div>
              <button onClick={() => downloadFile(previewFile)} style={{ fontSize: 11, padding: '3px 8px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'var(--surface2)', cursor: 'pointer', color: 'var(--text2)', fontFamily: 'inherit' }}>Download</button>
              <button onClick={() => { setPreviewFile(null); setPreviewUrl(null) }} style={{ fontSize: 14, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text2)', fontFamily: 'inherit', padding: '2px 6px' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
              {previewFile.file_name.match(/\.(jpg|jpeg|png|gif|webp)$/i)
                ? <img src={previewUrl} alt={previewFile.file_name} style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }} />
                : previewFile.file_name.match(/\.pdf$/i)
                ? <iframe src={previewUrl} style={{ width: '100%', height: '80vh', border: 'none' }} title={previewFile.file_name} />
                : <div style={{ textAlign: 'center', padding: 40, color: 'var(--text3)', fontSize: 13 }}>
                    <div style={{ fontSize: 40, marginBottom: 10 }}>📄</div>
                    Preview not available — <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => downloadFile(previewFile)}>download to view</span>
                  </div>
              }
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── File row ─────────────────────────────────────────────────
function FileRow({ file, canManage, onDownload, onDelete, onPreview, onRename }) {
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const ext = fileExt(file.file_name)
  const ec = EXT_COLORS[ext] || { bg: '#F1EFE8', color: '#888780' }
  const isSent = file.direction === 'sent'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderBottom: '0.5px solid var(--border)', fontSize: 11 }}>
      <div style={{ width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 600, flexShrink: 0, background: isSent ? '#e8f5e7' : '#E6F1FB', color: isSent ? '#448a40' : '#185FA5' }}>
        {isSent ? '↑' : '↓'}
      </div>
      <div style={{ width: 22, height: 22, borderRadius: 3, background: ec.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: ec.color, flexShrink: 0 }}>{ext}</div>
      {renaming ? (
        <input value={renameVal} autoFocus onChange={e => setRenameVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { onRename(file, renameVal); setRenaming(false) } if (e.key === 'Escape') setRenaming(false) }}
          onClick={e => e.stopPropagation()}
          style={{ flex: 1, fontSize: 11, padding: '1px 4px', border: '1px solid var(--accent)', borderRadius: 3, background: 'var(--surface)', color: 'var(--text)' }} />
      ) : (
        <div style={{ flex: 1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', color: 'var(--text)' }}
          onClick={onPreview}
          onDoubleClick={e => { if (canManage) { e.stopPropagation(); setRenameVal(file.file_name); setRenaming(true) } }}
          title={file.file_name + (canManage ? ' — double-click to rename' : '')}>{file.file_name}</div>
      )}
      <div style={{ fontSize: 9, color: 'var(--text3)', flexShrink: 0 }}>{fmtSize(file.file_size)}</div>
      <div style={{ fontSize: 9, color: 'var(--text3)', flexShrink: 0 }}>{formatDate(file.created_at)}</div>
      <button onClick={onDownload} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px', color: 'var(--text2)', fontFamily: 'inherit' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>
      {canManage && (
        <button onClick={onDelete} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px', color: 'var(--red)', fontFamily: 'inherit', fontSize: 10 }}>✕</button>
      )}
    </div>
  )
}

// ── Main inline component ────────────────────────────────────
export default function SubcontractorDocs({ projectId, projectSubId, subFiles, onReload, canManage }) {
  return (
    <div style={{ padding: '10px 16px 14px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {SUB_DOC_FOLDERS.map(folder => (
          <FolderSection key={folder.key} folder={folder} files={subFiles} projectId={projectId} projectSubId={projectSubId} canManage={canManage} onReload={onReload} />
        ))}
      </div>
    </div>
  )
}
