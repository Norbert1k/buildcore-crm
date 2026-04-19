import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { formatDate } from '../lib/utils'
import { Spinner } from '../components/ui'
import UploadProgress from '../components/UploadProgress'

const CATEGORIES = [
  { key: 'logo',           icon: '🏢', label: 'Logo & Branding',   color: '#448a40', bg: '#e8f5e7' },
  { key: 'policies',       icon: '📋', label: 'Policies',           color: '#378ADD', bg: '#E6F1FB' },
  { key: 'insurance',      icon: '🛡️', label: 'Insurance',          color: '#BA7517', bg: '#FAEEDA' },
  { key: 'vat',            icon: '💰', label: 'VAT & UTR',          color: '#888780', bg: '#F1EFE8' },
  { key: 'bank',           icon: '🏦', label: 'Bank Details',       color: '#448a40', bg: '#e8f5e7' },
  { key: 'certifications', icon: '📜', label: 'Certifications',     color: '#534AB7', bg: '#EEEDFE' },
  { key: 'templates',      icon: '📝', label: 'Templates',          color: '#0F6E56', bg: '#E1F5EE' },
  { key: 'site_folder',    icon: '📁', label: 'Site Folder',        color: '#888780', bg: '#F1EFE8' },
  { key: 'other',           icon: '🗃️', label: 'Other Documents',     color: '#6B5B93', bg: '#EEE8F8' },
]

function fmtSize(b) {
  if (!b) return ''
  if (b < 1024) return b + 'B'
  if (b < 1048576) return (b / 1024).toFixed(0) + 'KB'
  return (b / 1048576).toFixed(1) + 'MB'
}
function fileExt(name) { return name?.split('.').pop()?.toUpperCase().slice(0, 4) || 'FILE' }
function naturalSort(arr) {
  return [...arr].sort((a, b) => a.file_name.localeCompare(b.file_name, undefined, { numeric: true, sensitivity: 'base' }))
}

const B  = { fontSize: 11, lineHeight: '24px', padding: '0 9px', margin: 0, border: '0.5px solid var(--border)', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--text2)', display: 'inline-block', alignSelf: 'center', whiteSpace: 'nowrap', flexShrink: 0 }
const BG = { fontSize: 11, lineHeight: '24px', padding: '0 9px', margin: 0, border: '0.5px solid #448a40', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: '#448a40', display: 'inline-block', alignSelf: 'center', whiteSpace: 'nowrap', flexShrink: 0 }
const BR = { fontSize: 11, lineHeight: '24px', padding: '0 9px', margin: 0, border: '0.5px solid var(--red-border)', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--red)', display: 'inline-block', alignSelf: 'center', whiteSpace: 'nowrap', flexShrink: 0 }

function CountBadge({ count }) {
  if (!count) return null
  return (
    <div style={{ background: 'var(--surface2)', color: 'var(--text3)', fontSize: 10, fontWeight: 500, padding: '1px 7px', borderRadius: 10, flexShrink: 0 }}>{count}</div>
  )
}

function ExcelPreview({ url, fileName, onClose, onDownload }) {
  const [html, setHtml] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sheets, setSheets] = useState([])
  const [activeSheet, setActiveSheet] = useState(0)

  useEffect(() => {
    if (!url) return
    let cancelled = false
    async function load() {
      try {
        const script = document.createElement('script')
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
        document.head.appendChild(script)
        await new Promise((r, j) => { script.onload = r; script.onerror = j })
        const res = await fetch(url)
        const buf = await res.arrayBuffer()
        const wb = window.XLSX.read(buf, { type: 'array' })
        if (cancelled) return
        const allSheets = wb.SheetNames.map(name => ({
          name,
          html: window.XLSX.utils.sheet_to_html(wb.Sheets[name], { editable: false })
        }))
        setSheets(allSheets)
        setHtml(allSheets[0]?.html || '<p>Empty spreadsheet</p>')
        setLoading(false)
      } catch (e) { if (!cancelled) { setError(e.message); setLoading(false) } }
    }
    load()
    return () => { cancelled = true }
  }, [url])

  function switchSheet(i) {
    setActiveSheet(i)
    setHtml(sheets[i]?.html || '')
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 20 }} onClick={onClose}>
      <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 8, zIndex: 1 }}>
        {onDownload && <button onClick={e => { e.stopPropagation(); onDownload() }} style={{ fontSize: 12, padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>↓ Download</button>}
        <button onClick={onClose} style={{ fontSize: 12, padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>✕ Close</button>
      </div>
      <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginBottom: 8, marginTop: 8 }}>{fileName}</div>
      {sheets.length > 1 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }} onClick={e => e.stopPropagation()}>
          {sheets.map((s, i) => (
            <button key={i} onClick={() => switchSheet(i)}
              style={{ fontSize: 11, padding: '4px 10px', borderRadius: 4, border: '0.5px solid rgba(255,255,255,0.3)', background: i === activeSheet ? 'rgba(255,255,255,0.2)' : 'transparent', color: '#fff', cursor: 'pointer' }}>{s.name}</button>
          ))}
        </div>
      )}
      <div onClick={e => e.stopPropagation()} style={{ flex: 1, width: '95vw', maxHeight: '85vh', overflow: 'auto', background: '#fff', borderRadius: 8, padding: 0 }}>
        {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading spreadsheet...</div>
          : error ? <div style={{ padding: 40, textAlign: 'center', color: '#e24b4a' }}>Failed to load: {error}</div>
          : <div style={{ fontSize: 12, overflowX: 'auto' }} dangerouslySetInnerHTML={{ __html: `<style>table{border-collapse:collapse;width:100%}td,th{border:1px solid #d0d0d0;padding:6px 10px;font-size:13px;color:#1a1a1a;white-space:nowrap;max-width:300px;overflow:hidden;text-overflow:ellipsis}th{background:#e8e8e8;font-weight:600;color:#111;position:sticky;top:0}tr:nth-child(even){background:#f5f5f5}tr:hover{background:#e6f1fb}</style>${html}` }} />
        }
      </div>
    </div>
  )
}

