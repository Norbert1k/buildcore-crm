import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { formatDate } from '../lib/utils'
import UploadProgress from './UploadProgress'

// ── Folder config ────────────────────────────────────────────
const SUB_DOC_FOLDERS = [
  { key: 'purchase-order',       label: '01. Purchase Order',             color: '#185FA5', bg: '#E6F1FB' },
  { key: 'payment-applications', label: '02. Payment Applications',      color: '#854F0B', bg: '#FAEEDA' },
  { key: 'variations',           label: '03. Variations',                color: '#993C1D', bg: '#FAECE7' },
  { key: 'correspondence',       label: '04. Correspondence',            color: '#534AB7', bg: '#EEEDFE' },
  { key: 'rams',                 label: '05. RAMS & Method Statements',  color: '#0F6E56', bg: '#E1F5EE' },
  { key: 'other',                label: '06. Other',                     color: '#888780', bg: '#F1EFE8' },
]

// ── Shared utilities (same as ProjectDocumentation) ──────────
function fmtSize(b) { if (!b) return ''; if (b < 1024) return b + 'B'; if (b < 1048576) return (b / 1024).toFixed(0) + 'KB'; return (b / 1048576).toFixed(1) + 'MB' }
function fileExt(name) { return name?.split('.').pop()?.toUpperCase().slice(0, 4) || 'FILE' }
function naturalSort(arr) { return [...arr].sort((a, b) => (a.file_name || '').localeCompare(b.file_name || '', undefined, { numeric: true, sensitivity: 'base' })) }
async function triggerDownload(signedUrl, fileName) {
  try { const res = await fetch(signedUrl); const blob = await res.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(a.href), 2000) }
  catch { const a = document.createElement('a'); a.href = signedUrl; a.download = fileName; a.click() }
}

async function readDropEntries(e) {
  const items = e.dataTransfer?.items
  if (!items) return { files: Array.from(e.dataTransfer?.files || []).map(f => ({ file: f, path: '' })), folders: [] }
  const entries = []
  for (let i = 0; i < items.length; i++) { const entry = items[i].webkitGetAsEntry?.(); if (entry) entries.push(entry) }
  if (!entries.length) return { files: Array.from(e.dataTransfer?.files || []).map(f => ({ file: f, path: '' })), folders: [] }
  const result = { files: [], folders: new Set() }
  async function walk(entry, path) {
    if (entry.isFile) { const file = await new Promise(r => entry.file(r)); result.files.push({ file, path }); if (path) result.folders.add(path) }
    else if (entry.isDirectory) { const dirPath = path ? path + '/' + entry.name : entry.name; result.folders.add(dirPath); const reader = entry.createReader(); const children = await new Promise(r => reader.readEntries(r)); for (const child of children) await walk(child, dirPath) }
  }
  for (const entry of entries) await walk(entry, '')
  return { files: result.files, folders: [...result.folders] }
}

// ── Button styles (match ProjectDocumentation) ───────────────
const Btn  = { fontSize: 11, lineHeight: '24px', padding: '0 9px', margin: 0, border: '0.5px solid var(--border)', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--text2)', display: 'inline-block', alignSelf: 'center', whiteSpace: 'nowrap', flexShrink: 0 }
const BtnG = { fontSize: 11, lineHeight: '24px', padding: '0 9px', margin: 0, border: '0.5px solid #448a40', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: '#448a40', display: 'inline-block', alignSelf: 'center', whiteSpace: 'nowrap', flexShrink: 0 }
const BtnR = { fontSize: 11, lineHeight: '24px', padding: '0 9px', margin: 0, border: '0.5px solid var(--red-border)', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--red)', display: 'inline-block', alignSelf: 'center', whiteSpace: 'nowrap', flexShrink: 0 }
const PENCIL = <svg width="11" height="11" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="2" width="4" height="16" rx="1" fill="#e53935"/><rect x="10" y="7" width="4" height="4" fill="#FDD835"/><polygon points="10,18 14,18 12,23" fill="#fff"/><rect x="10" y="2" width="4" height="2.5" rx="0.5" fill="#555"/></svg>
const BIN = <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>

function CountBadge({ count }) {
  if (!count) return null
  return <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 8, fontWeight: 500, background: 'var(--accent)', color: '#fff', minWidth: 18, textAlign: 'center', display: 'inline-block' }}>{count}</span>
}

