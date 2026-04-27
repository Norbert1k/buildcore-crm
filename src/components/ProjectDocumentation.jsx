import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import UploadProgress from './UploadProgress'
import GanttEditor from './Gantt/GanttEditor'
import ProgressReportEditor, { generateProgressReportPdf } from './ProgressReportEditor'

// ── Fixed template folders ────────────────────────────────────────────────────
const TEMPLATE_FOLDERS = [
  {
    key: '00-project-information',
    label: '00. Project Information',
    color: '#448a40',
    bg: '#e8f5e7',
    subfolders: [
      { key: 'drawings', label: '01. Drawings' },
      { key: 'reports',  label: '02. Surveys & Reports' },
      { key: 'csa',      label: '03. CSA' },
      { key: 'cff',      label: '04. CFF - Cashflow Forecast' },
      { key: 'f10',      label: '05. F10' },
      { key: 'hs',       label: '06. Health & Safety' },
      { key: 'pci',      label: '07. PCI — Pre-Construction Information' },
      { key: 'cpp',      label: '08. CPP — Construction Phase Plan' },
      { key: 'planning', label: '09. Planning' },
      { key: 'utilities', label: '10. Utilities' },
      { key: 'meetings', label: '11. Meetings' },
    ]
  },
  { key: '01-project-order',        label: '01. Project Order',           color: '#378ADD', bg: '#E6F1FB', subfolders: [] },
  { key: '02-payment-application',  label: '02. Payment Application',     color: '#BA7517', bg: '#FAEEDA', subfolders: [] },
  { key: '03-payment-notice',       label: '03. Payment Notice (Client)', color: '#BA7517', bg: '#FAEEDA', subfolders: [] },
  { key: '04-variations',           label: '04. Variations',              color: '#993C1D', bg: '#FAECE7', subfolders: [] },
  { key: '05-progress-report',      label: '05. Project Progress Report', color: '#3B6D11', bg: '#EAF3DE', subfolders: [] },
  { key: '06-project-programme',    label: '06. Project Programme',       color: '#534AB7', bg: '#EEEDFE', subfolders: [] },
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
  '04-variations': ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 4 12 20 20 4"/>
    </svg>
  ),
  '05-progress-report': ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M7 17l3-4 2.5 3L16 12l4 5"/>
      <line x1="7" y1="8" x2="10" y2="8"/>
    </svg>
  ),
  '06-project-programme': ({ color, size }) => (
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

// ── Folder drop reader (reads dropped folders recursively via webkitGetAsEntry) ─
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
        <div style={{ fontSize: 14, marginBottom: 20, color: 'var(--text)', wordBreak: 'break-word', overflowWrap: 'break-word' }}>{message}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={Btn}>Cancel</button>
          <button onClick={onOk} style={BtnR}>Delete</button>
        </div>
      </div>
    </div>
  )
}

// ─── ZIP HELPERS ──────────────────────────────────────────────
// Reusable, used by all five zip flows below. Builds zips that mirror
// the CRM folder layout 1:1 — using folder LABELS (not raw subfolder_key
// IDs from the database). Reports progress via a setProgress callback.

async function loadJsZip() {
  if (window.JSZip) return window.JSZip
  const s = document.createElement('script')
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
  document.head.appendChild(s)
  await new Promise(r => { s.onload = r })
  return window.JSZip
}

// Sanitize a label for filesystem safety
function safeName(s) {
  return (s || 'Untitled').replace(/[\/\\:*?"<>|]/g, '_').replace(/\.+$/, '').trim() || 'Untitled'
}

// Build a map of folder_key -> full label-based path
// Recursively walks descendants of `rootKey`. Includes the root itself with "" path.
// Also seeds the map with hard-coded template subfolders (e.g. "Drawings", "CFF") that
// live only in the TEMPLATE_FOLDERS constant — not in the database.
async function buildFolderPathMap(projectId, rootKey) {
  const { data: allRows } = await supabase.from('project_doc_folders')
    .select('folder_key, parent_key, label, client_visible')
    .eq('project_id', projectId)
  const rows = allRows || []

  // Seed with template subfolder labels for the well-known folders
  const seeded = []
  const tpl = TEMPLATE_FOLDERS.find(t => t.key === rootKey)
  if (tpl) {
    for (const sf of (tpl.subfolders || [])) {
      seeded.push({ folder_key: sf.key, parent_key: rootKey, label: sf.label })
    }
  }
  // Also seed for ALL template folders if rootKey is one of them — covers nested template subfolders
  for (const t of TEMPLATE_FOLDERS) {
    for (const sf of (t.subfolders || [])) {
      if (!seeded.find(s => s.folder_key === sf.key)) {
        seeded.push({ folder_key: sf.key, parent_key: t.key, label: sf.label })
      }
    }
  }
  // Merge with DB rows (DB overrides templates if labels were renamed)
  const merged = [...seeded.filter(s => !rows.find(r => r.folder_key === s.folder_key)), ...rows]

  const childIdx = new Map()
  for (const r of merged) {
    if (!childIdx.has(r.parent_key)) childIdx.set(r.parent_key, [])
    childIdx.get(r.parent_key).push(r)
  }
  const map = {}
  map[rootKey] = ''
  function walk(parentKey, parentPath) {
    const kids = childIdx.get(parentKey) || []
    for (const k of kids) {
      const myPath = parentPath ? parentPath + '/' + safeName(k.label) : safeName(k.label)
      map[k.folder_key] = myPath
      walk(k.folder_key, myPath)
    }
  }
  walk(rootKey, '')
  return map
}

// Add files into a JSZip object using the path map. Reports incremental progress.
// `pathPrefix` is prepended to every file's resolved path (used by zipAll to
// nest under each top-level folder).
async function addFilesToZip(zip, files, pathMap, setProgress, startIndex = 0, totalOverride = null, pathPrefix = '') {
  let i = startIndex
  const total = totalOverride || files.length
  for (const f of files) {
    i++
    if (setProgress) setProgress({ current: i, total, fileName: f.file_name })
    try {
      const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 600)
      if (!data?.signedUrl) continue
      const res = await fetch(data.signedUrl)
      if (!res.ok) continue
      const blob = await res.blob()
      let folderPath = ''
      if (f.subfolder_key) {
        if (pathMap[f.subfolder_key] !== undefined) folderPath = pathMap[f.subfolder_key]
        else folderPath = safeName(f.subfolder_key)  // last-ditch fallback
      }
      const parts = [pathPrefix, folderPath, safeName(f.file_name)].filter(Boolean)
      zip.file(parts.join('/'), blob)
    } catch (e) { console.warn('zip skip', f.file_name, e) }
  }
  return i  // updated counter
}

// Trigger the actual download once a JSZip is built. Reports zipping progress.
// Force every folder in the path map to appear in the zip, even if it has no files.
// JSZip's `folder()` method registers the path; when serialized, the empty folder is included.
// Without this, empty subfolders (e.g. F10, PCI when blank) silently disappear from the zip.
function ensureFolders(zip, pathMap, pathPrefix = '') {
  for (const path of Object.values(pathMap)) {
    if (!path) continue
    const fullPath = pathPrefix ? pathPrefix + '/' + path : path
    zip.folder(fullPath)
  }
}

async function downloadZip(zip, filename, setProgress) {
  const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
    if (setProgress) setProgress({ current: 0, total: 0, fileName: 'Compressing…', percent: meta.percent, label: 'Compressing zip' })
  })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = safeName(filename)
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