const PENCIL = <svg width="11" height="11" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="2" width="4" height="16" rx="1" fill="#e53935"/><rect x="10" y="7" width="4" height="4" fill="#FDD835"/><polygon points="10,18 14,18 12,23" fill="#fff"/><rect x="10" y="2" width="4" height="2.5" rx="0.5" fill="#555"/></svg>
const BIN = <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>

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

async function readDropEntries(e) {
  const items = e.dataTransfer?.items
  if (!items) return { files: Array.from(e.dataTransfer?.files || []), folders: [] }
  const entries = []
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.()
    if (entry) entries.push(entry)
  }
  if (!entries.length) return { files: Array.from(e.dataTransfer?.files || []), folders: [] }
  const result = { files: [], folders: new Set() }
  async function walk(entry, path) {
    if (entry.isFile) {
      const file = await new Promise(r => entry.file(r))
      result.files.push({ file, path })
      if (path) result.folders.add(path)
    } else if (entry.isDirectory) {
      const dirPath = path ? path + '/' + entry.name : entry.name
      result.folders.add(dirPath)
      const reader = entry.createReader()
      const children = await new Promise(r => reader.readEntries(r))
      for (const child of children) await walk(child, dirPath)
    }
  }
  for (const entry of entries) await walk(entry, '')
  return { files: result.files, folders: [...result.folders] }
}

function Confirm({ message, onOk, onCancel }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onCancel}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 360, width: '90%' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 14, marginBottom: 20, color: 'var(--text)' }}>{message}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={B}>Cancel</button>
          <button onClick={onOk} style={BR}>Delete</button>
        </div>
      </div>
    </div>
  )
}

function fileTypeInfo(doc) {
  const t = doc.file_type || ''
  const n = doc.file_name || ''
  const isImage = t.includes('image') || /\.(jpg|jpeg|png|gif|webp)$/i.test(n)
  const isPdf = t.includes('pdf') || /\.pdf$/i.test(n)
  const isExcel = t.includes('spreadsheet') || t.includes('excel') || /\.xlsx?$/i.test(n)
  const isPpt = t.includes('presentation') || t.includes('powerpoint') || /\.pptx?$/i.test(n)
  const isWord = !isExcel && !isPpt && (t.includes('word') || t.includes('wordprocessing') || /\.docx?$/i.test(n))
  return { isImage, isPdf, isWord, isExcel, isPpt }
}

function FileTypeBadge({ doc, size = 36 }) {
  const { isWord, isExcel, isPpt } = fileTypeInfo(doc)
  const color = isWord ? '#1B5EAE' : isExcel ? '#1D7B45' : isPpt ? '#C55A25' : null
  const letter = isWord ? 'W' : isExcel ? 'X' : isPpt ? 'P' : null
  if (!color) return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  )
  return (
    <div style={{ width: size, height: size + 8, background: color, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: '#fff', fontSize: size * 0.55, fontWeight: 700, fontFamily: 'Arial' }}>{letter}</span>
    </div>
  )
}

