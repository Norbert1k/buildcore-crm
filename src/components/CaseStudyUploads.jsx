import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Uploaded case studies — finished case-study documents (e.g. the 2-page CCG
// PDFs) attached to a project. Stored like any project document:
//   bucket  project-docs   path  projects/<id>/case_study/<ts>-<name>
//   table   project_doc_files, folder_key 'case_study'
// The folder key isn't part of the Documents tree, so these appear only here.
// Newest upload is marked Current; earlier ones stay as previous versions.
// ─────────────────────────────────────────────────────────────────────────────

const FOLDER_KEY = 'case_study'
const ACCEPT = '.pdf,.docx,.doc,.pptx,.png,.jpg,.jpeg'

function sanitizeStorageName(name) {
  return String(name)
    .replace(/[—–]/g, '-')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[#?%{}\\^~\[\]`>|<]/g, '-')
    .replace(/\s{2,}/g, ' ').trim() || 'file'
}
function fmtSize(b) {
  if (!b) return ''
  return b < 1024 * 1024 ? Math.round(b / 1024) + ' KB' : (b / (1024 * 1024)).toFixed(1) + ' MB'
}
const isPdf = n => /\.pdf$/i.test(n || '')
const isImg = n => /\.(png|jpe?g)$/i.test(n || '')

let _pdfjsPromise = null
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib)
  if (_pdfjsPromise) return _pdfjsPromise
  _pdfjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
    s.onload = () => {
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
        resolve(window.pdfjsLib)
      } catch (e) { reject(e) }
    }
    s.onerror = reject
    document.head.appendChild(s)
  })
  return _pdfjsPromise
}

async function signedUrl(path, download) {
  const { data } = await supabase.storage.from('project-docs').createSignedUrl(path, 3600, download ? { download } : undefined)
  return data?.signedUrl || null
}

function Thumb({ file }) {
  const [img, setImg] = useState(null)
  const [state, setState] = useState('loading')
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const url = await signedUrl(file.storage_path)
        if (!url) throw new Error('no url')
        if (isImg(file.file_name)) { if (!cancelled) { setImg(url); setState('done') } return }
        if (!isPdf(file.file_name)) { setState('none'); return }
        const pdfjs = await loadPdfJs()
        const doc = await pdfjs.getDocument(url).promise
        const page = await doc.getPage(1)
        const vp = page.getViewport({ scale: 1 })
        const scale = 320 / vp.width
        const view = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = view.width; canvas.height = view.height
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: view }).promise
        if (!cancelled) { setImg(canvas.toDataURL('image/jpeg', 0.8)); setState('done') }
      } catch { if (!cancelled) setState('none') }
    })()
    return () => { cancelled = true }
  }, [file.id])
  return (
    <div style={{ height: 220, background: '#fff', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'hidden' }}>
      {state === 'done' && img
        ? <img src={img} alt="" style={{ width: '100%', objectFit: 'cover', objectPosition: 'top' }} />
        : <div style={{ alignSelf: 'center', fontSize: 12, color: '#888' }}>{state === 'loading' ? 'Loading preview…' : (file.file_name.split('.').pop() || 'file').toUpperCase()}</div>}
    </div>
  )
}

export default function CaseStudyUploads({ projectId, canManage }) {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('project_doc_files').select('*')
      .eq('project_id', projectId).eq('folder_key', FOLDER_KEY)
      .order('created_at', { ascending: false })
    setFiles(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [projectId])

  async function upload(list) {
    const arr = Array.from(list || []).filter(Boolean)
    if (!arr.length || !canManage) return
    const failed = []
    for (const file of arr) {
      setBusy(`Uploading ${file.name}…`)
      const path = `projects/${projectId}/${FOLDER_KEY}/${Date.now()}-${sanitizeStorageName(file.name)}`
      const { error } = await supabase.storage.from('project-docs').upload(path, file)
      if (error) { failed.push(`${file.name} — ${error.message}`); continue }
      const { error: dbErr } = await supabase.from('project_doc_files').insert({
        project_id: projectId, folder_key: FOLDER_KEY, subfolder_key: null,
        file_name: file.name, file_size: file.size, storage_path: path,
      })
      if (dbErr) failed.push(`${file.name} — ${dbErr.message}`)
    }
    setBusy('')
    if (failed.length) alert('Some files did not upload:\n\n' + failed.join('\n'))
    load()
  }

  async function open(f, download) {
    const w = window.open('', '_blank')
    const url = await signedUrl(f.storage_path, download ? f.file_name : undefined)
    if (url && w) w.location.href = url
    else if (w) w.close()
  }

  async function remove(f) {
    if (!canManage) return
    if (!window.confirm(`Delete "${f.file_name}" from this project's case studies? This can't be undone.`)) return
    await supabase.storage.from('project-docs').remove([f.storage_path])
    await supabase.from('project_doc_files').delete().eq('id', f.id)
    load()
  }

  return (
    <div className="card card-pad" style={{ marginBottom: 14 }}
      onDragOver={e => { if (canManage) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Uploaded case studies</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            Finished case-study documents for this project. The newest is marked current; earlier uploads are kept.
          </div>
        </div>
        {canManage && (
          <>
            <input ref={inputRef} type="file" multiple accept={ACCEPT} style={{ display: 'none' }}
              onChange={e => { upload(e.target.files); e.target.value = '' }} />
            <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => inputRef.current?.click()}>+ Upload case study</button>
          </>
        )}
      </div>

      {busy && <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>{busy}</div>}

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>Loading…</div>
      ) : files.length === 0 ? (
        <div style={{ border: `1.5px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius)', padding: 28, textAlign: 'center', fontSize: 12, color: 'var(--text3)' }}>
          {canManage ? 'Drop a case study PDF here, or use Upload.' : 'No case study uploaded yet.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, outline: dragOver ? '2px dashed var(--accent)' : 'none', outlineOffset: 4 }}>
          {files.map((f, i) => (
            <div key={f.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--surface)' }}>
              <div style={{ cursor: 'pointer' }} onClick={() => open(f, false)}><Thumb file={f} /></div>
              <div style={{ padding: '8px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.file_name}>{f.file_name}</div>
                  {i === 0
                    ? <span className="pill pill-green" style={{ fontSize: 10, flexShrink: 0 }}>Current</span>
                    : <span className="pill pill-gray" style={{ fontSize: 10, flexShrink: 0 }}>Previous</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', margin: '2px 0 8px' }}>
                  {fmtSize(f.file_size)} · {new Date(f.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm" style={{ flex: 1 }} onClick={() => open(f, false)}>View</button>
                  <button className="btn btn-sm" style={{ flex: 1 }} onClick={() => open(f, true)}>Download</button>
                  {canManage && <button className="btn btn-sm btn-danger" onClick={() => remove(f)} title="Delete">✕</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