// Reusable progress overlay — appears while a zip is being built
function ZipProgressOverlay({ progress }) {
  if (!progress) return null
  const { current = 0, total = 0, fileName = '', percent = null, label = 'Preparing zip' } = progress
  const filesPct = total > 0 ? Math.round((current / total) * 100) : 0
  const compressPct = percent != null ? Math.round(percent) : null
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '24px 28px', minWidth: 360, maxWidth: 460 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>{label}</div>
        {total > 0 && compressPct == null && (
          <>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Downloading file {current} of {total}</div>
            <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: filesPct + '%', height: '100%', background: '#448a40', transition: 'width 0.2s' }} />
            </div>
            {fileName && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={fileName}>{fileName}</div>}
          </>
        )}
        {compressPct != null && (
          <>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Compressing zip… {compressPct}%</div>
            <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: compressPct + '%', height: '100%', background: '#448a40', transition: 'width 0.1s' }} />
            </div>
          </>
        )}
        {total === 0 && compressPct == null && (
          <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 14, height: 14, border: '2px solid var(--border)', borderTopColor: '#448a40', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            Loading file list…
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}
      </div>
    </div>
  )
}

const PENCIL = <svg width="11" height="11" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="2" width="4" height="16" rx="1" fill="#e53935"/><rect x="10" y="7" width="4" height="4" fill="#FDD835"/><polygon points="10,18 14,18 12,23" fill="#fff"/><rect x="10" y="2" width="4" height="2.5" rx="0.5" fill="#555"/></svg>
const BIN = <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>

const Btn  = { fontSize: 11, lineHeight: '24px', padding: '0 9px', margin: 0, border: '0.5px solid var(--border)',     borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--text2)', display: 'inline-block', alignSelf: 'center', whiteSpace: 'nowrap', flexShrink: 0 }
const BtnG = { fontSize: 11, lineHeight: '24px', padding: '0 9px', margin: 0, border: '0.5px solid #448a40',           borderRadius: 5, background: 'transparent', cursor: 'pointer', color: '#448a40',        display: 'inline-block', alignSelf: 'center', whiteSpace: 'nowrap', flexShrink: 0 }
const BtnR = { fontSize: 11, lineHeight: '24px', padding: '0 9px', margin: 0, border: '0.5px solid var(--red-border)', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--red)',    display: 'inline-block', alignSelf: 'center', whiteSpace: 'nowrap', flexShrink: 0 }

// ── Count Badge (pill showing file count on subfolder rows) ───────────────────
function CountBadge({ count }) {
  if (!count) return null
  return (
    <div style={{ background: 'var(--surface2)', color: 'var(--text3)', fontSize: 10, fontWeight: 500, padding: '1px 7px', borderRadius: 10, flexShrink: 0 }}>{count}</div>
  )
}

