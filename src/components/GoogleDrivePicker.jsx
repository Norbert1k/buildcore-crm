import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../lib/auth'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const SCOPES = 'https://www.googleapis.com/auth/drive'

export function useGoogleDrive() {
  const [accessToken, setAccessToken] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // Load Google Identity Services script
    if (!document.getElementById('google-gsi')) {
      const script = document.createElement('script')
      script.id = 'google-gsi'
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      document.body.appendChild(script)
    }
  }, [])

  const signIn = useCallback(() => {
    return new Promise((resolve, reject) => {
      setLoading(true)
      setError('')
      try {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: SCOPES,
          callback: (response) => {
            setLoading(false)
            if (response.error) { setError(response.error); reject(response.error); return }
            setAccessToken(response.access_token)
            resolve(response.access_token)
          },
          error_callback: (err) => {
            setLoading(false)
            setError('Google sign-in failed — please try again')
            reject(err)
          }
        })
        client.requestAccessToken({ prompt: 'consent' })
      } catch(e) {
        setLoading(false)
        setError('Google sign-in unavailable — check your Client ID in settings')
        reject(e)
      }
    })
  }, [])

  const signOut = useCallback(() => {
    if (accessToken) {
      window.google.accounts.oauth2.revoke(accessToken)
      setAccessToken(null)
    }
  }, [accessToken])

  return { accessToken, loading, error, signIn, signOut }
}

export async function listFiles(accessToken, folderId = 'root') {
  const query = `'${folderId}' in parents and trashed = false`
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink,thumbnailLink)&orderBy=folder,name&pageSize=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) throw new Error('Failed to list files')
  const data = await res.json()
  return data.files || []
}

