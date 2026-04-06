import { useState, useEffect, useCallback, useRef } from 'react'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const SCOPES = 'https://www.googleapis.com/auth/drive'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

function loadScript(src, id) {
  return new Promise((resolve) => {
    if (document.getElementById(id)) { resolve(); return }
    const s = document.createElement('script')
    s.id = id; s.src = src; s.async = true; s.onload = resolve
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
      if (!sessionStorage.getItem('gd_token')) setTimeout(() => tryAutoSignIn(), 1000)
    })
  }, [])

  async function tryAutoSignIn() {
    try {
      if (!window.google?.accounts?.oauth2) return
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID, scope: SCOPES, prompt: '',
        callback: (resp) => {
          if (resp.access_token) { sessionStorage.setItem('gd_token', resp.access_token); setAccessToken(resp.access_token) }
        },
      })
      client.requestAccessToken({ prompt: '' })
    } catch (e) {}
  }

  const signIn = useCallback(async () => {
    setLoading(true); setError('')
    await loadScript('https://accounts.google.com/gsi/client', 'google-gsi')
    return new Promise((resolve, reject) => {
      const init = () => {
        try {
          tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID, scope: SCOPES,
            callback: (resp) => {
              setLoading(false)
              if (resp.error) { setError(resp.error); reject(resp.error); return }
              sessionStorage.setItem('gd_token', resp.access_token)
              setAccessToken(resp.access_token); resolve(resp.access_token)
            },
          })
          tokenClientRef.current.requestAccessToken()
        } catch (e) { setLoading(false); setError('Could not initialise Google sign-in'); reject(e) }
      }
      if (window.google?.accounts?.oauth2) init()
      else { const iv = setInterval(() => { if (window.google?.accounts?.oauth2) { clearInterval(iv); init() } }, 200) }
    })
  }, [])

  const signOut = useCallback(() => {
    if (accessToken) { window.google?.accounts?.oauth2?.revoke(accessToken, () => {}); sessionStorage.removeItem('gd_token'); setAccessToken(null) }
  }, [accessToken])

  return { accessToken, loading, error, signIn, signOut }
}

// ── API helpers ──────────────────────────────────────────────

async function apiFetch(accessToken, url, options = {}) {
  const res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) } })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function listSharedDrives(accessToken) {
  const data = await apiFetch(accessToken, 'https://www.googleapis.com/drive/v3/drives?pageSize=20&fields=drives(id,name)')
  return data.drives || []
}

export async function listFiles(accessToken, folderId = 'root', driveId = null) {
  const q = `'${folderId}' in parents and trashed = false`
  let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink)&orderBy=folder,name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`
  if (driveId) url += `&corpora=drive&driveId=${driveId}`
  const data = await apiFetch(accessToken, url)
  return data.files || []
}

export async function searchFiles(accessToken, query) {
  const q = `name contains '${query.replace(/'/g,"\\'")}' and trashed = false`
  const data = await apiFetch(accessToken, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink,parents)&pageSize=20&supportsAllDrives=true&includeItemsFromAllDrives=true`)
  return data.files || []
}

export async function uploadFile(accessToken, file, folderId) {
  const metadata = { name: file.name, ...(folderId ? { parents: [folderId] } : {}) }
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', file)
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form,
  })
  if (!res.ok) throw new Error('Upload failed')
  return res.json()
}

export async function createFolder(accessToken, name, parentId, driveId) {
  const body = { name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : [] }
  return apiFetch(accessToken, 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST', body: JSON.stringify(body)
  })
}

export async function renameFile(accessToken, fileId, newName) {
  return apiFetch(accessToken, `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, {
    method: 'PATCH', body: JSON.stringify({ name: newName })
  })
}

export async function downloadFile(accessToken, fileId, fileName, mimeType) {
  // Google Docs need export
  let url
  if (mimeType?.includes('google-apps')) {
    const exportMime = mimeType.includes('document') ? 'application/pdf' : mimeType.includes('spreadsheet') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf'
    url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}&supportsAllDrives=true`
  } else {
    url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error('Download failed')
  const blob = await res.blob()
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName; a.click()
  URL.revokeObjectURL(a.href)
}

// ── Helpers ──────────────────────────────────────────────────

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
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / 1048576).toFixed(1)}MB`
}

function formatDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── Main Component ───────────────────────────────────────────

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
  // New state
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingId, setRenamingId] = useState(null)
  const [renamingName, setRenamingName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [downloadingId, setDownloadingId] = useState(null)
  const newFolderRef = useRef(null)
  const renameRef = useRef(null)

  useEffect(() => { if (accessToken) { if (!currentFolder) loadRoot(); else loadFiles(currentFolder) } }, [accessToken, currentFolder])
  useEffect(() => { if (linkedFolderId && linkedFolderId !== currentFolder) { setCurrentFolder(linkedFolderId); setBreadcrumb([{ id: linkedFolderId, name: projectName || 'Project Folder' }]); setShowingRoot(false) } }, [linkedFolderId])
  useEffect(() => { if (externalSearch && accessToken) { setSearch(externalSearch); searchFiles(accessToken, externalSearch).then(r => setSearchResults(r)).catch(() => {}) } else if (!externalSearch) { setSearch(''); setSearchResults(null) } }, [externalSearch, accessToken])
  useEffect(() => { if (showNewFolder && newFolderRef.current) newFolderRef.current.focus() }, [showNewFolder])
  useEffect(() => { if (renamingId && renameRef.current) renameRef.current.focus() }, [renamingId])

  async function loadRoot() {
    setLoading(true); setError('')
    try {
      const [drives, myFiles] = await Promise.all([listSharedDrives(accessToken), listFiles(accessToken, 'root')])
      setSharedDrives(drives); setFiles(myFiles); setShowingRoot(true)
    } catch { setError('Failed to load drives') }
    setLoading(false)
  }

  async function loadFiles(folderId) {
    setLoading(true); setError('')
    try { setFiles(await listFiles(accessToken, folderId, currentDriveId)) }
    catch { setError('Failed to load files — please reconnect') }
    setLoading(false)
  }

  function openFolder(folder, isDrive = false) {
    setCurrentFolder(folder.id); setShowingRoot(false)
    if (isDrive) setCurrentDriveId(folder.id)
    setBreadcrumb(b => { const base = showingRoot ? [{ id: null, name: 'All Drives' }] : b; return [...base, { id: folder.id, name: folder.name }] })
    setSearchResults(null); setSearch('')
  }

  function navBreadcrumb(i) {
    const crumb = breadcrumb[i]
    setBreadcrumb(b => b.slice(0, i + 1))
    setCurrentFolder(crumb.id); setShowingRoot(!crumb.id)
    setSearchResults(null); setSearch('')
  }

  async function handleSearch(e) {
    const q = e.target.value; setSearch(q)
    if (!q.trim()) { setSearchResults(null); return }
    try { setSearchResults(await searchFiles(accessToken, q)) } catch {}
  }

  async function handleUpload(fileList) {
    setUploading(true); setError('')
    try { for (const f of fileList) await uploadFile(accessToken, f, currentFolder); await loadFiles(currentFolder) }
    catch { setError('Upload failed') }
    setUploading(false)
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return
    setCreatingFolder(true)
    try {
      await createFolder(accessToken, newFolderName.trim(), currentFolder, currentDriveId)
      setShowNewFolder(false); setNewFolderName('')
      if (currentFolder) await loadFiles(currentFolder); else await loadRoot()
    } catch { setError('Failed to create folder') }
    setCreatingFolder(false)
  }

  async function handleRename(fileId) {
    if (!renamingName.trim()) { setRenamingId(null); return }
    try {
      await renameFile(accessToken, fileId, renamingName.trim())
      setRenamingId(null)
      if (currentFolder) await loadFiles(currentFolder); else await loadRoot()
    } catch { setError('Failed to rename') }
  }

  async function handleDownload(file) {
    setDownloadingId(file.id)
    try { await downloadFile(accessToken, file.id, file.name, file.mimeType) }
    catch { setError('Download failed') }
    setDownloadingId(null)
  }

  function handleDrop(e) {
    e.preventDefault(); setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length && !showingRoot) handleUpload(files)
    else if (showingRoot) setError('Navigate into a folder first to upload files')
  }

  const displayFiles = searchResults || files
  const folders = displayFiles.filter(f => f.mimeType === FOLDER_MIME)
  const docFiles = displayFiles.filter(f => f.mimeType !== FOLDER_MIME)

  if (!accessToken) {
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📁</div>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Connect Google Drive</div>
        <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20, lineHeight: 1.6 }}>
          {linkedFolderId ? 'Your project folder is linked — sign in to view files.' : 'Sign in to browse, upload and manage your Google Drive files.'}
        </div>
        {authError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12, background: 'var(--red-bg)', padding: '8px 12px', borderRadius: 'var(--radius)' }}>{authError}</div>}
        <button className="btn btn-primary" onClick={signIn} disabled={authLoading}>
          {authLoading ? 'Connecting...' : '🔗 Connect Google Drive'}
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={handleSearch} placeholder="Search files..." style={{ flex: 1, minWidth: 160 }} />
        {!showingRoot && (
          <>
            <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer', flexShrink: 0 }}>
              {uploading ? 'Uploading...' : '↑ Upload'}
              <input type="file" multiple style={{ display: 'none' }} onChange={e => handleUpload(Array.from(e.target.files))} disabled={uploading} />
            </label>
            <button className="btn btn-sm" onClick={() => { setShowNewFolder(true); setNewFolderName('') }} style={{ flexShrink: 0 }}>
              📁+ New Folder
            </button>
          </>
        )}
        {onLinkFolder && !showingRoot && (
          <button className="btn btn-sm" onClick={() => onLinkFolder(currentFolder, breadcrumb[breadcrumb.length-1]?.name)} title="Link this folder">
            📌 Link Folder
          </button>
        )}
        <button className="btn btn-sm" onClick={signOut} style={{ color: 'var(--text3)', fontSize: 12, flexShrink: 0 }}>Disconnect</button>
      </div>

      {/* New folder input */}
      {showNewFolder && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', background: 'var(--surface2)', padding: '8px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--green-border)' }}>
          <span style={{ fontSize: 16 }}>📁</span>
          <input ref={newFolderRef} value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
            placeholder="Folder name..." style={{ flex: 1 }}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') setShowNewFolder(false) }} />
          <button className="btn btn-sm btn-primary" onClick={handleCreateFolder} disabled={creatingFolder || !newFolderName.trim()}>
            {creatingFolder ? '...' : 'Create'}
          </button>
          <button className="btn btn-sm" onClick={() => setShowNewFolder(false)}>Cancel</button>
        </div>
      )}

      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10, fontSize: 13, flexWrap: 'wrap' }}>
        {breadcrumb.map((crumb, i) => (
          <span key={`${crumb.id}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {i > 0 && <span style={{ color: 'var(--text3)' }}>›</span>}
            <button onClick={() => navBreadcrumb(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: i === breadcrumb.length - 1 ? 'var(--text)' : 'var(--blue)', fontWeight: i === breadcrumb.length - 1 ? 600 : 400, padding: '2px 4px', borderRadius: 4 }}>
              {crumb.name}
            </button>
          </span>
        ))}
        {searchResults && <span style={{ color: 'var(--text3)' }}>— search results</span>}
      </div>

      {error && <div style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red-border)', borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>{error}<button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)' }}>✕</button></div>}

      {/* File browser */}
      <div onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop}
        style={{ border: `2px dashed ${dragOver ? 'var(--green)' : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', background: dragOver ? 'var(--green-bg)' : 'var(--surface)', transition: 'all .15s', minHeight: 300 }}>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading...</div>
        ) : showingRoot && sharedDrives.length > 0 ? (
          <div>
            <div style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>Shared Drives</div>
            {sharedDrives.map(drive => (
              <div key={drive.id} onDoubleClick={() => openFolder(drive, true)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ fontSize: 20 }}>🏢</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{drive.name}</span>
                <span style={{ fontSize: 11, color: 'var(--blue)' }}>Double-click to open ›</span>
              </div>
            ))}
            {files.length > 0 && <>
              <div style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>My Drive</div>
              {files.filter(f => f.mimeType === FOLDER_MIME).map(f => (
                <FileRow key={f.id} file={f} onOpen={() => openFolder(f)} onRename={() => { setRenamingId(f.id); setRenamingName(f.name) }} onDownload={() => handleDownload(f)} renamingId={renamingId} renamingName={renamingName} setRenamingName={setRenamingName} onRenameSubmit={() => handleRename(f.id)} onRenameCancel={() => setRenamingId(null)} renameRef={renameRef} downloadingId={downloadingId} />
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
              <FileRow key={f.id} file={f} onOpen={() => openFolder(f)} onRename={() => { setRenamingId(f.id); setRenamingName(f.name) }} onDownload={() => handleDownload(f)} renamingId={renamingId} renamingName={renamingName} setRenamingName={setRenamingName} onRenameSubmit={() => handleRename(f.id)} onRenameCancel={() => setRenamingId(null)} renameRef={renameRef} downloadingId={downloadingId} />
            ))}
            {docFiles.map(f => (
              <FileRow key={f.id} file={f} onOpen={() => window.open(f.webViewLink, '_blank')} onRename={() => { setRenamingId(f.id); setRenamingName(f.name) }} onDownload={() => handleDownload(f)} renamingId={renamingId} renamingName={renamingName} setRenamingName={setRenamingName} onRenameSubmit={() => handleRename(f.id)} onRenameCancel={() => setRenamingId(null)} renameRef={renameRef} downloadingId={downloadingId} />
            ))}
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6, textAlign: 'center' }}>
        Double-click folders to open · Drag files to upload · Right-click or use ✏️ to rename
      </div>
    </div>
  )
}

function FileRow({ file, onOpen, onRename, onDownload, renamingId, renamingName, setRenamingName, onRenameSubmit, onRenameCancel, renameRef, downloadingId }) {
  const isFolder = file.mimeType === FOLDER_MIME
  const isRenaming = renamingId === file.id
  const isDownloading = downloadingId === file.id
  const [hovered, setHovered] = useState(false)

  return (
    <div onDoubleClick={isFolder ? onOpen : undefined}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--border)', background: hovered ? 'var(--surface2)' : 'transparent', transition: 'background .1s', cursor: isFolder ? 'pointer' : 'default' }}>

      <span style={{ fontSize: 18, flexShrink: 0 }}>{fileIcon(file.mimeType)}</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        {isRenaming ? (
          <input ref={renameRef} value={renamingName} onChange={e => setRenamingName(e.target.value)}
            style={{ width: '100%', fontSize: 13 }}
            onKeyDown={e => { if (e.key === 'Enter') onRenameSubmit(); if (e.key === 'Escape') onRenameCancel() }}
            onClick={e => e.stopPropagation()} />
        ) : (
          <div style={{ fontSize: 13, fontWeight: isFolder ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {!isFolder ? <a href={file.webViewLink} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)', textDecoration: 'none' }} onMouseEnter={e => e.target.style.color = 'var(--blue)'} onMouseLeave={e => e.target.style.color = 'var(--text)'}>{file.name}</a> : file.name}
          </div>
        )}
      </div>

      <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0, minWidth: 50, textAlign: 'right' }}>{formatSize(file.size)}</span>
      <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0, minWidth: 90, textAlign: 'right' }}>{formatDate(file.modifiedTime)}</span>

      {/* Action buttons — show on hover */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0, opacity: hovered || isRenaming ? 1 : 0, transition: 'opacity .15s' }}>
        {isRenaming ? (
          <>
            <button className="btn btn-sm btn-primary" onClick={e => { e.stopPropagation(); onRenameSubmit() }} style={{ fontSize: 11, padding: '2px 8px' }}>Save</button>
            <button className="btn btn-sm" onClick={e => { e.stopPropagation(); onRenameCancel() }} style={{ fontSize: 11, padding: '2px 8px' }}>Cancel</button>
          </>
        ) : (
          <>
            {isFolder && <button className="btn btn-sm" onClick={e => { e.stopPropagation(); onOpen() }} style={{ fontSize: 11 }}>Open</button>}
            <button className="btn btn-sm" onClick={e => { e.stopPropagation(); onRename() }} title="Rename" style={{ fontSize: 11, padding: '2px 8px' }}>✏️</button>
            {!isFolder && (
              <button className="btn btn-sm btn-primary" onClick={e => { e.stopPropagation(); onDownload() }} disabled={isDownloading} style={{ fontSize: 11, padding: '2px 8px' }}>
                {isDownloading ? '...' : '↓'}
              </button>
            )}
          </>
        )}
      </div>

      {isFolder && !isRenaming && <span style={{ fontSize: 11, color: 'var(--blue)', flexShrink: 0 }}>›</span>}
    </div>
  )
}
