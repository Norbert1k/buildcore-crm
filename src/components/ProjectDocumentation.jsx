import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ── Fixed template folders — auto-created on every new project ─
const TEMPLATE_FOLDERS = [
  {
    key: '00-project-information',
    label: '00. Project Information',
    color: '#448a40',
    bg: '#e8f5e7',
    subfolders: [
      { key: 'drawings',  label: 'Drawings' },
      { key: 'csa',       label: 'CSA' },
      { key: 'f10',       label: 'F10' },
      { key: 'pci',       label: 'PCI — Pre-Construction Information' },
      { key: 'cpp',       label: 'CPP — Construction Phase Plan' },
    ]
  },
  { key: '01-project-order',        label: '01. Project Order',           color: '#378ADD', bg: '#E6F1FB', subfolders: [] },
  { key: '02-payment-application',  label: '02. Payment Application',     color: '#BA7517', bg: '#FAEEDA', subfolders: [] },
  { key: '03-payment-notice',       label: '03. Payment Notice (Client)', color: '#BA7517', bg: '#FAEEDA', subfolders: [] },
  { key: '04-project-programme',    label: '04. Project Programme',       color: '#888780', bg: '#F1EFE8', subfolders: [] },
]

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
      <line x1="7" y1="13" x2="13" y2="13"/>
      <polyline points="15 16 17 18 21 14"/>
    </svg>
  ),
  '02-payment-application': ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="13" rx="2"/>
      <circle cx="12" cy="12.5" r="3"/>
      <circle cx="12" cy="12.5" r="1" fill={color}/>
      <line x1="2" y1="10" x2="5" y2="10"/>
      <line x1="19" y1="10" x2="22" y2="10"/>
      <line x1="2" y1="15" x2="5" y2="15"/>
      <line x1="19" y1="15" x2="22" y2="15"/>
    </svg>
  ),
  '03-payment-notice': ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="9" y1="13" x2="15" y2="13"/>
      <line x1="9" y1="17" x2="12" y2="17"/>
      <polyline points="14 15 16 17 20 13"/>
    </svg>
  ),
  '04-project-programme': ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2"/>
      <line x1="3" y1="9" x2="21" y2="9"/>
      <line x1="7" y1="4" x2="7" y2="9"/>
      <line x1="12" y1="4" x2="12" y2="9"/>
      <line x1="17" y1="4" x2="17" y2="9"/>
      <rect x="6" y="12" width="2.5" height="4.5" rx="1" fill={color}/>
      <rect x="10.5" y="13.5" width="2.5" height="3" rx="1" fill={color}/>
      <rect x="15" y="11" width="2.5" height="5.5" rx="1" fill={color}/>
    </svg>
  ),
}


