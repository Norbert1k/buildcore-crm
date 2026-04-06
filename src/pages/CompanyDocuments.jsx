import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import GoogleDriveBrowser from '../components/GoogleDrivePicker'
import { useAuth } from '../lib/auth'

const COMPANY_FOLDER_KEY = 'company_drive_folder'
const COMPANY_FOLDER_NAME_KEY = 'company_drive_folder_name'

export default function CompanyDocuments() {
  const { can } = useAuth()
  const [folderId, setFolderId] = useState(null)
  const [folderName, setFolderName] = useState(null)
  const [loading, setLoading] = useState(true)

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
        {[
          { icon: '🏢', label: 'Logo & Branding' },
          { icon: '📋', label: 'Policies' },
          { icon: '🛡️', label: 'Insurance' },
          { icon: '💰', label: 'VAT & Tax' },
          { icon: '🏦', label: 'Bank Details' },
          { icon: '📜', label: 'Certifications' },
          { icon: '🚗', label: 'Car Fleet' },
          { icon: '📝', label: 'Templates' },
        ].map(item => (
          <div key={item.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 10px', textAlign: 'center', fontSize: 12, color: 'var(--text2)' }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>{item.icon}</div>
            <div style={{ fontWeight: 500 }}>{item.label}</div>
          </div>
        ))}
      </div>

      {!loading && (
        <GoogleDriveBrowser
          linkedFolderId={folderId}
          projectName="Company Documents"
          onLinkFolder={can('manage_users') ? handleLinkFolder : null}
        />
      )}
    </div>
  )
}