export async function searchFiles(accessToken, query) {
  const q = `name contains '${query}' and trashed = false`
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink,parents)&pageSize=20`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) throw new Error('Failed to search files')
  const data = await res.json()
  return data.files || []
}

export async function uploadFile(accessToken, file, folderId) {
  const metadata = { name: file.name, parents: folderId ? [folderId] : undefined }
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', file)
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  })
  if (!res.ok) throw new Error('Upload failed')
  return res.json()
}

export async function createFolder(accessToken, name, parentId) {
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: parentId ? [parentId] : [] }),
  })
  if (!res.ok) throw new Error('Failed to create folder')
  return res.json()
}

const FOLDER_MIME = 'application/vnd.google-apps.folder'

function fileIcon(mimeType) {
  if (mimeType === FOLDER_MIME) return '📁'
  if (mimeType.includes('pdf')) return '📄'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊'
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📑'
  if (mimeType.includes('document') || mimeType.includes('word')) return '📝'
  if (mimeType.includes('image')) return '🖼️'
  if (mimeType.includes('video')) return '🎬'
  if (mimeType.includes('zip') || mimeType.includes('rar')) return '🗜️'
  return '📄'
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function GoogleDriveBrowser({ linkedFolderId, onLinkFolder, projectName }) {
  const { accessToken, loading: authLoading, error: authError, signIn, signOut } = useGoogleDrive()
  const [files, setFiles] = useState([])
  const [currentFolder, setCurrentFolder] = useState(linkedFolderId || 'root')
  const [breadcrumb, setBreadcrumb] = useState([{ id: linkedFolderId || 'root', name: linkedFolderId ? projectName || 'Project Folder' : 'My Drive' }])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (accessToken) loadFiles(currentFolder)
  }, [accessToken, currentFolder])

  useEffect(() => {
    if (linkedFolderId && linkedFolderId !== currentFolder) {
      setCurrentFolder(linkedFolderId)
      setBreadcrumb([{ id: linkedFolderId, name: projectName || 'Project Folder' }])
    }
  }, [linkedFolderId])

  async function loadFiles(folderId) {
    setLoading(true)
    setError('')
    try {
      const f = await listFiles(accessToken, folderId)
      setFiles(f)
    } catch (e) {
      setError('Failed to load files — please reconnect Google Drive')
    }
    setLoading(false)
  }

  async function openFolder(folder) {
    setCurrentFolder(folder.id)
    setBreadcrumb(b => [...b, { id: folder.id, name: folder.name }])
    setSearchResults(null)
    setSearch('')
  }

  function navigateBreadcrumb(index) {
    const crumb = breadcrumb[index]
    setBreadcrumb(b => b.slice(0, index + 1))
    setCurrentFolder(crumb.id)
    setSearchResults(null)
    setSearch('')
  }

  async function handleSearch(e) {
    const q = e.target.value
    setSearch(q)
    if (!q.trim()) { setSearchResults(null); return }
    const results = await searchFiles(accessToken, q)
    setSearchResults(results)
  }

  async function handleUpload(fileList) {
    setUploading(true)
    setError('')
    try {
      for (const file of fileList) {
        await uploadFile(accessToken, file, currentFolder)
      }
      await loadFiles(currentFolder)
    } catch (e) {
      setError('Upload failed — please try again')
    }
    setUploading(false)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) handleUpload(files)
  }

  async function handleLinkCurrentFolder() {
    if (onLinkFolder) {
      onLinkFolder(currentFolder, breadcrumb[breadcrumb.length - 1]?.name)
    }
  }

  const displayFiles = searchResults || files
  const folders = displayFiles.filter(f => f.mimeType === FOLDER_MIME)
  const docs = displayFiles.filter(f => f.mimeType !== FOLDER_MIME)

  if (!accessToken) {
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📁</div>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Connect Google Drive</div>
        <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20, lineHeight: 1.6 }}>
          Browse and upload files directly from your Google Drive.<br />
          {linkedFolderId ? 'Your project folder is linked — sign in to view files.' : 'Sign in to browse and link a folder to this project.'}
        </div>
        {authError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{authError}</div>}
        <button className="btn btn-primary" onClick={signIn} disabled={authLoading}>
          {authLoading ? 'Connecting...' : '🔗 Connect Google Drive'}
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={search}
          onChange={handleSearch}
          placeholder="Search files..."
          style={{ flex: 1, minWidth: 160 }}
        />
        <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer', flexShrink: 0 }}>
          {uploading ? 'Uploading...' : '↑ Upload'}
          <input type="file" multiple style={{ display: 'none' }} onChange={e => handleUpload(Array.from(e.target.files))} disabled={uploading} />
        </label>
        {onLinkFolder && (
          <button className="btn btn-sm" onClick={handleLinkCurrentFolder} title="Link this folder to the project">
            📌 Link Folder
          </button>
        )}
        <button className="btn btn-sm" onClick={signOut} style={{ color: 'var(--text3)' }}>Disconnect</button>
      </div>

      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10, fontSize: 13, flexWrap: 'wrap' }}>
        {breadcrumb.map((crumb, i) => (
          <span key={crumb.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {i > 0 && <span style={{ color: 'var(--text3)' }}>›</span>}
            <button onClick={() => navigateBreadcrumb(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: i === breadcrumb.length - 1 ? 'var(--text)' : 'var(--blue)', fontWeight: i === breadcrumb.length - 1 ? 600 : 400, padding: '2px 4px', borderRadius: 4 }}>
              {crumb.name}
            </button>
          </span>
        ))}
        {searchResults && <span style={{ color: 'var(--text3)' }}>— search results</span>}
      </div>

      {error && <div style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red-border)', borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>{error}</div>}

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{ border: `2px dashed ${dragOver ? 'var(--green)' : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', background: dragOver ? 'var(--green-bg)' : 'var(--surface)', transition: 'all .15s', minHeight: 300 }}>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading...</div>
        ) : displayFiles.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            {dragOver ? 'Drop files here to upload' : 'This folder is empty — drag files here or click Upload'}
          </div>
        ) : (
          <div>
            {/* Folders first */}
            {folders.map(f => (
              <div key={f.id} onDoubleClick={() => openFolder(f)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background .1s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>📁</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>{formatDate(f.modifiedTime)}</span>
                <span style={{ fontSize: 11, color: 'var(--blue)', flexShrink: 0 }}>›</span>
              </div>
            ))}
            {/* Files */}
            {docs.map(f => (
              <div key={f.id}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--border)', transition: 'background .1s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{fileIcon(f.mimeType)}</span>
                <a href={f.webViewLink} target="_blank" rel="noopener noreferrer"
                  style={{ flex: 1, fontSize: 13, color: 'var(--text)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  onMouseEnter={e => e.target.style.color = 'var(--blue)'}
                  onMouseLeave={e => e.target.style.color = 'var(--text)'}>
                  {f.name}
                </a>
                <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>{formatSize(f.size)}</span>
                <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>{formatDate(f.modifiedTime)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6, textAlign: 'center' }}>
        Double-click folders to open · Click files to open in Google Drive · Drag files here to upload
      </div>
    </div>
  )
}