// ── Excel Preview ─────────────────────────────────────────────────────────────
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
function BulkBar({ selected, onZip, onMove, onClear, moveTargets }) {
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
        {onMove && <button onClick={openMove} style={{ fontSize: 12, lineHeight: '26px', padding: '0 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.4)', background: showMove ? 'rgba(255,255,255,0.2)' : 'transparent', color: '#fff', cursor: 'pointer' }}>Move to ▾</button>}
        <button onClick={onClear} style={{ fontSize: 12, lineHeight: '26px', padding: '0 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.4)', background: 'transparent', color: '#fff', cursor: 'pointer' }}>✕ Clear</button>
      </div>
      {showMove && moveTargets && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 600 }} onClick={() => setShowMove(false)} />
          <div style={{ position: 'fixed', bottom: movePos.bottom, left: movePos.left, zIndex: 601, background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, minWidth: 240, maxHeight: 320, overflowY: 'auto', boxShadow: '0 -4px 24px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '8px 12px', fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '0.5px solid var(--border)' }}>Move to folder</div>
            <div onClick={() => { onMove(null); setShowMove(false) }} style={{ padding: '10px 14px', fontSize: 13, cursor: 'pointer', color: 'var(--text)', borderBottom: '0.5px solid var(--border)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'} onMouseLeave={e => e.currentTarget.style.background = ''}>
              📂 Root (no subfolder)
            </div>
            {moveTargets.map(t => (
              <div key={t.key} onClick={() => { onMove(t.key); setShowMove(false) }}
                style={{ padding: '8px 14px 8px 20px', fontSize: 13, cursor: 'pointer', color: 'var(--text)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}>
                📁 {t.label}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

// ── File Card (grid / compact view) ──────────────────────────────────────────
function FileCard({ file, onPreview, onDelete, canDelete, selected, onSelect, onGenerateGantt }) {
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
          {onGenerateGantt && isPdf && (
            <button onClick={e => { e.stopPropagation(); onGenerateGantt(file) }}
              title="Use AI to extract tasks from this PDF and load them into the Live Gantt editor"
              style={{ marginTop: 4, width: '100%', fontSize: 10, lineHeight: '22px', padding: 0, border: '0.5px solid #534AB7', borderRadius: 4, background: '#534AB7', cursor: 'pointer', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              Generate Gantt
            </button>
          )}
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
function FilesGrid({ files, viewMode, onPreview, canManage, onDelete, selected, onSelect, onDrop, onUpload, onGenerateGantt }) {
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
          selected={selected.has(f.id)} onSelect={onSelect} onGenerateGantt={onGenerateGantt} />
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
function SubfolderSection({ projectId, folder, subfolder, canManage, viewMode, onPreview, onReload, depth = 0, treeVersion, refreshTree }) {
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
  const [zipProgress, setZipProgress] = useState(null)
  const [clientVisible, setClientVisible] = useState(false)
  const [togglingVisible, setTogglingVisible] = useState(false)

  useEffect(() => { loadFileCount() }, [])
  useEffect(() => { if (open) { loadFiles(); loadChildFolders() } }, [open])
  // Re-fetch when any move happens in the tree — removes ghost copies
  useEffect(() => {
    if (!treeVersion) return
    loadFileCount()
    if (open) { loadFiles(); loadChildFolders() }
  }, [treeVersion])

  // Template subfolders track per-(project, parent_folder, subfolder) visibility.
  // Custom subfolders inherit from their parent template — no per-row toggle.
  useEffect(() => {
    if (subfolder.custom) return
    let cancelled = false
    async function loadVis() {
      const { data } = await supabase.from('project_template_folder_visibility')
        .select('client_visible')
        .eq('project_id', projectId)
        .eq('folder_key', folder.key)
        .eq('subfolder_key', subfolder.key)
        .maybeSingle()
      if (!cancelled) setClientVisible(data?.client_visible || false)
    }
    loadVis()
    return () => { cancelled = true }
  }, [])

  async function toggleSubfolderVisibility(e) {
    if (e) e.stopPropagation()
    if (togglingVisible || subfolder.custom) return
    setTogglingVisible(true)
    const newValue = !clientVisible
    setClientVisible(newValue)  // optimistic
    try {
      const { error } = await supabase.from('project_template_folder_visibility').upsert({
        project_id: projectId,
        folder_key: folder.key,
        subfolder_key: subfolder.key,
        client_visible: newValue,
      }, { onConflict: 'project_id,folder_key,subfolder_key' })
      if (error) throw error
    } catch (err) {
      setClientVisible(!newValue)  // revert
      alert('Could not update visibility: ' + err.message)
    }
    setTogglingVisible(false)
  }

  async function loadFileCount() {
    const { count } = await supabase.from('project_doc_files').select('id', { count: 'exact', head: true })
      .eq('project_id', projectId).eq('subfolder_key', subfolder.key)
    setFileCount(count || 0)
  }

  async function loadFiles() {
    const { data } = await supabase.from('project_doc_files').select('*')
      .eq('project_id', projectId).eq('folder_key', folder.key).eq('subfolder_key', subfolder.key)
      .order('created_at', { ascending: false })
    setFiles(naturalSort(data || []))
    setFileCount((data || []).length)
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
    refreshTree?.()
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
      const path = `projects/${projectId}/${folder.key}/${subfolder.key}/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('project-docs').upload(path, file)
      if (error) { console.error('Upload failed:', error.message); errors.push(file.name); continue }
      const { error: dbErr } = await supabase.from('project_doc_files').insert({
        project_id: projectId, folder_key: folder.key, subfolder_key: subfolder.key,
        file_name: file.name, file_size: file.size, storage_path: path,
      })
      if (dbErr) {
        console.error('DB insert failed:', dbErr.message)
        errors.push(file.name)
        // Clean up the orphaned storage object so we don't leak space.
        await supabase.storage.from('project-docs').remove([path]).catch(() => {})
      }
    }
    setUploading(false)
    setUploadProgress({ active: false, files: fileArr.map(f => f.name), current: fileArr.length, total: fileArr.length, errors })
    loadFiles()
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
    refreshTree?.()
  }

  async function zipSubfolder() {
    setZipProgress({ label: 'Preparing zip', current: 0, total: 0 })
    try {
      await loadJsZip()
      // Pull ALL files under this subfolder AND any descendants
      const pathMap = await buildFolderPathMap(projectId, subfolder.key)
      const folderKeys = Object.keys(pathMap)
      const { data: allFiles } = await supabase.from('project_doc_files').select('*')
        .eq('project_id', projectId)
        .in('subfolder_key', folderKeys)
      const fileList = allFiles || []
      if (!fileList.length) {
        setZipProgress(null)
        alert('No files in this subfolder.')
        return
      }
      const zip = new window.JSZip()
      await addFilesToZip(zip, fileList, pathMap, setZipProgress)
      ensureFolders(zip, pathMap)
      await downloadZip(zip, subLabel + '.zip', setZipProgress)
    } catch (e) { alert('Zip failed: ' + e.message); console.error(e) }
    setZipProgress(null)
  }

  async function bulkZip() {
    const chosen = files.filter(f => selected.has(f.id))
    if (!chosen.length) return
    setZipProgress({ label: 'Preparing zip', current: 0, total: chosen.length })
    try {
      await loadJsZip()
      const zip = new window.JSZip()
      // Selected files all live in this single subfolder, so just use file names directly
      let i = 0
      for (const f of chosen) {
        i++
        setZipProgress({ label: 'Preparing zip', current: i, total: chosen.length, fileName: f.file_name })
        const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 600)
        if (!data?.signedUrl) continue
        const res = await fetch(data.signedUrl)
        if (!res.ok) continue
        zip.file(safeName(f.file_name), await res.blob())
      }
      await downloadZip(zip, subLabel + '-selected.zip', setZipProgress)
    } catch (e) { alert('Zip failed: ' + e.message); console.error(e) }
    setZipProgress(null)
  }

  async function onDrop(e) {
    e.preventDefault(); e.stopPropagation()
    const subKey = e.dataTransfer.getData('subfolder')
    if (subKey) { moveSubfolder(subKey); return }
    const id = e.dataTransfer.getData('text/plain')
    if (id) { moveFile(id); return }
    const drop = await readDropEntries(e)
    if (drop.folders.length > 0) {
      const dropErrors = []
      const keyMap = {}
      for (const fp of drop.folders.sort()) {
        const parts = fp.split('/')
        const label = parts[parts.length - 1]
        const parentPath = parts.slice(0, -1).join('/')
        const parentKey = parentPath ? keyMap[parentPath] : subfolder.key
        const key = (parentKey || subfolder.key) + '-sub-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
        keyMap[fp] = key
        await supabase.from('project_doc_folders').insert({ project_id: projectId, parent_key: parentKey || subfolder.key, folder_key: key, label })
      }
      for (const { file, path } of drop.files) {
        const sfKey = path ? keyMap[path] : subfolder.key
        const storagePath = `projects/${projectId}/${folder.key}/${sfKey}/${Date.now()}-${file.name}`
        const { error } = await supabase.storage.from('project-docs').upload(storagePath, file)
        if (error) { console.error('Upload failed:', error.message); dropErrors.push(file.name); continue }
        const { error: dbErr } = await supabase.from('project_doc_files').insert({ project_id: projectId, folder_key: folder.key, subfolder_key: sfKey, file_name: file.name, file_size: file.size, storage_path: storagePath })
        if (dbErr) {
          console.error('DB insert failed:', dbErr.message)
          dropErrors.push(file.name)
          await supabase.storage.from('project-docs').remove([storagePath]).catch(() => {})
        }
      }
      if (dropErrors.length) alert(`${dropErrors.length} file${dropErrors.length === 1 ? '' : 's'} could not be saved:\n\n${dropErrors.join('\n')}\n\nThis is usually a permissions issue — check with your admin.`)
      loadChildFolders(); loadFiles()
    } else {
      const f = drop.files.map(x => x.file)
      if (f.length) uploadFiles(f)
    }
  }

  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const isCustom = subfolder.custom === true

  return (
    <div style={{ marginBottom: 2 }}>
      <UploadProgress uploadState={uploadProgress} />
      <ZipProgressOverlay progress={zipProgress} />
      <div
        draggable={isCustom && !renaming}
        onDragStart={e => { if (!isCustom) return; e.stopPropagation(); e.dataTransfer.setData('subfolder', subfolder.key); e.dataTransfer.effectAllowed = 'move' }}
        onClick={() => setOpen(o => !o)} onDragOver={e => e.preventDefault()} onDrop={onDrop}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', paddingLeft: 10 + depth * 12, borderRadius: 6, cursor: 'pointer', background: open ? 'var(--surface2)' : 'transparent', transition: 'background .1s' }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--surface2)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent' }}>
        <div style={{ width: 24, height: 24, borderRadius: 5, background: isCustom ? '#F1EFE8' : folder.color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {isCustom
            ? <span style={{ fontSize: 13 }}>📁</span>
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={folder.color} strokeWidth="1.5">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
          }
        </div>
        {renaming
          ? <input value={renameVal} autoFocus onChange={e => setRenameVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') renameFolder(); if (e.key === 'Escape') setRenaming(false) }}
              onClick={e => e.stopPropagation()}
              style={{ flex: 1, fontSize: 12, padding: '2px 8px', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text)' }} />
          : <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{subLabel}</span>
        }
        <span style={{ fontSize: 10, color: 'var(--text3)' }}>{open && (files.length + childFolders.length) > 0 ? (files.length + childFolders.length) + ' items' : ''}</span>
        {!open && <CountBadge count={fileCount} />}
        {!isCustom && canManage && (
          <button
            onClick={toggleSubfolderVisibility}
            disabled={togglingVisible}
            title={clientVisible ? 'Visible in client portal — click to hide' : 'Hidden from client portal — click to show'}
            style={{
              fontSize: 10,
              padding: '3px 8px',
              borderRadius: 12,
              border: '0.5px solid var(--border)',
              background: clientVisible ? '#448a4020' : 'transparent',
              color: clientVisible ? '#448a40' : 'var(--text3)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: clientVisible ? '#448a40' : 'var(--text3)',
            }} />
            {clientVisible ? 'Visible to client' : 'Hidden'}
          </button>
        )}
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
                        style={{ fontSize: 11, lineHeight: '24px', padding: '0 8px', border: '0.5px solid var(--border)', borderRadius: 5, background: 'var(--surface2)', color: 'var(--text)', width: 260 }} />
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
          <BulkBar selected={selected} onZip={bulkZip} onClear={() => setSelected(new Set())}
            onMove={async (targetKey) => {
              for (const id of selected) await supabase.from('project_doc_files').update({ subfolder_key: targetKey || subfolder.key }).eq('id', id)
              setSelected(new Set()); loadFiles()
              refreshTree?.()
            }}
            moveTargets={childFolders.map(cf => ({ key: cf.folder_key, label: cf.label }))} />
          {childFolders.map(cf => (
            <SubfolderSection key={cf.folder_key} projectId={projectId} folder={folder}
              subfolder={{ key: cf.folder_key, label: cf.label, custom: true }}
              canManage={canManage} viewMode={viewMode} onPreview={onPreview}
              onReload={id => { if (id === '__folder_deleted__') loadChildFolders(); else setFiles(prev => prev.filter(f => f.id !== id)) }}
              depth={depth + 1} treeVersion={treeVersion} refreshTree={refreshTree} />
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
function PrimeFolderSection({ projectId, projectName, folder, canManage, canAddFolders, allFileCounts, onDeleteFolder, onRenameFolder, treeVersion, refreshTree }) {
  const [open, setOpen] = useState(false)
  const [subfolders, setSubfolders] = useState(folder.subfolders || [])
  const [showAddFolder, setShowAddFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [savingFolder, setSavingFolder] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ active: false, files: [], current: 0, total: 0, errors: [] })
  const [files, setFiles] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [selectedSubs, setSelectedSubs] = useState(new Set())
  const [previewFile, setPreviewFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [renamingFolder, setRenamingFolder] = useState(false)
  const [renameFolderVal, setRenameFolderVal] = useState('')
  const [showGantt, setShowGantt] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatePreview, setGeneratePreview] = useState(null)
  const [showProgressEditor, setShowProgressEditor] = useState(false)
  const [editingReportId, setEditingReportId] = useState(null)
  const [progressReports, setProgressReports] = useState([])
  const [confirmDeleteReport, setConfirmDeleteReport] = useState(null)
  const [zipProgress, setZipProgress] = useState(null)
  const [clientVisible, setClientVisible] = useState(false)
  const [togglingVisible, setTogglingVisible] = useState(false)
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
  useEffect(() => { loadClientVisible() }, [])
  // Re-fetch when any move happens anywhere in the tree (kills ghost copies)
  useEffect(() => {
    if (treeVersion === 0) return
    loadCustomSubfolders()
    if (open) loadRootFiles()
  }, [treeVersion])

  async function loadClientVisible() {
    // Template folders use the project_template_folder_visibility table.
    // Custom (DB-backed) folders use project_doc_folders.client_visible.
    if (folder.custom) {
      const { data } = await supabase.from('project_doc_folders')
        .select('client_visible')
        .eq('project_id', projectId)
        .eq('folder_key', folder.key)
        .maybeSingle()
      setClientVisible(data?.client_visible || false)
    } else {
      const { data } = await supabase.from('project_template_folder_visibility')
        .select('client_visible')
        .eq('project_id', projectId)
        .eq('folder_key', folder.key)
        .eq('subfolder_key', '')
        .maybeSingle()
      setClientVisible(data?.client_visible || false)
    }
  }

  async function toggleClientVisible() {
    if (togglingVisible) return
    setTogglingVisible(true)
    const newValue = !clientVisible
    setClientVisible(newValue)  // optimistic
    try {
      if (folder.custom) {
        // Custom folder — update the existing project_doc_folders row
        const { error } = await supabase.from('project_doc_folders')
          .update({ client_visible: newValue })
          .eq('project_id', projectId)
          .eq('folder_key', folder.key)
        if (error) throw error
      } else {
        // Template folder — upsert into project_template_folder_visibility
        const { error } = await supabase.from('project_template_folder_visibility')
          .upsert({
            project_id: projectId,
            folder_key: folder.key,
            subfolder_key: '',
            client_visible: newValue,
          }, { onConflict: 'project_id,folder_key,subfolder_key' })
        if (error) throw error
      }
    } catch (e) {
      setClientVisible(!newValue)  // revert
      alert('Could not update visibility: ' + e.message)
    }
    setTogglingVisible(false)
  }

  async function loadCustomSubfolders() {
    const { data } = await supabase.from('project_doc_folders').select('*')
      .eq('project_id', projectId).eq('parent_key', folder.key).order('created_at')
    const custom = (data || []).map(d => ({ key: d.folder_key, label: d.label, custom: true }))
    setSubfolders([...(folder.subfolders || []), ...custom])
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
    refreshTree?.()
  }

  async function uploadToFolder(fileList) {
    if (!fileList.length) return
    const fileArr = Array.from(fileList)
    setUploading(true)
    setUploadProgress({ active: true, files: fileArr.map(f => f.name), current: 0, total: fileArr.length, errors: [] })
    const errors = []
    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i]
      setUploadProgress(prev => ({ ...prev, current: i }))
      const path = `projects/${projectId}/${folder.key}/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('project-docs').upload(path, file)
      if (error) { console.error('Upload failed:', error.message); errors.push(file.name); continue }
      const { error: dbErr } = await supabase.from('project_doc_files').insert({
        project_id: projectId, folder_key: folder.key,
        file_name: file.name, file_size: file.size, storage_path: path,
      })
      if (dbErr) {
        console.error('DB insert failed:', dbErr.message)
        errors.push(file.name)
        await supabase.storage.from('project-docs').remove([path]).catch(() => {})
      }
    }
    setUploading(false)
    setUploadProgress({ active: false, files: fileArr.map(f => f.name), current: fileArr.length, total: fileArr.length, errors })
    loadRootFiles()
  }

  async function deleteFile(f) {
    await supabase.storage.from('project-docs').remove([f.storage_path])
    await supabase.from('project_doc_files').delete().eq('id', f.id)
    setFiles(prev => prev.filter(x => x.id !== f.id))
  }

  async function zipFolder() {
    setZipProgress({ label: 'Preparing zip', current: 0, total: 0 })
    try {
      await loadJsZip()
      // Pull EVERY file under this top-level folder (across all subfolders)
      // We have two strategies because top-level files use folder_key while
      // nested files use subfolder_key. Pull both.
      const pathMap = await buildFolderPathMap(projectId, folder.key)
      const subfolderKeys = Object.keys(pathMap).filter(k => k !== folder.key)
      // Files at the top level of this folder (no subfolder set OR subfolder_key === folder.key)
      const { data: topLevelFiles } = await supabase.from('project_doc_files').select('*')
        .eq('project_id', projectId).eq('folder_key', folder.key).is('subfolder_key', null)
      // Files in subfolders
      let nestedFiles = []
      if (subfolderKeys.length > 0) {
        const { data } = await supabase.from('project_doc_files').select('*')
          .eq('project_id', projectId).in('subfolder_key', subfolderKeys)
        nestedFiles = data || []
      }
      const allFiles = [...(topLevelFiles || []), ...nestedFiles]
      const zip = new window.JSZip()
      if (allFiles.length > 0) {
        await addFilesToZip(zip, allFiles, pathMap, setZipProgress)
      }
      // Always include the full folder structure — F10/PCI etc. show up even when empty
      ensureFolders(zip, pathMap)
      await downloadZip(zip, folder.label + '.zip', setZipProgress)
    } catch (e) { alert('Zip failed: ' + e.message); console.error(e) }
    setZipProgress(null)
  }

  async function bulkZip() {
    const chosen = files.filter(f => selected.has(f.id))
    if (!chosen.length) return
    setZipProgress({ label: 'Preparing zip', current: 0, total: chosen.length })
    try {
      await loadJsZip()
      const zip = new window.JSZip()
      // These are files at the top of the folder, just put them flat in the zip
      let i = 0
      for (const f of chosen) {
        i++
        setZipProgress({ label: 'Preparing zip', current: i, total: chosen.length, fileName: f.file_name })
        const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 600)
        if (!data?.signedUrl) continue
        const res = await fetch(data.signedUrl)
        if (!res.ok) continue
        zip.file(safeName(f.file_name), await res.blob())
      }
      await downloadZip(zip, folder.label + '-selected.zip', setZipProgress)
    } catch (e) { alert('Zip failed: ' + e.message); console.error(e) }
    setZipProgress(null)
  }

  async function zipSelectedSubs() {
    setZipProgress({ label: 'Preparing zip', current: 0, total: 0 })
    try {
      await loadJsZip()
      // For each selected subfolder, pull all files (including descendants)
      const pathMap = await buildFolderPathMap(projectId, folder.key)
      const allKeysSet = new Set(Object.keys(pathMap))
      // Filter the keys to those rooted at one of the selected subfolders
      const wantedKeys = new Set()
      for (const sfKey of selectedSubs) {
        // Include the subfolder itself + all keys whose path starts with its label
        const sfPath = pathMap[sfKey]
        if (sfPath === undefined) continue
        for (const k of allKeysSet) {
          const p = pathMap[k]
          if (k === sfKey || (sfPath && (p === sfPath || p.startsWith(sfPath + '/')))) wantedKeys.add(k)
        }
      }
      if (wantedKeys.size === 0) {
        setZipProgress(null)
        alert('No subfolders selected.')
        return
      }
      const { data: allFiles } = await supabase.from('project_doc_files').select('*')
        .eq('project_id', projectId).in('subfolder_key', Array.from(wantedKeys))
      if (!allFiles?.length) {
        setZipProgress(null)
        alert('Selected subfolders contain no files.')
        return
      }
      const zip = new window.JSZip()
      await addFilesToZip(zip, allFiles, pathMap, setZipProgress)
      ensureFolders(zip, pathMap)
      await downloadZip(zip, folder.label + '-folders.zip', setZipProgress)
      setSelectedSubs(new Set())
    } catch (e) { alert('Zip failed: ' + e.message); console.error(e) }
    setZipProgress(null)
  }

  async function moveSubfolderToRoot(key) {
    await supabase.from('project_doc_folders').update({ parent_key: folder.key }).eq('folder_key', key).eq('project_id', projectId)
    loadCustomSubfolders()
    refreshTree?.()
  }

  async function onDropFolder(e) {
    e.preventDefault(); e.stopPropagation()
    const subKey = e.dataTransfer.getData('subfolder')
    if (subKey) { moveSubfolderToRoot(subKey); return }
    const drop = await readDropEntries(e)
    if (drop.folders.length > 0) {
      const dropErrors = []
      const keyMap = {}
      for (const fp of drop.folders.sort()) {
        const parts = fp.split('/')
        const label = parts[parts.length - 1]
        const parentPath = parts.slice(0, -1).join('/')
        const parentKey = parentPath ? keyMap[parentPath] : folder.key
        const key = (parentKey || folder.key) + '-custom-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
        keyMap[fp] = key
        await supabase.from('project_doc_folders').insert({ project_id: projectId, parent_key: parentKey || folder.key, folder_key: key, label })
      }
      for (const { file, path } of drop.files) {
        const sfKey = path ? keyMap[path] : null
        const storagePath = `projects/${projectId}/${folder.key}/${sfKey || 'root'}/${Date.now()}-${file.name}`
        const { error } = await supabase.storage.from('project-docs').upload(storagePath, file)
        if (error) { console.error('Upload failed:', error.message); dropErrors.push(file.name); continue }
        const { error: dbErr } = await supabase.from('project_doc_files').insert({ project_id: projectId, folder_key: folder.key, subfolder_key: sfKey, file_name: file.name, file_size: file.size, storage_path: storagePath })
        if (dbErr) {
          console.error('DB insert failed:', dbErr.message)
          dropErrors.push(file.name)
          await supabase.storage.from('project-docs').remove([storagePath]).catch(() => {})
        }
      }
      if (dropErrors.length) alert(`${dropErrors.length} file${dropErrors.length === 1 ? '' : 's'} could not be saved:\n\n${dropErrors.join('\n')}\n\nThis is usually a permissions issue — check with your admin.`)
      loadCustomSubfolders(); loadRootFiles()
    } else {
      const f = drop.files.map(x => x.file)
      if (f.length) uploadToFolder(f)
    }
  }

  async function loadProgressReports() {
    if (folder.key !== '05-progress-report') return
    const { data } = await supabase.from('progress_reports')
      .select('id, report_number, report_date, created_at, updated_at, profiles:created_by(full_name)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    setProgressReports(data || [])
  }

  useEffect(() => { if (open && folder.key === '05-progress-report') loadProgressReports() }, [open, folder.key, projectId, treeVersion])

  async function deleteProgressReport(reportId) {
    // Best-effort: delete photos from storage first
    const { data: photos } = await supabase.from('progress_report_photos').select('storage_path').eq('report_id', reportId)
    if (photos?.length) {
      await supabase.storage.from('progress-photos').remove(photos.map(p => p.storage_path))
    }
    await supabase.from('progress_reports').delete().eq('id', reportId)
    setConfirmDeleteReport(null)
    loadProgressReports()
  }

  async function generateGanttFromPdf(file) {
    if (!file?.storage_path) return
    setGenerating(true)
    try {
      const { data, error } = await supabase.functions.invoke('parse-programme-pdf', {
        body: { storage_path: file.storage_path },
      })
      if (error) throw error
      if (!data?.ok) {
        throw new Error(data?.error || data?.parse_error || 'Parser returned no result')
      }
      // Show preview to user
      setGeneratePreview({
        filename: file.file_name,
        tasks: data.tasks || [],
        confidence: data.confidence,
        notes: data.notes,
        raw: data.raw_response,
      })
    } catch (err) {
      console.error('[generateGantt]', err)
      const msg = err?.message || err?.error?.message || String(err)
      alert('Could not parse PDF: ' + msg + '\n\nThe AI parser may struggle with hand-drawn or low-quality PDFs. You can still build the Gantt manually.')
    }
    setGenerating(false)
  }

  async function onDropBody(e) {
    e.preventDefault(); e.stopPropagation()
    const subKey = e.dataTransfer.getData('subfolder')
    if (subKey) { moveSubfolderToRoot(subKey); return }
    const id = e.dataTransfer.getData('text/plain')
    if (id) { moveFileToRoot(id); return }
    const drop = await readDropEntries(e)
    if (drop.folders.length > 0) {
      const dropErrors = []
      const keyMap = {}
      for (const fp of drop.folders.sort()) {
        const parts = fp.split('/')
        const label = parts[parts.length - 1]
        const parentPath = parts.slice(0, -1).join('/')
        const parentKey = parentPath ? keyMap[parentPath] : folder.key
        const key = (parentKey || folder.key) + '-custom-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
        keyMap[fp] = key
        await supabase.from('project_doc_folders').insert({ project_id: projectId, parent_key: parentKey || folder.key, folder_key: key, label })
      }
      for (const { file, path } of drop.files) {
        const sfKey = path ? keyMap[path] : null
        const storagePath = `projects/${projectId}/${folder.key}/${sfKey || 'root'}/${Date.now()}-${file.name}`
        const { error } = await supabase.storage.from('project-docs').upload(storagePath, file)
        if (error) { console.error('Upload failed:', error.message); dropErrors.push(file.name); continue }
        const { error: dbErr } = await supabase.from('project_doc_files').insert({ project_id: projectId, folder_key: folder.key, subfolder_key: sfKey, file_name: file.name, file_size: file.size, storage_path: storagePath })
        if (dbErr) {
          console.error('DB insert failed:', dbErr.message)
          dropErrors.push(file.name)
          await supabase.storage.from('project-docs').remove([storagePath]).catch(() => {})
        }
      }
      if (dropErrors.length) alert(`${dropErrors.length} file${dropErrors.length === 1 ? '' : 's'} could not be saved:\n\n${dropErrors.join('\n')}\n\nThis is usually a permissions issue — check with your admin.`)
      loadCustomSubfolders(); loadRootFiles()
    } else {
      const f = drop.files.map(x => x.file)
      if (f.length) uploadToFolder(f)
    }
  }

  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function toggleSub(key) {
    setSelectedSubs(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <UploadProgress uploadState={uploadProgress} />
      <ZipProgressOverlay progress={zipProgress} />
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
          {canManage && (
            <button
              onClick={e => { e.stopPropagation(); toggleClientVisible() }}
              disabled={togglingVisible}
              title={clientVisible ? 'Visible in client portal — click to hide' : 'Hidden from client portal — click to show'}
              style={{
                fontSize: 10,
                padding: '3px 8px',
                borderRadius: 12,
                border: '0.5px solid var(--border)',
                background: clientVisible ? '#448a4020' : 'transparent',
                color: clientVisible ? '#448a40' : 'var(--text3)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: clientVisible ? '#448a40' : 'var(--text3)',
              }} />
              {clientVisible ? 'Visible to client' : 'Hidden'}
            </button>
          )}
          {showAddFolder ? (
            <>
              <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="Subfolder name" autoFocus
                onKeyDown={e => { if (e.key === 'Enter') addCustomSubfolder(); if (e.key === 'Escape') setShowAddFolder(false) }}
                style={{ fontSize: 11, lineHeight: '24px', padding: '0 8px', border: '0.5px solid var(--border)', borderRadius: 5, background: 'var(--surface2)', color: 'var(--text)', width: 260 }} />
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
              {folder.key === '05-progress-report' && canManage && (
                <button onClick={(e) => { e.stopPropagation(); setEditingReportId(null); setShowProgressEditor(true) }}
                  style={{ ...BtnG, display: 'inline-flex', alignItems: 'center', gap: 4, background: '#448a40', color: 'white', border: '0.5px solid #448a40' }}
                  title="Create a new monthly progress report">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>
                  New Progress Report
                </button>
              )}
              {folder.key === '06-project-programme' && (
                <button onClick={(e) => { e.stopPropagation(); setShowGantt(true) }}
                  style={{ ...BtnG, display: 'inline-flex', alignItems: 'center', gap: 4, background: '#534AB7', color: 'white', border: '0.5px solid #534AB7' }}
                  title="Open the live editable Gantt chart for this project">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  Open Live Gantt
                </button>
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

          {/* Progress reports list (folder 05 only) */}
          {folder.key === '05-progress-report' && progressReports.length > 0 && (
            <div style={{ marginBottom: 14, padding: 12, border: '0.5px solid var(--border)', borderRadius: 6, background: 'var(--surface2)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Saved Progress Reports ({progressReports.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {progressReports.map(r => (
                  <div key={r.id}
                    onClick={() => { setEditingReportId(r.id); setShowProgressEditor(true) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: 'var(--surface)', borderRadius: 4, cursor: 'pointer', border: '0.5px solid var(--border)' }}>
                    <span style={{ fontSize: 14 }}>📋</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{r.report_number}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                        Last updated {new Date(r.updated_at).toLocaleDateString('en-GB')} · {r.profiles?.full_name || 'Unknown'}
                      </div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setEditingReportId(r.id); setShowProgressEditor(true) }}
                      style={{ fontSize: 10, padding: '3px 8px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'var(--surface2)', cursor: 'pointer', color: 'var(--text2)' }}>
                      Open
                    </button>
                    <button onClick={async (e) => {
                        e.stopPropagation()
                        // Fetch full report + photos then generate PDF
                        const [{ data: full }, { data: pics }] = await Promise.all([
                          supabase.from('progress_reports').select('*').eq('id', r.id).single(),
                          supabase.from('progress_report_photos').select('*').eq('report_id', r.id).order('display_order'),
                        ])
                        if (!full) { alert('Report not found'); return }
                        await generateProgressReportPdf(full, pics || [], projectName)
                      }}
                      style={{ fontSize: 10, padding: '3px 8px', border: '0.5px solid #448a40', borderRadius: 4, background: '#448a40', cursor: 'pointer', color: 'white' }}>
                      📄 Export PDF
                    </button>
                    {canManage && (
                      <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteReport(r.id) }}
                        style={{ fontSize: 10, padding: '3px 8px', border: '0.5px solid var(--red-border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--red)' }}>
                        Delete
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <BulkBar selected={selected} onZip={bulkZip} onClear={() => setSelected(new Set())}
            onMove={async (targetKey) => {
              for (const id of selected) await supabase.from('project_doc_files').update({ subfolder_key: targetKey }).eq('id', id)
              setSelected(new Set()); loadRootFiles()
              refreshTree?.()
            }}
            moveTargets={subfolders.map(sf => ({ key: sf.key, label: sf.label }))} />

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
                  depth={0} treeVersion={treeVersion} refreshTree={refreshTree} />
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
                onDelete={deleteFile} selected={selected} onSelect={toggleSelect} onDrop={onDropBody} onUpload={uploadToFolder}
                onGenerateGantt={folder.key === '06-project-programme' ? generateGanttFromPdf : null} />
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
        fileTypeInfo(previewFile.file_name).isExcel
          ? <ExcelPreview url={previewUrl} fileName={previewFile.file_name}
              onClose={() => setPreviewFile(null)}
              onDownload={previewUrl ? () => triggerDownload(previewUrl, previewFile.file_name) : null} />
          : <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setPreviewFile(null)}>
          <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 8 }}>
            {previewUrl && <button onClick={e => { e.stopPropagation(); triggerDownload(previewUrl, previewFile.file_name) }} style={{ fontSize: 12, padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>↓ Download</button>}
            <button onClick={() => setPreviewFile(null)} style={{ fontSize: 12, padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>✕ Close</button>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginBottom: 12 }}>{previewFile.file_name}</div>
          {previewUrl ? (
            fileTypeInfo(previewFile.file_name).isImage
              ? <img src={previewUrl} alt={previewFile.file_name} style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 8 }} onClick={e => e.stopPropagation()} />
              : fileTypeInfo(previewFile.file_name).isPdf
              ? <iframe src={previewUrl} style={{ width: '95vw', height: '92vh', border: 'none', borderRadius: 8 }} title={previewFile.file_name} onClick={e => e.stopPropagation()} />
              : <iframe src={'https://docs.google.com/gview?url=' + encodeURIComponent(previewUrl) + '&embedded=true'} style={{ width: '95vw', height: '92vh', border: 'none', borderRadius: 8, background: '#fff' }} title={previewFile.file_name} onClick={e => e.stopPropagation()} />
          ) : (
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Loading preview...</div>
          )}
        </div>
      )}

      {/* Live Gantt editor (programme folder only) */}
      {/* Progress Report editor */}
      {showProgressEditor && folder.key === '05-progress-report' && (
        <ProgressReportEditor
          projectId={projectId}
          projectName={projectName || 'Project'}
          reportId={editingReportId}
          onClose={() => { setShowProgressEditor(false); setEditingReportId(null); loadProgressReports() }}
          onSaved={() => { loadProgressReports() }}
        />
      )}

      {confirmDeleteReport && <ConfirmDlg
        message="Permanently delete this progress report and all its photos? This cannot be undone."
        onOk={() => deleteProgressReport(confirmDeleteReport)}
        onCancel={() => setConfirmDeleteReport(null)} />}

      {showGantt && folder.key === '06-project-programme' && (
        <GanttEditor
          projectId={projectId}
          projectName={projectName || 'Project'}
          onClose={() => { setShowGantt(false); setGeneratePreview(null) }}
          canEdit={canManage}
          initialTasks={generatePreview?._approved || null}
        />
      )}

      {/* AI generation spinner */}
      {generating && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--surface)', borderRadius: 8, padding: 32, textAlign: 'center', maxWidth: 380 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚡</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Reading your programme PDF…</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 16 }}>
              AI is extracting tasks, dates, and groups. This typically takes 10–30 seconds.
            </div>
            <div style={{ display: 'inline-block', width: 24, height: 24, border: '3px solid var(--border)', borderTopColor: '#534AB7', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      )}

      {/* Preview modal — show parsed tasks before committing */}
      {generatePreview && !generating && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setGeneratePreview(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--surface)', borderRadius: 8, maxWidth: 720, width: '100%', maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>AI Extracted Tasks</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>From: {generatePreview.filename}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: generatePreview.confidence === 'high' ? '#e8f5e7' : generatePreview.confidence === 'medium' ? '#fef4e0' : '#fee', color: generatePreview.confidence === 'high' ? '#448a40' : generatePreview.confidence === 'medium' ? '#b87a00' : '#c00', textTransform: 'uppercase' }}>
                  {generatePreview.confidence || 'unknown'} confidence
                </span>
              </div>
            </div>
            <div style={{ padding: 14, fontSize: 12, color: 'var(--text2)', borderBottom: '1px solid var(--border)' }}>
              <strong>{generatePreview.tasks.length}</strong> tasks extracted.
              {generatePreview.notes && <div style={{ marginTop: 6, fontStyle: 'italic', color: 'var(--text3)' }}>{generatePreview.notes}</div>}
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text3)' }}>
                Review the list below. If it looks good, click <strong>Open in Gantt Editor</strong> to load these tasks for editing — they won't be saved until you click Save in the editor.
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
              {generatePreview.tasks.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 30, fontSize: 12 }}>
                  No tasks were extracted. The PDF may not contain a recognisable Gantt chart, or the AI struggled to read it.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {generatePreview.tasks.map((t, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 110px', gap: 10, padding: '6px 10px', background: t.parent_name ? 'var(--surface2)' : undefined, borderRadius: 4, fontSize: 12 }}>
                      <div style={{ paddingLeft: t.parent_name ? 16 : 0 }}>
                        {t.parent_name && <span style={{ color: 'var(--text3)', marginRight: 4 }}>↳</span>}
                        {t.is_milestone && <span style={{ marginRight: 4 }}>◆</span>}
                        <span style={{ fontWeight: t.parent_name ? 400 : 500 }}>{t.name}</span>
                      </div>
                      <div style={{ color: 'var(--text3)', fontSize: 11 }}>{t.start_date || '—'}</div>
                      <div style={{ color: 'var(--text3)', fontSize: 11 }}>{t.end_date || '—'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setGeneratePreview(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={generatePreview.tasks.length === 0}
                onClick={async () => {
                  // Convert AI shape -> editor shape
                  const { tasksFromAiResponse } = await import('./Gantt/ganttUtils')
                  const editorTasks = tasksFromAiResponse(generatePreview.tasks)
                  setGeneratePreview(prev => ({ ...prev, _approved: editorTasks }))
                  setShowGantt(true)
                }}>
                Open in Gantt Editor →
              </button>
            </div>
          </div>
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
        style={{ fontSize: 12, padding: '5px 10px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'var(--surface2)', color: 'var(--text)', flex: 1, minWidth: 260 }} />
      <button onClick={save} disabled={saving} style={BtnG}>{saving ? '...' : 'Add'}</button>
      <button onClick={() => setShow(false)} style={Btn}>Cancel</button>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function ProjectDocumentation({ projectId, projectName, projectStatus }) {
  const { can, role } = useAuth()
  const [fileCounts, setFileCounts] = useState({})
  const [customTopFolders, setCustomTopFolders] = useState([])
  const [zippingAll, setZippingAll] = useState(false)
  const [zipProgress, setZipProgress] = useState(null)
  // Bump this whenever a folder or file is moved anywhere in the tree.
  // Every SubfolderSection / PrimeFolderSection watches it and re-fetches
  // its own children, so stale "ghost" copies disappear from the old location.
  const [treeVersion, setTreeVersion] = useState(0)
  const refreshTree = () => setTreeVersion(v => v + 1)

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
    setZipProgress({ label: 'Preparing zip', current: 0, total: 0 })
    try {
      await loadJsZip()
      const { data: allFiles } = await supabase.from('project_doc_files').select('*').eq('project_id', projectId)
      const filesList = allFiles || []
      // Build label paths for every top-level folder (template + custom)
      const allTopFolders = [...TEMPLATE_FOLDERS, ...customTopFolders]
      const pathMaps = {}
      const topLabelMap = {}
      for (const tf of allTopFolders) {
        pathMaps[tf.key] = await buildFolderPathMap(projectId, tf.key)
        topLabelMap[tf.key] = tf.label
      }

      const zip = new window.JSZip()

      // Add files (if any)
      const total = filesList.length
      let i = 0
      for (const f of filesList) {
        i++
        setZipProgress({ label: 'Preparing zip', current: i, total, fileName: f.file_name })
        const topLabel = topLabelMap[f.folder_key] || safeName(f.folder_key)
        const pathMap = pathMaps[f.folder_key] || {}
        try {
          const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 600)
          if (!data?.signedUrl) continue
          const res = await fetch(data.signedUrl)
          if (!res.ok) continue
          const blob = await res.blob()
          let folderPath = ''
          if (f.subfolder_key) {
            if (pathMap[f.subfolder_key] !== undefined) folderPath = pathMap[f.subfolder_key]
            else folderPath = safeName(f.subfolder_key)
          }
          const parts = [safeName(topLabel), folderPath, safeName(f.file_name)].filter(Boolean)
          zip.file(parts.join('/'), blob)
        } catch (e) { console.warn('zip skip', f.file_name, e) }
      }

      // ALWAYS include the full folder structure for every top-level folder,
      // even when empty. This ensures F10, PCI etc. appear in the zip.
      for (const tf of allTopFolders) {
        ensureFolders(zip, pathMaps[tf.key], safeName(tf.label))
      }

      await downloadZip(zip, (projectName || 'project') + '-all-docs.zip', setZipProgress)
    } catch (e) { alert('Zip failed: ' + e.message); console.error(e) }
    setZipProgress(null)
    setZippingAll(false)
  }

  const hiddenFolders = []
  const hiddenSubfolders = []
  if (!can('view_payments')) { hiddenFolders.push('02-payment-application', '03-payment-notice') }
  if (!can('view_csa')) { hiddenSubfolders.push('csa') }
  if (!can('view_cff')) { hiddenSubfolders.push('cff') }

  // Site managers can only see Project Information and Project Programme
  const SITE_MANAGER_FOLDERS = ['00-project-information', '05-progress-report', '06-project-programme']

  // Tender projects only need Project Information + Project Programme.
  // The other folders (Orders, Payments, Variations, Progress Reports) are
  // only relevant once the project is Active, so hide them to reduce clutter.
  const TENDER_FOLDERS = ['00-project-information', '06-project-programme']
  const isTender = projectStatus === 'tender'

  const allFolders = [...TEMPLATE_FOLDERS, ...(role === 'site_manager' ? [] : customTopFolders)]
    .filter(f => {
      if (role === 'site_manager') return SITE_MANAGER_FOLDERS.includes(f.key)
      if (isTender) return TENDER_FOLDERS.includes(f.key)
      return !hiddenFolders.includes(f.key)
    })
    .map(f => f.subfolders ? { ...f, subfolders: f.subfolders.filter(sf => !hiddenSubfolders.includes(sf.key)) } : f)

  return (
    <div>
      <ZipProgressOverlay progress={zipProgress} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={zipAll} disabled={zippingAll}
          style={{ fontSize: 12, padding: '6px 14px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: 'var(--text2)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
          {zippingAll ? 'Zipping...' : 'Zip all documents'}
        </button>
      </div>
      <div>
        {allFolders.map(folder => (
          <PrimeFolderSection key={folder.key} projectId={projectId} projectName={projectName} folder={folder}
            canManage={canManage} canAddFolders={canAddFolders} allFileCounts={fileCounts}
            treeVersion={treeVersion} refreshTree={refreshTree}
            onDeleteFolder={async (key) => {
              if (!window.confirm('Delete this folder and ALL its files? This cannot be undone.')) return
              await supabase.from('project_doc_files').delete().eq('project_id', projectId).eq('folder_key', key)
              await supabase.from('project_doc_folders').delete().eq('folder_key', key).eq('project_id', projectId)
              setCustomTopFolders(prev => prev.filter(f => f.key !== key))
              refreshTree()
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
