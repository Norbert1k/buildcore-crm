import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import GoogleDriveBrowser from '../components/GoogleDrivePicker'
import { useAuth } from '../lib/auth'

const COMPANY_FOLDER_KEY = 'company_drive_folder'
const COMPANY_FOLDER_NAME_KEY = 'company_drive_folder_name'

const QUICK_FOLDERS = [
  { icon: '🏢', label: 'Logo & Branding',  search: 'logo' },
  { icon: '📋', label: 'Policies',          search: 'policies' },
  { icon: '🛡️', label: 'Insurance',         search: 'insurance' },
  { icon: '💰', label: 'VAT & Tax',         search: 'vat' },
  { icon: '🏦', label: 'Bank Details',      search: 'bank' },
  { icon: '📜', label: 'Certifications',    search: 'chas' },
  { icon: '🚗', label: 'Car Fleet',         search: 'car fleet' },
  { icon: '📝', label: 'Templates',         search: 'template' },
]

export default function CompanyDocuments() {
  const { can } = useAuth()
  const [folderId, setFolderId] = useState(null)
  const [folderName, setFolderName] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeSearch, setActiveSearch] = useState('')
  const driveRef = useRef(null)

  useEffect(() => { loadSetting() }, [])

  async function loadSetting() {
    const { data: d1 } = await supabase.from('app_settings').select('value').eq('key', COMPANY_FOLDER_KEY).single()
    const { data: d2 } = await supabase.from('app_settings').select('value').eq('key', COMPANY_FOLDER_NAME_KEY).single()
    if (d1?.value) setFolderId(d1.value)
    if (d2?.value) setFolderName(d2.value)
    setLoading(false)
  }

  async function handleLinkFolder(id, name) {
    setFolderId(id)
    setFolderName(name)
    await supabase.from('app_settings').upsert({ key: COMPANY_FOLDER_KEY, value: id }, { onConflict: 'key' })
    await supabase.from('app_settings').upsert({ key: COMPANY_FOLDER_NAME_KEY, value: name || id }, { onConflict: 'key' })
  }

  async function handleUnlinkFolder() {
    setFolderId(null)
    setFolderName(null)
    await supabase.from('app_settings').delete().eq('key', COMPANY_FOLDER_KEY)
    await supabase.from('app_settings').delete().eq('key', COMPANY_FOLDER_NAME_KEY)
  }

  function handleQuickFolder(search) {
    setActiveSearch(search)
    // Scroll down to drive browser
    setTimeout(() => {
      driveRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Company Documents</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
          {folderId ? (
            <>
              <span style={{ fontSize: 13, color: 'var(--text2)' }}>
                Linked to: <strong style={{ color: 'var(--text)' }}>{folderName || folderId}</strong>
              </span>
              {can('manage_users') && (
                <button className="btn btn-sm btn-danger" onClick={handleUnlinkFolder}>
                  ✕ Unlink folder
                </button>
              )}
            </>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--text2)' }}>
              Connect your Google Drive and link your company documents folder
            </span>
          )}
        </div>
      </div>

      {/* Quick access tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 20 }}>
        {QUICK_FOLDERS.map(item => (
          <div
            key={item.label}
            onClick={() => handleQuickFolder(item.search)}
            style={{
              background: activeSearch === item.search ? 'var(--green-bg)' : 'var(--surface)',
              border: `1px solid ${activeSearch === item.search ? 'var(--green-border)' : 'var(--border)'}`,
              borderRadius: 'var(--radius)',
              padding: '12px 10px',
              textAlign: 'center',
              fontSize: 12,
              color: activeSearch === item.search ? 'var(--green)' : 'var(--text2)',
              cursor: 'pointer',
              transition: 'all .15s',
            }}
            onMouseEnter={e => { if (activeSearch !== item.search) { e.currentTarget.style.background = 'var(--surface2)'; e.currentTarget.style.borderColor = 'var(--border2)' }}}
            onMouseLeave={e => { if (activeSearch !== item.search) { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.borderColor = 'var(--border)' }}}
          >
            <div style={{ fontSize: 24, marginBottom: 6 }}>{item.icon}</div>
            <div style={{ fontWeight: 500 }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* Clear search if active */}
      {activeSearch && (
        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span style={{ color: 'var(--text2)' }}>Searching for: <strong>{activeSearch}</strong></span>
          <button className="btn btn-sm" onClick={() => setActiveSearch('')} style={{ fontSize: 11 }}>✕ Clear</button>
        </div>
      )}

      <div ref={driveRef}>
        {!loading && (
          <GoogleDriveBrowser
            linkedFolderId={folderId}
            projectName="Company Documents"
            onLinkFolder={can('manage_users') ? handleLinkFolder : null}
            externalSearch={activeSearch}
            onSearchClear={() => setActiveSearch('')}
          />
        )}
      </div>
    </div>
  )
}
