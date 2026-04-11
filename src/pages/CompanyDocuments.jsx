import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { formatDate } from '../lib/utils'
import { Spinner } from '../components/ui'

const CATEGORIES = [
  { key: 'logo',           icon: '🏢', label: 'Logo & Branding',   color: '#448a40', bg: '#e8f5e7' },
  { key: 'policies',       icon: '📋', label: 'Policies',           color: '#378ADD', bg: '#E6F1FB' },
  { key: 'insurance',      icon: '🛡️', label: 'Insurance',          color: '#BA7517', bg: '#FAEEDA' },
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

// Shared button styles — guarantees identical sizing across button and label elements
const BTN = { fontSize: 11, lineHeight: '24px', padding: '0 9px', margin: 0, border: '0.5px solid var(--border)', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--text2)', display: 'inline-block', alignSelf: 'center', whiteSpace: 'nowrap', flexShrink: 0 }
const BTN_GREEN = { fontSize: 11, lineHeight: '24px', padding: '0 9px', margin: 0, border: '0.5px solid #448a40', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: '#448a40', display: 'inline-block', alignSelf: 'center', whiteSpace: 'nowrap', flexShrink: 0 }
const BTN_RED = { fontSize: 11, lineHeight: '24px', padding: '0 9px', margin: 0, border: '0.5px solid var(--red-border)', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--red)', display: 'inline-block', alignSelf: 'center', whiteSpace: 'nowrap', flexShrink: 0 }

const PENCIL_SVG = <svg width="11" height="11" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="2" width="4" height="16" rx="1" fill="#e53935"/><rect x="10" y="7" width="4" height="4" fill="#FDD835"/><polygon points="10,18 14,18 12,23" fill="#fff"/><rect x="10" y="2" width="4" height="2.5" rx="0.5" fill="#555"/></svg>
const BIN_SVG = <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>

// ── Confirm Dialog ────────────────────────────────────────────────────────────
function Confirm({ message, onOk, onCancel }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onCancel}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 360, width: '90%' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 14, marginBottom: 20, color: 'var(--text)' }}>{message}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={BTN}>Cancel</button>
          <button onClick={onOk} style={BTN_RED}>Delete</button>
        </div>
      </div>
    </div>
  )
}

// ── Download helper ───────────────────────────────────────────────────────────
async function triggerDownload(signedUrl, fileName) {
  try {
    const res = await fetch(signedUrl)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = fileName
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  } catch {
    const a = document.createElement('a'); a.href = signedUrl; a.download = fileName; a.click()
  }
}

