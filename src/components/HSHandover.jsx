import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ── H&S Structure (fixed — same across all projects) ─────────────────────────
const HS_STRUCTURE = [
  {
    key: 's1',
    label: 'Pre-Construction',
    icon: 's1',
    children: [
      { key: 's1-cppa', label: 'Construction Phase Plan (Appointments)', icon: null, children: [] },
      { key: 's1-f10',  label: 'F10 Notification',                        icon: null, children: [] },
      { key: 's1-pci',  label: 'Pre-Construction Information',             icon: null, children: [] },
      { key: 's1-dra',  label: 'Designer Risk Assessments',                icon: null, children: [] },
    ],
  },
  {
    key: 's2',
    label: 'Construction Phase',
    icon: 's2',
    children: [
      { key: 's2-cpp',  label: 'Construction Phase Plan',     icon: null, children: [] },
      { key: 's2-rams', label: 'RAMS',                        icon: null, children: [] },
      { key: 's2-si',   label: 'Site Inspections',            icon: null, children: [] },
      { key: 's2-ti',   label: 'Toolbox Talk / Inductions',   icon: null, children: [] },
      { key: 's2-acc',  label: 'Accident / Incident Reports', icon: null, children: [] },
    ],
  },
  {
    key: 's3',
    label: 'Statutory Documents',
    icon: 's3',
    children: [
      { key: 's3-ins', label: 'Insurance',                   icon: null, children: [] },
      { key: 's3-lc',  label: 'Licences & Certificates',     icon: null, children: [] },
      { key: 's3-test',label: 'Test & Inspection Certificates', icon: null, children: [] },
    ],
  },
  {
    key: 's4',
    label: 'O&M Manual',
    icon: 's4',
    children: [
      { key: 's4-as',   label: 'As-Built Drawings',            icon: null, children: [] },
      { key: 's4-spec', label: 'Specifications',               icon: null, children: [] },
      { key: 's4-maint',label: 'Maintenance Manuals',          icon: null, children: [] },
      { key: 's4-warr', label: 'Warranties & Guarantees',      icon: null, children: [] },
      { key: 's4-cert', label: 'Completion Certificates',      icon: null, children: [] },
    ],
  },
]

function getAllKeys(nodes, acc = []) {
  for (const n of nodes) {
    acc.push(n.key)
    if (n.children?.length) getAllKeys(n.children, acc)
  }
  return acc
}

function getAllLeafKeys(nodes, acc = []) {
  for (const n of nodes) {
    if (!n.children?.length) acc.push(n.key)
    else getAllLeafKeys(n.children, acc)
  }
  return acc
}

function findSection(nodes, key) {
  for (const n of nodes) {
    if (n.key === key) return n
    if (n.children?.length) {
      const found = findSection(n.children, key)
      if (found) return found
    }
  }
  return null
}

// ── H&S Icons (custom SVG per section) ───────────────────────────────────────
const HS_ICONS = {
  s1: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      <polyline points="9 12 11 14 15 10"/>
    </svg>
  ),
  s2: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2"/>
      <line x1="8" y1="21" x2="16" y2="21"/>
      <line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  ),
  s3: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <polyline points="9 12 11 14 15 10"/>
    </svg>
  ),
  s4: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
    </svg>
  ),
}

function getColor(node, depth) {
  const colors = ['#448a40', '#378ADD', '#BA7517', '#534AB7', '#E53935', '#0F6E56', '#993C1D', '#888780']
  if (node.key.startsWith('s1')) return '#448a40'
  if (node.key.startsWith('s2')) return '#378ADD'
  if (node.key.startsWith('s3')) return '#BA7517'
  if (node.key.startsWith('s4')) return '#534AB7'
  return colors[depth % colors.length]
}