// ── View Toggle ──────────────────────────────────────────────
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
          style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '0.5px solid ' + (viewMode === mode ? 'var(--accent)' : 'var(--border)'), borderRadius: 4, background: viewMode === mode ? 'var(--accent)' : 'transparent', cursor: 'pointer', color: viewMode === mode ? '#fff' : 'var(--text3)', padding: 0, flexShrink: 0 }}>
          {icon}
        </button>
      ))}
    </div>
  )
}

// ── BulkBar ──────────────────────────────────────────────────
function BulkBar({ selected, onZip, onClear }) {
  if (selected.size === 0) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', marginBottom: 8, background: 'var(--accent-light, var(--surface2))', borderRadius: 6, fontSize: 11, border: '0.5px solid var(--accent)' }}>
      <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{selected.size} selected</span>
      <button onClick={onZip} style={{ ...BtnG, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
        Zip selected
      </button>
      <button onClick={onClear} style={Btn}>Clear</button>
    </div>
  )
}

// ── File card (grid/compact view — same as ProjectDocumentation) ─
function FileCard({ file, onPreview, onDelete, canDelete, selected, onSelect, compact }) {
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const ext = fileExt(file.file_name)
  const isSent = file.direction === 'sent'
  async function renameFile() {
    if (!renameVal.trim() || renameVal.trim() === file.file_name) { setRenaming(false); return }
    await supabase.from('project_sub_files').update({ file_name: renameVal.trim() }).eq('id', file.id)
    file.file_name = renameVal.trim(); setRenaming(false)
  }
  return (
    <div draggable onDragStart={e => { e.dataTransfer.setData('text/plain', file.id); e.dataTransfer.effectAllowed = 'move' }}
      style={{ background: 'var(--surface)', border: selected ? '1.5px solid var(--accent)' : '0.5px solid var(--border)', borderRadius: 'var(--radius)', padding: compact ? '6px' : '8px', cursor: 'pointer', position: 'relative', transition: 'border-color .1s' }}
      onClick={() => onPreview(file)} onMouseEnter={e => e.currentTarget.style.borderColor = selected ? 'var(--accent)' : 'var(--border2)'} onMouseLeave={e => e.currentTarget.style.borderColor = selected ? 'var(--accent)' : 'var(--border)'}>
      <div style={{ position: 'absolute', top: 4, left: 4, zIndex: 1 }} onClick={e => { e.stopPropagation(); onSelect(file.id) }}>
        <div style={{ width: 16, height: 16, borderRadius: 3, border: '1.5px solid ' + (selected ? 'var(--accent)' : 'rgba(255,255,255,0.25)'), background: selected ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          {selected && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
        </div>
      </div>
      {/* Direction badge */}
      <div style={{ position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 600, background: isSent ? '#e8f5e7' : '#E6F1FB', color: isSent ? '#448a40' : '#185FA5' }}>{isSent ? '↑' : '↓'}</div>
      <div style={{ textAlign: 'center', marginTop: compact ? 2 : 6, marginBottom: compact ? 4 : 6 }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text3)', marginTop: -4 }}>{ext}</div>
      </div>
      {renaming ? (
        <input value={renameVal} autoFocus onChange={e => setRenameVal(e.target.value)} onClick={e => e.stopPropagation()}
          onKeyDown={e => { if (e.key === 'Enter') renameFile(); if (e.key === 'Escape') setRenaming(false) }}
          style={{ fontSize: 10, padding: '2px 4px', width: '100%', border: '1px solid var(--accent)', borderRadius: 3, background: 'var(--surface2)', color: 'var(--text)' }} />
      ) : (
        <div style={{ fontSize: compact ? 9 : 10, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center', color: 'var(--text)' }}
          onDoubleClick={e => { if (canDelete) { e.stopPropagation(); setRenameVal(file.file_name); setRenaming(true) } }}
          title={file.file_name + (canDelete ? ' — double-click to rename' : '')}>{file.file_name}</div>
      )}
      <div style={{ fontSize: 8, color: 'var(--text3)', textAlign: 'center', marginTop: 2 }}>{fmtSize(file.file_size)}</div>
    </div>
  )
}

// ── FilesGrid ────────────────────────────────────────────────
function FilesGrid({ files, viewMode, onPreview, canManage, onDelete, selected, onSelect, onDrop, onUpload }) {
  if (viewMode === 'list') {
    return (
      <div>
        {files.map(f => {
          const ext = fileExt(f.file_name)
          const isSent = f.direction === 'sent'
          return (
            <div key={f.id} draggable onDragStart={e => { e.dataTransfer.setData('text/plain', f.id); e.dataTransfer.effectAllowed = 'move' }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderBottom: '0.5px solid var(--border)', fontSize: 12, cursor: 'pointer' }}
              onClick={() => onPreview(f)}>
              <div onClick={e => { e.stopPropagation(); onSelect(f.id) }} style={{ cursor: 'pointer' }}>
                <div style={{ width: 16, height: 16, borderRadius: 3, border: '1.5px solid ' + (selected.has(f.id) ? 'var(--accent)' : 'rgba(255,255,255,0.25)'), background: selected.has(f.id) ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {selected.has(f.id) && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                </div>
              </div>
              <div style={{ width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 600, flexShrink: 0, background: isSent ? '#e8f5e7' : '#E6F1FB', color: isSent ? '#448a40' : '#185FA5' }}>{isSent ? '↑' : '↓'}</div>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', width: 30 }}>{ext}</span>
              <span style={{ flex: 1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name}</span>
              <span style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>{fmtSize(f.file_size)}</span>
              <span style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>{formatDate(f.created_at)}</span>
              {canManage && <button onClick={e => { e.stopPropagation(); onDelete(f) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 11, padding: '2px 4px' }}>✕</button>}
            </div>
          )
        })}
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: viewMode === 'compact' ? 'repeat(auto-fill, minmax(110px, 1fr))' : 'repeat(auto-fill, minmax(150px, 1fr))', gap: viewMode === 'compact' ? 6 : 8 }}>
      {files.map(f => <FileCard key={f.id} file={f} onPreview={onPreview} canDelete={canManage} onDelete={onDelete} selected={selected.has(f.id)} onSelect={onSelect} compact={viewMode === 'compact'} />)}
      {canManage && (
        <label onDragOver={e => e.preventDefault()} onDrop={onDrop}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: '0.5px dashed var(--border)', borderRadius: 'var(--radius)', minHeight: viewMode === 'compact' ? 60 : 80, cursor: 'pointer', fontSize: 11, color: 'var(--text3)' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Drop files or click to upload
          <input type="file" multiple style={{ display: 'none' }} onChange={e => onUpload(Array.from(e.target.files))} />
        </label>
      )}
    </div>
  )
}

// ── SubfolderSection (recursive, same layout as ProjectDocumentation) ─
function SubfolderSection({ projectId, projectSubId, folder, subfolder, canManage, viewMode, onPreview, onReload, direction, depth = 0 }) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState([])
  const [childFolders, setChildFolders] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ active: false, files: [], current: 0, total: 0, errors: [] })
  const [selected, setSelected] = useState(new Set())
  const [showAddSub, setShowAddSub] = useState(false)
  const [newSubName, setNewSubName] = useState('')
  const [savingSub, setSavingSub] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const [confirmDelFolder, setConfirmDelFolder] = useState(false)
  const [subLabel, setSubLabel] = useState(subfolder.label)
  const [fileCount, setFileCount] = useState(0)
  const { profile } = useAuth()

  useEffect(() => { loadFileCount() }, [])
  useEffect(() => { if (open) { loadFiles(); loadChildFolders() } }, [open])

  async function loadFileCount() {
    const { count } = await supabase.from('project_sub_files').select('id', { count: 'exact', head: true }).eq('project_sub_id', projectSubId).eq('folder_key', subfolder.key)
    setFileCount(count || 0)
  }
  async function loadFiles() {
    const { data } = await supabase.from('project_sub_files').select('*').eq('project_sub_id', projectSubId).eq('folder_key', subfolder.key).order('created_at', { ascending: false })
    setFiles(naturalSort(data || [])); setFileCount((data || []).length)
  }
  async function loadChildFolders() {
    const { data } = await supabase.from('project_sub_folders').select('*').eq('project_sub_id', projectSubId).eq('parent_key', subfolder.key).order('created_at')
    setChildFolders(data || [])
  }
  async function uploadFiles(fileList) {
    if (!fileList.length) return; const fileArr = Array.from(fileList); setUploading(true)
    setUploadProgress({ active: true, files: fileArr.map(f => f.name), current: 0, total: fileArr.length, errors: [] })
    const errors = []
    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i]; setUploadProgress(prev => ({ ...prev, current: i }))
      const path = `projects/${projectId}/subs/${projectSubId}/${subfolder.key}/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('project-docs').upload(path, file)
      if (!error) await supabase.from('project_sub_files').insert({ project_id: projectId, project_sub_id: projectSubId, folder_key: subfolder.key, file_name: file.name, file_size: file.size, storage_path: path, direction: direction || 'received', uploaded_by: profile?.id })
      else errors.push(file.name)
    }
    setUploading(false); setUploadProgress({ active: false, files: fileArr.map(f => f.name), current: fileArr.length, total: fileArr.length, errors }); loadFiles(); if (onReload) onReload()
  }
  async function deleteFile(f) { await supabase.storage.from('project-docs').remove([f.storage_path]); await supabase.from('project_sub_files').delete().eq('id', f.id); setFiles(prev => prev.filter(x => x.id !== f.id)) }
  async function addChildFolder() { if (!newSubName.trim()) return; setSavingSub(true); const key = subfolder.key + '-sub-' + Date.now(); await supabase.from('project_sub_folders').insert({ project_id: projectId, project_sub_id: projectSubId, parent_key: subfolder.key, folder_key: key, label: newSubName.trim() }); setNewSubName(''); setShowAddSub(false); setSavingSub(false); loadChildFolders() }
  async function renameFolder() { if (!renameVal.trim()) return; await supabase.from('project_sub_folders').update({ label: renameVal.trim() }).eq('folder_key', subfolder.key).eq('project_sub_id', projectSubId); setSubLabel(renameVal.trim()); setRenaming(false) }
  async function deleteFolder() { await supabase.from('project_sub_folders').delete().eq('folder_key', subfolder.key).eq('project_sub_id', projectSubId); if (onReload) onReload('__folder_deleted__') }
  async function zipSubfolder() {
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; document.head.appendChild(s); await new Promise(r => s.onload = r)
    const zip = new window.JSZip(); const filesToZip = selected.size > 0 ? files.filter(f => selected.has(f.id)) : files
    for (const f of filesToZip) { const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 300); if (data?.signedUrl) { const res = await fetch(data.signedUrl); zip.file(f.file_name, await res.blob()) } }
    const blob = await zip.generateAsync({ type: 'blob' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = subLabel + '.zip'; document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  async function onDrop(e) {
    e.preventDefault(); e.stopPropagation(); if (!canManage) return
    const id = e.dataTransfer.getData('text/plain')
    if (id && !id.includes('/')) { await supabase.from('project_sub_files').update({ folder_key: subfolder.key }).eq('id', id); loadFiles(); if (onReload) onReload(id); return }
    const drop = await readDropEntries(e)
    if (drop.folders.length > 0) {
      const keyMap = {}
      for (const fp of drop.folders.sort()) {
        const parts = fp.split('/'); const label = parts[parts.length - 1]; const parentPath = parts.slice(0, -1).join('/'); const parentKey = parentPath ? keyMap[parentPath] : subfolder.key
        const key = (parentKey || subfolder.key) + '-sub-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); keyMap[fp] = key
        await supabase.from('project_sub_folders').insert({ project_id: projectId, project_sub_id: projectSubId, parent_key: parentKey || subfolder.key, folder_key: key, label })
      }
      for (const { file, path } of drop.files) {
        const sfKey = path ? keyMap[path] : subfolder.key; const storagePath = `projects/${projectId}/subs/${projectSubId}/${sfKey}/${Date.now()}-${file.name}`
        const { error } = await supabase.storage.from('project-docs').upload(storagePath, file)
        if (!error) await supabase.from('project_sub_files').insert({ project_id: projectId, project_sub_id: projectSubId, folder_key: sfKey, file_name: file.name, file_size: file.size, storage_path: storagePath, direction: direction || 'received' })
      }
      loadChildFolders(); loadFiles()
    } else { const f = drop.files.map(x => x.file); if (f.length) uploadFiles(f) }
  }

  function toggleSelect(id) { setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  const isCustom = subfolder.custom === true

  return (
    <div style={{ marginBottom: 2 }}>
      <UploadProgress uploadState={uploadProgress} />
      <div
        draggable={isCustom && !renaming}
        onDragStart={e => { if (!isCustom) return; e.stopPropagation(); e.dataTransfer.setData('subfolder', subfolder.key); e.dataTransfer.effectAllowed = 'move' }}
        onClick={() => setOpen(o => !o)} onDragOver={e => e.preventDefault()} onDrop={onDrop}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', paddingLeft: 10 + depth * 12, borderRadius: 6, cursor: 'pointer', background: open ? 'var(--surface2)' : 'transparent', transition: 'background .1s' }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--surface2)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent' }}>
        <div style={{ width: 24, height: 24, borderRadius: 5, background: isCustom ? '#F1EFE8' : folder.color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {isCustom ? <span style={{ fontSize: 13 }}>📁</span> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={folder.color} strokeWidth="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>}
        </div>
        {renaming
          ? <input value={renameVal} autoFocus onChange={e => setRenameVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') renameFolder(); if (e.key === 'Escape') setRenaming(false) }} onClick={e => e.stopPropagation()} style={{ flex: 1, fontSize: 12, padding: '2px 8px', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text)' }} />
          : <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{subLabel}</span>
        }
        <span style={{ fontSize: 10, color: 'var(--text3)' }}>{open && (files.length + childFolders.length) > 0 ? (files.length + childFolders.length) + ' items' : ''}</span>
        {!open && <CountBadge count={fileCount} />}
        {canManage && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={e => e.stopPropagation()}>
            {!renaming && <>
              {isCustom && <>
                <button onClick={() => { setRenameVal(subLabel); setRenaming(true) }} style={Btn} title="Rename">{PENCIL}</button>
                {confirmDelFolder ? <><button onClick={deleteFolder} style={BtnR}>Confirm</button><button onClick={() => setConfirmDelFolder(false)} style={Btn}>✕</button></> : <button onClick={() => setConfirmDelFolder(true)} style={BtnR} title="Delete">{BIN}</button>}
              </>}
              <button onClick={zipSubfolder} style={{ ...Btn, display: 'inline-flex', alignItems: 'center', gap: 3 }} title="Zip">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>Zip
              </button>
              {showAddSub ? <>
                <input value={newSubName} onChange={e => setNewSubName(e.target.value)} placeholder="Name" autoFocus onKeyDown={e => { if (e.key === 'Enter') addChildFolder(); if (e.key === 'Escape') setShowAddSub(false) }} style={{ fontSize: 11, lineHeight: '24px', padding: '0 6px', border: '0.5px solid var(--border)', borderRadius: 5, background: 'var(--surface2)', color: 'var(--text)', width: 90 }} />
                <button onClick={addChildFolder} disabled={savingSub} style={BtnG}>{savingSub ? '...' : 'Add'}</button>
                <button onClick={() => { setShowAddSub(false); setNewSubName('') }} style={Btn}>✕</button>
              </> : <button onClick={() => setShowAddSub(true)} style={Btn}>+ Sub</button>}
            </>}
            <label style={BtnG}>{uploading ? '...' : '+ Upload'}<input type="file" multiple style={{ display: 'none' }} onChange={e => uploadFiles(Array.from(e.target.files))} /></label>
          </div>
        )}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0, marginLeft: 2 }}><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      {open && (
        <div onDragOver={e => e.preventDefault()} onDrop={onDrop}
          style={{ marginLeft: 14 + depth * 12, paddingLeft: 10, borderLeft: '1.5px solid ' + folder.color + '30', paddingTop: 6, paddingBottom: 6 }}>
          <BulkBar selected={selected} onZip={zipSubfolder} onClear={() => setSelected(new Set())} />
          {childFolders.map(cf => (
            <SubfolderSection key={cf.folder_key} projectId={projectId} projectSubId={projectSubId} folder={folder}
              subfolder={{ key: cf.folder_key, label: cf.label, custom: true }} canManage={canManage} viewMode={viewMode} onPreview={onPreview} direction={direction}
              onReload={id => { if (id === '__folder_deleted__') loadChildFolders(); else setFiles(prev => prev.filter(f => f.id !== id)) }} depth={depth + 1} />
          ))}
          {files.length === 0 && childFolders.length === 0 ? (
            <label onDragOver={e => e.preventDefault()} onDrop={onDrop}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 50, border: '0.5px dashed var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text3)', fontSize: 11 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Drop files or click to upload
              <input type="file" multiple style={{ display: 'none' }} onChange={e => uploadFiles(Array.from(e.target.files))} />
            </label>
          ) : (
            <FilesGrid files={files} viewMode={viewMode} onPreview={onPreview} canManage={canManage} onDelete={deleteFile} selected={selected} onSelect={toggleSelect} onDrop={onDrop} onUpload={uploadFiles} />
          )}
        </div>
      )}
    </div>
  )
}

// ── PrimeFolder (top-level folder — matches PrimeFolderSection design) ─
function PrimeFolder({ folder, projectId, projectSubId, canManage, viewMode, setView, onPreview, onReload, direction }) {
  const [open, setOpen] = useState(false)
  const [subfolders, setSubfolders] = useState([])
  const [showAddFolder, setShowAddFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [savingFolder, setSavingFolder] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ active: false, files: [], current: 0, total: 0, errors: [] })
  const [files, setFiles] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [fileCount, setFileCount] = useState(0)
  const { profile } = useAuth()

  useEffect(() => { loadCustomSubfolders(); loadFileCount() }, [])
  useEffect(() => { if (open) loadRootFiles() }, [open])

  async function loadFileCount() {
    const { count } = await supabase.from('project_sub_files').select('id', { count: 'exact', head: true }).eq('project_sub_id', projectSubId).eq('folder_key', folder.key)
    setFileCount(count || 0)
  }
  async function loadCustomSubfolders() {
    const { data } = await supabase.from('project_sub_folders').select('*').eq('project_sub_id', projectSubId).eq('parent_key', folder.key).order('created_at')
    setSubfolders((data || []).map(d => ({ key: d.folder_key, label: d.label, custom: true })))
  }
  async function loadRootFiles() {
    const { data } = await supabase.from('project_sub_files').select('*').eq('project_sub_id', projectSubId).eq('folder_key', folder.key).order('created_at', { ascending: false })
    setFiles(naturalSort(data || [])); setFileCount((data || []).length)
  }
  async function addCustomSubfolder() {
    if (!newFolderName.trim()) return; setSavingFolder(true)
    const key = folder.key + '-custom-' + Date.now()
    await supabase.from('project_sub_folders').insert({ project_id: projectId, project_sub_id: projectSubId, parent_key: folder.key, folder_key: key, label: newFolderName.trim() })
    setSubfolders(prev => [...prev, { key, label: newFolderName.trim(), custom: true }]); setNewFolderName(''); setShowAddFolder(false); setSavingFolder(false)
  }
  async function uploadToFolder(fileList) {
    if (!fileList.length) return; const fileArr = Array.from(fileList); setUploading(true)
    setUploadProgress({ active: true, files: fileArr.map(f => f.name), current: 0, total: fileArr.length, errors: [] })
    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i]; setUploadProgress(prev => ({ ...prev, current: i }))
      const path = `projects/${projectId}/subs/${projectSubId}/${folder.key}/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('project-docs').upload(path, file)
      if (!error) await supabase.from('project_sub_files').insert({ project_id: projectId, project_sub_id: projectSubId, folder_key: folder.key, file_name: file.name, file_size: file.size, storage_path: path, direction: direction || 'received', uploaded_by: profile?.id })
    }
    setUploading(false); setUploadProgress({ active: false, files: fileArr.map(f => f.name), current: fileArr.length, total: fileArr.length, errors: [] }); loadRootFiles(); onReload()
  }
  async function deleteFile(f) { await supabase.storage.from('project-docs').remove([f.storage_path]); await supabase.from('project_sub_files').delete().eq('id', f.id); setFiles(prev => prev.filter(x => x.id !== f.id)) }
  async function zipFolder() {
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; document.head.appendChild(s); await new Promise(r => s.onload = r)
    const zip = new window.JSZip()
    const { data: allFiles } = await supabase.from('project_sub_files').select('*').eq('project_sub_id', projectSubId).eq('folder_key', folder.key)
    if (!allFiles?.length) { alert('No files in this folder.'); return }
    for (const f of allFiles) { const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 300); if (data?.signedUrl) { const res = await fetch(data.signedUrl); zip.file(f.file_name, await res.blob()) } }
    const blob = await zip.generateAsync({ type: 'blob' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = folder.label + '.zip'; document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }
  async function bulkZip() {
    const chosen = files.filter(f => selected.has(f.id)); if (!chosen.length) return
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; document.head.appendChild(s); await new Promise(r => s.onload = r)
    const zip = new window.JSZip()
    for (const f of chosen) { const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 120); if (data?.signedUrl) { const res = await fetch(data.signedUrl); zip.file(f.file_name, await res.blob()) } }
    const blob = await zip.generateAsync({ type: 'blob' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = folder.label + '-selected.zip'; document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  async function onDropFolder(e) {
    e.preventDefault(); e.stopPropagation(); if (!canManage) return
    const drop = await readDropEntries(e)
    if (drop.folders.length > 0) {
      const keyMap = {}
      for (const fp of drop.folders.sort()) {
        const parts = fp.split('/'); const label = parts[parts.length - 1]; const parentPath = parts.slice(0, -1).join('/'); const parentKey = parentPath ? keyMap[parentPath] : folder.key
        const key = (parentKey || folder.key) + '-custom-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); keyMap[fp] = key
        await supabase.from('project_sub_folders').insert({ project_id: projectId, project_sub_id: projectSubId, parent_key: parentKey || folder.key, folder_key: key, label })
      }
      for (const { file, path } of drop.files) {
        const sfKey = path ? keyMap[path] : null; const storagePath = `projects/${projectId}/subs/${projectSubId}/${folder.key}/${Date.now()}-${file.name}`
        const { error } = await supabase.storage.from('project-docs').upload(storagePath, file)
        if (!error) await supabase.from('project_sub_files').insert({ project_id: projectId, project_sub_id: projectSubId, folder_key: sfKey || folder.key, file_name: file.name, file_size: file.size, storage_path: storagePath, direction: direction || 'received' })
      }
      loadCustomSubfolders(); loadRootFiles()
    } else { const f = drop.files.map(x => x.file); if (f.length) uploadToFolder(f) }
  }

  function toggleSelect(id) { setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }) }

  return (
    <div style={{ marginBottom: 12 }}>
      <UploadProgress uploadState={uploadProgress} />
      {/* Folder header — exact same design as ProjectDocumentation */}
      <div onClick={() => setOpen(o => !o)} onDragOver={e => e.preventDefault()} onDrop={onDropFolder}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8, cursor: 'pointer', borderLeft: `3px solid ${folder.color}`, background: open ? 'var(--surface2)' : 'var(--surface)', border: '0.5px solid var(--border)', borderLeftWidth: 3, borderLeftColor: folder.color, transition: 'background 0.1s' }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: folder.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={folder.color} strokeWidth="1.6"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{folder.label}</div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>
            {subfolders.length > 0 ? `${subfolders.length} sub-folder${subfolders.length !== 1 ? 's' : ''}` : ''}
            {fileCount > 0 ? `${subfolders.length > 0 ? ' · ' : ''}${fileCount} file${fileCount !== 1 ? 's' : ''}` : ''}
            {subfolders.length === 0 && fileCount === 0 ? 'Empty' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {showAddFolder ? (
            <>
              <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="Subfolder name" autoFocus
                onKeyDown={e => { if (e.key === 'Enter') addCustomSubfolder(); if (e.key === 'Escape') setShowAddFolder(false) }}
                style={{ fontSize: 11, lineHeight: '24px', padding: '0 8px', border: '0.5px solid var(--border)', borderRadius: 5, background: 'var(--surface2)', color: 'var(--text)', width: 130 }} />
              <button onClick={addCustomSubfolder} disabled={savingFolder} style={BtnG}>{savingFolder ? '...' : 'Add'}</button>
              <button onClick={() => { setShowAddFolder(false); setNewFolderName('') }} style={Btn}>✕</button>
            </>
          ) : (
            <>
              <button onClick={() => zipFolder()} style={{ ...Btn, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>Zip all
              </button>
              {canManage && <button onClick={() => setShowAddFolder(true)} style={Btn}>+ Subfolder</button>}
              {canManage && <label style={BtnG}>{uploading ? '...' : '+ Upload'}<input type="file" multiple style={{ display: 'none' }} onChange={e => uploadToFolder(Array.from(e.target.files))} /></label>}
              {open && <ViewToggle viewMode={viewMode} setView={setView} />}
            </>
          )}
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', marginLeft: 4, flexShrink: 0 }}><polyline points="6 9 12 15 18 9"/></svg>
      </div>

      {/* Folder body */}
      {open && (
        <div onDragOver={e => e.preventDefault()} onDrop={onDropFolder}
          style={{ marginLeft: 16, paddingLeft: 12, borderLeft: `1.5px solid ${folder.color}30`, paddingTop: 8, paddingBottom: 8 }}>
          <BulkBar selected={selected} onZip={bulkZip} onClear={() => setSelected(new Set())} />
          {subfolders.map(sf => (
            <SubfolderSection key={sf.key} projectId={projectId} projectSubId={projectSubId} folder={folder} subfolder={sf}
              canManage={canManage} viewMode={viewMode} onPreview={onPreview} direction={direction}
              onReload={id => { if (id === '__folder_deleted__') loadCustomSubfolders(); else { loadRootFiles() } }} />
          ))}
          {files.length === 0 && subfolders.length === 0 ? (
            <label onDragOver={e => e.preventDefault()} onDrop={onDropFolder}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 50, border: '0.5px dashed var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text3)', fontSize: 11 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Drop files or click to upload
              <input type="file" multiple style={{ display: 'none' }} onChange={e => uploadToFolder(Array.from(e.target.files))} />
            </label>
          ) : (
            <FilesGrid files={files} viewMode={viewMode} onPreview={onPreview} canManage={canManage} onDelete={deleteFile} selected={selected} onSelect={toggleSelect} onDrop={onDropFolder} onUpload={uploadToFolder} />
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────
export default function SubcontractorDocs({ projectId, projectSubId, subFiles, onReload, canManage }) {
  const [viewMode, setViewMode] = useState(() => { try { return localStorage.getItem('subDocView') || 'grid' } catch { return 'grid' } })
  const [direction, setDirection] = useState('received')
  const [previewFile, setPreviewFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)

  function setView(mode) { setViewMode(mode); try { localStorage.setItem('subDocView', mode) } catch {} }

  async function previewFileAction(file) {
    const { data } = await supabase.storage.from('project-docs').createSignedUrl(file.storage_path, 3600)
    if (data?.signedUrl) { setPreviewFile(file); setPreviewUrl(data.signedUrl) }
  }

  return (
    <div style={{ padding: '10px 16px 14px' }}>
      {/* Direction toggle */}
      {canManage && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>Upload direction:</span>
          <div style={{ display: 'flex', gap: 0, border: '0.5px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}>
            <button onClick={() => setDirection('sent')} style={{ fontSize: 11, padding: '4px 12px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: direction === 'sent' ? '#448a40' : 'var(--surface)', color: direction === 'sent' ? 'white' : 'var(--text2)' }}>↑ Sent to them</button>
            <button onClick={() => setDirection('received')} style={{ fontSize: 11, padding: '4px 12px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: direction === 'received' ? '#448a40' : 'var(--surface)', color: direction === 'received' ? 'white' : 'var(--text2)' }}>↓ Received from them</button>
          </div>
        </div>
      )}

      {SUB_DOC_FOLDERS.map(folder => (
        <PrimeFolder key={folder.key} folder={folder} projectId={projectId} projectSubId={projectSubId}
          canManage={canManage} viewMode={viewMode} setView={setView} onPreview={previewFileAction} onReload={onReload} direction={direction} />
      ))}

      {/* Preview modal */}
      {previewFile && previewUrl && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => { setPreviewFile(null); setPreviewUrl(null) }}>
          <div style={{ width: '100%', maxWidth: 900, maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previewFile.file_name}</div>
              <button onClick={async () => { const { data } = await supabase.storage.from('project-docs').createSignedUrl(previewFile.storage_path, 120); if (data?.signedUrl) triggerDownload(data.signedUrl, previewFile.file_name) }}
                style={{ fontSize: 11, padding: '3px 8px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'var(--surface2)', cursor: 'pointer', color: 'var(--text2)', fontFamily: 'inherit' }}>Download</button>
              <button onClick={() => { setPreviewFile(null); setPreviewUrl(null) }} style={{ fontSize: 14, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text2)', fontFamily: 'inherit', padding: '2px 6px' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
              {previewFile.file_name.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? <img src={previewUrl} alt={previewFile.file_name} style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }} />
                : previewFile.file_name.match(/\.pdf$/i) ? <iframe src={previewUrl} style={{ width: '100%', height: '80vh', border: 'none' }} title={previewFile.file_name} />
                : <div style={{ textAlign: 'center', padding: 40, color: 'var(--text3)', fontSize: 13 }}><div style={{ fontSize: 40, marginBottom: 10 }}>📄</div>Preview not available — click Download to view</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