// ── File Card ─────────────────────────────────────────────────────────────────
function FileCard({ doc, onPreview, onDelete, canDelete, selected, onSelect }) {
  const [url, setUrl] = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const isImage = doc.file_type?.includes('image')
  const isPdf = doc.file_type?.includes('pdf')
  const isWord = doc.file_type?.includes('word') || doc.file_type?.includes('document') || /\.docx?$/i.test(doc.file_name || '')
  const isExcel = doc.file_type?.includes('spreadsheet') || doc.file_type?.includes('excel') || /\.xlsx?$/i.test(doc.file_name || '')
  const isPpt = doc.file_type?.includes('presentation') || doc.file_type?.includes('powerpoint') || /\.pptx?$/i.test(doc.file_name || '')

  useEffect(() => {
    supabase.storage.from('company-docs').createSignedUrl(doc.storage_path, 3600)
      .then(({ data }) => { if (data?.signedUrl) setUrl(data.signedUrl) })
  }, [doc.storage_path])

  function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', doc.id)
    e.dataTransfer.effectAllowed = 'move'
    const ghost = document.createElement('div')
    ghost.style.cssText = 'position:fixed;top:-999px;left:-999px;background:#1a1d27;border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:8px 12px;display:flex;align-items:center;gap:8px;font-size:12px;color:#e8e9f0;white-space:nowrap;'
    ghost.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9a9db0" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span>' + doc.file_name.slice(0, 35) + '</span>'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 16, 20)
    setTimeout(() => document.body.removeChild(ghost), 0)
  }

  return (
    <>
      <div
        draggable={true}
        onDragStart={handleDragStart}
        style={{ border: selected ? '2px solid var(--accent)' : '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)', cursor: 'grab', position: 'relative', transition: 'border .1s' }}
      >
        <div
          onClick={e => { e.stopPropagation(); onSelect(doc.id) }}
          style={{ position: 'absolute', top: 6, left: 6, zIndex: 1, width: 18, height: 18, borderRadius: 4, border: '2px solid ' + (selected ? 'var(--accent)' : 'rgba(255,255,255,0.4)'), background: selected ? 'var(--accent)' : 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          {selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
        </div>
        <div
          style={{ height: 130, background: 'var(--surface2)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer' }}
          onClick={() => onPreview(doc)}
        >
          {isImage && url
            ? <img src={url} alt={doc.file_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : isPdf && url
            ? <iframe src={url + '#page=1&toolbar=0&navpanes=0&scrollbar=0'} style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }} title={doc.file_name} />
            : isWord
            ? <div style={{ width: 48, height: 56, background: '#1B5EAE', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ color: '#fff', fontSize: 22, fontWeight: 700, fontFamily: 'Arial' }}>W</span></div>
            : isExcel
            ? <div style={{ width: 48, height: 56, background: '#1D7B45', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ color: '#fff', fontSize: 22, fontWeight: 700, fontFamily: 'Arial' }}>X</span></div>
            : isPpt
            ? <div style={{ width: 48, height: 56, background: '#C55A25', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ color: '#fff', fontSize: 22, fontWeight: 700, fontFamily: 'Arial' }}>P</span></div>
            : <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
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
            {url && <button onClick={e => { e.stopPropagation(); onPreview(doc) }} style={{ flex: 1, fontSize: 10, lineHeight: '22px', padding: '0', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>View</button>}
            {url && <button onClick={e => { e.stopPropagation(); triggerDownload(url, doc.file_name) }} style={{ flex: 1, fontSize: 10, lineHeight: '22px', padding: '0', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>↓</button>}
            {canDelete && <button onClick={e => { e.stopPropagation(); setConfirmDel(true) }} style={{ fontSize: 10, lineHeight: '22px', padding: '0 6px', border: '0.5px solid var(--red-border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--red)' }}>✕</button>}
          </div>
        </div>
      </div>
      {confirmDel && <Confirm message={'Delete "' + doc.file_name + '"?'} onOk={() => { setConfirmDel(false); onDelete(doc) }} onCancel={() => setConfirmDel(false)} />}
    </>
  )
}


// ── File List Row (list view) ──────────────────────────────────────────────
function FileListRow({ doc, onPreview, onDelete, canDelete, selected, onSelect }) {
  const [url, setUrl] = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const isWord = doc.file_type?.includes('word') || doc.file_type?.includes('document') || /\.docx?$/i.test(doc.file_name || '')
  const isExcel = doc.file_type?.includes('spreadsheet') || doc.file_type?.includes('excel') || /\.xlsx?$/i.test(doc.file_name || '')
  const isPpt = doc.file_type?.includes('presentation') || doc.file_type?.includes('powerpoint') || /\.pptx?$/i.test(doc.file_name || '')
  const isPdf = doc.file_type?.includes('pdf')
  const isImage = doc.file_type?.includes('image')

  useEffect(() => {
    supabase.storage.from('company-docs').createSignedUrl(doc.storage_path, 3600)
      .then(({ data }) => { if (data?.signedUrl) setUrl(data.signedUrl) })
  }, [doc.storage_path])

  const iconColor = isPdf ? '#E24B4A' : isWord ? '#1B5EAE' : isExcel ? '#1D7B45' : isPpt ? '#C55A25' : isImage ? '#448a40' : '#888'
  const iconLetter = isPdf ? 'PDF' : isWord ? 'W' : isExcel ? 'X' : isPpt ? 'P' : null

  function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', doc.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <>
      <div draggable={true} onDragStart={handleDragStart}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 6, border: selected ? '1.5px solid var(--accent)' : '0.5px solid var(--border)', background: 'var(--surface)', cursor: 'grab', transition: 'border .1s' }}>
        {/* Checkbox */}
        <div onClick={e => { e.stopPropagation(); onSelect(doc.id) }}
          style={{ width: 16, height: 16, borderRadius: 3, border: '2px solid ' + (selected ? 'var(--accent)' : 'rgba(255,255,255,0.3)'), background: selected ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
          {selected && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
        </div>
        {/* File type icon */}
        <div style={{ width: 32, height: 32, borderRadius: 5, background: iconColor + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {iconLetter
            ? <span style={{ fontSize: 10, fontWeight: 700, color: iconColor }}>{iconLetter}</span>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          }
        </div>
        {/* Filename — full width, no truncation */}
        <div onClick={() => onPreview(doc)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', wordBreak: 'break-word', lineHeight: '1.3' }}>{doc.file_name}</div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{fmtSize(doc.file_size)}{doc.file_size ? ' · ' : ''}{formatDate(doc.created_at)}</div>
        </div>
        {/* Actions */}
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {url && <button onClick={e => { e.stopPropagation(); onPreview(doc) }} style={{ fontSize: 10, lineHeight: '22px', padding: '0 7px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>View</button>}
          {url && <button onClick={e => { e.stopPropagation(); triggerDownload(url, doc.file_name) }} style={{ fontSize: 10, lineHeight: '22px', padding: '0 7px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>↓</button>}
          {canDelete && <button onClick={e => { e.stopPropagation(); setConfirmDel(true) }} style={{ fontSize: 10, lineHeight: '22px', padding: '0 7px', border: '0.5px solid var(--red-border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--red)' }}>✕</button>}
        </div>
      </div>
      {confirmDel && <Confirm message={'Delete "' + doc.file_name + '"?'} onOk={() => { setConfirmDel(false); onDelete(doc) }} onCancel={() => setConfirmDel(false)} />}
    </>
  )
}

// ── Bulk Bar ──────────────────────────────────────────────────────────────────
function BulkBar({ selected, onZip, onMove, onClear, allSubfolders }) {
  const [showMove, setShowMove] = useState(false)
  const [movePos, setMovePos] = useState({ bottom: 80, left: 400 })
  if (!selected.size) return null
  function openMove(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    setMovePos({ bottom: window.innerHeight - rect.top + 8, left: rect.left })
    setShowMove(v => !v)
  }
  return (
    <>
      <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 500, background: 'var(--accent)', color: '#fff', borderRadius: 12, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 4px 24px rgba(0,0,0,0.3)', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.size} selected</span>
        <button onClick={onZip} style={{ fontSize: 12, lineHeight: '26px', padding: '0 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.4)', background: 'transparent', color: '#fff', cursor: 'pointer' }}>↓ Download ZIP</button>
        <button onClick={openMove} style={{ fontSize: 12, lineHeight: '26px', padding: '0 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.4)', background: showMove ? 'rgba(255,255,255,0.2)' : 'transparent', color: '#fff', cursor: 'pointer' }}>Move to ▾</button>
        <button onClick={onClear} style={{ fontSize: 12, lineHeight: '26px', padding: '0 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.4)', background: 'transparent', color: '#fff', cursor: 'pointer' }}>✕ Clear</button>
      </div>
      {showMove && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 600 }} onClick={() => setShowMove(false)} />
          <div style={{ position: 'fixed', bottom: movePos.bottom, left: movePos.left, zIndex: 601, background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, minWidth: 240, maxHeight: 320, overflowY: 'auto', boxShadow: '0 -4px 24px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '8px 12px', fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '0.5px solid var(--border)' }}>Move to folder</div>
            <div onClick={() => { onMove(null, null); setShowMove(false) }} style={{ padding: '10px 14px', fontSize: 13, cursor: 'pointer', color: 'var(--text)', borderBottom: '0.5px solid var(--border)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'} onMouseLeave={e => e.currentTarget.style.background = ''}>
              📂 General files (same folder)
            </div>
            {CATEGORIES.map(cat => (
              <div key={cat.key}>
                <div style={{ padding: '8px 14px 4px', fontSize: 11, fontWeight: 600, color: cat.color }}>{cat.icon} {cat.label}</div>
                {(allSubfolders[cat.key] || []).map(sf => (
                  <div key={sf.folder_key} onClick={() => { onMove(sf.folder_key, cat.key); setShowMove(false) }} style={{ padding: '8px 14px 8px 28px', fontSize: 13, cursor: 'pointer', color: 'var(--text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'} onMouseLeave={e => e.currentTarget.style.background = ''}>
                    📁 {sf.label}
                  </div>
                ))}
                {!(allSubfolders[cat.key] || []).length && <div style={{ padding: '4px 14px 8px 28px', fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>No subfolders</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

// ── Subfolder Section (recursive) ─────────────────────────────────────────────
function SubfolderSection({ subfolder, categoryKey, color, canManage, onPreview, onReload, depth = 0, viewMode = 'grid' }) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState([])
  const [childFolders, setChildFolders] = useState([])
  const [uploading, setUploading] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [showAddSub, setShowAddSub] = useState(false)
  const [newSubName, setNewSubName] = useState('')
  const [savingSub, setSavingSub] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const [confirmDelFolder, setConfirmDelFolder] = useState(false)
  const [subLabel, setSubLabel] = useState(subfolder.label)

  useEffect(() => { if (open) { loadFiles(); loadChildFolders() } }, [open])

  async function loadFiles() {
    const { data } = await supabase.from('company_documents')
      .select('*, profiles(full_name)').eq('category', categoryKey).eq('subfolder_key', subfolder.key)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: false })
    setFiles((data || []).sort((a, b) => a.file_name.localeCompare(b.file_name, undefined, { numeric: true, sensitivity: 'base' })))
  }
  async function loadChildFolders() {
    const { data } = await supabase.from('company_doc_subfolders').select('*').eq('parent_folder_key', subfolder.key).order('label')
    setChildFolders(data || [])
  }
  async function moveFile(docId) {
    await supabase.from('company_documents').update({ subfolder_key: subfolder.key }).eq('id', docId)
    loadFiles(); if (onReload) onReload(docId)
  }
  async function upload(fileList) {
    if (!fileList.length) return
    setUploading(true)
    for (const file of fileList) {
      const path = 'company/' + categoryKey + '/' + subfolder.key + '/' + Date.now() + '-' + file.name
      const { error } = await supabase.storage.from('company-docs').upload(path, file)
      if (!error) await supabase.from('company_documents').insert({ category: categoryKey, subfolder_key: subfolder.key, file_name: file.name, file_type: file.type, file_size: file.size, storage_path: path })
    }
    setUploading(false); loadFiles()
  }
  async function deleteDoc(doc) {
    await supabase.storage.from('company-docs').remove([doc.storage_path])
    await supabase.from('company_documents').delete().eq('id', doc.id)
    setFiles(prev => prev.filter(f => f.id !== doc.id))
  }
  async function addChildFolder() {
    if (!newSubName.trim()) return
    setSavingSub(true)
    const key = subfolder.key + '-sub-' + Date.now()
    await supabase.from('company_doc_subfolders').insert({ category_key: categoryKey, folder_key: key, label: newSubName.trim(), parent_folder_key: subfolder.key })
    setNewSubName(''); setShowAddSub(false); setSavingSub(false); loadChildFolders()
  }
  async function renameFolder() {
    if (!renameVal.trim()) return
    await supabase.from('company_doc_subfolders').update({ label: renameVal.trim() }).eq('folder_key', subfolder.key)
    setSubLabel(renameVal.trim()); setRenaming(false)
    if (onReload) onReload('__folder_renamed__')
  }
  async function deleteFolder() {
    await supabase.from('company_documents').update({ subfolder_key: null }).eq('subfolder_key', subfolder.key)
    await supabase.from('company_doc_subfolders').delete().eq('folder_key', subfolder.key)
    setConfirmDelFolder(false)
    if (onReload) onReload('__folder_deleted__')
  }
  async function bulkZip() {
    const chosen = files.filter(f => selected.has(f.id))
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    s.onload = async () => {
      const zip = new window.JSZip()
      for (const f of chosen) {
        const { data } = await supabase.storage.from('company-docs').createSignedUrl(f.storage_path, 120)
        if (data?.signedUrl) { const res = await fetch(data.signedUrl); zip.file(f.file_name, await res.blob()) }
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = subLabel + '.zip'; a.click()
    }
    document.head.appendChild(s)
  }
  async function bulkMove(targetSubfolder, targetCategory) {
    const upd = { subfolder_key: targetSubfolder }
    if (targetCategory && targetCategory !== categoryKey) upd.category = targetCategory
    for (const id of selected) await supabase.from('company_documents').update(upd).eq('id', id)
    setSelected(new Set()); loadFiles()
  }
  function onDrop(e) {
    e.preventDefault(); e.stopPropagation()
    const id = e.dataTransfer.getData('text/plain')
    if (id) { moveFile(id); return }
    const f = Array.from(e.dataTransfer.files); if (f.length) upload(f)
  }

  return (
    <div style={{ marginBottom: 2 }}>
      <div
        onClick={() => setOpen(o => !o)}
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', paddingLeft: 10 + depth * 12, borderRadius: 6, cursor: 'pointer', background: open ? 'var(--surface2)' : 'transparent', transition: 'background .1s' }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--surface2)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent' }}
      >
        <div style={{ width: 24, height: 24, borderRadius: 5, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13 }}>📁</div>
        {renaming
          ? <input value={renameVal} autoFocus onChange={e => setRenameVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') renameFolder(); if (e.key === 'Escape') setRenaming(false) }}
              onClick={e => e.stopPropagation()}
              style={{ flex: 1, fontSize: 12, padding: '2px 8px', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text)' }} />
          : <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{subLabel}</span>
        }
        <span style={{ fontSize: 10, color: 'var(--text3)' }}>{open && (files.length + childFolders.length) > 0 ? (files.length + childFolders.length) + ' items' : ''}</span>
        {canManage && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={e => e.stopPropagation()}>
            {!renaming && (
              <>
                <button onClick={() => { setRenameVal(subLabel); setRenaming(true) }} style={BTN} title="Rename">{PENCIL_SVG}</button>
                {confirmDelFolder
                  ? <>
                      <button onClick={deleteFolder} style={BTN_RED}>Confirm</button>
                      <button onClick={() => setConfirmDelFolder(false)} style={BTN}>✕</button>
                    </>
                  : <button onClick={() => setConfirmDelFolder(true)} style={BTN_RED} title="Delete">{BIN_SVG}</button>
                }
              </>
            )}
            {showAddSub
              ? <>
                  <input value={newSubName} onChange={e => setNewSubName(e.target.value)} placeholder="Name" autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') addChildFolder(); if (e.key === 'Escape') setShowAddSub(false) }}
                    style={{ fontSize: 11, lineHeight: '24px', padding: '0 6px', border: '0.5px solid var(--border)', borderRadius: 5, background: 'var(--surface2)', color: 'var(--text)', width: 90 }} />
                  <button onClick={addChildFolder} disabled={savingSub} style={BTN_GREEN}>{savingSub ? '...' : 'Add'}</button>
                  <button onClick={() => { setShowAddSub(false); setNewSubName('') }} style={BTN}>✕</button>
                </>
              : <button onClick={() => setShowAddSub(true)} style={BTN}>+ Sub</button>
            }
            <label style={BTN_GREEN}>
              {uploading ? '...' : '+ Upload'}
              <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} />
            </label>
          </div>
        )}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0, marginLeft: 2 }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      {open && (
        <div onDragOver={e => e.preventDefault()} onDrop={onDrop}
          style={{ marginLeft: 14 + depth * 12, paddingLeft: 10, borderLeft: '1.5px solid ' + color + '30', paddingTop: 6, paddingBottom: 6 }}>
          <BulkBar selected={selected} onZip={bulkZip} onMove={bulkMove} onClear={() => setSelected(new Set())} allSubfolders={{}} />
          {childFolders.map(cf => (
            <SubfolderSection key={cf.folder_key} subfolder={{ key: cf.folder_key, label: cf.label }}
              categoryKey={categoryKey} color={color} canManage={canManage} onPreview={onPreview} viewMode={viewMode}
              onReload={id => { if (id === '__folder_deleted__') loadChildFolders(); else setFiles(prev => prev.filter(f => f.id !== id)) }}
              depth={depth + 1} />
          ))}
          {files.length === 0 && childFolders.length === 0
            ? <label onDragOver={e => e.preventDefault()} onDrop={onDrop}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 50, border: '0.5px dashed var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text3)', fontSize: 11 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Drop files or click to upload
                <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} />
              </label>
            : files.length > 0 && (
              {viewMode === 'list'
              ? <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: childFolders.length > 0 ? 8 : 0 }}>
                  {files.map(f => (
                    <FileListRow key={f.id} doc={f} onPreview={onPreview} canDelete={canManage} onDelete={deleteDoc}
                      selected={selected.has(f.id)} onSelect={id => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })} />
                  ))}
                </div>
              : <div style={{ display: 'grid', gridTemplateColumns: viewMode === 'compact' ? 'repeat(auto-fill, minmax(110px, 1fr))' : 'repeat(auto-fill, minmax(140px, 1fr))', gap: viewMode === 'compact' ? 6 : 8, marginTop: childFolders.length > 0 ? 8 : 0 }}>
                  {files.map(f => (
                    <FileCard key={f.id} doc={f} onPreview={onPreview} canDelete={canManage} onDelete={deleteDoc}
                      selected={selected.has(f.id)} onSelect={id => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })} />
                  ))}
                  {canManage && (
                    <label onDragOver={e => e.preventDefault()} onDrop={onDrop}
                      style={{ border: '0.5px dashed var(--border)', borderRadius: 8, minHeight: 70, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer', color: 'var(--text3)', fontSize: 10 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      Add files
                      <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} />
                    </label>
                  )}
                </div>
            }
            )
          }
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
  const [allSubfolders, setAllSubfolders] = useState({})
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('docView_' + cat.key) || 'grid')

  function setView(mode) { setViewMode(mode); localStorage.setItem('docView_' + cat.key, mode) }

  useEffect(() => { if (open) { loadFiles(); loadSubfolders(); loadAllSubfolders() } }, [open])
  useEffect(() => {
    supabase.from('company_documents').select('id', { count: 'exact' }).eq('category', cat.key)
      .then(({ count }) => setTotalCount(count || 0))
  }, [cat.key, open])

  async function loadFiles() {
    const { data } = await supabase.from('company_documents')
      .select('*, profiles(full_name)').eq('category', cat.key).is('subfolder_key', null)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: false })
    setFiles((data || []).sort((a, b) => a.file_name.localeCompare(b.file_name, undefined, { numeric: true, sensitivity: 'base' })))
  }
  async function loadSubfolders() {
    const { data } = await supabase.from('company_doc_subfolders').select('*').eq('category_key', cat.key).is('parent_folder_key', null).order('label')
    setSubfolders(data || [])
  }
  async function loadAllSubfolders() {
    const { data } = await supabase.from('company_doc_subfolders').select('*').order('label')
    const grouped = {}
    ;(data || []).forEach(sf => { if (!grouped[sf.category_key]) grouped[sf.category_key] = []; grouped[sf.category_key].push(sf) })
    setAllSubfolders(grouped)
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
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
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
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
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
  async function bulkMove(targetSubfolder, targetCategory) {
    const upd = { subfolder_key: targetSubfolder }
    if (targetCategory && targetCategory !== cat.key) upd.category = targetCategory
    for (const id of selected) await supabase.from('company_documents').update(upd).eq('id', id)
    setSelected(new Set()); loadFiles()
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
        {/* Action buttons — order: Zip | + Subfolder | + Upload */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {showAddSub ? (
            <>
              <input value={newSubName} onChange={e => setNewSubName(e.target.value)} placeholder="Subfolder name" autoFocus
                onKeyDown={e => { if (e.key === 'Enter') addSubfolder(); if (e.key === 'Escape') setShowAddSub(false) }}
                style={{ fontSize: 11, lineHeight: '24px', padding: '0 8px', border: '0.5px solid var(--border)', borderRadius: 5, background: 'var(--surface2)', color: 'var(--text)', width: 130, alignSelf: 'center' }} />
              <button onClick={addSubfolder} disabled={savingSub} style={BTN_GREEN}>{savingSub ? '...' : 'Add'}</button>
              <button onClick={() => { setShowAddSub(false); setNewSubName('') }} style={BTN}>✕</button>
            </>
          ) : (
            <>
              <button onClick={zipFolder} disabled={zipping} style={{ ...BTN, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
                {zipping ? '...' : 'Zip'}
              </button>
              {canManage && <button onClick={() => setShowAddSub(true)} style={BTN}>+ Subfolder</button>}
              {canManage && (
                <label style={BTN_GREEN}>
                  {uploading ? '...' : '+ Upload'}
                  <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} />
                </label>
              )}
            </>
          )}
        </div>
        {open && (
          <div style={{ display: 'flex', gap: 2, marginLeft: 4 }} onClick={e => e.stopPropagation()}>
            {[
              { mode: 'grid',    title: 'Grid view',    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> },
              { mode: 'compact', title: 'Compact view', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="4" height="4"/><rect x="10" y="3" width="4" height="4"/><rect x="17" y="3" width="4" height="4"/><rect x="3" y="10" width="4" height="4"/><rect x="10" y="10" width="4" height="4"/><rect x="17" y="10" width="4" height="4"/><rect x="3" y="17" width="4" height="4"/><rect x="10" y="17" width="4" height="4"/><rect x="17" y="17" width="4" height="4"/></svg> },
              { mode: 'list',    title: 'List view',    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg> },
            ].map(({ mode, title, icon }) => (
              <button key={mode} onClick={() => setView(mode)} title={title}
                style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '0.5px solid ' + (viewMode === mode ? 'var(--accent)' : 'var(--border)'), borderRadius: 4, background: viewMode === mode ? 'var(--accent)' : 'transparent', cursor: 'pointer', color: viewMode === mode ? '#fff' : 'var(--text3)', padding: 0, flexShrink: 0 }}>
                {icon}
              </button>
            ))}
          </div>
        )}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', marginLeft: 4, flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      {open && (
        <div onDragOver={e => e.preventDefault()} onDrop={onDropBody}
          style={{ marginLeft: 16, paddingLeft: 12, borderLeft: '1.5px solid ' + cat.color + '30', paddingTop: 8, paddingBottom: 8 }}>
          <BulkBar selected={selected} onZip={bulkZip} onMove={bulkMove} onClear={() => setSelected(new Set())} allSubfolders={allSubfolders} />
          {subfolders.map(sf => (
            <SubfolderSection key={sf.folder_key} subfolder={{ key: sf.folder_key, label: sf.label }}
              categoryKey={cat.key} color={cat.color} canManage={canManage} onPreview={onPreview}
              onReload={id => { if (id === '__folder_deleted__') { loadSubfolders(); loadAllSubfolders() } else if (id === '__folder_renamed__') { loadAllSubfolders() } else setFiles(prev => prev.filter(f => f.id !== id)) }} />
          ))}
          {files.length > 0 && (
            <div style={{ marginTop: subfolders.length > 0 ? 10 : 0 }}>
              {subfolders.length > 0 && <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>General files</div>}
              {viewMode === 'list'
                ? <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {files.map(f => (
                      <FileListRow key={f.id} doc={f} onPreview={onPreview} canDelete={canManage} onDelete={deleteDoc}
                        selected={selected.has(f.id)} onSelect={id => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })} />
                    ))}
                  </div>
                : <div style={{ display: 'grid', gridTemplateColumns: viewMode === 'compact' ? 'repeat(auto-fill, minmax(110px, 1fr))' : 'repeat(auto-fill, minmax(150px, 1fr))', gap: viewMode === 'compact' ? 6 : 8 }}>
                    {files.map(f => (
                      <FileCard key={f.id} doc={f} onPreview={onPreview} canDelete={canManage} onDelete={deleteDoc}
                        selected={selected.has(f.id)} onSelect={id => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })} />
                    ))}
                  </div>
              }
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setPreviewDoc(null)}>
          <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 8 }}>
            {previewUrl && <button onClick={e => { e.stopPropagation(); triggerDownload(previewUrl, previewDoc.file_name) }} style={{ fontSize: 12, padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>↓ Download</button>}
            <button onClick={() => setPreviewDoc(null)} style={{ fontSize: 12, padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>✕ Close</button>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginBottom: 12 }}>{previewDoc.file_name}</div>
          {previewLoading ? <Spinner /> : previewUrl
            ? previewDoc.file_type?.includes('image')
              ? <img src={previewUrl} alt={previewDoc.file_name} style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 8 }} onClick={e => e.stopPropagation()} />
              : previewDoc.file_type?.includes('pdf')
              ? <iframe src={previewUrl} style={{ width: '85vw', height: '80vh', border: 'none', borderRadius: 8 }} title={previewDoc.file_name} onClick={e => e.stopPropagation()} />
              : <iframe src={'https://docs.google.com/gview?url=' + encodeURIComponent(previewUrl) + '&embedded=true'} style={{ width: '85vw', height: '80vh', border: 'none', borderRadius: 8, background: '#fff' }} title={previewDoc.file_name} onClick={e => e.stopPropagation()} />
            : <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Unable to preview this file</div>
          }
        </div>
      )}
    </div>
  )
}