// ── Shared utilities (same as CompanyDocuments) ───────────────────────────────
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
  return {
    isImage: t.includes('image') || /\.(jpg|jpeg|png|gif|webp)$/i.test(n),
    isPdf:   t.includes('pdf')   || /\.pdf$/i.test(n),
    isWord:  t.includes('word')  || t.includes('document') || /\.docx?$/i.test(n),
    isExcel: t.includes('spreadsheet') || t.includes('excel') || /\.xlsx?$/i.test(n),
    isPpt:   t.includes('presentation') || t.includes('powerpoint') || /\.pptx?$/i.test(n),
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

// ── HS File Card (grid / compact) ─────────────────────────────────────────────
function HSFileCard({ file, onPreview, onDelete, canDelete, selected, onSelect }) {
  const [url, setUrl] = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const { isImage, isPdf } = fileTypeInfo(file.file_name, null)

  useEffect(() => {
    supabase.storage.from('hs-handover').createSignedUrl(file.storage_path, 3600)
      .then(({ data }) => { if (data?.signedUrl) setUrl(data.signedUrl) })
  }, [file.storage_path])

  async function renameFile() {
    if (!renameVal.trim() || renameVal.trim() === file.file_name) { setRenaming(false); return }
    await supabase.from('hs_files').update({ file_name: renameVal.trim() }).eq('id', file.id)
    file.file_name = renameVal.trim()
    setRenaming(false)
  }

  return (
    <>
      <div draggable={!renaming} style={{ border: selected ? '2px solid var(--accent)' : '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)', position: 'relative', transition: 'border .1s' }}>
        <div onClick={e => { e.stopPropagation(); onSelect(file.id) }}
          style={{ position: 'absolute', top: 6, left: 6, zIndex: 1, width: 18, height: 18, borderRadius: 4, border: '2px solid ' + (selected ? 'var(--accent)' : 'rgba(255,255,255,0.4)'), background: selected ? 'var(--accent)' : 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          {selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
        </div>
        <div style={{ height: 120, background: 'var(--surface2)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer' }} onClick={() => onPreview(file, url)}>
          {isImage && url
            ? <img src={url} alt={file.file_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : isPdf && url
            ? <iframe src={url + '#page=1&toolbar=0&navpanes=0&scrollbar=0'} style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }} title={file.file_name} />
            : <FileTypeBadge fileName={file.file_name} fileType={null} size={34} />
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

// ── HS File List Row ──────────────────────────────────────────────────────────
function HSFileListRow({ file, onPreview, onDelete, canDelete, selected, onSelect }) {
  const [url, setUrl] = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const { isWord, isExcel, isPpt, isPdf, isImage } = fileTypeInfo(file.file_name, null)
  const iconColor  = isPdf ? '#E24B4A' : isWord ? '#1B5EAE' : isExcel ? '#1D7B45' : isPpt ? '#C55A25' : isImage ? '#448a40' : '#888'
  const iconLetter = isPdf ? 'PDF' : isWord ? 'W' : isExcel ? 'X' : isPpt ? 'P' : null

  useEffect(() => {
    supabase.storage.from('hs-handover').createSignedUrl(file.storage_path, 3600)
      .then(({ data }) => { if (data?.signedUrl) setUrl(data.signedUrl) })
  }, [file.storage_path])

  async function renameFile() {
    if (!renameVal.trim() || renameVal.trim() === file.file_name) { setRenaming(false); return }
    await supabase.from('hs_files').update({ file_name: renameVal.trim() }).eq('id', file.id)
    file.file_name = renameVal.trim()
    setRenaming(false)
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 6, border: selected ? '1.5px solid var(--accent)' : '0.5px solid var(--border)', background: 'var(--surface)', transition: 'border .1s' }}>
        <div onClick={e => { e.stopPropagation(); onSelect(file.id) }}
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
          {renaming
            ? <input value={renameVal} autoFocus onChange={e => setRenameVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') renameFile(); if (e.key === 'Escape') setRenaming(false) }}
                onFocus={e => e.target.select()} onClick={e => e.stopPropagation()}
                style={{ width: '100%', fontSize: 12, padding: '2px 6px', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text)' }} />
            : (
              <div onClick={() => onPreview(file, url)} style={{ cursor: 'pointer' }}>
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
          {url && <button onClick={e => { e.stopPropagation(); onPreview(file, url) }} style={{ fontSize: 10, lineHeight: '22px', padding: '0 7px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>View</button>}
          {url && <button onClick={e => { e.stopPropagation(); triggerDownload(url, file.file_name) }} style={{ fontSize: 10, lineHeight: '22px', padding: '0 7px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>↓</button>}
          {canDelete && <button onClick={e => { e.stopPropagation(); setConfirmDel(true) }} style={{ fontSize: 10, lineHeight: '22px', padding: '0 7px', border: '0.5px solid var(--red-border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--red)' }}>✕</button>}
        </div>
      </div>
      {confirmDel && <ConfirmDlg message={'Delete "' + file.file_name + '"?'} onOk={() => { setConfirmDel(false); onDelete(file) }} onCancel={() => setConfirmDel(false)} />}
    </>
  )
}

// ── HS Files Grid (shared renderer) ──────────────────────────────────────────
function HSFilesGrid({ files, viewMode, onPreview, canManage, onDelete, selected, onSelect, onDrop, onUpload }) {
  if (!files.length) return null
  if (viewMode === 'list') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {files.map(f => (
          <HSFileListRow key={f.id} file={f} onPreview={onPreview} canDelete={canManage} onDelete={onDelete}
            selected={selected.has(f.id)} onSelect={onSelect} />
        ))}
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: viewMode === 'compact' ? 'repeat(auto-fill, minmax(110px, 1fr))' : 'repeat(auto-fill, minmax(150px, 1fr))', gap: viewMode === 'compact' ? 6 : 8 }}>
      {files.map(f => (
        <HSFileCard key={f.id} file={f} onPreview={onPreview} canDelete={canManage} onDelete={onDelete}
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

// ── Folder Node (recursive — same design as original) ─────────────────────────
function FolderNode({ node, projectId, depth, fileCounts, canManage, canAddFolders, customFolders, onCustomFolderAdded, sectionColor, onPreview, viewMode, setViewMode }) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [showAddFolder, setShowAddFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [savingFolder, setSavingFolder] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [selected, setSelected] = useState(new Set())

  const color = sectionColor || getColor(node, depth)
  const Icon = node.icon ? HS_ICONS[node.icon] : null
  const fileCount = fileCounts?.[node.key] || 0
  const childCustomFolders = (customFolders || []).filter(cf => cf.parent_key === node.key)

  useEffect(() => { if (open) loadFiles() }, [open])

  async function loadFiles() {
    const { data } = await supabase.from('hs_files').select('*')
      .eq('project_id', projectId).eq('folder_key', node.key).order('created_at', { ascending: false })
    setFiles(naturalSort(data || []))
  }

  async function upload(fileList) {
    if (!fileList.length) return
    setUploading(true)
    for (const file of fileList) {
      const path = `projects/${projectId}/hs/${node.key}/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('hs-handover').upload(path, file)
      if (!error) await supabase.from('hs_files').insert({
        project_id: projectId, folder_key: node.key, storage_path: path, file_name: file.name, file_size: file.size,
      })
    }
    setUploading(false); loadFiles()
  }

  async function deleteFile(f) {
    await supabase.storage.from('hs-handover').remove([f.storage_path])
    await supabase.from('hs_files').delete().eq('id', f.id)
    setConfirmDelete(null)
    setFiles(prev => prev.filter(x => x.id !== f.id))
  }

  async function addCustomFolder() {
    if (!newFolderName.trim()) return
    setSavingFolder(true)
    const key = node.key + '-custom-' + Date.now()
    await supabase.from('hs_folders').insert({ project_id: projectId, parent_key: node.key, folder_key: key, label: newFolderName.trim() })
    onCustomFolderAdded?.({ project_id: projectId, parent_key: node.key, folder_key: key, label: newFolderName.trim() })
    setNewFolderName(''); setShowAddFolder(false); setSavingFolder(false)
  }

  async function zipFolder() {
    const { data: allFiles } = await supabase.from('hs_files').select('*').eq('project_id', projectId).eq('folder_key', node.key)
    if (!allFiles?.length) { alert('No files in this section.'); return }
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    s.onload = async () => {
      const zip = new window.JSZip()
      for (const f of allFiles) {
        const { data } = await supabase.storage.from('hs-handover').createSignedUrl(f.storage_path, 300)
        if (data?.signedUrl) { const res = await fetch(data.signedUrl); zip.file(f.file_name, await res.blob()) }
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = node.label + '.zip'; a.click()
    }
    document.head.appendChild(s)
  }

  async function bulkZip() {
    const chosen = files.filter(f => selected.has(f.id))
    if (!chosen.length) return
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    s.onload = async () => {
      const zip = new window.JSZip()
      for (const f of chosen) {
        const { data } = await supabase.storage.from('hs-handover').createSignedUrl(f.storage_path, 120)
        if (data?.signedUrl) { const res = await fetch(data.signedUrl); zip.file(f.file_name, await res.blob()) }
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = node.label + '-selected.zip'; a.click()
    }
    document.head.appendChild(s)
  }

  function onDrop(e) {
    e.preventDefault(); e.stopPropagation()
    const fileList = Array.from(e.dataTransfer.files)
    if (fileList.length) upload(fileList)
  }

  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const indent = depth * 16
  const isRoot = depth === 0

  return (
    <div style={{ marginBottom: isRoot ? 6 : 2 }}>
      {/* ── Node header ── */}
      <div onClick={() => setOpen(o => !o)} onDragOver={e => e.preventDefault()} onDrop={onDrop}
        style={{
          display: 'flex', alignItems: 'center', gap: isRoot ? 12 : 8,
          padding: isRoot ? '10px 14px' : '7px 10px',
          paddingLeft: (isRoot ? 14 : 10) + indent,
          borderRadius: 8, cursor: 'pointer',
          background: open ? 'var(--surface2)' : 'var(--surface)',
          border: `0.5px solid var(--border)`,
          borderLeftWidth: isRoot ? 3 : 2,
          borderLeftColor: color,
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--surface2)' }}
        onMouseLeave={e => { e.currentTarget.style.background = open ? 'var(--surface2)' : 'var(--surface)' }}>

        {/* Icon */}
        {Icon && (
          <div style={{ width: isRoot ? 36 : 26, height: isRoot ? 36 : 26, borderRadius: 6, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon color={color} size={isRoot ? 18 : 14} />
          </div>
        )}
        {!Icon && !isRoot && (
          <div style={{ width: 20, height: 20, borderRadius: 4, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
        )}

        {/* Label + subtitle */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: isRoot ? 13 : 12, fontWeight: 600, color: 'var(--text)' }}>{node.label}</div>
          {isRoot && (
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>
              {fileCount > 0 ? fileCount + ' file' + (fileCount !== 1 ? 's' : '') : 'Empty'}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {showAddFolder ? (
            <>
              <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="Folder name" autoFocus
                onKeyDown={e => { if (e.key === 'Enter') addCustomFolder(); if (e.key === 'Escape') setShowAddFolder(false) }}
                style={{ fontSize: 11, lineHeight: '24px', padding: '0 8px', border: '0.5px solid var(--border)', borderRadius: 5, background: 'var(--surface2)', color: 'var(--text)', width: 120 }} />
              <button onClick={addCustomFolder} disabled={savingFolder} style={BtnG}>{savingFolder ? '...' : 'Add'}</button>
              <button onClick={() => { setShowAddFolder(false); setNewFolderName('') }} style={Btn}>✕</button>
            </>
          ) : (
            <>
              {open && (
                <button onClick={zipFolder} style={{ ...Btn, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
                  Zip
                </button>
              )}
              {canAddFolders && <button onClick={() => setShowAddFolder(true)} style={Btn}>+ Sub</button>}
              {canManage && (
                <label style={BtnG}>
                  {uploading ? '…' : '+ Upload'}
                  <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} />
                </label>
              )}
              {open && isRoot && <ViewToggle viewMode={viewMode} setView={setViewMode} />}
            </>
          )}
        </div>

        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', marginLeft: 4, flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      {/* ── Node body ── */}
      {open && (
        <div onDragOver={e => e.preventDefault()} onDrop={onDrop}
          style={{ marginLeft: indent + 16, paddingLeft: 12, borderLeft: `1.5px solid ${color}30`, paddingTop: 6, paddingBottom: 6 }}>
          <BulkBar selected={selected} onZip={bulkZip} onClear={() => setSelected(new Set())} />

          {/* Fixed children */}
          {node.children?.map(child => (
            <FolderNode key={child.key} node={child} projectId={projectId} depth={depth + 1}
              fileCounts={fileCounts} canManage={canManage} canAddFolders={canAddFolders}
              customFolders={customFolders} onCustomFolderAdded={onCustomFolderAdded}
              sectionColor={color} onPreview={onPreview} viewMode={viewMode} setViewMode={setViewMode} />
          ))}

          {/* Custom sub-folders */}
          {childCustomFolders.map(cf => (
            <FolderNode key={cf.folder_key}
              node={{ key: cf.folder_key, label: cf.label, icon: null, children: [] }}
              projectId={projectId} depth={depth + 1}
              fileCounts={fileCounts} canManage={canManage} canAddFolders={canAddFolders}
              customFolders={customFolders} onCustomFolderAdded={onCustomFolderAdded}
              sectionColor={color} onPreview={onPreview} viewMode={viewMode} setViewMode={setViewMode} />
          ))}

          {/* Files */}
          {files.length === 0 && !node.children?.length && !childCustomFolders.length ? (
            <label onDragOver={e => e.preventDefault()} onDrop={onDrop}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 50, border: '0.5px dashed var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text3)', fontSize: 11 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Drop files or click to upload
              <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} />
            </label>
          ) : files.length > 0 && (
            <HSFilesGrid files={files} viewMode={viewMode} onPreview={onPreview} canManage={canManage}
              onDelete={deleteFile} selected={selected} onSelect={toggleSelect} onDrop={onDrop} onUpload={upload} />
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Export ───────────────────────────────────────────────────────────────
export default function HSHandover({ projectId, projectName }) {
  const { can } = useAuth()
  const [fileCounts, setFileCounts] = useState({})
  const [customFolders, setCustomFolders] = useState([])
  const [compilingFull, setCompilingFull] = useState(false)
  const [compilingOm, setCompilingOm] = useState(false)
  const [previewFile, setPreviewFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('hsView_' + projectId) || 'grid' } catch { return 'grid' }
  })

  function setView(mode) {
    setViewMode(mode)
    try { localStorage.setItem('hsView_' + projectId, mode) } catch {}
  }

  function openPreview(file, url) {
    setPreviewFile(file); setPreviewUrl(url || null)
    if (!url) {
      supabase.storage.from('hs-handover').createSignedUrl(file.storage_path, 3600)
        .then(({ data }) => { if (data?.signedUrl) setPreviewUrl(data.signedUrl) })
    }
  }

  const canManage = can('manage_projects')
  const canAddFolders = can('manage_projects')

  useEffect(() => {
    const prevent = e => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => { window.removeEventListener('dragover', prevent); window.removeEventListener('drop', prevent) }
  }, [])

  useEffect(() => { loadFileCounts(); loadCustomFolders() }, [projectId])

  async function loadFileCounts() {
    const { data } = await supabase.from('hs_files').select('folder_key').eq('project_id', projectId)
    if (data) {
      const counts = {}
      data.forEach(f => { counts[f.folder_key] = (counts[f.folder_key] || 0) + 1 })
      setFileCounts(counts)
    }
  }

  async function loadCustomFolders() {
    const { data } = await supabase.from('hs_folders').select('*').eq('project_id', projectId).order('created_at')
    if (data?.length) setCustomFolders(data)
  }

  // ── Compile Full H&S Handover PDF ─────────────────────────────────────────
  async function compileHandover(sectionKeys, filename) {
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'
    document.head.appendChild(script)
    await new Promise(r => script.onload = r)

    const { PDFDocument, rgb, StandardFonts, PageSizes } = window.PDFLib
    const merged = await PDFDocument.create()
    const boldFont = await merged.embedFont(StandardFonts.HelveticaBold)
    const regFont  = await merged.embedFont(StandardFonts.Helvetica)

    // Cover page
    const cover = merged.addPage(PageSizes.A4)
    const [w, h] = [cover.getWidth(), cover.getHeight()]
    cover.drawRectangle({ x: 0, y: 0, width: w, height: h, color: rgb(0.97, 0.97, 0.97) })
    cover.drawRectangle({ x: 0, y: h - 140, width: w, height: 140, color: rgb(0.267, 0.541, 0.251) })
    cover.drawText('H&S Handover', { x: 50, y: h - 65, size: 28, font: boldFont, color: rgb(1, 1, 1) })
    cover.drawText(projectName || 'Project Documentation', { x: 50, y: h - 100, size: 14, font: regFont, color: rgb(0.9, 0.9, 0.9) })
    cover.drawText('Generated: ' + new Date().toLocaleDateString('en-GB'), { x: 50, y: h - 180, size: 11, font: regFont, color: rgb(0.4, 0.4, 0.4) })

    // Table of contents page
    const toc = merged.addPage(PageSizes.A4)
    toc.drawText('Contents', { x: 50, y: toc.getHeight() - 60, size: 18, font: boldFont, color: rgb(0.1, 0.1, 0.1) })
    let tocY = toc.getHeight() - 100
    for (const key of sectionKeys) {
      const section = findSection(HS_STRUCTURE, key)
      if (section) {
        toc.drawText('• ' + section.label, { x: 70, y: tocY, size: 11, font: regFont, color: rgb(0.2, 0.2, 0.2) })
        tocY -= 20
      }
    }

    // Merge PDFs from each section
    for (const key of sectionKeys) {
      const { data: files } = await supabase.from('hs_files').select('*').eq('project_id', projectId).eq('folder_key', key)
      for (const f of (files || [])) {
        if (!f.file_name?.toLowerCase().endsWith('.pdf')) continue
        const { data: urlData } = await supabase.storage.from('hs-handover').createSignedUrl(f.storage_path, 300)
        if (!urlData?.signedUrl) continue
        try {
          const res = await fetch(urlData.signedUrl)
          const bytes = await res.arrayBuffer()
          const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
          const pages = await merged.copyPages(pdf, pdf.getPageIndices())
          pages.forEach(p => merged.addPage(p))
        } catch { /* skip unreadable PDFs */ }
      }
    }

    const pdfBytes = await merged.save()
    const blob = new Blob([pdfBytes], { type: 'application/pdf' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click()
  }

  return (
    <div>
      {/* ── Compile buttons ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <button
          onClick={async () => {
            setCompilingFull(true)
            await compileHandover(getAllKeys(HS_STRUCTURE), (projectName || 'project') + '-hs-handover-full.pdf')
            setCompilingFull(false)
          }}
          disabled={compilingFull}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '8px 16px', border: '0.5px solid #448a40', borderRadius: 6, background: 'transparent', color: '#448a40', cursor: 'pointer' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="9 12 11 14 15 10"/></svg>
          {compilingFull ? 'Compiling…' : 'Compile Full H&S Handover'}
        </button>
        <button
          onClick={async () => {
            setCompilingOm(true)
            const omKeys = getAllKeys(HS_STRUCTURE.filter(s => s.key === 's4'))
            await compileHandover(omKeys, (projectName || 'project') + '-om-manual.pdf')
            setCompilingOm(false)
          }}
          disabled={compilingOm}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '8px 16px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text2)', cursor: 'pointer' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          {compilingOm ? 'Compiling…' : 'Compile O&M Manual'}
        </button>
      </div>

      {/* ── Folder tree ── */}
      <div>
        {HS_STRUCTURE.map(section => (
          <FolderNode
            key={section.key}
            node={section}
            projectId={projectId}
            depth={0}
            fileCounts={fileCounts}
            canManage={canManage}
            canAddFolders={canAddFolders}
            customFolders={customFolders}
            onCustomFolderAdded={cf => setCustomFolders(prev => [...prev, cf])}
            onPreview={openPreview}
            viewMode={viewMode}
            setViewMode={setView}
          />
        ))}
      </div>

      {/* ── Preview modal ── */}
      {previewFile && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setPreviewFile(null)}>
          <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 8 }}>
            {previewUrl && (
              <button onClick={e => { e.stopPropagation(); triggerDownload(previewUrl, previewFile.file_name) }}
                style={{ fontSize: 12, padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>
                ↓ Download
              </button>
            )}
            <button onClick={() => setPreviewFile(null)} style={{ fontSize: 12, padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>✕ Close</button>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginBottom: 12 }}>{previewFile.file_name}</div>
          {previewUrl ? (
            fileTypeInfo(previewFile.file_name, null).isImage
              ? <img src={previewUrl} alt={previewFile.file_name} style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 8 }} onClick={e => e.stopPropagation()} />
              : fileTypeInfo(previewFile.file_name, null).isPdf
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
