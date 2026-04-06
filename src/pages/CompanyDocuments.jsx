import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { formatDate } from '../lib/utils'
import { Spinner, ConfirmDialog, IconTrash } from '../components/ui'
import SortableGrid from '../components/SortableGrid'

const CATEGORIES = [
  { key: 'logo',           icon: '🏢', label: 'Logo & Branding' },
  { key: 'policies',       icon: '📋', label: 'Policies' },
  { key: 'insurance',      icon: '🛡️', label: 'Insurance' },
  { key: 'vat',            icon: '💰', label: 'VAT & Tax' },
  { key: 'bank',           icon: '🏦', label: 'Bank Details' },
  { key: 'certifications', icon: '📜', label: 'Certifications' },
  { key: 'fleet',          icon: '🚗', label: 'Car Fleet' },
  { key: 'templates',      icon: '📝', label: 'Templates' },
]

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / 1048576).toFixed(1)}MB`
}

function fileIcon(type) {
  if (!type) return '📄'
  if (type.includes('pdf')) return '📄'
  if (type.includes('spreadsheet') || type.includes('excel') || type.includes('csv')) return '📊'
  if (type.includes('presentation') || type.includes('powerpoint')) return '📑'
  if (type.includes('word') || type.includes('document')) return '📝'
  if (type.includes('image')) return null
  if (type.includes('video')) return '🎬'
  return '📄'
}

function fileColor(type) {
  if (!type) return '#808080'
  if (type.includes('pdf')) return '#E24B4A'
  if (type.includes('spreadsheet') || type.includes('excel')) return '#1D7B45'
  if (type.includes('presentation') || type.includes('powerpoint')) return '#C55A25'
  if (type.includes('word') || type.includes('document')) return '#1B5EAE'
  if (type.includes('image')) return '#448a40'
  return '#808080'
}

function fileExt(name) {
  return name?.split('.').pop()?.toUpperCase() || 'FILE'
}

async function generatePdfThumbnail(url) {
  try {
    if (!window.pdfjsLib) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script')
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
        s.onload = resolve; s.onerror = reject
        document.head.appendChild(s)
      })
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
    }
    const pdf = await window.pdfjsLib.getDocument(url).promise
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 0.5 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width; canvas.height = viewport.height
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    return canvas.toDataURL()
  } catch (e) { return null }
}

export default function CompanyDocuments() {
  const { can, profile } = useAuth()
  const [activeCategory, setActiveCategory] = useState(null)
  const [docs, setDocs] = useState({})
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [previewDoc, setPreviewDoc] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [thumbnails, setThumbnails] = useState({})
  const [downloading, setDownloading] = useState(false)

  useEffect(() => { loadDocs() }, [])

  async function loadDocs() {
    setLoading(true)
    const { data } = await supabase
      .from('company_documents')
      .select('*, profiles(full_name)')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
    const grouped = {}
    CATEGORIES.forEach(c => grouped[c.key] = [])
    ;(data || []).forEach(d => { if (grouped[d.category] !== undefined) grouped[d.category].push(d) })
    setDocs(grouped)
    setLoading(false)
  }

  async function loadThumbnailsForCategory(categoryDocs) {
    for (const doc of categoryDocs) {
      if (thumbnails[doc.id]) continue
      if (!doc.file_type?.includes('image') && !doc.file_type?.includes('pdf')) continue
      const { data: urlData } = await supabase.storage.from('company-docs').createSignedUrl(doc.storage_path, 3600)
      if (urlData?.signedUrl) {
        if (doc.file_type?.includes('image')) {
          setThumbnails(t => ({ ...t, [doc.id]: urlData.signedUrl }))
        } else if (doc.file_type?.includes('pdf')) {
          generatePdfThumbnail(urlData.signedUrl).then(thumb => {
            if (thumb) setThumbnails(t => ({ ...t, [doc.id]: thumb }))
          })
        }
      }
    }
  }

  async function uploadFiles(files, category) {
    if (!category) return
    setUploading(true)
    for (const file of files) {
      const path = `company/${category}/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('company-docs').upload(path, file)
      if (!error) {
        const { data: existing } = await supabase.from('company_documents').select('sort_order').eq('category', category).order('sort_order', { ascending: false }).limit(1).single()
        await supabase.from('company_documents').insert({
          category, file_name: file.name, file_size: file.size,
          file_type: file.type, storage_path: path, uploaded_by: profile?.id,
          sort_order: (existing?.sort_order || 0) + 1,
        })
      }
    }
    setUploading(false)
    setSelected(new Set())
    loadDocs()
  }

  async function getSignedUrl(doc) {
    const { data } = await supabase.storage.from('company-docs').createSignedUrl(doc.storage_path, 300)
    return data?.signedUrl
  }

  async function downloadSingle(doc) {
    const url = await getSignedUrl(doc)
    if (url) { const a = document.createElement('a'); a.href = url; a.download = doc.file_name; a.click() }
  }

  async function downloadSelected() {
    const activeDocs = docs[activeCategory] || []
    const selectedDocs = activeDocs.filter(d => selected.has(d.id))
    if (selectedDocs.length === 0) return
    if (selectedDocs.length === 1) { downloadSingle(selectedDocs[0]); return }
    setDownloading(true)
    try {
      const script = document.createElement('script')
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
      document.head.appendChild(script)
      await new Promise(r => script.onload = r)
      const zip = new window.JSZip()
      for (const doc of selectedDocs) {
        const url = await getSignedUrl(doc)
        if (url) { const res = await fetch(url); zip.file(doc.file_name, await res.blob()) }
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${CATEGORIES.find(c => c.key === activeCategory)?.label || 'documents'}.zip`
      a.click(); URL.revokeObjectURL(a.href)
    } catch(e) { console.error(e) }
    setDownloading(false)
  }

  async function openPreview(doc) {
    setPreviewDoc(doc); setPreviewLoading(true); setPreviewUrl(null)
    setPreviewUrl(await getSignedUrl(doc))
    setPreviewLoading(false)
  }

  async function deleteDoc(doc) {
    await supabase.storage.from('company-docs').remove([doc.storage_path])
    await supabase.from('company_documents').delete().eq('id', doc.id)
    setConfirmDelete(null)
    setSelected(s => { const n = new Set(s); n.delete(doc.id); return n })
    loadDocs()
  }

  async function handleReorder(newOrder) {
    const updates = newOrder.map((id, i) =>
      supabase.from('company_documents').update({ sort_order: i + 1 }).eq('id', id)
    )
    await Promise.all(updates)
    // Update local state to reflect new order
    setDocs(prev => ({
      ...prev,
      [activeCategory]: newOrder.map(id => prev[activeCategory].find(d => d.id === id)).filter(Boolean)
    }))
  }

  function toggleSelect(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function selectAll() {
    const activeDocs = docs[activeCategory] || []
    if (selected.size === activeDocs.length) setSelected(new Set())
    else setSelected(new Set(activeDocs.map(d => d.id)))
  }

  const activeCat = CATEGORIES.find(c => c.key === activeCategory)
  const activeDocs = activeCategory ? (docs[activeCategory] || []) : []
  const selectedCount = [...selected].filter(id => activeDocs.find(d => d.id === id)).length

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Company Documents</h2>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>Upload and manage company-wide documents — accessible to all staff</p>
      </div>

      {/* Category tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 24 }}>
        {CATEGORIES.map(cat => {
          const count = docs[cat.key]?.length || 0
          const isActive = activeCategory === cat.key
          return (
            <div key={cat.key}
              onClick={() => {
                const newCat = isActive ? null : cat.key
                setActiveCategory(newCat)
                setSelected(new Set())
                if (!isActive && docs[cat.key]?.length) setTimeout(() => loadThumbnailsForCategory(docs[cat.key]), 150)
              }}
              style={{ background: isActive ? 'var(--green-bg)' : 'var(--surface)', border: `1.5px solid ${isActive ? 'var(--green)' : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', padding: '14px 10px', textAlign: 'center', cursor: 'pointer', transition: 'all .15s', position: 'relative' }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface2)' }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface)' }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>{cat.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: isActive ? 'var(--green)' : 'var(--text)', lineHeight: 1.3 }}>{cat.label}</div>
              {count > 0 && <div style={{ position: 'absolute', top: 8, right: 8, background: isActive ? 'var(--green)' : '#808080', color: 'white', fontSize: 10, fontWeight: 700, width: 18, height: 18, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{count}</div>}
            </div>
          )
        })}
      </div>

      {/* Document panel */}
      {activeCategory && (
        <div className="card card-pad">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 20 }}>{activeCat?.icon}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{activeCat?.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{activeDocs.length} file{activeDocs.length !== 1 ? 's' : ''} · drag cards to reorder</div>
              </div>
              {activeDocs.length > 1 && <button className="btn btn-sm" onClick={selectAll} style={{ fontSize: 11 }}>{selectedCount === activeDocs.length ? 'Deselect all' : 'Select all'}</button>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {selectedCount > 0 && (
                <button className="btn btn-sm btn-primary" onClick={downloadSelected} disabled={downloading} style={{ fontSize: 12 }}>
                  {downloading ? 'Preparing...' : `↓ Download ${selectedCount > 1 ? `${selectedCount} as ZIP` : '1 file'}`}
                </button>
              )}
              {can('manage_subcontractors') && (
                <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
                  {uploading ? 'Uploading...' : '↑ Upload Files'}
                  <input type="file" multiple style={{ display: 'none' }} onChange={e => uploadFiles(Array.from(e.target.files), activeCategory)} disabled={uploading} />
                </label>
              )}
            </div>
          </div>

          {/* Drop zone wrapper */}
          <div onDragOver={e => { if (!e.target.closest('[draggable]')) { e.preventDefault(); setDragOver(true) }}}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false) }}
            onDrop={e => {
              const files = Array.from(e.dataTransfer.files)
              if (files.length) { e.preventDefault(); setDragOver(false); uploadFiles(files, activeCategory) }
            }}
            style={{ border: `2px dashed ${dragOver ? 'var(--green)' : 'transparent'}`, borderRadius: 'var(--radius)', background: dragOver ? 'var(--green-bg)' : 'transparent', transition: 'all .15s', minHeight: activeDocs.length === 0 ? 140 : 'auto' }}>

            {activeDocs.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                No documents yet — drag files here or click Upload
              </div>
            ) : (
              <SortableGrid
                items={activeDocs}
                onReorder={handleReorder}
                columns="repeat(auto-fill, minmax(160px, 1fr))"
                renderItem={(doc) => {
                  const isSelected = selected.has(doc.id)
                  const isImage = doc.file_type?.includes('image')
                  const thumb = thumbnails[doc.id]
                  const icon = fileIcon(doc.file_type)
                  const color = fileColor(doc.file_type)
                  const ext = fileExt(doc.file_name)
                  return (
                    <div style={{ borderRadius: 'var(--radius)', border: `2px solid ${isSelected ? 'var(--green)' : 'var(--border)'}`, background: isSelected ? 'var(--green-bg)' : 'var(--surface)', overflow: 'visible', userSelect: 'none', position: 'relative' }}>
                      {/* Checkbox */}
                      <div onClick={e => { e.stopPropagation(); toggleSelect(doc.id) }}
                        style={{ position: 'absolute', top: 8, left: 8, zIndex: 50, width: 20, height: 20, borderRadius: 4, border: `2px solid ${isSelected ? 'var(--green)' : 'rgba(128,128,128,0.6)'}`, background: isSelected ? 'var(--green)' : 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        {isSelected && <svg width="10" height="10" viewBox="0 0 12 12" fill="white"><path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>}
                      </div>
                      {/* Delete */}
                      {can('manage_subcontractors') && (
                        <div onClick={e => { e.stopPropagation(); e.preventDefault(); setConfirmDelete(doc) }}
                          style={{ position: 'absolute', top: 8, right: 8, zIndex: 50, width: 22, height: 22, borderRadius: 4, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white', fontSize: 12, pointerEvents: 'all' }}>
                          ✕
                        </div>
                      )}
                      {/* Thumbnail */}
                      <div onClick={e => { e.stopPropagation(); openPreview(doc) }} style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: thumb ? (isImage ? '#000' : '#fff') : `${color}15`, overflow: 'hidden', cursor: 'pointer', borderRadius: 'calc(var(--radius) - 2px) calc(var(--radius) - 2px) 0 0' }}>
                        {thumb ? (
                          <img src={thumb} alt={doc.file_name} style={{ width: '100%', height: '100%', objectFit: isImage ? 'cover' : 'contain', padding: isImage ? 0 : 4 }} />
                        ) : (
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 36, marginBottom: 4 }}>{icon}</div>
                            <div style={{ fontSize: 10, fontWeight: 700, color, background: `${color}20`, padding: '2px 6px', borderRadius: 4 }}>{ext}</div>
                          </div>
                        )}
                      </div>
                      {/* Info */}
                      <div style={{ padding: '8px 10px' }}>
                        <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.4, marginBottom: 2, wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={doc.file_name}>{doc.file_name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)' }}>{formatSize(doc.file_size)} · {formatDate(doc.created_at)}</div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                          <button className="btn btn-sm" style={{ flex: 1, fontSize: 10, padding: '4px 6px' }} onClick={e => { e.stopPropagation(); openPreview(doc) }}>👁 View</button>
                          <button onClick={e => { e.stopPropagation(); downloadSingle(doc) }} title="Download" style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--green)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'white', fontSize: 13 }}>↓</button>
                        </div>
                      </div>
                    </div>
                  )
                }}
              />
            )}
          </div>
        </div>
      )}

      {!activeCategory && (
        <div style={{ textAlign: 'center', padding: '30px 20px', color: 'var(--text3)', fontSize: 13 }}>
          Click a category above to view and upload documents
        </div>
      )}

      {/* Preview Modal */}
      {previewDoc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => { setPreviewDoc(null); setPreviewUrl(null) }}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 900, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <span style={{ fontSize: 20 }}>{fileIcon(previewDoc.file_type) || '🖼️'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previewDoc.file_name}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{formatSize(previewDoc.file_size)} · {formatDate(previewDoc.created_at)}</div>
              </div>
              <button className="btn btn-sm btn-primary" onClick={() => downloadSingle(previewDoc)}>↓ Download</button>
              <button className="btn btn-sm" onClick={() => { setPreviewDoc(null); setPreviewUrl(null) }} style={{ fontSize: 16, padding: '4px 12px' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111', minHeight: 300 }}>
              {previewLoading ? (
                <div style={{ color: 'white', fontSize: 13 }}>Loading preview...</div>
              ) : !previewUrl ? (
                <div style={{ color: '#aaa', fontSize: 13 }}>Could not load preview</div>
              ) : previewDoc.file_type?.includes('image') ? (
                <img src={previewUrl} alt={previewDoc.file_name} style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }} />
              ) : previewDoc.file_type?.includes('pdf') ? (
                <iframe src={`${previewUrl}#toolbar=1`} style={{ width: '100%', height: '80vh', border: 'none' }} title={previewDoc.file_name} />
              ) : previewDoc.file_type?.includes('video') ? (
                <video controls src={previewUrl} style={{ maxWidth: '100%', maxHeight: '80vh' }} />
              ) : (previewDoc.file_type?.includes('word') || previewDoc.file_type?.includes('spreadsheet') || previewDoc.file_name?.match(/\.(docx?|xlsx?|pptx?)$/i)) ? (
                <iframe src={`https://docs.google.com/viewer?url=${encodeURIComponent(previewUrl)}&embedded=true`} style={{ width: '100%', height: '80vh', border: 'none' }} title={previewDoc.file_name} />
              ) : (
                <div style={{ color: 'white', textAlign: 'center', padding: 40 }}>
                  <div style={{ fontSize: 56, marginBottom: 16 }}>{fileIcon(previewDoc.file_type)}</div>
                  <div style={{ fontSize: 14, marginBottom: 24 }}>{previewDoc.file_name}</div>
                  <button className="btn btn-primary" onClick={() => downloadSingle(previewDoc)}>↓ Download File</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={() => deleteDoc(confirmDelete)}
        title="Delete document" message={`Delete "${confirmDelete?.file_name}"? This cannot be undone.`} danger />
    </div>
  )
}
