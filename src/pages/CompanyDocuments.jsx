import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { formatDate } from '../lib/utils'
import { Spinner, ConfirmDialog, IconTrash } from '../components/ui'

const CATEGORIES = [
  { key: 'logo',          icon: '🏢', label: 'Logo & Branding' },
  { key: 'policies',      icon: '📋', label: 'Policies' },
  { key: 'insurance',     icon: '🛡️', label: 'Insurance' },
  { key: 'vat',           icon: '💰', label: 'VAT & Tax' },
  { key: 'bank',          icon: '🏦', label: 'Bank Details' },
  { key: 'certifications',icon: '📜', label: 'Certifications' },
  { key: 'fleet',         icon: '🚗', label: 'Car Fleet' },
  { key: 'templates',     icon: '📝', label: 'Templates' },
]

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1048576) return `${(bytes/1024).toFixed(0)}KB`
  return `${(bytes/1048576).toFixed(1)}MB`
}

function fileIcon(type) {
  if (!type) return '📄'
  if (type.includes('pdf')) return '📄'
  if (type.includes('spreadsheet') || type.includes('excel') || type.includes('csv')) return '📊'
  if (type.includes('presentation') || type.includes('powerpoint')) return '📑'
  if (type.includes('word') || type.includes('document')) return '📝'
  if (type.includes('image')) return '🖼️'
  if (type.includes('zip') || type.includes('rar')) return '🗜️'
  return '📄'
}

export default function CompanyDocuments() {
  const { can, profile } = useAuth()
  const [activeCategory, setActiveCategory] = useState(null)
  const [docs, setDocs] = useState({})
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => { loadDocs() }, [])

  async function loadDocs() {
    setLoading(true)
    const { data } = await supabase
      .from('company_documents')
      .select('*, profiles(full_name)')
      .order('created_at', { ascending: false })
    // Group by category
    const grouped = {}
    CATEGORIES.forEach(c => grouped[c.key] = [])
    ;(data || []).forEach(d => {
      if (grouped[d.category] !== undefined) grouped[d.category].push(d)
    })
    setDocs(grouped)
    setLoading(false)
  }

  async function uploadFiles(files, category) {
    if (!category) return
    setUploading(true)
    for (const file of files) {
      const path = `company/${category}/${Date.now()}-${file.name}`
      const { error: uploadErr } = await supabase.storage.from('company-docs').upload(path, file)
      if (uploadErr) { console.error(uploadErr); continue }
      await supabase.from('company_documents').insert({
        category,
        file_name: file.name,
        file_size: file.size,
        file_type: file.type,
        storage_path: path,
        uploaded_by: profile?.id,
      })
    }
    setUploading(false)
    loadDocs()
  }

  async function downloadFile(doc) {
    const { data } = await supabase.storage.from('company-docs').createSignedUrl(doc.storage_path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function deleteDoc(doc) {
    await supabase.storage.from('company-docs').remove([doc.storage_path])
    await supabase.from('company_documents').delete().eq('id', doc.id)
    setConfirmDelete(null)
    loadDocs()
  }

  const activeCat = CATEGORIES.find(c => c.key === activeCategory)
  const activeDocs = activeCategory ? (docs[activeCategory] || []) : []

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Company Documents</h2>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>
          Upload and manage company-wide documents — accessible to all staff
        </p>
      </div>

      {/* Category tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 24 }}>
        {CATEGORIES.map(cat => {
          const count = docs[cat.key]?.length || 0
          const isActive = activeCategory === cat.key
          return (
            <div key={cat.key} onClick={() => setActiveCategory(isActive ? null : cat.key)}
              style={{
                background: isActive ? 'var(--green-bg)' : 'var(--surface)',
                border: `1.5px solid ${isActive ? 'var(--green)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-lg)',
                padding: '14px 10px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all .15s',
                position: 'relative',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface2)' }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface)' }}
            >
              <div style={{ fontSize: 28, marginBottom: 6 }}>{cat.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: isActive ? 'var(--green)' : 'var(--text)', lineHeight: 1.3 }}>{cat.label}</div>
              {count > 0 && (
                <div style={{ position: 'absolute', top: 8, right: 8, background: isActive ? 'var(--green)' : 'var(--text3)', color: 'white', fontSize: 10, fontWeight: 700, width: 18, height: 18, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {count}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Document panel */}
      {activeCategory && (
        <div className="card card-pad">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 24 }}>{activeCat?.icon}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{activeCat?.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{activeDocs.length} document{activeDocs.length !== 1 ? 's' : ''}</div>
              </div>
            </div>
            {can('manage_subcontractors') && (
              <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
                {uploading ? 'Uploading...' : '↑ Upload Files'}
                <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
                  onChange={e => uploadFiles(Array.from(e.target.files), activeCategory)}
                  disabled={uploading} />
              </label>
            )}
          </div>

          {/* Drag & drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); uploadFiles(Array.from(e.dataTransfer.files), activeCategory) }}
            style={{ border: `2px dashed ${dragOver ? 'var(--green)' : 'var(--border)'}`, borderRadius: 'var(--radius)', background: dragOver ? 'var(--green-bg)' : 'transparent', transition: 'all .15s', minHeight: activeDocs.length === 0 ? 120 : 'auto', display: 'flex', flexDirection: 'column' }}>

            {loading ? (
              <div style={{ padding: 30, textAlign: 'center' }}><Spinner /></div>
            ) : activeDocs.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                {dragOver ? 'Drop files here to upload' : `No documents in ${activeCat?.label} yet — drag files here or click Upload`}
              </div>
            ) : (
              <div>
                {activeDocs.map(doc => (
                  <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>{fileIcon(doc.file_type)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.file_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {formatSize(doc.file_size)} · Uploaded {formatDate(doc.created_at)}
                        {doc.profiles?.full_name && ` by ${doc.profiles.full_name}`}
                      </div>
                    </div>
                    <button className="btn btn-sm btn-primary" style={{ flexShrink: 0, fontSize: 12 }} onClick={() => downloadFile(doc)}>
                      ↓ Download
                    </button>
                    {can('manage_subcontractors') && (
                      <button className="btn btn-sm btn-danger" style={{ flexShrink: 0 }} onClick={() => setConfirmDelete(doc)}>
                        <IconTrash size={12} />
                      </button>
                    )}
                  </div>
                ))}
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

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => deleteDoc(confirmDelete)}
        title="Delete document"
        message={`Delete "${confirmDelete?.file_name}"? This cannot be undone.`}
        danger
      />
    </div>
  )
}