// ── Upgrade utilities (view toggle, bulk, rename, preview) ───────────────────
async function triggerDownload(signedUrl, fileName) {
  try {
    const res = await fetch(signedUrl); const blob = await res.blob()
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  } catch { const a = document.createElement('a'); a.href = signedUrl; a.download = fileName; a.click() }
}
function _fti(name, type) {
  const t = type||'', n = name||''
  return {
    isImage: t.includes('image')||/\.(jpg|jpeg|png|gif|webp)$/i.test(n),
    isPdf: t.includes('pdf')||/\.pdf$/i.test(n),
    isWord: t.includes('word')||t.includes('document')||/\.docx?$/i.test(n),
    isExcel: t.includes('spreadsheet')||t.includes('excel')||/\.xlsx?$/i.test(n),
    isPpt: t.includes('presentation')||t.includes('powerpoint')||/\.pptx?$/i.test(n),
  }
}
function _naturalSort(arr) {
  return [...arr].sort((a,b) => (a.file_name||'').localeCompare(b.file_name||'',undefined,{numeric:true,sensitivity:'base'}))
}
function _FTBadge({ name, type, size=34 }) {
  const {isWord,isExcel,isPpt} = _fti(name,type)
  const color = isWord?'#1B5EAE':isExcel?'#1D7B45':isPpt?'#C55A25':null
  const letter = isWord?'W':isExcel?'X':isPpt?'P':null
  if (!color) return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
  return <div style={{width:size,height:size+8,background:color,borderRadius:5,display:'flex',alignItems:'center',justifyContent:'center'}}><span style={{color:'#fff',fontSize:size*0.5,fontWeight:700,fontFamily:'Arial'}}>{letter}</span></div>
}
function _Confirm({ message, onOk, onCancel }) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={onCancel}>
      <div style={{background:'var(--surface)',borderRadius:10,padding:24,maxWidth:360,width:'90%'}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:14,marginBottom:20,color:'var(--text)'}}>{message}</div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onCancel} style={{fontSize:11,lineHeight:'24px',padding:'0 9px',border:'0.5px solid var(--border)',borderRadius:5,background:'transparent',cursor:'pointer',color:'var(--text2)'}}>Cancel</button>
          <button onClick={onOk} style={{fontSize:11,lineHeight:'24px',padding:'0 9px',border:'0.5px solid var(--red-border)',borderRadius:5,background:'transparent',cursor:'pointer',color:'var(--red)'}}>Delete</button>
        </div>
      </div>
    </div>
  )
}
function _ViewToggle({ viewMode, setView }) {
  const views = [
    {mode:'grid',title:'Grid',icon:<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>},
    {mode:'compact',title:'Compact',icon:<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="4" height="4"/><rect x="10" y="2" width="4" height="4"/><rect x="18" y="2" width="4" height="4"/><rect x="2" y="10" width="4" height="4"/><rect x="10" y="10" width="4" height="4"/><rect x="18" y="10" width="4" height="4"/><rect x="2" y="18" width="4" height="4"/><rect x="10" y="18" width="4" height="4"/><rect x="18" y="18" width="4" height="4"/></svg>},
    {mode:'list',title:'List',icon:<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>},
  ]
  return (
    <div style={{display:'flex',gap:2}} onClick={e=>e.stopPropagation()}>
      {views.map(({mode,title,icon}) => (
        <button key={mode} onClick={()=>setView(mode)} title={title}
          style={{width:24,height:24,display:'flex',alignItems:'center',justifyContent:'center',border:'0.5px solid '+(viewMode===mode?'var(--accent)':'var(--border)'),borderRadius:4,background:viewMode===mode?'var(--accent)':'transparent',cursor:'pointer',color:viewMode===mode?'#fff':'var(--text3)',padding:0,flexShrink:0}}>
          {icon}
        </button>
      ))}
    </div>
  )
}
function _BulkBar({ selected, onZip, onClear }) {
  if (!selected.size) return null
  return (
    <div style={{position:'fixed',bottom:20,left:'50%',transform:'translateX(-50%)',zIndex:500,background:'var(--accent)',color:'#fff',borderRadius:12,padding:'10px 16px',display:'flex',alignItems:'center',gap:10,boxShadow:'0 4px 24px rgba(0,0,0,0.3)',whiteSpace:'nowrap'}}>
      <span style={{fontSize:13,fontWeight:600}}>{selected.size} selected</span>
      <button onClick={onZip} style={{fontSize:12,lineHeight:'26px',padding:'0 12px',borderRadius:6,border:'1px solid rgba(255,255,255,0.4)',background:'transparent',color:'#fff',cursor:'pointer'}}>↓ Download ZIP</button>
      <button onClick={onClear} style={{fontSize:12,lineHeight:'26px',padding:'0 10px',borderRadius:6,border:'1px solid rgba(255,255,255,0.4)',background:'transparent',color:'#fff',cursor:'pointer'}}>✕ Clear</button>
    </div>
  )
}
function FolderIcon({ folderKey, color, bg, size = 20 }) {
  const IconSvg = FOLDER_ICONS[folderKey]
  return (
    <div style={{ width: size + 12, height: size + 12, borderRadius: 6, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {IconSvg ? <IconSvg color={color} size={size} /> : (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      )}
    </div>
  )
}

function FileTypeIcon({ fileName }) {
  const ext = fileName?.split('.').pop()?.toLowerCase()
  const map = {
    pdf: { bg: '#FCEBEB', color: '#A32D2D', label: 'PDF' },
    dwg: { bg: '#E6F1FB', color: '#185FA5', label: 'DWG' },
    dxf: { bg: '#E6F1FB', color: '#185FA5', label: 'DXF' },
    doc:  { bg: '#E6F1FB', color: '#185FA5', label: 'DOC' },
    docx: { bg: '#E6F1FB', color: '#185FA5', label: 'DOC' },
    xls:  { bg: '#EAF3DE', color: '#3B6D11', label: 'XLS' },
    xlsx: { bg: '#EAF3DE', color: '#3B6D11', label: 'XLS' },
    mpp:  { bg: '#FAEEDA', color: '#633806', label: 'MPP' },
    jpg:  { bg: '#F1EFE8', color: '#5F5E5A', label: 'IMG' },
    jpeg: { bg: '#F1EFE8', color: '#5F5E5A', label: 'IMG' },
    png:  { bg: '#F1EFE8', color: '#5F5E5A', label: 'IMG' },
  }
  const info = map[ext] || { bg: '#F1EFE8', color: '#888780', label: (ext || '?').toUpperCase().slice(0, 3) }
  return (
    <div style={{ position: 'absolute', top: 6, right: 6, background: info.bg, color: info.color, fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3 }}>
      {info.label}
    </div>
  )
}

function FileCard({ file, onDownload, onDelete, canDelete, selected, onSelect, onPreview }) {
  const [url, setUrl] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const { isImage, isPdf } = _fti(file.file_name, file.file_type)

  useEffect(() => {
    supabase.storage.from('project-docs').createSignedUrl(file.storage_path, 3600)
      .then(({ data }) => { if (data?.signedUrl) setUrl(data.signedUrl) })
  }, [file.storage_path])

  async function renameFile() {
    if (!renameVal.trim() || renameVal.trim() === file.file_name) { setRenaming(false); return }
    await supabase.from('project_doc_files').update({ file_name: renameVal.trim() }).eq('id', file.id)
    file.file_name = renameVal.trim(); setRenaming(false)
  }

  const fmtSize = (b) => {
    if (!b) return ''
    if (b < 1024) return b + 'B'
    if (b < 1048576) return (b/1024).toFixed(0) + 'KB'
    return (b/1048576).toFixed(1) + 'MB'
  }

  return (
    <>
      <div draggable={!renaming} style={{ border: selected ? '2px solid var(--accent)' : '0.5px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--surface)', position: 'relative', transition: 'border .1s' }}>
        <div onClick={e => { e.stopPropagation(); onSelect && onSelect(file.id) }}
          style={{ position: 'absolute', top: 6, left: 6, zIndex: 1, width: 18, height: 18, borderRadius: 4, border: '2px solid ' + (selected ? 'var(--accent)' : 'rgba(255,255,255,0.4)'), background: selected ? 'var(--accent)' : 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          {selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
        </div>
        <div style={{ height: 130, background: 'var(--surface2)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer' }}
          onClick={() => onPreview ? onPreview(file, url) : url && triggerDownload(url, file.file_name)}>
          {isImage && url
            ? <img src={url} alt={file.file_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : isPdf && url
            ? <iframe src={url + '#page=1&toolbar=0&navpanes=0&scrollbar=0'} style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }} title={file.file_name} />
            : <_FTBadge name={file.file_name} type={file.file_type} size={34} />
          }
          <div style={{ position: 'absolute', top: 5, right: 5, background: 'rgba(0,0,0,0.55)', color: 'white', fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3 }}>{file.file_name?.split('.').pop()?.toUpperCase().slice(0,4)}</div>
        </div>
        <div style={{ padding: '7px 9px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
            {renaming
              ? <input value={renameVal} autoFocus onChange={e => setRenameVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') renameFile(); if (e.key === 'Escape') setRenaming(false) }}
                  onFocus={e => e.target.select()} onClick={e => e.stopPropagation()}
                  style={{ flex:1, fontSize:11, padding:'1px 5px', border:'1px solid var(--accent)', borderRadius:4, background:'var(--surface2)', color:'var(--text)', minWidth:0 }} />
              : <>
                  <div style={{ flex: 1, fontSize: 11, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.file_name}>{file.file_name}</div>
                  {canDelete && <button onClick={e => { e.stopPropagation(); setRenameVal(file.file_name); setRenaming(true) }} title="Rename"
                    style={{ flexShrink:0, cursor:'pointer', background:'var(--surface2)', border:'0.5px solid var(--border)', borderRadius:4, padding:'2px 4px', display:'inline-flex', alignItems:'center' }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#448a40" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>}
                </>
            }
          </div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 6 }}>{fmtSize(file.file_size)}</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {url && <button onClick={e => { e.stopPropagation(); onPreview ? onPreview(file, url) : triggerDownload(url, file.file_name) }} style={{ flex:1, fontSize:10, lineHeight:'22px', padding:'0', border:'0.5px solid var(--border)', borderRadius:4, background:'transparent', cursor:'pointer', color:'var(--text2)' }}>View</button>}
            {url && <button onClick={e => { e.stopPropagation(); triggerDownload(url, file.file_name) }} style={{ flex:1, fontSize:10, lineHeight:'22px', padding:'0', border:'0.5px solid var(--border)', borderRadius:4, background:'transparent', cursor:'pointer', color:'var(--text2)' }}>↓</button>}
            {canDelete && <button onClick={e => { e.stopPropagation(); setConfirmDel(true) }} style={{ fontSize:10, lineHeight:'22px', padding:'0 6px', border:'0.5px solid var(--red-border)', borderRadius:4, background:'transparent', cursor:'pointer', color:'var(--red)' }}>✕</button>}
          </div>
        </div>
      </div>
      {confirmDel && <_Confirm message={'Delete "' + file.file_name + '"?'} onOk={() => { setConfirmDel(false); onDelete(file) }} onCancel={() => setConfirmDel(false)} />}
    </>
  )
}


function FileListRow({ file, onPreview, onDelete, canDelete, selected, onSelect }) {
  const [url, setUrl] = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const {isWord,isExcel,isPpt,isPdf,isImage} = _fti(file.file_name, file.file_type)
  const iconColor = isPdf?'#E24B4A':isWord?'#1B5EAE':isExcel?'#1D7B45':isPpt?'#C55A25':isImage?'#448a40':'#888'
  const iconLetter = isPdf?'PDF':isWord?'W':isExcel?'X':isPpt?'P':null
  useEffect(() => {
    supabase.storage.from('project-docs').createSignedUrl(file.storage_path, 3600)
      .then(({ data }) => { if (data?.signedUrl) setUrl(data.signedUrl) })
  }, [file.storage_path])
  async function renameFile() {
    if (!renameVal.trim() || renameVal.trim() === file.file_name) { setRenaming(false); return }
    await supabase.from('project_doc_files').update({ file_name: renameVal.trim() }).eq('id', file.id)
    file.file_name = renameVal.trim(); setRenaming(false)
  }
  const fmtSize = (b) => { if (!b) return ''; if (b<1024) return b+'B'; if (b<1048576) return (b/1024).toFixed(0)+'KB'; return (b/1048576).toFixed(1)+'MB' }
  return (
    <>
      <div style={{display:'flex',alignItems:'center',gap:10,padding:'6px 10px',borderRadius:6,border:selected?'1.5px solid var(--accent)':'0.5px solid var(--border)',background:'var(--surface)',transition:'border .1s'}}>
        <div onClick={e=>{e.stopPropagation();onSelect&&onSelect(file.id)}} style={{width:16,height:16,borderRadius:3,border:'2px solid '+(selected?'var(--accent)':'rgba(255,255,255,0.3)'),background:selected?'var(--accent)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0}}>
          {selected&&<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
        </div>
        <div style={{width:32,height:32,borderRadius:5,background:iconColor+'20',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          {iconLetter?<span style={{fontSize:10,fontWeight:700,color:iconColor}}>{iconLetter}</span>:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
        </div>
        <div style={{flex:1,minWidth:0}}>
          {renaming
            ? <input value={renameVal} autoFocus onChange={e=>setRenameVal(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter')renameFile();if(e.key==='Escape')setRenaming(false)}}
                onFocus={e=>e.target.select()} onClick={e=>e.stopPropagation()}
                style={{width:'100%',fontSize:12,padding:'2px 6px',border:'1px solid var(--accent)',borderRadius:4,background:'var(--surface2)',color:'var(--text)'}} />
            : <div onClick={()=>onPreview?onPreview(file,url):url&&triggerDownload(url,file.file_name)} style={{cursor:'pointer'}}>
                <div style={{display:'flex',alignItems:'center',gap:4}}>
                  <div style={{fontSize:12,fontWeight:500,color:'var(--text)',wordBreak:'break-word',lineHeight:'1.3',flex:1}}>{file.file_name}</div>
                  {canDelete&&<button onClick={e=>{e.stopPropagation();setRenameVal(file.file_name);setRenaming(true)}} title="Rename" style={{flexShrink:0,cursor:'pointer',background:'var(--surface2)',border:'0.5px solid var(--border)',borderRadius:4,padding:'2px 4px',display:'inline-flex',alignItems:'center'}}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#448a40" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>}
                </div>
                <div style={{fontSize:10,color:'var(--text3)',marginTop:2}}>{fmtSize(file.file_size)}</div>
              </div>
          }
        </div>
        <div style={{display:'flex',gap:4,flexShrink:0}}>
          {url&&<button onClick={e=>{e.stopPropagation();onPreview?onPreview(file,url):triggerDownload(url,file.file_name)}} style={{fontSize:10,lineHeight:'22px',padding:'0 7px',border:'0.5px solid var(--border)',borderRadius:4,background:'transparent',cursor:'pointer',color:'var(--text2)'}}>View</button>}
          {url&&<button onClick={e=>{e.stopPropagation();triggerDownload(url,file.file_name)}} style={{fontSize:10,lineHeight:'22px',padding:'0 7px',border:'0.5px solid var(--border)',borderRadius:4,background:'transparent',cursor:'pointer',color:'var(--text2)'}}>↓</button>}
          {canDelete&&<button onClick={e=>{e.stopPropagation();setConfirmDel(true)}} style={{fontSize:10,lineHeight:'22px',padding:'0 7px',border:'0.5px solid var(--red-border)',borderRadius:4,background:'transparent',cursor:'pointer',color:'var(--red)'}}>✕</button>}
        </div>
      </div>
      {confirmDel&&<_Confirm message={'Delete "'+file.file_name+'"?'} onOk={()=>{setConfirmDel(false);onDelete(file)}} onCancel={()=>setConfirmDel(false)} />}
    </>
  )
}

function SubfolderSection({ projectId, folder, subfolder, canManage, viewMode = 'grid', onPreview }) {
  const [files, setFiles] = useState([])
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (open) loadFiles()
  }, [open])

  async function loadFiles() {
    const { data } = await supabase
      .from('project_doc_files')
      .select('*')
      .eq('project_id', projectId)
      .eq('folder_key', folder.key)
      .eq('subfolder_key', subfolder.key)
      .order('created_at', { ascending: false })
    setFiles(_naturalSort(data || []))
  }

  async function uploadFiles(fileList) {
    if (!fileList.length) return
    setUploading(true)
    for (const file of fileList) {
      const path = `projects/${projectId}/${folder.key}/${subfolder.key}/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('project-docs').upload(path, file)
      if (!error) {
        await supabase.from('project_doc_files').insert({
          project_id: projectId,
          folder_key: folder.key,
          subfolder_key: subfolder.key,
          storage_path: path,
          file_name: file.name,
          file_size: file.size,
        })
      }
    }
    setUploading(false)
    loadFiles()
  }

  async function deleteFile(f) {
    await supabase.storage.from('project-docs').remove([f.storage_path])
    await supabase.from('project_doc_files').delete().eq('id', f.id)
    setConfirmDelete(null)
    setFiles(prev => prev.filter(x => x.id !== f.id))
  }

  async function downloadFile(f) {
    const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 60)
    if (data?.signedUrl) {
      const a = document.createElement('a'); a.href = data.signedUrl; a.download = f.file_name; a.click()
    }
  }

  async function zipFolder() {
    if (!files.length) return alert('No files in this folder to zip.')
    // Load JSZip and download all files
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    script.onload = async () => {
      const zip = new window.JSZip()
      for (const f of files) {
        const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 300)
        if (data?.signedUrl) {
          const resp = await fetch(data.signedUrl)
          const blob = await resp.blob()
          zip.file(f.file_name, blob)
        }
      }
      const content = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(content)
      a.download = `${subfolder.label}.zip`
      a.click()
    }
    document.head.appendChild(script)
  }


  async function bulkZip() {
    const chosen = files.filter(f => selected.has(f.id))
    if (!chosen.length) return
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    s.onload = async () => {
      const zip = new window.JSZip()
      for (const f of chosen) {
        const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 120)
        if (data?.signedUrl) { const res = await fetch(data.signedUrl); zip.file(f.file_name, await res.blob()) }
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = subfolder.label + '.zip'; a.click()
    }
    document.head.appendChild(s)
  }
  function toggleSelect(id) { setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  return (
    <div style={{ marginBottom: 3 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 6, cursor: 'pointer', background: open ? 'var(--surface2)' : 'transparent', transition: 'background 0.1s' }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--surface2)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent' }}
      >
        <FolderIcon folderKey={folder.key} color={folder.color} bg={folder.bg} size={14} />
        <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{subfolder.label}</span>
        <span style={{ fontSize: 10, color: 'var(--text3)' }}>{files.length > 0 ? `${files.length} file${files.length !== 1 ? 's' : ''}` : open ? '0 files' : ''}</span>
        {open && canManage && (
          <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
            <button onClick={zipFolder} style={{ fontSize: 10, padding: '2px 7px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>Zip</button>
            <label onClick={e => e.stopPropagation()} style={{ fontSize: 10, padding: '2px 7px', border: '0.5px solid #448a40', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: '#3b6d11' }}>
              {uploading ? 'Uploading...' : '+ Upload'}
              <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={e => uploadFiles(Array.from(e.target.files))} disabled={uploading} />
            </label>
          </div>
        )}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', marginLeft: 4 }}>
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>

      {open && (
        <div style={{ marginLeft: 14, paddingLeft: 12, borderLeft: '1.5px solid var(--border)', paddingTop: 10, paddingBottom: 8 }}>
          {files.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 12, color: 'var(--text3)' }}>
              No files yet
              {canManage && <span> — click <strong>+ Upload</strong> above to add files</span>}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
              {files.map(f => (
                <FileCard key={f.id} file={f}
                  onDownload={() => downloadFile(f)}
                  onDelete={() => setConfirmDelete(f)}
                  canDelete={canManage}
                />
              ))}
              {canManage && (
                <label style={{ border: '0.5px dashed var(--border)', borderRadius: 'var(--radius)', minHeight: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', color: 'var(--text3)', fontSize: 11 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Add file
                  <input type="file" multiple style={{ display: 'none' }} onChange={e => uploadFiles(Array.from(e.target.files))} />
                </label>
              )}
            </div>
          )}
        </div>
      )}

      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setConfirmDelete(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', padding: 24, maxWidth: 360, width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Delete file?</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>"{confirmDelete.file_name}" will be permanently deleted.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => deleteFile(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PrimeFolderSection({ projectId, folder, canManage, canAddFolders, allFileCounts }) {
  const [open, setOpen] = useState(false)
  const [subfolders, setSubfolders] = useState(folder.subfolders || [])
  const [showAddFolder, setShowAddFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [savingFolder, setSavingFolder] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [viewMode, setViewMode] = useState(() => { try { return localStorage.getItem('pdView_' + projectId + '_' + folder.key) || 'grid' } catch { return 'grid' } })
  const [selectedSubs, setSelectedSubs] = useState(new Set())
  const [previewFile, setPreviewFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  function setView(mode) { setViewMode(mode); try { localStorage.setItem('pdView_' + projectId + '_' + folder.key, mode) } catch {} }
  function openPreview(file, url) { setPreviewFile(file); setPreviewUrl(url||null); if (!url) supabase.storage.from('project-docs').createSignedUrl(file.storage_path, 3600).then(({data}) => { if (data?.signedUrl) setPreviewUrl(data.signedUrl) }) }

  useEffect(() => {
    loadCustomSubfolders()
  }, [])

  async function loadCustomSubfolders() {
    const { data } = await supabase
      .from('project_doc_folders')
      .select('*')
      .eq('project_id', projectId)
      .eq('parent_key', folder.key)
      .order('created_at')
    if (data?.length) {
      const custom = data.map(d => ({ key: d.folder_key, label: d.label, custom: true }))
      setSubfolders([...(folder.subfolders || []), ...custom])
    }
  }

  async function addCustomSubfolder() {
    if (!newFolderName.trim()) return
    setSavingFolder(true)
    const key = newFolderName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
    await supabase.from('project_doc_folders').insert({
      project_id: projectId,
      parent_key: folder.key,
      folder_key: key,
      label: newFolderName.trim(),
    })
    setSubfolders(prev => [...prev, { key, label: newFolderName.trim(), custom: true }])
    setNewFolderName('')
    setShowAddFolder(false)
    setSavingFolder(false)
  }

  async function uploadToFolder(fileList) {
    if (!fileList.length || folder.subfolders?.length > 0) return
    setUploading(true)
    for (const file of fileList) {
      const path = `projects/${projectId}/${folder.key}/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('project-docs').upload(path, file)
      if (!error) {
        await supabase.from('project_doc_files').insert({
          project_id: projectId,
          folder_key: folder.key,
          subfolder_key: null,
          storage_path: path,
          file_name: file.name,
          file_size: file.size,
        })
      }
    }
    setUploading(false)
  }

  async function zipFolder() {
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    script.onload = async () => {
      const zip = new window.JSZip()
      const { data: files } = await supabase.from('project_doc_files').select('*').eq('project_id', projectId).eq('folder_key', folder.key)
      if (!files?.length) { alert('No files in this folder.'); return }
      for (const f of files) {
        const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 300)
        if (data?.signedUrl) {
          const resp = await fetch(data.signedUrl)
          const blob = await resp.blob()
          const subPath = f.subfolder_key ? `${f.subfolder_key}/${f.file_name}` : f.file_name
          zip.file(subPath, blob)
        }
      }
      const content = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(content); a.download = `${folder.label}.zip`; a.click()
    }
    document.head.appendChild(script)
  }

  const fileCount = allFileCounts?.[folder.key] || 0


  async function zipSelectedSubs() {
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    s.onload = async () => {
      const zip = new window.JSZip()
      for (const sfKey of selectedSubs) {
        const sf = subfolders.find(s => s.key === sfKey)
        const { data: sfFiles } = await supabase.from('project_doc_files').select('*').eq('project_id', projectId).eq('subfolder_key', sfKey)
        for (const f of (sfFiles||[])) {
          const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 300)
          if (data?.signedUrl) { const res = await fetch(data.signedUrl); zip.file((sf?.label||sfKey)+'/'+f.file_name, await res.blob()) }
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = folder.label + '-folders.zip'; a.click()
      setSelectedSubs(new Set())
    }
    document.head.appendChild(s)
  }
  return (
    <div style={{ marginBottom: 6 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8, cursor: 'pointer', borderLeft: `3px solid ${folder.color}`, background: open ? 'var(--surface2)' : 'var(--surface)', border: `0.5px solid var(--border)`, borderLeftWidth: 3, borderLeftColor: folder.color, transition: 'background 0.1s' }}
      >
        <FolderIcon folderKey={folder.key} color={folder.color} bg={folder.bg} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{folder.label}</div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>
            {subfolders.length > 0 ? `${subfolders.length} sub-folder${subfolders.length !== 1 ? 's' : ''}` : ''}
            {fileCount > 0 ? ` · ${fileCount} file${fileCount !== 1 ? 's' : ''}` : ''}
            {' · locked template'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
          <button onClick={zipFolder} style={{ fontSize: 11, padding: '4px 10px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
            Zip
          </button>
          {folder.subfolders?.length === 0 && canManage && (
            <label style={{ fontSize: 11, padding: '4px 10px', border: '0.5px solid #448a40', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: '#3b6d11' }}>
              {uploading ? 'Uploading...' : '+ Upload'}
              <input type="file" multiple style={{ display: 'none' }} onChange={e => uploadToFolder(Array.from(e.target.files))} disabled={uploading} />
            </label>
          )}
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      {open && (
        <div style={{ marginLeft: 16, paddingLeft: 12, borderLeft: '1.5px solid var(--border)', paddingTop: 8, paddingBottom: 4 }}>
          {subfolders.map(sf => (
            <SubfolderSection key={sf.key} projectId={projectId} folder={folder} subfolder={sf} canManage={canManage} />
          ))}

          {canAddFolders && (
            <div style={{ marginTop: 6 }}>
              {showAddFolder ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 12px' }}>
                  <input
                    autoFocus
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addCustomSubfolder(); if (e.key === 'Escape') setShowAddFolder(false) }}
                    placeholder="Folder name..."
                    style={{ flex: 1, fontSize: 12, padding: '5px 10px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text)' }}
                  />
                  <button onClick={addCustomSubfolder} disabled={savingFolder || !newFolderName.trim()} style={{ fontSize: 11, padding: '5px 10px', background: '#448a40', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                    {savingFolder ? '...' : 'Add'}
                  </button>
                  <button onClick={() => setShowAddFolder(false)} style={{ fontSize: 11, padding: '5px 10px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowAddFolder(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '6px 12px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text3)' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Add sub-folder to this project
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ProjectDocumentation({ projectId, projectName }) {
  const { can, profile } = useAuth()
  useEffect(() => {
    const prevent = e => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])
  const [fileCounts, setFileCounts] = useState({})
  const [zippingAll, setZippingAll] = useState(false)
  const [customTopFolders, setCustomTopFolders] = useState([])

  const canManage = can('manage_projects')
  const canAddFolders = can('manage_projects')

  useEffect(() => {
    loadFileCounts()
    loadCustomTopFolders()
  }, [projectId])

  async function loadFileCounts() {
    const { data } = await supabase
      .from('project_doc_files')
      .select('folder_key')
      .eq('project_id', projectId)
    if (data) {
      const counts = {}
      data.forEach(f => { counts[f.folder_key] = (counts[f.folder_key] || 0) + 1 })
      setFileCounts(counts)
    }
  }

  async function loadCustomTopFolders() {
    const { data } = await supabase
      .from('project_doc_folders')
      .select('*')
      .eq('project_id', projectId)
      .is('parent_key', null)
      .order('created_at')
    setCustomTopFolders(data || [])
  }

  async function addTopFolder(name) {
    const key = `custom-${Date.now()}`
    await supabase.from('project_doc_folders').insert({
      project_id: projectId,
      parent_key: null,
      folder_key: key,
      label: name,
    })
    loadCustomTopFolders()
  }

  async function zipAll() {
    setZippingAll(true)
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    script.onload = async () => {
      const zip = new window.JSZip()
      const { data: files } = await supabase.from('project_doc_files').select('*').eq('project_id', projectId)
      if (!files?.length) { alert('No files uploaded yet.'); setZippingAll(false); return }
      for (const f of files) {
        const { data } = await supabase.storage.from('project-docs').createSignedUrl(f.storage_path, 300)
        if (data?.signedUrl) {
          const resp = await fetch(data.signedUrl)
          const blob = await resp.blob()
          const folderLabel = [...TEMPLATE_FOLDERS, ...customTopFolders].find(x => x.key === f.folder_key)?.label || f.folder_key
          const subLabel = f.subfolder_key || ''
          const path = subLabel ? `${folderLabel}/${subLabel}/${f.file_name}` : `${folderLabel}/${f.file_name}`
          zip.file(path, blob)
        }
      }
      const content = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(content)
      a.download = `${projectName || 'Project'} — All Documents.zip`
      a.click()
      setZippingAll(false)
    }
    document.head.appendChild(script)
  }

  const totalFiles = Object.values(fileCounts).reduce((a, b) => a + b, 0)

  return (
    <div>
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Project Documentation</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{totalFiles} file{totalFiles !== 1 ? 's' : ''} across all folders</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={zipAll} disabled={zippingAll} style={{ fontSize: 12, padding: '7px 14px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
            {zippingAll ? 'Preparing...' : 'Zip All Folders'}
          </button>
        </div>
      </div>

      {/* Template folders */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
        {TEMPLATE_FOLDERS.map(folder => (
          <PrimeFolderSection
            key={folder.key}
            projectId={projectId}
            folder={folder}
            canManage={canManage}
            canAddFolders={canAddFolders}
            allFileCounts={fileCounts}
          />
        ))}

        {/* Custom top-level folders */}
        {customTopFolders.map(cf => (
          <PrimeFolderSection
            key={cf.folder_key}
            projectId={projectId}
            folder={{ key: cf.folder_key, label: cf.label, color: '#888780', bg: '#F1EFE8', subfolders: [] }}
            canManage={canManage}
            canAddFolders={canAddFolders}
            allFileCounts={fileCounts}
          />
        ))}
      </div>

      {/* Add top-level folder (admin/PM only) */}
      {canAddFolders && <AddTopFolderButton onAdd={addTopFolder} />}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8, fontSize: 11, color: 'var(--text3)', marginTop: 16 }}>
        {TEMPLATE_FOLDERS.map(f => (
          <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 3, height: 12, background: f.color, borderRadius: 1 }} />
            {f.label.split('. ')[1] || f.label}
          </div>
        ))}
        <div style={{ marginLeft: 'auto', fontStyle: 'italic' }}>Template folders auto-created with each project</div>
      </div>

      {previewFile && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:1000, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:20 }} onClick={() => setPreviewFile(null)}>
          <div style={{ position:'absolute', top:16, right:16, display:'flex', gap:8 }}>
            {previewUrl && <button onClick={e => { e.stopPropagation(); triggerDownload(previewUrl, previewFile.file_name) }} style={{ fontSize:12, padding:'6px 12px', background:'rgba(255,255,255,0.15)', color:'#fff', borderRadius:6, border:'0.5px solid rgba(255,255,255,0.3)', cursor:'pointer' }}>↓ Download</button>}
            <button onClick={() => setPreviewFile(null)} style={{ fontSize:12, padding:'6px 12px', background:'rgba(255,255,255,0.15)', color:'#fff', borderRadius:6, border:'0.5px solid rgba(255,255,255,0.3)', cursor:'pointer' }}>✕ Close</button>
          </div>
          <div style={{ color:'rgba(255,255,255,0.7)', fontSize:12, marginBottom:12 }}>{previewFile.file_name}</div>
          {previewUrl
            ? _fti(previewFile.file_name, previewFile.file_type).isImage
              ? <img src={previewUrl} alt={previewFile.file_name} style={{ maxWidth:'90vw', maxHeight:'80vh', objectFit:'contain', borderRadius:8 }} onClick={e=>e.stopPropagation()} />
              : _fti(previewFile.file_name, previewFile.file_type).isPdf
              ? <iframe src={previewUrl} style={{ width:'95vw', height:'92vh', border:'none', borderRadius:8 }} title={previewFile.file_name} onClick={e=>e.stopPropagation()} />
              : <iframe src={'https://docs.google.com/gview?url='+encodeURIComponent(previewUrl)+'&embedded=true'} style={{ width:'95vw', height:'92vh', border:'none', borderRadius:8, background:'#fff' }} title={previewFile.file_name} onClick={e=>e.stopPropagation()} />
            : <div style={{ color:'rgba(255,255,255,0.5)', fontSize:13 }}>Loading preview...</div>
          }
        </div>
      )}
    </div>
  )
}

function AddTopFolderButton({ onAdd }) {
  const [show, setShow] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    await onAdd(name.trim())
    setName('')
    setShow(false)
    setSaving(false)
  }

  return (
    <div style={{ marginTop: 4 }}>
      {show ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '8px 0' }}>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setShow(false) }}
            placeholder="New folder name for this project..."
            style={{ flex: 1, fontSize: 12, padding: '7px 12px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text)' }}
          />
          <button onClick={save} disabled={saving || !name.trim()} style={{ fontSize: 12, padding: '7px 14px', background: '#448a40', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
            {saving ? '...' : 'Add Folder'}
          </button>
          <button onClick={() => setShow(false)} style={{ fontSize: 12, padding: '7px 12px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>
            Cancel
          </button>
        </div>
      ) : (
        <button onClick={() => setShow(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '8px 14px', border: '0.5px dashed var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: 'var(--text3)', width: '100%', justifyContent: 'center' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add folder to this project (admin / PM only)
        </button>
      )}
    </div>
  )
}
