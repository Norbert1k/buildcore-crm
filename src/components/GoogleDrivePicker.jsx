import { useState, useEffect, useCallback, useRef } from 'react'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const SCOPES = 'https://www.googleapis.com/auth/drive'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

// Load a script once
function loadScript(src, id) {
  return new Promise((resolve) => {
    if (document.getElementById(id)) { resolve(); return }
    const s = document.createElement('script')
    s.id = id; s.src = src; s.async = true
    s.onload = resolve
    document.body.appendChild(s)
  })
}

export function useGoogleDrive() {
  const [accessToken, setAccessToken] = useState(() => sessionStorage.getItem('gd_token') || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const tokenClientRef = useRef(null)

  useEffect(() => {
    loadScript('https://accounts.google.com/gsi/client', 'google-gsi').then(() => {
      // Try silent sign-in if no token stored
      if (!sessionStorage.getItem('gd_token')) {
        setTimeout(() => tryAutoSignIn(), 1000)
      }
    })
  }, [])

  async function tryAutoSignIn() {
    // Silent sign-in attempt — won't show popup if not already authorised
    try {
      if (!window.google?.accounts?.oauth2) return
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        prompt: '',  // Empty prompt = silent, no popup
        callback: (resp) => {
          if (resp.access_token) {
            sessionStorage.setItem('gd_token', resp.access_token)
            setAccessToken(resp.access_token)
          }
        },
      })
      client.requestAccessToken({ prompt: '' })
    } catch (e) {
      // Silent fail — user will click Connect manually
    }
  }

  const signIn = useCallback(async () => {
    setLoading(true)
    setError('')
    await loadScript('https://accounts.google.com/gsi/client', 'google-gsi')

    return new Promise((resolve, reject) => {
      const initAndRequest = () => {
        try {
          tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: SCOPES,
            callback: (resp) => {
              setLoading(false)
              if (resp.error) { setError(resp.error); reject(resp.error); return }
              setAccessToken(resp.access_token)
              resolve(resp.access_token)
            },
          })
          tokenClientRef.current.requestAccessToken()
        } catch (e) {
          setLoading(false)
          setError('Could not initialise Google sign-in')
          reject(e)
        }
      }

      if (window.google?.accounts?.oauth2) {
        initAndRequest()
      } else {
        // Wait for script to load
        const interval = setInterval(() => {
          if (window.google?.accounts?.oauth2) {
            clearInterval(interval)
            initAndRequest()
          }
        }, 200)
        setTimeout(() => { clearInterval(interval); setLoading(false); setError('Google sign-in timed out') }, 10000)
      }
    })
  }, [])

  const signOut = useCallback(() => {
    if (accessToken) {
      window.google?.accounts?.oauth2?.revoke(accessToken, () => {})
      sessionStorage.removeItem('gd_token')
      setAccessToken(null)
    }
  }, [accessToken])

  return { accessToken, loading, error, signIn, signOut }
}

export async function listFiles(accessToken, folderId = 'root', driveId = null) {
  const q = `'${folderId}' in parents and trashed = false`
  let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink)&orderBy=folder,name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`
  if (driveId) url += `&corpora=drive&driveId=${driveId}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error('Failed to list files')
  return (await res.json()).files || []
}

export async function listSharedDrives(accessToken) {
  const res = await fetch(
    'https://www.googleapis.com/drive/v3/drives?pageSize=20&fields=drives(id,name)&useDomainAdminAccess=false',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) throw new Error('Failed to list shared drives')
  return (await res.json()).drives || []
}

