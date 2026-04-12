import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ── Fixed template folders ────────────────────────────────────────────────────
const TEMPLATE_FOLDERS = [
  {
    key: '00-project-information',
    label: '00. Project Information',
    color: '#448a40',
    bg: '#e8f5e7',
    subfolders: [
      { key: 'drawings', label: 'Drawings' },
      { key: 'csa',      label: 'CSA' },
      { key: 'cff',      label: 'CFF - Cashflow Forecast' },
      { key: 'f10',      label: 'F10' },
      { key: 'pci',      label: 'PCI — Pre-Construction Information' },
      { key: 'cpp',      label: 'CPP — Construction Phase Plan' },
    ]
  },
  { key: '01-project-order',        label: '01. Project Order',           color: '#378ADD', bg: '#E6F1FB', subfolders: [] },
  { key: '02-payment-application',  label: '02. Payment Application',     color: '#BA7517', bg: '#FAEEDA', subfolders: [] },
  { key: '03-payment-notice',       label: '03. Payment Notice (Client)', color: '#BA7517', bg: '#FAEEDA', subfolders: [] },
  { key: '04-project-programme',    label: '04. Project Programme',       color: '#534AB7', bg: '#EEEDFE', subfolders: [] },
]

// ── Folder icons (per folder key) ─────────────────────────────────────────────
const FOLDER_ICONS = {
  '00-project-information': ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
      <rect x="9" y="3" width="6" height="4" rx="1"/>
      <circle cx="12" cy="13" r="1" fill={color}/>
      <line x1="12" y1="15" x2="12" y2="17"/>
      <line x1="9" y1="10" x2="15" y2="10"/>
    </svg>
  ),
  '01-project-order': ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2"/>
      <line x1="7" y1="9" x2="17" y2="9"/>
      <line x1="7" y1="13" x2="17" y2="13"/>
      <line x1="7" y1="17" x2="12" y2="17"/>
    </svg>
  ),
  '02-payment-application': ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2"/>
      <line x1="2" y1="10" x2="22" y2="10"/>
      <line x1="6" y1="15" x2="10" y2="15"/>
    </svg>
  ),
  '03-payment-notice': ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="9" y1="13" x2="15" y2="13"/>
      <line x1="9" y1="17" x2="12" y2="17"/>
    </svg>
  ),
  '04-project-programme': ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
      <line x1="8" y1="14" x2="16" y2="14"/>
    </svg>
  ),
}

function FolderIcon({ folderKey, color, bg, size = 20 }) {
  const Icon = FOLDER_ICONS[folderKey]
  return (
    <div style={{ width: 36, height: 36, borderRadius: 8, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {Icon ? <Icon color={color} size={size} /> : (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      )}
    </div>
  )
}

// ── Shared utilities ──────────────────────────────────────────────────────────
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
function fileTypeInfo(fileName, fileType) {
  const t = fileType || ''; const n = fileName || ''
  const isExcel = t.includes('spreadsheet') || t.includes('excel') || /\.xlsx?$/i.test(n)
  const isPpt   = t.includes('presentation') || t.includes('powerpoint') || /\.pptx?$/i.test(n)
  const isWord  = !isExcel && !isPpt && (t.includes('word') || t.includes('wordprocessing') || /\.docx?$/i.test(n))
  return {
    isImage: t.includes('image') || /\.(jpg|jpeg|png|gif|webp)$/i.test(n),
    isPdf:   t.includes('pdf')   || /\.pdf$/i.test(n),
    isWord,
    isExcel,
    isPpt,
  }
}
function FileTypeBadge({ fileName, fileType, size = 34 }) {
  const { isWord, isExcel, isPpt } = fileTypeInfo(fileName, fileType)
  const color  = isWord ? '#1B5EAE' : isExcel ? '#1D7B45' : isPpt ? '#C55A25' : null
  const letter = isWord ? 'W'       : isExcel ? 'X'       : isPpt ? 'P'       : null
  if (!color) return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  )
  return (
    <div style={{ width: size, height: size + 8, background: color, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: '#fff', fontSize: size * 0.5, fontWeight: 700, fontFamily: 'Arial' }}>{letter}</span>
    </div>
  )
}
function ConfirmDlg({ message, onOk, onCancel }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onCancel}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 360, width: '90%' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 14, marginBottom: 20, color: 'var(--text)' }}>{message}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={Btn}>Cancel</button>
          <button onClick={onOk} style={BtnR}>Delete</button>
        </div>
      </div>
    </div>
  )
}

const PENCIL = <svg width="11" height="11" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="2" width="4" height="16" rx="1" fill="#e53935"/><rect x="10" y="7" width="4" height="4" fill="#FDD835"/><polygon points="10,18 14,18 12,23" fill="#fff"/><rect x="10" y="2" width="4" height="2.5" rx="0.5" fill="#555"/></svg>
const BIN = <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>

const Btn  = { fontSize: 11, lineHeight: '24px', padding: '0 9px', margin: 0, border: '0.5px solid var(--border)',     borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--text2)', display: 'inline-block', alignSelf: 'center', whiteSpace: 'nowrap', flexShrink: 0 }
const BtnG = { fontSize: 11, lineHeight: '24px', padding: '0 9px', margin: 0, border: '0.5px solid #448a40',           borderRadius: 5, background: 'transparent', cursor: 'pointer', color: '#448a40',        display: 'inline-block', alignSelf: 'center', whiteSpace: 'nowrap', flexShrink: 0 }
const BtnR = { fontSize: 11, lineHeight: '24px', padding: '0 9px', margin: 0, border: '0.5px solid var(--red-border)', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--red)',    display: 'inline-block', alignSelf: 'center', whiteSpace: 'nowrap', flexShrink: 0 }