// ── File Card (grid/compact view) ─────────────────────────────────────────────
function FileCard({ doc, onPreview, onDelete, canDelete, selected, onSelect }) {
  const [url, setUrl] = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const { isImage, isPdf } = fileTypeInfo(doc)

  useEffect(() => {
    supabase.storage.from('company-docs').createSignedUrl(doc.storage_path, 3600)
      .then(({ data }) => { if (data?.signedUrl) setUrl(data.signedUrl) })
  }, [doc.storage_path])

  async function renameFile() {
    if (!renameVal.trim() || renameVal.trim() === doc.file_name) { setRenaming(false); return }
    await supabase.from('company_documents').update({ file_name: renameVal.trim() }).eq('id', doc.id)
    doc.file_name = renameVal.trim()
    setRenaming(false)
  }

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
      <div draggable={!renaming} onDragStart={handleDragStart}
        style={{ border: selected ? '2px solid var(--accent)' : '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)', cursor: renaming ? 'default' : 'grab', position: 'relative', transition: 'border .1s' }}>
        <div onClick={e => { e.stopPropagation(); onSelect(doc.id) }}
          style={{ position: 'absolute', top: 6, left: 6, zIndex: 1, width: 18, height: 18, borderRadius: 4, border: '2px solid ' + (selected ? 'var(--accent)' : 'rgba(255,255,255,0.4)'), background: selected ? 'var(--accent)' : 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          {selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
        </div>
        <div style={{ height: 130, background: 'var(--surface2)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer' }} onClick={() => onPreview(doc)}>
          {isImage && url
            ? <img src={url} alt={doc.file_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : isPdf && url
            ? <iframe src={url + '#page=1&toolbar=0&navpanes=0&scrollbar=0'} style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }} title={doc.file_name} />
            : <FileTypeBadge doc={doc} size={36} />
          }
          <div style={{ position: 'absolute', top: 5, right: 5, background: 'rgba(0,0,0,0.55)', color: 'white', fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3 }}>{fileExt(doc.file_name)}</div>
        </div>
        <div style={{ padding: '7px 9px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }} onClick={e => { if (renaming) e.stopPropagation() }}>
            {renaming
              ? <input value={renameVal} autoFocus onChange={e => setRenameVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') renameFile(); if (e.key === 'Escape') setRenaming(false) }}
                  onFocus={e => e.target.select()}
                  onClick={e => e.stopPropagation()}
                  style={{ flex: 1, fontSize: 11, padding: '1px 5px', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text)', minWidth: 0 }} />
              : <>
                  <div style={{ flex: 1, fontSize: 11, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.file_name}>{doc.file_name}</div>
                  {canDelete && (
                  <button onClick={e => { e.stopPropagation(); setRenameVal(doc.file_name); setRenaming(true) }}
                    title="Rename file"
                    style={{ flexShrink: 0, cursor: 'pointer', background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: 4, padding: '2px 4px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#448a40" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                )}
                </>
            }
          </div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 6 }}>{fmtSize(doc.file_size)}{doc.file_size ? ' · ' : ''}{formatDate(doc.created_at)}</div>
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

// ── File List Row (list view) ──────────────────────────────────────────────────
function FileListRow({ doc, onPreview, onDelete, canDelete, selected, onSelect }) {
  const [url, setUrl] = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const { isWord, isExcel, isPpt, isPdf, isImage } = fileTypeInfo(doc)
  const iconColor = isPdf ? '#E24B4A' : isWord ? '#1B5EAE' : isExcel ? '#1D7B45' : isPpt ? '#C55A25' : isImage ? '#448a40' : '#888'
  const iconLetter = isPdf ? 'PDF' : isWord ? 'W' : isExcel ? 'X' : isPpt ? 'P' : null

  useEffect(() => {
    supabase.storage.from('company-docs').createSignedUrl(doc.storage_path, 3600)
      .then(({ data }) => { if (data?.signedUrl) setUrl(data.signedUrl) })
  }, [doc.storage_path])

  async function renameFile() {
    if (!renameVal.trim() || renameVal.trim() === doc.file_name) { setRenaming(false); return }
    await supabase.from('company_documents').update({ file_name: renameVal.trim() }).eq('id', doc.id)
    doc.file_name = renameVal.trim()
    setRenaming(false)
  }

  function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', doc.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <>
      <div draggable={!renaming} onDragStart={handleDragStart}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 6, border: selected ? '1.5px solid var(--accent)' : '0.5px solid var(--border)', background: 'var(--surface)', cursor: renaming ? 'default' : 'grab', transition: 'border .1s' }}>
        <div onClick={e => { e.stopPropagation(); onSelect(doc.id) }}
          style={{ width: 16, height: 16, borderRadius: 3, border: '2px solid ' + (selected ? 'var(--accent)' : 'rgba(255,255,255,0.3)'), background: selected ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
          {selected && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
        </div>
        <div style={{ width: 32, height: 32, borderRadius: 5, background: iconColor + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {iconLetter
            ? <span style={{ fontSize: 10, fontWeight: 700, color: iconColor }}>{iconLetter}</span>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          }
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {renaming && (
            <input value={renameVal} autoFocus onChange={e => setRenameVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') renameFile(); if (e.key === 'Escape') setRenaming(false) }}
              onFocus={e => e.target.select()}
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', fontSize: 12, padding: '2px 6px', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text)', marginBottom: 2 }} />
          )}
          {!renaming && <div onClick={() => onPreview(doc)} style={{ cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', wordBreak: 'break-word', lineHeight: '1.3', flex: 1 }}>{doc.file_name}</div>
              {canDelete && (
                  <button onClick={e => { e.stopPropagation(); setRenameVal(doc.file_name); setRenaming(true) }}
                    title="Rename file"
                    style={{ flexShrink: 0, cursor: 'pointer', background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: 4, padding: '2px 4px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#448a40" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                )}
            </div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{fmtSize(doc.file_size)}{doc.file_size ? ' · ' : ''}{formatDate(doc.created_at)}</div>
          </div>}
        </div>
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

// ── Files Renderer (shared by category + subfolder) ───────────────────────────
function FilesGrid({ files, viewMode, onPreview, canManage, onDelete, selected, onSelect, onDrop, upload }) {
  if (files.length === 0) return null
  if (viewMode === 'list') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {files.map(f => (
          <FileListRow key={f.id} doc={f} onPreview={onPreview} canDelete={canManage} onDelete={onDelete}
            selected={selected.has(f.id)} onSelect={onSelect} />
        ))}
      </div>
    )
  }
  const cols = viewMode === 'compact' ? 'repeat(auto-fill, minmax(90px, 1fr))' : 'repeat(auto-fill, minmax(130px, 1fr))'
  const gap = viewMode === 'compact' ? 6 : 8
  return (
    <div style={{ display: 'grid', gridTemplateColumns: cols, gap }}>
      {files.map(f => (
        <FileCard key={f.id} doc={f} onPreview={onPreview} canDelete={canManage} onDelete={onDelete}
          selected={selected.has(f.id)} onSelect={onSelect} />
      ))}
      {canManage && viewMode !== 'list' && (
        <label onDragOver={e => e.preventDefault()} onDrop={onDrop}
          style={{ border: '0.5px dashed var(--border)', borderRadius: 8, minHeight: 70, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer', color: 'var(--text3)', fontSize: 10 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add files
          <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} />
        </label>
      )}
    </div>
  )
}

// ── View Toggle ───────────────────────────────────────────────────────────────
function ViewToggle({ viewMode, setView }) {
  const views = [
    { mode: 'grid',    title: 'Grid',    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> },
    { mode: 'compact', title: 'Compact', icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="4" height="4"/><rect x="10" y="2" width="4" height="4"/><rect x="18" y="2" width="4" height="4"/><rect x="2" y="10" width="4" height="4"/><rect x="10" y="10" width="4" height="4"/><rect x="18" y="10" width="4" height="4"/><rect x="2" y="18" width="4" height="4"/><rect x="10" y="18" width="4" height="4"/><rect x="18" y="18" width="4" height="4"/></svg> },
    { mode: 'list',    title: 'List',    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg> },
  ]
  return (
    <div style={{ display: 'flex', gap: 2 }}>
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
      <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 500, background: 'var(--accent)', color: '#fff', borderRadius: 12, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 24px rgba(0,0,0,0.3)', flexWrap: 'wrap', justifyContent: 'center', maxWidth: 'calc(100vw - 32px)' }}>
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
                  <div key={sf.folder_key} onClick={() => { onMove(sf.folder_key, cat.key); setShowMove(false) }}
                    style={{ padding: '8px 14px 8px 28px', fontSize: 13, cursor: 'pointer', color: 'var(--text)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
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

// ── Subfolder Section ─────────────────────────────────────────────────────────
function SubfolderSection({ subfolder, categoryKey, color, canManage, onPreview, onReload, depth = 0, viewMode = 'grid' }) {
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

  useEffect(() => { loadFileCount() }, [])
  useEffect(() => { if (open) { loadFiles(); loadChildFolders() } }, [open])

  async function loadFileCount() {
    const { count } = await supabase.from('company_documents').select('id', { count: 'exact', head: true })
      .eq('subfolder_key', subfolder.key)
    setFileCount(count || 0)
  }

  async function loadFiles() {
    const { data } = await supabase.from('company_documents')
      .select('*, profiles(full_name)').eq('category', categoryKey).eq('subfolder_key', subfolder.key)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: false })
    setFiles(naturalSort(data || []))
    setFileCount((data || []).length)
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
    const fileArr = Array.from(fileList)
    setUploading(true)
    setUploadProgress({ active: true, files: fileArr.map(f => f.name), current: 0, total: fileArr.length, errors: [] })
    const errors = []
    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i]
      setUploadProgress(prev => ({ ...prev, current: i }))
      const path = 'company/' + categoryKey + '/' + subfolder.key + '/' + Date.now() + '-' + file.name
      const { error } = await supabase.storage.from('company-docs').upload(path, file)
      if (!error) await supabase.from('company_documents').insert({ category: categoryKey, subfolder_key: subfolder.key, file_name: file.name, file_type: file.type, file_size: file.size, storage_path: path })
      else errors.push(file.name)
    }
    setUploading(false)
    setUploadProgress({ active: false, files: fileArr.map(f => f.name), current: fileArr.length, total: fileArr.length, errors })
    loadFiles()
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
    setNewSubName(''); setShowAddSub(false); setSavingSub(false); loadChildFolders(); if (onReload) onReload('__folder_renamed__')
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
  async function moveSubfolder(key) {
    // Move subfolder into this subfolder (set parent_folder_key to this subfolder's key)
    if (key === subfolder.key) return // can't move into itself
    await supabase.from('company_doc_subfolders').update({ parent_folder_key: subfolder.key }).eq('folder_key', key)
    loadChildFolders()
    if (onReload) onReload('__folder_deleted__') // trigger parent to refresh its list
  }

  async function onDrop(e) {
    e.preventDefault(); e.stopPropagation()
    const subKey = e.dataTransfer.getData('subfolder')
    if (subKey) { moveSubfolder(subKey); return }
    const id = e.dataTransfer.getData('text/plain')
    if (id) { moveFile(id); return }
    const drop = await readDropEntries(e)
    if (drop.folders.length > 0) {
      const keyMap = {}
      for (const fp of drop.folders.sort()) {
        const parts = fp.split('/')
        const label = parts[parts.length - 1]
        const parentPath = parts.slice(0, -1).join('/')
        const parentKey = parentPath ? keyMap[parentPath] : subfolder.key
        const key = (parentKey || subfolder.key) + '-sub-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
        keyMap[fp] = key
        await supabase.from('company_doc_subfolders').insert({ category_key: categoryKey, folder_key: key, label, parent_folder_key: parentKey || subfolder.key })
      }
      for (const { file, path } of drop.files) {
        const sfKey = path ? keyMap[path] : subfolder.key
        const storagePath = 'company/' + categoryKey + '/' + sfKey + '/' + Date.now() + '-' + file.name
        const { error } = await supabase.storage.from('company-docs').upload(storagePath, file)
        if (!error) await supabase.from('company_documents').insert({ category: categoryKey, subfolder_key: sfKey, file_name: file.name, file_type: file.type, file_size: file.size, storage_path: storagePath })
      }
      loadChildFolders(); loadFiles(); if (onReload) onReload('__folder_renamed__')
    } else {
      const f = drop.files.map(x => x.file)
      if (f.length) upload(f)
    }
  }
  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  return (
    <div style={{ marginBottom: 2 }}>
      <UploadProgress uploadState={uploadProgress} />
      <div
        draggable={!renaming}
        onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData('subfolder', subfolder.key); e.dataTransfer.setData('subfolder_label', subLabel); e.dataTransfer.effectAllowed = 'move' }}
        onClick={() => setOpen(o => !o)} onDragOver={e => e.preventDefault()} onDrop={onDrop}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', paddingLeft: 10 + depth * 12, borderRadius: 6, cursor: 'pointer', background: open ? 'var(--surface2)' : 'transparent', transition: 'background .1s' }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--surface2)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent' }}>
        <div style={{ width: 24, height: 24, borderRadius: 5, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13 }}>📁</div>
        {renaming
          ? <input value={renameVal} autoFocus onChange={e => setRenameVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') renameFolder(); if (e.key === 'Escape') setRenaming(false) }}
              onClick={e => e.stopPropagation()}
              style={{ flex: 1, fontSize: 12, padding: '2px 8px', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text)' }} />
          : <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{subLabel}</span>
        }
        <span style={{ fontSize: 10, color: 'var(--text3)' }}>{open && (files.length + childFolders.length) > 0 ? (files.length + childFolders.length) + ' items' : ''}</span>
        {!open && <CountBadge count={fileCount} />}
        {canManage && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={e => e.stopPropagation()}>
            {!renaming && (
              <>
                <button onClick={() => { setRenameVal(subLabel); setRenaming(true) }} style={B} title="Rename">{PENCIL}</button>
                {confirmDelFolder
                  ? <>
                      <button onClick={deleteFolder} style={BR}>Confirm</button>
                      <button onClick={() => setConfirmDelFolder(false)} style={B}>✕</button>
                    </>
                  : <button onClick={() => setConfirmDelFolder(true)} style={BR} title="Delete">{BIN}</button>
                }
              </>
            )}
            {showAddSub
              ? <>
                  <input value={newSubName} onChange={e => setNewSubName(e.target.value)} placeholder="Name" autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') addChildFolder(); if (e.key === 'Escape') setShowAddSub(false) }}
                    style={{ fontSize: 11, lineHeight: '24px', padding: '0 6px', border: '0.5px solid var(--border)', borderRadius: 5, background: 'var(--surface2)', color: 'var(--text)', width: 90 }} />
                  <button onClick={addChildFolder} disabled={savingSub} style={BG}>{savingSub ? '...' : 'Add'}</button>
                  <button onClick={() => { setShowAddSub(false); setNewSubName('') }} style={B}>✕</button>
                </>
              : <button onClick={() => setShowAddSub(true)} style={B}>+ Sub</button>
            }
            <label style={BG}>
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
          {files.length === 0 && childFolders.length === 0 ? (
            <label onDragOver={e => e.preventDefault()} onDrop={onDrop}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 50, border: '0.5px dashed var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text3)', fontSize: 11 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Drop files or click to upload
              <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} />
            </label>
          ) : (
            <FilesGrid files={files} viewMode={viewMode} onPreview={onPreview} canManage={canManage}
              onDelete={deleteDoc} selected={selected} onSelect={toggleSelect} onDrop={onDrop} upload={upload} />
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
  const [uploadProgress, setUploadProgress] = useState({ active: false, files: [], current: 0, total: 0, errors: [] })
  const [showAddSub, setShowAddSub] = useState(false)
  const [newSubName, setNewSubName] = useState('')
  const [savingSub, setSavingSub] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const [selected, setSelected] = useState(new Set())
  const [allSubfolders, setAllSubfolders] = useState({})
  const [selectedSubs, setSelectedSubs] = useState(new Set())
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('docView_' + cat.key) || 'grid' } catch { return 'grid' }
  })

  function setView(mode) {
    setViewMode(mode)
    try { localStorage.setItem('docView_' + cat.key, mode) } catch {}
  }

  useEffect(() => { if (open) { loadFiles(); loadSubfolders(); loadAllSubfolders() } }, [open])
  useEffect(() => {
    supabase.from('company_documents').select('id', { count: 'exact' }).eq('category', cat.key)
      .then(({ count }) => setTotalCount(count || 0))
  }, [cat.key, open])

  async function loadFiles() {
    const { data } = await supabase.from('company_documents')
      .select('*, profiles(full_name)').eq('category', cat.key).is('subfolder_key', null)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: false })
    setFiles(naturalSort(data || []))
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
    const fileArr = Array.from(fileList)
    setUploading(true)
    setUploadProgress({ active: true, files: fileArr.map(f => f.name), current: 0, total: fileArr.length, errors: [] })
    const errors = []
    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i]
      setUploadProgress(prev => ({ ...prev, current: i }))
      const path = 'company/' + cat.key + '/' + Date.now() + '-' + file.name
      const { error } = await supabase.storage.from('company-docs').upload(path, file)
      if (!error) await supabase.from('company_documents').insert({ category: cat.key, file_name: file.name, file_type: file.type, file_size: file.size, storage_path: path })
      else errors.push(file.name)
    }
    setUploading(false)
    setUploadProgress({ active: false, files: fileArr.map(f => f.name), current: fileArr.length, total: fileArr.length, errors })
    loadFiles()
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
    setNewSubName(''); setShowAddSub(false); setSavingSub(false); loadSubfolders(); loadAllSubfolders()
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
  async function zipSelected() {
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    s.onload = async () => {
      const zip = new window.JSZip()
      for (const sfKey of selectedSubs) {
        const sf = subfolders.find(s => s.folder_key === sfKey)
        const folderName = sf ? sf.label : sfKey
        const { data: sfFiles } = await supabase.from('company_documents').select('*').eq('subfolder_key', sfKey)
        for (const f of (sfFiles || [])) {
          const { data } = await supabase.storage.from('company-docs').createSignedUrl(f.storage_path, 300)
          if (data?.signedUrl) { const res = await fetch(data.signedUrl); zip.file(folderName + '/' + f.file_name, await res.blob()) }
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = cat.label + '-selected.zip'; a.click()
      setSelectedSubs(new Set())
    }
    document.head.appendChild(s)
  }

  async function onDropFolder(e) {
    e.preventDefault(); e.stopPropagation()
    const subKey = e.dataTransfer.getData('subfolder')
    if (subKey) { moveSubfolderToRoot(subKey); return }
    const drop = await readDropEntries(e)
    if (drop.folders.length > 0) {
      const keyMap = {}
      for (const fp of drop.folders.sort()) {
        const parts = fp.split('/')
        const label = parts[parts.length - 1]
        const parentPath = parts.slice(0, -1).join('/')
        const parentKey = parentPath ? keyMap[parentPath] : null
        const key = cat.key + '-sub-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
        keyMap[fp] = key
        await supabase.from('company_doc_subfolders').insert({ category_key: cat.key, folder_key: key, label, parent_folder_key: parentKey || null })
      }
      for (const { file, path } of drop.files) {
        const sfKey = path ? keyMap[path] : null
        const storagePath = 'company/' + cat.key + '/' + (sfKey || 'root') + '/' + Date.now() + '-' + file.name
        const { error } = await supabase.storage.from('company-docs').upload(storagePath, file)
        if (!error) await supabase.from('company_documents').insert({ category: cat.key, subfolder_key: sfKey, file_name: file.name, file_type: file.type, file_size: file.size, storage_path: storagePath })
      }
      loadSubfolders(); loadFiles(); loadAllSubfolders()
    } else {
      const f = drop.files.map(x => x.file)
      if (f.length) upload(f)
    }
  }
  async function moveSubfolderToRoot(key) {
    await supabase.from('company_doc_subfolders').update({ parent_folder_key: null }).eq('folder_key', key)
    loadSubfolders()
  }

  async function onDropBody(e) {
    e.preventDefault(); e.stopPropagation()
    const subKey = e.dataTransfer.getData('subfolder')
    if (subKey) { moveSubfolderToRoot(subKey); return }
    const id = e.dataTransfer.getData('text/plain')
    if (id) { moveToRoot(id); return }
    const drop = await readDropEntries(e)
    if (drop.folders.length > 0) {
      const keyMap = {}
      for (const fp of drop.folders.sort()) {
        const parts = fp.split('/')
        const label = parts[parts.length - 1]
        const parentPath = parts.slice(0, -1).join('/')
        const parentKey = parentPath ? keyMap[parentPath] : null
        const key = cat.key + '-sub-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
        keyMap[fp] = key
        await supabase.from('company_doc_subfolders').insert({ category_key: cat.key, folder_key: key, label, parent_folder_key: parentKey || null })
      }
      for (const { file, path } of drop.files) {
        const sfKey = path ? keyMap[path] : null
        const storagePath = 'company/' + cat.key + '/' + (sfKey || 'root') + '/' + Date.now() + '-' + file.name
        const { error } = await supabase.storage.from('company-docs').upload(storagePath, file)
        if (!error) await supabase.from('company_documents').insert({ category: cat.key, subfolder_key: sfKey, file_name: file.name, file_type: file.type, file_size: file.size, storage_path: storagePath })
      }
      loadSubfolders(); loadFiles(); loadAllSubfolders()
    } else {
      const f = drop.files.map(x => x.file)
      if (f.length) upload(f)
    }
  }
  function toggleSelect(id) { setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  function toggleSub(key) { setSelectedSubs(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n }) }

  return (
    <div style={{ marginBottom: 6 }}>
      <UploadProgress uploadState={uploadProgress} />
      <div onClick={() => setOpen(o => !o)} onDragOver={e => e.preventDefault()} onDrop={onDropFolder}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 8, cursor: 'pointer', background: open ? 'var(--surface2)' : 'var(--surface)', border: '0.5px solid var(--border)', borderLeft: '3px solid ' + cat.color, transition: 'background .1s' }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--surface2)' }}
        onMouseLeave={e => { e.currentTarget.style.background = open ? 'var(--surface2)' : 'var(--surface)' }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: cat.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18 }}>{cat.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{cat.label}</div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>
            {totalCount > 0 ? totalCount + ' file' + (totalCount !== 1 ? 's' : '') : 'Empty'}
            {subfolders.length > 0 ? ' · ' + subfolders.length + ' sub-folder' + (subfolders.length !== 1 ? 's' : '') : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
          {showAddSub ? (
            <>
              <input value={newSubName} onChange={e => setNewSubName(e.target.value)} placeholder="Subfolder name" autoFocus
                onKeyDown={e => { if (e.key === 'Enter') addSubfolder(); if (e.key === 'Escape') setShowAddSub(false) }}
                style={{ fontSize: 11, lineHeight: '24px', padding: '0 8px', border: '0.5px solid var(--border)', borderRadius: 5, background: 'var(--surface2)', color: 'var(--text)', width: 130, alignSelf: 'center' }} />
              <button onClick={addSubfolder} disabled={savingSub} style={BG}>{savingSub ? '...' : 'Add'}</button>
              <button onClick={() => { setShowAddSub(false); setNewSubName('') }} style={B}>✕</button>
            </>
          ) : (
            <>
              <button onClick={zipFolder} disabled={zipping} style={{ ...B, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
                {zipping ? '...' : 'Zip all'}
              </button>
              {selectedSubs.size > 0 && (
                <button onClick={zipSelected} style={{ ...BG, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
                  ↓ {selectedSubs.size} folder{selectedSubs.size > 1 ? 's' : ''}
                </button>
              )}
              {canManage && <button onClick={() => setShowAddSub(true)} style={B}>+ Subfolder</button>}
              {canManage && (
                <label style={BG}>
                  {uploading ? '...' : '+ Upload'}
                  <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} />
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
      {open && (
        <div onDragOver={e => e.preventDefault()} onDrop={onDropBody}
          style={{ marginLeft: 16, paddingLeft: 12, borderLeft: '1.5px solid ' + cat.color + '30', paddingTop: 8, paddingBottom: 8 }}>
          <BulkBar selected={selected} onZip={bulkZip} onMove={bulkMove} onClear={() => setSelected(new Set())} allSubfolders={allSubfolders} />
          {subfolders.map(sf => (
            <div key={sf.folder_key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div onClick={() => toggleSub(sf.folder_key)}
                style={{ width: 16, height: 16, borderRadius: 3, border: '1.5px solid ' + (selectedSubs.has(sf.folder_key) ? 'var(--accent)' : 'rgba(255,255,255,0.25)'), background: selectedSubs.has(sf.folder_key) ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, marginTop: 1 }}>
                {selectedSubs.has(sf.folder_key) && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <SubfolderSection subfolder={{ key: sf.folder_key, label: sf.label }}
                  categoryKey={cat.key} color={cat.color} canManage={canManage} onPreview={onPreview} viewMode={viewMode}
                  onReload={id => {
                    if (id === '__folder_deleted__') { loadSubfolders(); loadAllSubfolders() }
                    else if (id === '__folder_renamed__') { loadAllSubfolders() }
                    else setFiles(prev => prev.filter(f => f.id !== id))
                  }} />
              </div>
            </div>
          ))}
          {files.length > 0 && (
            <div style={{ marginTop: subfolders.length > 0 ? 10 : 0 }}>
              {subfolders.length > 0 && <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>General files</div>}
              <FilesGrid files={files} viewMode={viewMode} onPreview={onPreview} canManage={canManage}
                onDelete={deleteDoc} selected={selected} onSelect={toggleSelect} onDrop={onDropBody} upload={upload} />
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
  const hiddenCats = []
  if (!can('view_company_vat')) hiddenCats.push('vat')
  if (!can('view_company_bank')) hiddenCats.push('bank')
  if (!can('view_company_other')) hiddenCats.push('other')
  if (!can('view_company_templates')) hiddenCats.push('templates')
  const visibleCategories = CATEGORIES.filter(c => !hiddenCats.includes(c.key))
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
        {visibleCategories.map(cat => <CategoryFolder key={cat.key} cat={cat} canManage={canManage} onPreview={openPreview} />)}
      </div>
      {previewDoc && (
        fileTypeInfo(previewDoc).isExcel
          ? <ExcelPreview url={previewUrl} fileName={previewDoc.file_name}
              onClose={() => setPreviewDoc(null)}
              onDownload={previewUrl ? () => triggerDownload(previewUrl, previewDoc.file_name) : null} />
          : <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setPreviewDoc(null)}>
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
            ? fileTypeInfo(previewDoc).isImage
              ? <img src={previewUrl} alt={previewDoc.file_name} style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 8 }} onClick={e => e.stopPropagation()} />
              : fileTypeInfo(previewDoc).isPdf
              ? <iframe src={previewUrl} style={{ width: '95vw', height: '92vh', border: 'none', borderRadius: 8 }} title={previewDoc.file_name} onClick={e => e.stopPropagation()} />
              : <iframe src={'https://docs.google.com/gview?url=' + encodeURIComponent(previewUrl) + '&embedded=true'} style={{ width: '95vw', height: '92vh', border: 'none', borderRadius: 8, background: '#fff' }} title={previewDoc.file_name} onClick={e => e.stopPropagation()} />
            : <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Unable to preview this file</div>
          }
        </div>
      )}
    </div>
  )
}
