import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { formatDate } from '../lib/utils'
import { Spinner, ConfirmDialog, IconTrash } from '../components/ui'

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
  if (type.includes('image')) return null // show actual image
  if (type.includes('video')) return '🎬'
  if (type.includes('zip') || type.includes('rar')) return '🗜️'
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
      .order('created_at', { ascending: false })
    const grouped = {}
    CATEGORIES.forEach(c => grouped[c.key] = [])
    ;(data || []).forEach(d => { if (grouped[d.category] !== undefined) grouped[d.category].push(d) })
    setDocs(grouped)
    setLoading(false)
    // Load thumbnails for images
    const imageDocs = (data || []).filter(d => d.file_type?.includes('image'))
    for (const doc of imageDocs.slice(0, 20)) {
      const { data: urlData } = await supabase.storage.from('company-docs').createSignedUrl(doc.storage_path, 3600)
      if (urlData?.signedUrl) setThumbnails(t => ({ ...t, [doc.id]: urlData.signedUrl }))
    }
  }

  async function uploadFiles(files, category) {
    if (!category) return
    setUploading(true)
    for (const file of files) {
      const path = `company/${category}/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('company-docs').upload(path, file)
      if (!error) {
        await supabase.from('company_documents').insert({
          category, file_name: file.name, file_size: file.size,
          file_type: file.type, storage_path: path, uploaded_by: profile?.id,
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
    if (url) {
      const a = document.createElement('a'); a.href = url; a.download = doc.file_name; a.click()
    }
  }

  async function downloadSelected() {
    const activeDocs = docs[activeCategory] || []
    const selectedDocs = activeDocs.filter(d => selected.has(d.id))
    if (selectedDocs.length === 0) return
    if (selectedDocs.length === 1) { downloadSingle(selectedDocs[0]); return }

    // Download as ZIP using JSZip
    setDownloading(true)
    try {
      const script = document.createElement('script')
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
      document.head.appendChild(script)
      await new Promise(r => script.onload = r)

      const zip = new window.JSZip()
      for (const doc of selectedDocs) {
        const url = await getSignedUrl(doc)
        if (url) {
          const res = await fetch(url)
          const blob = await res.blob()
          zip.file(doc.file_name, blob)
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${CATEGORIES.find(c=>c.key===activeCategory)?.label || 'documents'}.zip`; a.click()
      URL.revokeObjectURL(url)
    } catch(e) { console.error(e) }
    setDownloading(false)
  }

  async function openPreview(doc) {
    setPreviewDoc(doc); setPreviewLoading(true); setPreviewUrl(null)
    const url = await getSignedUrl(doc)
    setPreviewUrl(url)
    setPreviewLoading(false)
  }

  async function deleteDoc(doc) {
    await supabase.storage.from('company-docs').remove([doc.storage_path])
    await supabase.from('company_documents').delete().eq('id', doc.id)
    setConfirmDelete(null)
    setSelected(s => { const n = new Set(s); n.delete(doc.id); return n })
    loadDocs()
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
            <div key={cat.key} onClick={() => { setActiveCategory(isActive ? null : cat.key); setSelected(new Set()) }}
              style={{ background: isActive ? 'var(--green-bg)' : 'var(--surface)', border: `1.5px solid ${isActive ? 'var(--green)' : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', padding: '14px 10px', textAlign: 'center', cursor: 'pointer', transition: 'all .15s', position: 'relative' }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface2)' }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface)' }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>{cat.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: isActive ? 'var(--green)' : 'var(--text)', lineHeight: 1.3 }}>{cat.label}</div>
              {count > 0 && (
                <div style={{ position: 'absolute', top: 8, right: 8, background: isActive ? 'var(--green)' : '#808080', color: 'white', fontSize: 10, fontWeight: 700, width: 18, height: 18, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{count}</div>
              )}
            </div>
          )
        })}
      </div>

      {/* Document panel */}
      {activeCategory && (
        <div className="card card-pad">
          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 20 }}>{activeCat?.icon}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{activeCat?.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{activeDocs.length} file{activeDocs.length !== 1 ? 's' : ''}</div>
              </div>
              {activeDocs.length > 0 && (
                <button className="btn btn-sm" onClick={selectAll} style={{ fontSize: 11 }}>
                  {selectedCount === activeDocs.length ? 'Deselect all' : 'Select all'}
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {selectedCount > 0 && (
                <>
                  <button className="btn btn-sm" onClick={() => downloadSelected()} disabled={downloading} style={{ fontSize: 12 }}>
                    {downloading ? 'Zipping...' : `↓ Download ${selectedCount} file${selectedCount > 1 ? 's' : ''}`}
                  </button>
                  {selectedCount > 1 && (
                    <button className="btn btn-sm btn-primary" onClick={downloadSelected} disabled={downloading} style={{ fontSize: 12 }}>
                      {downloading ? 'Creating ZIP...' : '🗜️ Download as ZIP'}
                    </button>
                  )}
                </>
              )}
              {can('manage_subcontractors') && (
                <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
                  {uploading ? 'Uploading...' : '↑ Upload Files'}
                  <input type="file" multiple style={{ display: 'none' }} onChange={e => uploadFiles(Array.from(e.target.files), activeCategory)} disabled={uploading} />
                </label>
              )}
            </div>
          </div>

          {/* Drag & drop + file grid */}
          <div onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); uploadFiles(Array.from(e.dataTransfer.files), activeCategory) }}
            style={{ border: `2px dashed ${dragOver ? 'var(--green)' : 'transparent'}`, borderRadius: 'var(--radius)', background: dragOver ? 'var(--green-bg)' : 'transparent', transition: 'all .15s', minHeight: activeDocs.length === 0 ? 140 : 'auto' }}>

            {activeDocs.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                {dragOver ? 'Drop files here to upload' : 'No documents yet — drag files here or click Upload'}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, padding: 4 }}>
                {activeDocs.map(doc => {
                  const isSelected = selected.has(doc.id)
                  const isImage = doc.file_type?.includes('image')
                  const thumb = thumbnails[doc.id]
                  const icon = fileIcon(doc.file_type)
                  const color = fileColor(doc.file_type)
                  const ext = fileExt(doc.file_name)

                  return (
                    <div key={doc.id} style={{ position: 'relative', borderRadius: 'var(--radius)', border: `2px solid ${isSelected ? 'var(--green)' : 'var(--border)'}`, background: isSelected ? 'var(--green-bg)' : 'var(--surface)', overflow: 'hidden', transition: 'all .15s', cursor: 'pointer' }}>
                      {/* Checkbox */}
                      <div onClick={() => toggleSelect(doc.id)}
                        style={{ position: 'absolute', top: 8, left: 8, zIndex: 2, width: 20, height: 20, borderRadius: 4, border: `2px solid ${isSelected ? 'var(--green)' : 'rgba(255,255,255,0.8)'}`, background: isSelected ? 'var(--green)' : 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }}>
                        {isSelected && <svg width="10" height="10" viewBox="0 0 12 12" fill="white"><path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>}
                      </div>

                      {/* Delete button */}
                      {can('manage_subcontractors') && (
                        <div onClick={() => setConfirmDelete(doc)}
                          style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, width: 20, height: 20, borderRadius: 4, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white', fontSize: 12, backdropFilter: 'blur(2px)' }}>
                          ✕
                        </div>
                      )}

                      {/* Thumbnail / preview area */}
                      <div onClick={() => openPreview(doc)} style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isImage && thumb ? '#000' : `${color}15`, overflow: 'hidden' }}>
                        {isImage && thumb ? (
                          <img src={thumb} alt={doc.file_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 36, marginBottom: 4 }}>{icon}</div>
                            <div style={{ fontSize: 10, fontWeight: 700, color, background: `${color}20`, padding: '2px 6px', borderRadius: 4 }}>{ext}</div>
                          </div>
                        )}
                      </div>

                      {/* File info */}
                      <div style={{ padding: '8px 10px' }}>
                        <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }} title={doc.file_name}>{doc.file_name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)' }}>{formatSize(doc.file_size)} · {formatDate(doc.created_at)}</div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                          <button className="btn btn-sm" style={{ flex: 1, fontSize: 10, padding: '4px 6px' }} onClick={() => openPreview(doc)}>👁 View</button>
                          <button onClick={() => downloadSingle(doc)} title="Download" style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--green)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'white', fontSize: 13 }}>↓</button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
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
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{formatSize(previewDoc.file_size)} · Uploaded {formatDate(previewDoc.created_at)}</div>
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
                <iframe
                  src={`${previewUrl}#toolbar=1&navpanes=1&scrollbar=1&view=FitH`}
                  style={{ width: '100%', height: '80vh', border: 'none', background: 'white' }}
                  title={previewDoc.file_name}
                />
              ) : previewDoc.file_type?.includes('video') ? (
                <video controls src={previewUrl} style={{ maxWidth: '100%', maxHeight: '80vh' }} />
              ) : (previewDoc.file_type?.includes('word') || previewDoc.file_type?.includes('document') ||
                   previewDoc.file_type?.includes('spreadsheet') || previewDoc.file_type?.includes('excel') ||
                   previewDoc.file_type?.includes('presentation') || previewDoc.file_type?.includes('powerpoint') ||
                   previewDoc.file_name?.match(/\.(docx?|xlsx?|pptx?)$/i)) ? (
                <iframe
                  src={`https://docs.google.com/viewer?url=${encodeURIComponent(previewUrl)}&embedded=true`}
                  style={{ width: '100%', height: '80vh', border: 'none', background: 'white' }}
                  title={previewDoc.file_name}
                />
              ) : (
                <div style={{ color: 'white', textAlign: 'center', padding: 40 }}>
                  <div style={{ fontSize: 56, marginBottom: 16 }}>{fileIcon(previewDoc.file_type)}</div>
                  <div style={{ fontSize: 14, marginBottom: 8 }}>{previewDoc.file_name}</div>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 24 }}>Preview not available — download to view</div>
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