// ── View Toggle ───────────────────────────────────────────────────────────────
function ViewToggle({ viewMode, setView }) {
  const views = [
    { mode: 'grid',    title: 'Grid',    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> },
    { mode: 'compact', title: 'Compact', icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="4" height="4"/><rect x="10" y="2" width="4" height="4"/><rect x="18" y="2" width="4" height="4"/><rect x="2" y="10" width="4" height="4"/><rect x="10" y="10" width="4" height="4"/><rect x="18" y="10" width="4" height="4"/><rect x="2" y="18" width="4" height="4"/><rect x="10" y="18" width="4" height="4"/><rect x="18" y="18" width="4" height="4"/></svg> },
    { mode: 'list',    title: 'List',    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg> },
  ]
  return (
    <div style={{ display: 'flex', gap: 2 }} onClick={e => e.stopPropagation()}>
      {views.map(({ mode, title, icon }) => (
        <button key={mode} onClick={() => setView(mode)} title={title}
          style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '0.5px solid ' + (viewMode === mode ? 'var(--accent)' : 'var(--border)'), borderRadius: 4, background: viewMode === mode ? 'var(--accent)' : 'transparent', cursor: 'pointer', color: viewMode === mode ? '#fff' : 'var(--text3)', padding: 0, flexShrink: 0 }}>
          {icon}
        </button>
      ))}
    </div>
  )
}

// ── Bulk Bar ──────────────────────────────────────────────────────────────────
function BulkBar({ selected, onZip, onClear }) {
  if (!selected.size) return null
  return (
    <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 500, background: 'var(--accent)', color: '#fff', borderRadius: 12, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 4px 24px rgba(0,0,0,0.3)', whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.size} selected</span>
      <button onClick={onZip} style={{ fontSize: 12, lineHeight: '26px', padding: '0 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.4)', background: 'transparent', color: '#fff', cursor: 'pointer' }}>↓ Download ZIP</button>
      <button onClick={onClear} style={{ fontSize: 12, lineHeight: '26px', padding: '0 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.4)', background: 'transparent', color: '#fff', cursor: 'pointer' }}>✕ Clear</button>
    </div>
  )
}