export async function searchFiles(accessToken, query) {
  const q = `name contains '${query.replace(/'/g,"\\'")}' and trashed = false`
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink,parents)&pageSize=20`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) throw new Error('Failed to search')
  return (await res.json()).files || []
}

export async function uploadFile(accessToken, file, folderId) {
  const metadata = { name: file.name, ...(folderId ? { parents: [folderId] } : {}) }
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

function fileIcon(mimeType) {
  if (mimeType === FOLDER_MIME) return '📁'
  if (mimeType?.includes('pdf')) return '📄'
  if (mimeType?.includes('spreadsheet') || mimeType?.includes('excel')) return '📊'
  if (mimeType?.includes('presentation') || mimeType?.includes('powerpoint')) return '📑'
  if (mimeType?.includes('document') || mimeType?.includes('word')) return '📝'
  if (mimeType?.includes('image')) return '🖼️'
  if (mimeType?.includes('video')) return '🎬'
  if (mimeType?.includes('zip') || mimeType?.includes('rar')) return '🗜️'
  return '📄'
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1048576) return `${(bytes/1024).toFixed(0)}KB`
  return `${(bytes/1048576).toFixed(1)}MB`
}

function formatDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function GoogleDriveBrowser({ linkedFolderId, onLinkFolder, projectName, externalSearch, onSearchClear }) {
  const { accessToken, loading: authLoading, error: authError, signIn, signOut } = useGoogleDrive()
  const [files, setFiles] = useState([])
  const [currentFolder, setCurrentFolder] = useState(linkedFolderId || null)
  const [breadcrumb, setBreadcrumb] = useState([{ id: linkedFolderId || null, name: linkedFolderId ? (projectName || 'Project Folder') : 'All Drives' }])
  const [sharedDrives, setSharedDrives] = useState([])
  const [showingRoot, setShowingRoot] = useState(!linkedFolderId)
  const [currentDriveId, setCurrentDriveId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (accessToken) {
      if (!currentFolder) loadRoot()
      else loadFiles(currentFolder, currentDriveId)
    }
  }, [accessToken, currentFolder])

  useEffect(() => {
    if (externalSearch && accessToken) {
      setSearch(externalSearch)
      searchFiles(accessToken, externalSearch).then(results => setSearchResults(results)).catch(() => {})
    } else if (!externalSearch) {
      setSearch('')
      setSearchResults(null)
    }
  }, [externalSearch, accessToken])

  async function loadRoot() {
    setLoading(true); setError('')
    try {
      const [drives, myDriveFiles] = await Promise.all([
        listSharedDrives(accessToken),
        listFiles(accessToken, 'root')
      ])
      setSharedDrives(drives)
      setFiles(myDriveFiles)
      setShowingRoot(true)
    } catch { setError('Failed to load drives') }
    setLoading(false)
  }

  useEffect(() => {
    if (linkedFolderId && linkedFolderId !== currentFolder) {
      setCurrentFolder(linkedFolderId)
      setBreadcrumb([{ id: linkedFolderId, name: projectName || 'Project Folder' }])
      setShowingRoot(false)
    }
  }, [linkedFolderId])

  async function loadFiles(folderId) {
    setLoading(true); setError('')
    try { setFiles(await listFiles(accessToken, folderId, currentDriveId)) }
    catch { setError('Failed to load files — please reconnect') }
    setLoading(false)
  }

  function openFolder(folder, isDrive = false) {
    setCurrentFolder(folder.id)
    setShowingRoot(false)
    if (isDrive) setCurrentDriveId(folder.id)
    else if (showingRoot) setCurrentDriveId(null)
    setBreadcrumb(b => {
      const base = showingRoot ? [{ id: null, name: 'All Drives' }] : b
      return [...base, { id: folder.id, name: folder.name }]
    })
    setSearchResults(null); setSearch('')
  }

  function navBreadcrumb(i) {
    const crumb = breadcrumb[i]
    setBreadcrumb(b => b.slice(0, i + 1))
    setCurrentFolder(crumb.id)
    setShowingRoot(!crumb.id)
    setSearchResults(null); setSearch('')
  }

  async function handleSearch(e) {
    const q = e.target.value; setSearch(q)
    if (!q.trim()) { setSearchResults(null); return }
    try { setSearchResults(await searchFiles(accessToken, q)) }
    catch { }
  }

  async function handleUpload(fileList) {
    setUploading(true); setError('')
    try {
      for (const f of fileList) await uploadFile(accessToken, f, currentFolder)
      await loadFiles(currentFolder)
    } catch { setError('Upload failed') }
    setUploading(false)
  }

  function handleDrop(e) {
    e.preventDefault(); setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) handleUpload(files)
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
          {linkedFolderId ? 'Your project folder is linked — sign in to view files.' : 'Sign in to browse and upload files.'}
        </div>
        {authError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12, background: 'var(--red-bg)', padding: '8px 12px', borderRadius: 'var(--radius)' }}>{authError}</div>}
        <button className="btn btn-primary" onClick={signIn} disabled={authLoading}>
          {authLoading ? 'Connecting...' : '🔗 Connect Google Drive'}
        </button>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 12 }}>
          A Google sign-in popup will appear — sign in with norbert@cltd.co.uk
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={handleSearch} placeholder="Search files..." style={{ flex: 1, minWidth: 160 }} />
        <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer', flexShrink: 0 }}>
          {uploading ? 'Uploading...' : '↑ Upload'}
          <input type="file" multiple style={{ display: 'none' }} onChange={e => handleUpload(Array.from(e.target.files))} disabled={uploading} />
        </label>
        {onLinkFolder && (
          <button className="btn btn-sm" onClick={() => onLinkFolder(currentFolder, breadcrumb[breadcrumb.length-1]?.name)} title="Link this folder to the project">
            📌 Link Folder
          </button>
        )}
        <button className="btn btn-sm" onClick={signOut} style={{ color: 'var(--text3)', fontSize: 12 }}>Disconnect</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10, fontSize: 13, flexWrap: 'wrap' }}>
        {breadcrumb.map((crumb, i) => (
          <span key={crumb.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {i > 0 && <span style={{ color: 'var(--text3)' }}>›</span>}
            <button onClick={() => navBreadcrumb(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: i === breadcrumb.length - 1 ? 'var(--text)' : 'var(--blue)', fontWeight: i === breadcrumb.length - 1 ? 600 : 400, padding: '2px 4px', borderRadius: 4 }}>
              {crumb.name}
            </button>
          </span>
        ))}
        {searchResults && <span style={{ color: 'var(--text3)' }}>— search results</span>}
      </div>

      {error && <div style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red-border)', borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>{error}</div>}

      <div onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop}
        style={{ border: `2px dashed ${dragOver ? 'var(--green)' : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', background: dragOver ? 'var(--green-bg)' : 'var(--surface)', transition: 'all .15s', minHeight: 300 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading...</div>
        ) : showingRoot && sharedDrives.length > 0 ? (
          <div>
            <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>Shared Drives</div>
            {sharedDrives.map(drive => (
              <div key={drive.id} onDoubleClick={() => openFolder(drive, true)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ fontSize: 20 }}>🏢</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{drive.name}</span>
                <span style={{ fontSize: 11, color: 'var(--blue)' }}>›</span>
              </div>
            ))}
            {files.length > 0 && <>
              <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>My Drive</div>
              {files.filter(f => f.mimeType === FOLDER_MIME).map(f => (
                <div key={f.id} onDoubleClick={() => openFolder(f)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ fontSize: 18 }}>📁</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{f.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--blue)' }}>›</span>
                </div>
              ))}
            </>}
          </div>
        ) : displayFiles.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            {dragOver ? 'Drop files here to upload' : 'This folder is empty — drag files here or click Upload'}
          </div>
        ) : (
          <div>
            {folders.map(f => (
              <div key={f.id} onDoubleClick={() => openFolder(f)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>📁</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>{formatDate(f.modifiedTime)}</span>
                <span style={{ fontSize: 11, color: 'var(--blue)', flexShrink: 0 }}>›</span>
              </div>
            ))}
            {docs.map(f => (
              <div key={f.id}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--border)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{fileIcon(f.mimeType)}</span>
                <a href={f.webViewLink} target="_blank" rel="noopener noreferrer"
                  style={{ flex: 1, fontSize: 13, color: 'var(--text)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