// ── File Card (grid / compact view) ──────────────────────────────────────────
function FileCard({ file, onPreview, onDelete, canDelete, selected, onSelect }) {
  const [url, setUrl] = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const { isImage, isPdf } = fileTypeInfo(file.file_name, file.file_type)

  useEffect(() => {
    supabase.storage.from('project-docs').createSignedUrl(file.storage_path, 3600)
      .then(({ data }) => { if (data?.signedUrl) setUrl(data.signedUrl) })
  }, [file.storage_path])

  async function renameFile() {
    if (!renameVal.trim() || renameVal.trim() === file.file_name) { setRenaming(false); return }
    await supabase.from('project_doc_files').update({ file_name: renameVal.trim() }).eq('id', file.id)
    file.file_name = renameVal.trim()
    setRenaming(false)
  }

  function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', file.id)
    e.dataTransfer.setData('file_subfolder', file.subfolder_key || '')
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <>
      <div draggable={!renaming} onDragStart={handleDragStart}
        style={{ border: selected ? '2px solid var(--accent)' : '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)', cursor: renaming ? 'default' : 'grab', position: 'relative', transition: 'border .1s' }}>
        <div onClick={e => { e.stopPropagation(); onSelect(file.id) }}
          style={{ position: 'absolute', top: 6, left: 6, zIndex: 1, width: 18, height: 18, borderRadius: 4, border: '2px solid ' + (selected ? 'var(--accent)' : 'rgba(255,255,255,0.4)'), background: selected ? 'var(--accent)' : 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          {selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
        </div>
        <div style={{ height: 120, background: 'var(--surface2)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer' }} onClick={() => onPreview(file, url)}>
          {isImage && url
            ? <img src={url} alt={file.file_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : isPdf && url
            ? <iframe src={url + '#page=1&toolbar=0&navpanes=0&scrollbar=0'} style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }} title={file.file_name} />
            : <FileTypeBadge fileName={file.file_name} fileType={file.file_type} size={34} />
          }
          <div style={{ position: 'absolute', top: 5, right: 5, background: 'rgba(0,0,0,0.55)', color: 'white', fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3 }}>{fileExt(file.file_name)}</div>
        </div>
        <div style={{ padding: '6px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
            {renaming
              ? <input value={renameVal} autoFocus onChange={e => setRenameVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') renameFile(); if (e.key === 'Escape') setRenaming(false) }}
                  onFocus={e => e.target.select()} onClick={e => e.stopPropagation()}
                  style={{ flex: 1, fontSize: 11, padding: '1px 5px', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text)', minWidth: 0 }} />
              : <>
                  <div style={{ flex: 1, fontSize: 11, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.file_name}>{file.file_name}</div>
                  {canDelete && (
                    <button onClick={e => { e.stopPropagation(); setRenameVal(file.file_name); setRenaming(true) }} title="Rename"
                      style={{ flexShrink: 0, cursor: 'pointer', background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: 4, padding: '2px 4px', display: 'inline-flex', alignItems: 'center' }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#448a40" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                  )}
                </>
            }
          </div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 5 }}>{fmtSize(file.file_size)}</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {url && <button onClick={e => { e.stopPropagation(); onPreview(file, url) }} style={{ flex: 1, fontSize: 10, lineHeight: '22px', padding: 0, border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>View</button>}
            {url && <button onClick={e => { e.stopPropagation(); triggerDownload(url, file.file_name) }} style={{ flex: 1, fontSize: 10, lineHeight: '22px', padding: 0, border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>↓</button>}
            {canDelete && <button onClick={e => { e.stopPropagation(); setConfirmDel(true) }} style={{ fontSize: 10, lineHeight: '22px', padding: '0 6px', border: '0.5px solid var(--red-border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--red)' }}>✕</button>}
          </div>
        </div>
      </div>
      {confirmDel && <ConfirmDlg message={'Delete "' + file.file_name + '"?'} onOk={() => { setConfirmDel(false); onDelete(file) }} onCancel={() => setConfirmDel(false)} />}
    </>
  )
}

// ── File List Row (list view) ─────────────────────────────────────────────────
function FileListRow({ file, onPreview, onDelete, canDelete, selected, onSelect }) {
  const [url, setUrl] = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const { isWord, isExcel, isPpt, isPdf, isImage } = fileTypeInfo(file.file_name, file.file_type)
  const iconColor = isPdf ? '#E24B4A' : isWord ? '#1B5EAE' : isExcel ? '#1D7B45' : isPpt ? '#C55A25' : isImage ? '#448a40' : '#888'
  const iconLetter = isPdf ? 'PDF' : isWord ? 'W' : isExcel ? 'X' : isPpt ? 'P' : null

  useEffect(() => {
    supabase.storage.from('project-docs').createSignedUrl(file.storage_path, 3600)
      .then(({ data }) => { if (data?.signedUrl) setUrl(data.signedUrl) })
  }, [file.storage_path])

  async function renameFile() {
    if (!renameVal.trim() || renameVal.trim() === file.file_name) { setRenaming(false); return }
    await supabase.from('project_doc_files').update({ file_name: renameVal.trim() }).eq('id', file.id)
    file.file_name = renameVal.trim()
    setRenaming(false)
  }

  function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', file.id)
    e.dataTransfer.setData('file_subfolder', file.subfolder_key || '')
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <>
      <div draggable={!renaming} onDragStart={handleDragStart}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 6, border: selected ? '1.5px solid var(--accent)' : '0.5px solid var(--border)', background: 'var(--surface)', cursor: renaming ? 'default' : 'grab', transition: 'border .1s' }}>
        <div onClick={e => { e.stopPropagation(); onSelect(file.id) }}
          style={{ width: 16, height: 16, borderRadius: 3, border: '2px solid ' + (selected ? 'var(--accent)' : 'rgba(255,255,255,0.3)'), background: selected ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
          {selected && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
        </div>
        <div style={{ width: 32, height: 32, borderRadius: 5, background: iconColor + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {iconLetter ? <span style={{ fontSize: 10, fontWeight: 700, color: iconColor }}>{iconLetter}</span>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {renaming
            ? <input value={renameVal} autoFocus onChange={e => setRenameVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') renameFile(); if (e.key === 'Escape') setRenaming(false) }}
                onFocus={e => e.target.select()} onClick={e => e.stopPropagation()}
                style={{ width: '100%', fontSize: 12, padding: '2px 6px', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text)' }} />
            : (
              <div onClick={() => onPreview ? onPreview(file, url) : null} style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', wordBreak: 'break-word', lineHeight: '1.3', flex: 1 }}>{file.file_name}</div>
                  {canDelete && (
                    <button onClick={e => { e.stopPropagation(); setRenameVal(file.file_name); setRenaming(true) }} title="Rename"
                      style={{ flexShrink: 0, cursor: 'pointer', background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: 4, padding: '2px 4px', display: 'inline-flex', alignItems: 'center' }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#448a40" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{fmtSize(file.file_size)}</div>
              </div>
            )
          }
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {url && <button onClick={e => { e.stopPropagation(); onPreview ? onPreview(file, url) : window.open(url, '_blank') }} style={{ fontSize: 10, lineHeight: '22px', padding: '0 7px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>View</button>}
          {url && <button onClick={e => { e.stopPropagation(); triggerDownload(url, file.file_name) }} style={{ fontSize: 10, lineHeight: '22px', padding: '0 7px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>↓</button>}
          {canDelete && <button onClick={e => { e.stopPropagation(); setConfirmDel(true) }} style={{ fontSize: 10, lineHeight: '22px', padding: '0 7px', border: '0.5px solid var(--red-border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--red)' }}>✕</button>}
        </div>
      </div>
      {confirmDel && <ConfirmDlg message={'Delete "' + file.file_name + '"?'} onOk={() => { setConfirmDel(false); onDelete(file) }} onCancel={() => setConfirmDel(false)} />}
    </>
  )
}

// ── Files Grid (shared renderer) ─────────────────────────────────────────────
function FilesGrid({ files, viewMode, onPreview, canManage, onDelete, selected, onSelect, onDrop, onUpload }) {
  if (!files.length) return null
  if (viewMode === 'list') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {files.map(f => (
          <FileListRow key={f.id} file={f} onPreview={onPreview} canDelete={canManage} onDelete={onDelete}
            selected={selected.has(f.id)} onSelect={onSelect} />
        ))}
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: viewMode === 'compact' ? 'repeat(auto-fill, minmax(110px, 1fr))' : 'repeat(auto-fill, minmax(150px, 1fr))', gap: viewMode === 'compact' ? 6 : 8 }}>
      {files.map(f => (
        <FileCard key={f.id} file={f} onPreview={onPreview} canDelete={canManage} onDelete={onDelete}
          selected={selected.has(f.id)} onSelect={onSelect} />
      ))}
      {canManage && (
        <label onDragOver={e => e.preventDefault()} onDrop={onDrop}
          style={{ border: '0.5px dashed var(--border)', borderRadius: 8, minHeight: 70, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer', color: 'var(--text3)', fontSize: 10 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add files
          <input type="file" multiple style={{ display: 'none' }} onChange={e => onUpload(Array.from(e.target.files))} />
        </label>
      )}
    </div>
  )
}

// ── Subfolder Section (recursive — supports nested sub-subfolders) ────────────
function SubfolderSection({ projectId, folder, subfolder, canManage, viewMode, onPreview, onReload, depth = 0 }) {
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
    const { data } = await supabase.from('project_doc_files').select('*')
      .eq('project_id', projectId).eq('folder_key', folder.key).eq('subfolder_key', subfolder.key)
      .order('created_at', { ascending: false })
    setFiles(naturalSort(data || []))
  }

  async function loadChildFolders() {
    const { data } = await supabase.from('project_doc_folders').select('*')
      .eq('project_id', projectId).eq('parent_key', subfolder.key).order('created_at')
    setChildFolders(data || [])
  }

  async function moveFile(docId) {
    await supabase.from('project_doc_files').update({ subfolder_key: subfolder.key }).eq('id', docId)
    loadFiles()
    if (onReload) onReload(docId)
  }

  async function uploadFiles(fileList) {
    if (!fileList.length) return
    setUploading(true)
    for (const file of fileList) {
      const path = `projects/${projectId}/${folder.key}/${subfolder.key}/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('project-docs').upload(path, file)
      if (error) { console.error('Upload failed:', error.message); continue }
      const { error: dbErr } = await supabase.from('project_doc_files').insert({
        project_id: projectId, folder_key: folder.key, subfolder_key: subfolder.key,
        file_name: file.name, file_size: file.size, storage_path: path,
      })
      if (dbErr) console.error('DB insert failed:', dbErr.message)
    }
    setUploading(false); loadFiles()
  }

  async function deleteFile(f) {
    await supabase.storage.from('project-docs').remove([f.storage_path])
    await supabase.from('project_doc_files').delete().eq('id', f.id)
    setFiles(prev => prev.filter(x => x.id !== f.id))
  }

  async function addChildFolder() {
    if (!newSubName.trim()) return
    setSavingSub(true)
    const key = subfolder.key + '-sub-' + Date.now()
    await supabase.from('project_doc_folders').insert({ project_id: projectId, parent_key: subfolder.key, folder_key: key, label: newSubName.trim() })
    setNewSubName(''); setShowAddSub(false); setSavingSub(false); loadChildFolders()
  }

  async function renameFolder() {
    if (!renameVal.trim()) return
    await supabase.from('project_doc_folders').update({ label: renameVal.trim() }).eq('folder_key', subfolder.key).eq('project_id', projectId)
    setSubLabel(renameVal.trim()); setRenaming(false)
  }

  async function deleteFolder() {
    await supabase.from('project_doc_files').delete().eq('project_id', projectId).eq('subfolder_key', subfolder.key)
    await supabase.from('project_doc_folders').delete().eq('folder_key', subfolder.key).eq('project_id', projectId)
    setConfirmDelFolder(false)
    if (onReload) onReload('__folder_deleted__')
  }

  async function moveSubfolder(key) {
    if (key === subfolder.key) return
    await supabase.from('project_doc_folders').update({ parent_key: subfolder.key }).eq('folder_key', key).eq('project_id', projectId)
    loadChildFolders()
    if (onReload) onReload('__folder_deleted__')
  }

  async function zipSubfolder() {
    if (!files.length) { alert('No files in this subfolder.'); return }
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    document.head.appendChild(s)
    await new Promise(r => s.onload = r)
    const zip = new window.JSZip()
    for (const f of files) {
      const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 300)
      if (data?.signedUrl) { const res = await fetch(data.signedUrl); zip.file(f.file_name, await res.blob()) }
    }
    const blob = await zip.generateAsync({ type: 'blob' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = subLabel + '.zip'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  async function bulkZip() {
    const chosen = files.filter(f => selected.has(f.id))
    if (!chosen.length) return
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    document.head.appendChild(s)
    await new Promise(r => s.onload = r)
    const zip = new window.JSZip()
    for (const f of chosen) {
      const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 120)
      if (data?.signedUrl) { const res = await fetch(data.signedUrl); zip.file(f.file_name, await res.blob()) }
    }
    const blob = await zip.generateAsync({ type: 'blob' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = subLabel + '-selected.zip'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  function onDrop(e) {
    e.preventDefault(); e.stopPropagation()
    const subKey = e.dataTransfer.getData('subfolder')
    if (subKey) { moveSubfolder(subKey); return }
    const id = e.dataTransfer.getData('text/plain')
    if (id) { moveFile(id); return }
    const f = Array.from(e.dataTransfer.files); if (f.length) uploadFiles(f)
  }

  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const isCustom = subfolder.custom === true

  return (
    <div style={{ marginBottom: 2 }}>
      <div
        draggable={isCustom}
        onDragStart={e => { if (!isCustom) return; e.stopPropagation(); e.dataTransfer.setData('subfolder', subfolder.key); e.dataTransfer.effectAllowed = 'move' }}
        onClick={() => setOpen(o => !o)} onDragOver={e => e.preventDefault()} onDrop={onDrop}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', paddingLeft: 10 + depth * 12, borderRadius: 6, cursor: 'pointer', background: open ? 'var(--surface2)' : 'transparent', transition: 'background .1s' }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--surface2)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent' }}>
        <div style={{ width: 22, height: 22, borderRadius: 4, background: folder.color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={folder.color} strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
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
                {isCustom && (
                  <>
                    <button onClick={() => { setRenameVal(subLabel); setRenaming(true) }} style={Btn} title="Rename">{PENCIL}</button>
                    {confirmDelFolder
                      ? <>
                          <button onClick={deleteFolder} style={BtnR}>Confirm</button>
                          <button onClick={() => setConfirmDelFolder(false)} style={Btn}>✕</button>
                        </>
                      : <button onClick={() => setConfirmDelFolder(true)} style={BtnR} title="Delete">{BIN}</button>
                    }
                  </>
                )}
                <button onClick={zipSubfolder} style={{ ...Btn, display: 'inline-flex', alignItems: 'center', gap: 3 }} title="Zip">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
                  Zip
                </button>
                {showAddSub
                  ? <>
                      <input value={newSubName} onChange={e => setNewSubName(e.target.value)} placeholder="Name" autoFocus
                        onKeyDown={e => { if (e.key === 'Enter') addChildFolder(); if (e.key === 'Escape') setShowAddSub(false) }}
                        style={{ fontSize: 11, lineHeight: '24px', padding: '0 6px', border: '0.5px solid var(--border)', borderRadius: 5, background: 'var(--surface2)', color: 'var(--text)', width: 90 }} />
                      <button onClick={addChildFolder} disabled={savingSub} style={BtnG}>{savingSub ? '...' : 'Add'}</button>
                      <button onClick={() => { setShowAddSub(false); setNewSubName('') }} style={Btn}>✕</button>
                    </>
                  : <button onClick={() => setShowAddSub(true)} style={Btn}>+ Sub</button>
                }
              </>
            )}
            <label style={BtnG}>
              {uploading ? '...' : '+ Upload'}
              <input type="file" multiple style={{ display: 'none' }} onChange={e => uploadFiles(Array.from(e.target.files))} />
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
          style={{ marginLeft: 14 + depth * 12, paddingLeft: 10, borderLeft: '1.5px solid ' + folder.color + '30', paddingTop: 6, paddingBottom: 6 }}>
          <BulkBar selected={selected} onZip={bulkZip} onClear={() => setSelected(new Set())} />
          {childFolders.map(cf => (
            <SubfolderSection key={cf.folder_key} projectId={projectId} folder={folder}
              subfolder={{ key: cf.folder_key, label: cf.label, custom: true }}
              canManage={canManage} viewMode={viewMode} onPreview={onPreview}
              onReload={id => { if (id === '__folder_deleted__') loadChildFolders(); else setFiles(prev => prev.filter(f => f.id !== id)) }}
              depth={depth + 1} />
          ))}
          {files.length === 0 && childFolders.length === 0 ? (
            <label onDragOver={e => e.preventDefault()} onDrop={onDrop}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 50, border: '0.5px dashed var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text3)', fontSize: 11 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Drop files or click to upload
              <input type="file" multiple style={{ display: 'none' }} onChange={e => uploadFiles(Array.from(e.target.files))} />
            </label>
          ) : (
            <FilesGrid files={files} viewMode={viewMode} onPreview={onPreview} canManage={canManage}
              onDelete={deleteFile} selected={selected} onSelect={toggleSelect} onDrop={onDrop} onUpload={uploadFiles} />
          )}
        </div>
      )}
    </div>
  )
}

// ── Prime Folder Section ──────────────────────────────────────────────────────
function PrimeFolderSection({ projectId, folder, canManage, canAddFolders, allFileCounts, onDeleteFolder, onRenameFolder }) {
  const [open, setOpen] = useState(false)
  const [subfolders, setSubfolders] = useState(folder.subfolders || [])
  const [showAddFolder, setShowAddFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [savingFolder, setSavingFolder] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [files, setFiles] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [selectedSubs, setSelectedSubs] = useState(new Set())
  const [previewFile, setPreviewFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [renamingFolder, setRenamingFolder] = useState(false)
  const [renameFolderVal, setRenameFolderVal] = useState('')
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('pdView_' + folder.key) || 'grid' } catch { return 'grid' }
  })

  function setView(mode) {
    setViewMode(mode)
    try { localStorage.setItem('pdView_' + folder.key, mode) } catch {}
  }

  function openPreview(file, url) {
    setPreviewFile(file); setPreviewUrl(url || null)
    if (!url) {
      supabase.storage.from('project-docs').createSignedUrl(file.storage_path, 3600)
        .then(({ data }) => { if (data?.signedUrl) setPreviewUrl(data.signedUrl) })
    }
  }

  const fileCount = allFileCounts?.[folder.key] || 0

  useEffect(() => { loadCustomSubfolders() }, [])
  useEffect(() => { if (open) loadRootFiles() }, [open])

  async function loadCustomSubfolders() {
    const { data } = await supabase.from('project_doc_folders').select('*')
      .eq('project_id', projectId).eq('parent_key', folder.key).order('created_at')
    if (data?.length) {
      const custom = data.map(d => ({ key: d.folder_key, label: d.label, custom: true }))
      setSubfolders([...(folder.subfolders || []), ...custom])
    }
  }

  async function loadRootFiles() {
    const { data } = await supabase.from('project_doc_files').select('*')
      .eq('project_id', projectId).eq('folder_key', folder.key).is('subfolder_key', null)
      .order('created_at', { ascending: false })
    setFiles(naturalSort(data || []))
  }

  async function addCustomSubfolder() {
    if (!newFolderName.trim()) return
    setSavingFolder(true)
    const key = folder.key + '-custom-' + Date.now()
    await supabase.from('project_doc_folders').insert({ project_id: projectId, parent_key: folder.key, folder_key: key, label: newFolderName.trim() })
    setSubfolders(prev => [...prev, { key, label: newFolderName.trim(), custom: true }])
    setNewFolderName(''); setShowAddFolder(false); setSavingFolder(false)
  }

  async function moveFileToRoot(docId) {
    await supabase.from('project_doc_files').update({ subfolder_key: null }).eq('id', docId)
    loadRootFiles()
  }

  async function uploadToFolder(fileList) {
    if (!fileList.length) return
    setUploading(true)
    for (const file of fileList) {
      const path = `projects/${projectId}/${folder.key}/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('project-docs').upload(path, file)
      if (error) { console.error('Upload failed:', error.message); continue }
      const { error: dbErr } = await supabase.from('project_doc_files').insert({
        project_id: projectId, folder_key: folder.key,
        file_name: file.name, file_size: file.size, storage_path: path,
      })
      if (dbErr) console.error('DB insert failed:', dbErr.message)
    }
    setUploading(false); loadRootFiles()
  }

  async function deleteFile(f) {
    await supabase.storage.from('project-docs').remove([f.storage_path])
    await supabase.from('project_doc_files').delete().eq('id', f.id)
    setFiles(prev => prev.filter(x => x.id !== f.id))
  }

  async function zipFolder() {
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    document.head.appendChild(script)
    await new Promise(r => script.onload = r)
    const zip = new window.JSZip()
    const { data: allFiles } = await supabase.from('project_doc_files').select('*').eq('project_id', projectId).eq('folder_key', folder.key)
    if (!allFiles?.length) { alert('No files in this folder.'); return }
    for (const f of allFiles) {
      const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 300)
      if (data?.signedUrl) {
        const res = await fetch(data.signedUrl)
        const sub = f.subfolder_key ? f.subfolder_key + '/' : ''
        zip.file(sub + f.file_name, await res.blob())
      }
    }
    const blob = await zip.generateAsync({ type: 'blob' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = folder.label + '.zip'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  async function bulkZip() {
    const chosen = files.filter(f => selected.has(f.id))
    if (!chosen.length) return
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    document.head.appendChild(s)
    await new Promise(r => s.onload = r)
    const zip = new window.JSZip()
    for (const f of chosen) {
      const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 120)
      if (data?.signedUrl) { const res = await fetch(data.signedUrl); zip.file(f.file_name, await res.blob()) }
    }
    const blob = await zip.generateAsync({ type: 'blob' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = folder.label + '-selected.zip'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  async function zipSelectedSubs() {
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    document.head.appendChild(s)
    await new Promise(r => s.onload = r)
    const zip = new window.JSZip()
    for (const sfKey of selectedSubs) {
      const sf = subfolders.find(s => s.key === sfKey)
      const folderName = sf ? sf.label : sfKey
      const { data: sfFiles } = await supabase.from('project_doc_files').select('*').eq('project_id', projectId).eq('subfolder_key', sfKey)
      for (const f of (sfFiles || [])) {
        const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 300)
        if (data?.signedUrl) { const res = await fetch(data.signedUrl); zip.file(folderName + '/' + f.file_name, await res.blob()) }
      }
    }
    const blob = await zip.generateAsync({ type: 'blob' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = folder.label + '-folders.zip'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    setSelectedSubs(new Set())
  }

  async function moveSubfolderToRoot(key) {
    await supabase.from('project_doc_folders').update({ parent_key: folder.key }).eq('folder_key', key).eq('project_id', projectId)
    loadCustomSubfolders()
  }

  function onDropFolder(e) {
    e.preventDefault(); e.stopPropagation()
    const subKey = e.dataTransfer.getData('subfolder')
    if (subKey) { moveSubfolderToRoot(subKey); return }
    const f = Array.from(e.dataTransfer.files); if (f.length) uploadToFolder(f)
  }

  function onDropBody(e) {
    e.preventDefault(); e.stopPropagation()
    const subKey = e.dataTransfer.getData('subfolder')
    if (subKey) { moveSubfolderToRoot(subKey); return }
    const id = e.dataTransfer.getData('text/plain')
    if (id) { moveFileToRoot(id); return }
    const f = Array.from(e.dataTransfer.files); if (f.length) uploadToFolder(f)
  }

  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function toggleSub(key) {
    setSelectedSubs(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Folder header */}
      <div onClick={() => setOpen(o => !o)} onDragOver={e => e.preventDefault()} onDrop={onDropFolder}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8, cursor: 'pointer', borderLeft: `3px solid ${folder.color}`, background: open ? 'var(--surface2)' : 'var(--surface)', border: `0.5px solid var(--border)`, borderLeftWidth: 3, borderLeftColor: folder.color, transition: 'background 0.1s' }}>
        <FolderIcon folderKey={folder.key} color={folder.color} bg={folder.bg} />
        <div style={{ flex: 1, minWidth: 0 }} onClick={e => { if (renamingFolder) e.stopPropagation() }}>
          {renamingFolder
            ? <input value={renameFolderVal} autoFocus onChange={e => setRenameFolderVal(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter') {
                    if (renameFolderVal.trim() && renameFolderVal.trim() !== folder.label) await onRenameFolder(folder.key, renameFolderVal.trim())
                    setRenamingFolder(false)
                  }
                  if (e.key === 'Escape') setRenamingFolder(false)
                }}
                onFocus={e => e.target.select()} onClick={e => e.stopPropagation()}
                style={{ fontSize: 13, fontWeight: 600, padding: '2px 6px', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text)', width: '100%' }} />
            : <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{folder.label}</div>
          }
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
              {folder.custom && canManage && (
                <>
                  <button onClick={e => { e.stopPropagation(); setRenameFolderVal(folder.label); setRenamingFolder(true) }} title="Rename folder"
                    style={{ ...BtnG, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    {PENCIL} Rename
                  </button>
                  <button onClick={e => { e.stopPropagation(); onDeleteFolder(folder.key) }} title="Delete folder"
                    style={{ ...BtnR, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    {BIN} Delete
                  </button>
                </>
              )}
              <button onClick={() => zipFolder()} style={{ ...Btn, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
                Zip all
              </button>
              {selectedSubs.size > 0 && (
                <button onClick={zipSelectedSubs} style={{ ...BtnG, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
                  ↓ {selectedSubs.size} folder{selectedSubs.size > 1 ? 's' : ''}
                </button>
              )}
              {canAddFolders && <button onClick={() => setShowAddFolder(true)} style={Btn}>+ Subfolder</button>}
              {canManage && (
                <label style={BtnG}>
                  {uploading ? '...' : '+ Upload'}
                  <input type="file" multiple style={{ display: 'none' }} onChange={e => uploadToFolder(Array.from(e.target.files))} />
                </label>
              )}
              {open && <ViewToggle viewMode={viewMode} setView={setView} />}
            </>
          )}
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', marginLeft: 4, flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      {/* Folder body */}
      {open && (
        <div onDragOver={e => e.preventDefault()} onDrop={onDropBody}
          style={{ marginLeft: 16, paddingLeft: 12, borderLeft: `1.5px solid ${folder.color}30`, paddingTop: 8, paddingBottom: 8 }}>
          <BulkBar selected={selected} onZip={bulkZip} onClear={() => setSelected(new Set())} />

          {/* Subfolders with checkboxes */}
          {subfolders.map(sf => (
            <div key={sf.key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}
              onDragOver={e => e.preventDefault()}>
              <div onClick={() => toggleSub(sf.key)}
                style={{ width: 16, height: 16, borderRadius: 3, border: '1.5px solid ' + (selectedSubs.has(sf.key) ? 'var(--accent)' : 'rgba(255,255,255,0.25)'), background: selectedSubs.has(sf.key) ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                {selectedSubs.has(sf.key) && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <SubfolderSection projectId={projectId} folder={folder} subfolder={sf}
                  canManage={canManage} viewMode={viewMode} onPreview={openPreview}
                  onReload={id => {
                    if (id === '__folder_deleted__') loadCustomSubfolders()
                    else loadRootFiles()
                  }}
                  depth={0} />
              </div>
            </div>
          ))}

          {/* Root-level files */}
          {files.length > 0 && (
            <div style={{ marginTop: subfolders.length > 0 ? 10 : 0 }}>
              {subfolders.length > 0 && (
                <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>General files</div>
              )}
              <FilesGrid files={files} viewMode={viewMode} onPreview={openPreview} canManage={canManage}
                onDelete={deleteFile} selected={selected} onSelect={toggleSelect} onDrop={onDropBody} onUpload={uploadToFolder} />
            </div>
          )}

          {/* Empty state */}
          {files.length === 0 && subfolders.length === 0 && canManage && (
            <label onDragOver={e => e.preventDefault()} onDrop={onDropBody}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 56, border: '0.5px dashed var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text3)', fontSize: 11 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Drop files or click to upload
              <input type="file" multiple style={{ display: 'none' }} onChange={e => uploadToFolder(Array.from(e.target.files))} />
            </label>
          )}
        </div>
      )}

      {/* Preview modal */}
      {previewFile && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setPreviewFile(null)}>
          <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 8 }}>
            {previewUrl && <button onClick={e => { e.stopPropagation(); triggerDownload(previewUrl, previewFile.file_name) }} style={{ fontSize: 12, padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>↓ Download</button>}
            <button onClick={() => setPreviewFile(null)} style={{ fontSize: 12, padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>✕ Close</button>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginBottom: 12 }}>{previewFile.file_name}</div>
          {previewUrl ? (
            fileTypeInfo(previewFile.file_name, previewFile.file_type).isImage
              ? <img src={previewUrl} alt={previewFile.file_name} style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 8 }} onClick={e => e.stopPropagation()} />
              : fileTypeInfo(previewFile.file_name, previewFile.file_type).isPdf
              ? <iframe src={previewUrl} style={{ width: '95vw', height: '92vh', border: 'none', borderRadius: 8 }} title={previewFile.file_name} onClick={e => e.stopPropagation()} />
              : <iframe src={'https://docs.google.com/gview?url=' + encodeURIComponent(previewUrl) + '&embedded=true'} style={{ width: '95vw', height: '92vh', border: 'none', borderRadius: 8, background: '#fff' }} title={previewFile.file_name} onClick={e => e.stopPropagation()} />
          ) : (
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Loading preview...</div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Add Top Folder Button ─────────────────────────────────────────────────────
function AddTopFolderButton({ onAdd }) {
  const [show, setShow] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    await onAdd(name.trim())
    setName(''); setShow(false); setSaving(false)
  }

  if (!show) return (
    <button onClick={() => setShow(true)}
      style={{ marginTop: 8, fontSize: 12, padding: '6px 14px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: 'var(--text2)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add folder
    </button>
  )
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Folder name" autoFocus
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setShow(false) }}
        style={{ fontSize: 12, padding: '5px 10px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'var(--surface2)', color: 'var(--text)', flex: 1 }} />
      <button onClick={save} disabled={saving} style={BtnG}>{saving ? '...' : 'Add'}</button>
      <button onClick={() => setShow(false)} style={Btn}>Cancel</button>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function ProjectDocumentation({ projectId, projectName }) {
  const { can } = useAuth()
  const [fileCounts, setFileCounts] = useState({})
  const [customTopFolders, setCustomTopFolders] = useState([])
  const [zippingAll, setZippingAll] = useState(false)

  const canManage = can('manage_projects')
  const canAddFolders = can('manage_projects')

  useEffect(() => {
    const prevent = e => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => { window.removeEventListener('dragover', prevent); window.removeEventListener('drop', prevent) }
  }, [])

  useEffect(() => { loadFileCounts(); loadCustomTopFolders() }, [projectId])

  async function loadFileCounts() {
    const { data } = await supabase.from('project_doc_files').select('folder_key').eq('project_id', projectId)
    if (data) {
      const counts = {}
      data.forEach(f => { counts[f.folder_key] = (counts[f.folder_key] || 0) + 1 })
      setFileCounts(counts)
    }
  }

  async function loadCustomTopFolders() {
    const { data } = await supabase.from('project_doc_folders').select('*')
      .eq('project_id', projectId).is('parent_key', null).order('created_at')
    if (data?.length) {
      setCustomTopFolders(data.map(d => ({
        key: d.folder_key, label: d.label, color: '#888780', bg: '#F1EFE8', subfolders: [], custom: true,
      })))
    }
  }

  async function addTopFolder(name) {
    const key = 'custom-' + Date.now()
    await supabase.from('project_doc_folders').insert({ project_id: projectId, parent_key: null, folder_key: key, label: name })
    setCustomTopFolders(prev => [...prev, { key, label: name, color: '#888780', bg: '#F1EFE8', subfolders: [], custom: true }])
  }

  async function zipAll() {
    setZippingAll(true)
    try {
      const script = document.createElement('script')
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
      document.head.appendChild(script)
      await new Promise(r => script.onload = r)
      const zip = new window.JSZip()
      const { data: allFiles } = await supabase.from('project_doc_files').select('*').eq('project_id', projectId)
      if (!allFiles?.length) { alert('No files in this project.'); setZippingAll(false); return }
      for (const f of allFiles) {
        const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 300)
        if (data?.signedUrl) {
          const res = await fetch(data.signedUrl)
          const sub = f.subfolder_key ? f.subfolder_key + '/' : ''
          zip.file(f.folder_key + '/' + sub + f.file_name, await res.blob())
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (projectName || 'project') + '-all-docs.zip'
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    } catch (e) { alert('Zip failed: ' + e.message) }
    setZippingAll(false)
  }

  const allFolders = [...TEMPLATE_FOLDERS, ...customTopFolders]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={zipAll} disabled={zippingAll}
          style={{ fontSize: 12, padding: '6px 14px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: 'var(--text2)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
          {zippingAll ? 'Zipping...' : 'Zip all documents'}
        </button>
      </div>
      <div>
        {allFolders.map(folder => (
          <PrimeFolderSection key={folder.key} projectId={projectId} folder={folder}
            canManage={canManage} canAddFolders={canAddFolders} allFileCounts={fileCounts}
            onDeleteFolder={async (key) => {
              if (!window.confirm('Delete this folder and ALL its files? This cannot be undone.')) return
              await supabase.from('project_doc_files').delete().eq('project_id', projectId).eq('folder_key', key)
              await supabase.from('project_doc_folders').delete().eq('folder_key', key).eq('project_id', projectId)
              setCustomTopFolders(prev => prev.filter(f => f.key !== key))
            }}
            onRenameFolder={async (key, label) => {
              await supabase.from('project_doc_folders').update({ label }).eq('folder_key', key).eq('project_id', projectId)
              setCustomTopFolders(prev => prev.map(f => f.key === key ? { ...f, label } : f))
            }} />
        ))}
      </div>
      {canAddFolders && <AddTopFolderButton onAdd={addTopFolder} />}
    </div>
  )
}
