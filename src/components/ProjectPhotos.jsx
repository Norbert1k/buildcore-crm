import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ──────────────────────────────────────────────────────────────────────────
// ProjectPhotos
//
// Renders the photo system inside a project. Two views:
//   1. Folder grid (default) — one card per folder with thumbnail count and
//      visibility toggle. Plus "Connect Telegram" banner if the project isn't
//      linked yet.
//   2. Folder detail — chronological photo grid for one folder, click for
//      full-size lightbox.
//
// Photos are uploaded ONLY via the Telegram bot. There's no upload button.
// Staff manages: folder visibility (per-folder toggle), photo deletion,
// and the Telegram group link.
// ──────────────────────────────────────────────────────────────────────────

const STORAGE_BUCKET = 'company-docs'

// Trigger a browser download for a blob with the given filename. Used by
// both the single-photo download (from the lightbox) and the bulk zip
// download. Creates a temporary <a download>, clicks it, then revokes the
// object URL after a short delay so memory doesn't leak.
function triggerBrowserDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export default function ProjectPhotos({ projectId }) {
  const { profile, can } = useAuth()
  const canManage = can ? can('manage_documents') : (profile?.role === 'admin')

  const [loading, setLoading] = useState(true)
  const [photos, setPhotos] = useState([])
  const [folderVis, setFolderVis] = useState({}) // { folder_slug: true/false }
  const [telegramGroup, setTelegramGroup] = useState(null)
  const [openFolder, setOpenFolder] = useState(null) // folder_slug
  const [thumbs, setThumbs] = useState({}) // { photo_id: signed_url }
  // Lightbox now holds an INDEX into the currently-open folder's photo array,
  // not the photo object itself. This lets us cycle via ← → arrow keys
  // (see the global keydown listener inside the folder detail view).
  // null = lightbox closed.
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [showConnect, setShowConnect] = useState(false)
  // Multi-select state. Set of photo IDs that the user has ticked. The
  // checkbox sits in the top-left corner of every PhotoTile (always
  // visible — confirmed by Norbert). When the set is non-empty a sticky
  // bulk-action bar appears at the top of the folder detail view.
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  // Track bulk-action progress so we can disable buttons and show a label
  // while a zip is being assembled or a batch delete is running.
  const [bulkBusy, setBulkBusy] = useState(null) // null | 'downloading' | 'deleting'
  // Live progress for zip downloads: "Fetching 4/12…". Updated as each
  // signed URL fetch completes.
  const [bulkProgress, setBulkProgress] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)

    const [photosRes, visRes, tgRes] = await Promise.all([
      supabase
        .from('project_photos')
        .select('*')
        .eq('project_id', projectId)
        .order('taken_at', { ascending: false }),
      supabase
        .from('project_photo_folder_visibility')
        .select('folder_slug, client_visible')
        .eq('project_id', projectId),
      supabase
        .from('project_telegram_groups')
        .select('chat_id, chat_title, added_at')
        .eq('project_id', projectId)
        .maybeSingle(),
    ])

    setPhotos(photosRes.data || [])
    const vis = {}
    for (const v of visRes.data || []) vis[v.folder_slug] = v.client_visible
    setFolderVis(vis)
    setTelegramGroup(tgRes.data || null)
    setLoading(false)
  }, [projectId])

  useEffect(() => { load() }, [load])

  // Sign URLs for the first photo in each folder (thumbnail) and all photos
  // in the open folder.
  useEffect(() => {
    let cancelled = false
    async function signThumbs() {
      const toSign = new Set()

      // First photo per folder for the grid
      const seenFolders = new Set()
      for (const p of photos) {
        if (!seenFolders.has(p.folder_slug)) {
          seenFolders.add(p.folder_slug)
          toSign.add(p.id)
        }
      }

      // Every photo in the currently-open folder
      if (openFolder) {
        for (const p of photos) {
          if (p.folder_slug === openFolder) toSign.add(p.id)
        }
      }

      const photosToSign = photos.filter(p => toSign.has(p.id) && !thumbs[p.id])
      if (photosToSign.length === 0) return

      const pairs = await Promise.all(photosToSign.map(async p => {
        const { data } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(p.storage_path, 3600)
        return [p.id, data?.signedUrl || null]
      }))

      if (cancelled) return
      setThumbs(prev => {
        const next = { ...prev }
        for (const [id, url] of pairs) if (url) next[id] = url
        return next
      })
    }
    signThumbs()
    return () => { cancelled = true }
  }, [photos, openFolder, thumbs])

  // Group photos by folder
  const folderMap = new Map() // folder_slug -> { name, photos: [] }
  for (const p of photos) {
    if (!folderMap.has(p.folder_slug)) {
      folderMap.set(p.folder_slug, { name: p.folder_name, photos: [] })
    }
    folderMap.get(p.folder_slug).photos.push(p)
  }
  const folders = Array.from(folderMap.entries())
    .map(([slug, f]) => ({ slug, name: f.name, photos: f.photos, visible: !!folderVis[slug] }))
    .sort((a, b) => a.name.localeCompare(b.name))

  async function toggleFolderVisibility(slug, name) {
    if (!canManage) return
    const current = folderVis[slug] || false
    const next = !current
    setFolderVis(prev => ({ ...prev, [slug]: next }))

    const { error } = await supabase
      .from('project_photo_folder_visibility')
      .upsert(
        {
          project_id: projectId,
          folder_slug: slug,
          folder_name: name,
          client_visible: next,
          updated_by: profile?.id || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'project_id,folder_slug' }
      )
    if (error) {
      // revert on failure
      setFolderVis(prev => ({ ...prev, [slug]: current }))
      alert('Could not update visibility: ' + error.message)
    }
  }

  async function deletePhoto(photo) {
    if (!canManage) return
    if (!confirm(`Delete this photo? This cannot be undone.`)) return

    const { error: dbErr } = await supabase.from('project_photos').delete().eq('id', photo.id)
    if (dbErr) { alert('Delete failed: ' + dbErr.message); return }

    await supabase.storage.from(STORAGE_BUCKET).remove([photo.storage_path])
    setPhotos(prev => prev.filter(p => p.id !== photo.id))
    setLightboxIndex(null)
    // If the deleted photo was selected, drop it from the selection set
    // so the bulk-action bar count stays accurate.
    setSelectedIds(prev => {
      if (!prev.has(photo.id)) return prev
      const next = new Set(prev)
      next.delete(photo.id)
      return next
    })
  }

  // Download a single photo. Used by the lightbox's Download button.
  // Fetches the signed URL, pulls the blob, triggers a browser download
  // with a clean filename based on the project slug + photo timestamp.
  async function downloadOnePhoto(photo) {
    try {
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(photo.storage_path, 60)
      if (error || !data) throw error || new Error('No URL returned')
      const res = await fetch(data.signedUrl)
      if (!res.ok) throw new Error('Fetch failed: ' + res.status)
      const blob = await res.blob()
      const ext = (photo.storage_path.split('.').pop() || 'jpg').toLowerCase()
      const stamp = new Date(photo.taken_at).toISOString().slice(0, 10)
      const fname = `${photo.folder_name || 'photo'}-${stamp}-${photo.id.slice(0, 8)}.${ext}`
      triggerBrowserDownload(blob, fname)
    } catch (err) {
      alert('Download failed: ' + (err?.message || err))
    }
  }

  // Bulk zip download. Loads JSZip on demand (we don't want it in the
  // initial bundle just for occasional bulk downloads), builds a zip in
  // memory, and triggers a single browser download. Filename pattern:
  // <FolderName>-YYYY-MM-DD.zip. Progress is reported via bulkProgress
  // state so the user sees "Fetching 4/12…" while the zip builds.
  async function downloadSelectedAsZip(folderName) {
    if (selectedIds.size === 0) return
    const ids = Array.from(selectedIds)
    const picked = photos.filter(p => ids.includes(p.id))
    setBulkBusy('downloading')
    setBulkProgress(0)
    try {
      // Dynamic import keeps the zip library out of the main bundle.
      const JSZip = (await import('https://esm.sh/jszip@3.10.1')).default
      const zip = new JSZip()
      let done = 0
      for (const photo of picked) {
        const { data, error } = await supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(photo.storage_path, 60)
        if (error || !data) {
          console.warn('Skipping (sign error):', photo.id, error)
          done++; setBulkProgress(done)
          continue
        }
        const res = await fetch(data.signedUrl)
        if (!res.ok) {
          console.warn('Skipping (fetch error):', photo.id, res.status)
          done++; setBulkProgress(done)
          continue
        }
        const blob = await res.blob()
        const ext = (photo.storage_path.split('.').pop() || 'jpg').toLowerCase()
        const stamp = new Date(photo.taken_at).toISOString().slice(0, 10)
        // Keep filename short and unique. ID prefix avoids collisions if
        // two photos were taken at exactly the same time.
        const fname = `${stamp}-${photo.id.slice(0, 8)}.${ext}`
        zip.file(fname, blob)
        done++; setBulkProgress(done)
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const today = new Date().toISOString().slice(0, 10)
      triggerBrowserDownload(blob, `${folderName}-${today}.zip`)
    } catch (err) {
      alert('Zip download failed: ' + (err?.message || err))
    } finally {
      setBulkBusy(null)
      setBulkProgress(0)
    }
  }

  // Bulk delete the selected photos. One confirm, then loops through.
  // Database deletes happen one-by-one; storage cleanup is batched per
  // 100-file chunk (Supabase storage.remove accepts an array).
  async function deleteSelected() {
    if (!canManage || selectedIds.size === 0) return
    if (!confirm(`Delete ${selectedIds.size} photo${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.`)) return
    setBulkBusy('deleting')
    try {
      const ids = Array.from(selectedIds)
      const picked = photos.filter(p => ids.includes(p.id))
      // Delete DB rows in one statement.
      const { error: dbErr } = await supabase.from('project_photos').delete().in('id', ids)
      if (dbErr) throw dbErr
      // Storage cleanup. Batch into chunks of 100 to stay safely under
      // Supabase's batch-remove limits.
      const paths = picked.map(p => p.storage_path)
      for (let i = 0; i < paths.length; i += 100) {
        await supabase.storage.from(STORAGE_BUCKET).remove(paths.slice(i, i + 100))
      }
      setPhotos(prev => prev.filter(p => !selectedIds.has(p.id)))
      setSelectedIds(new Set())
      setLightboxIndex(null)
    } catch (err) {
      alert('Bulk delete failed: ' + (err?.message || err))
    } finally {
      setBulkBusy(null)
    }
  }

  async function disconnectTelegram() {
    if (!canManage) return
    if (!confirm('Disconnect this Telegram group from the project? Photos already uploaded will stay.')) return
    const { error } = await supabase.from('project_telegram_groups').delete().eq('project_id', projectId)
    if (error) { alert('Disconnect failed: ' + error.message); return }
    setTelegramGroup(null)
  }

  // ── Render ─────────────────────────────────────────────────────────────
  if (loading) {
    return <div style={{ padding: 20, color: 'var(--text3)', fontSize: 13 }}>Loading photos…</div>
  }

  // Folder detail view
  if (openFolder) {
    const folder = folders.find(f => f.slug === openFolder)
    if (!folder) {
      setOpenFolder(null)
      return null
    }
    // Photos in this folder that are currently selected. We compute this
    // from the global selectedIds rather than a separate state so it
    // stays in sync when photos are deleted or filtered.
    const selectedCount = folder.photos.filter(p => selectedIds.has(p.id)).length
    return (
      <div style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <button
            onClick={() => { setOpenFolder(null); setSelectedIds(new Set()); setLightboxIndex(null) }}
            style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--text2)' }}>
            ← All folders
          </button>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{folder.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{folder.photos.length} photo{folder.photos.length === 1 ? '' : 's'}</div>
          {canManage && (
            <button
              onClick={() => toggleFolderVisibility(folder.slug, folder.name)}
              style={{
                marginLeft: 'auto',
                background: folder.visible ? '#EAF3DE' : 'var(--surface2)',
                color: folder.visible ? '#27500A' : 'var(--text2)',
                border: '1px solid ' + (folder.visible ? '#C0DD97' : 'var(--border)'),
                borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}>
              {folder.visible ? '● Visible to client' : '○ Hidden from client'}
            </button>
          )}
        </div>

        {/* Bulk-action bar. Renders only when at least one photo is
            selected. Sticks just below the header. Shows the count and
            three actions: download zip, delete (if canManage), clear. */}
        {selectedCount > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '8px 12px', marginBottom: 12,
            position: 'sticky', top: 8, zIndex: 10,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>
              {selectedCount} selected
            </div>
            <button
              onClick={() => downloadSelectedAsZip(folder.name)}
              disabled={bulkBusy !== null}
              style={{
                background: 'var(--accent, #448a40)', color: 'white', border: 0,
                borderRadius: 4, padding: '6px 12px', fontSize: 11, fontWeight: 600,
                cursor: bulkBusy ? 'wait' : 'pointer', opacity: bulkBusy ? 0.6 : 1,
              }}>
              {bulkBusy === 'downloading'
                ? `Zipping… ${bulkProgress}/${selectedCount}`
                : `Download zip (${selectedCount})`}
            </button>
            {canManage && (
              <button
                onClick={deleteSelected}
                disabled={bulkBusy !== null}
                style={{
                  background: '#A32D2D', color: 'white', border: 0,
                  borderRadius: 4, padding: '6px 12px', fontSize: 11, fontWeight: 600,
                  cursor: bulkBusy ? 'wait' : 'pointer', opacity: bulkBusy ? 0.6 : 1,
                }}>
                {bulkBusy === 'deleting' ? 'Deleting…' : `Delete (${selectedCount})`}
              </button>
            )}
            <button
              onClick={() => setSelectedIds(new Set())}
              disabled={bulkBusy !== null}
              style={{
                background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)',
                borderRadius: 4, padding: '6px 12px', fontSize: 11, cursor: 'pointer',
              }}>
              Clear
            </button>
            {/* Select-all toggle for the current folder. */}
            <button
              onClick={() => {
                const allIds = folder.photos.map(p => p.id)
                const allSelected = allIds.every(id => selectedIds.has(id))
                setSelectedIds(prev => {
                  const next = new Set(prev)
                  if (allSelected) {
                    for (const id of allIds) next.delete(id)
                  } else {
                    for (const id of allIds) next.add(id)
                  }
                  return next
                })
              }}
              style={{
                background: 'transparent', color: 'var(--text2)',
                border: '1px solid var(--border)', borderRadius: 4,
                padding: '6px 12px', fontSize: 11, cursor: 'pointer', marginLeft: 'auto',
              }}>
              {folder.photos.every(p => selectedIds.has(p.id)) ? 'Deselect all' : 'Select all'}
            </button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
          {folder.photos.map((p, i) => (
            <PhotoTile
              key={p.id}
              photo={p}
              url={thumbs[p.id]}
              selected={selectedIds.has(p.id)}
              onToggleSelect={() => {
                setSelectedIds(prev => {
                  const next = new Set(prev)
                  if (next.has(p.id)) next.delete(p.id)
                  else next.add(p.id)
                  return next
                })
              }}
              onClick={() => setLightboxIndex(i)}
            />
          ))}
        </div>

        {lightboxIndex !== null && folder.photos[lightboxIndex] && (
          <Lightbox
            photos={folder.photos}
            index={lightboxIndex}
            thumbs={thumbs}
            onClose={() => setLightboxIndex(null)}
            onPrev={() => setLightboxIndex(i => (i > 0 ? i - 1 : i))}
            onNext={() => setLightboxIndex(i => (i < folder.photos.length - 1 ? i + 1 : i))}
            canManage={canManage}
            onDelete={() => deletePhoto(folder.photos[lightboxIndex])}
            onDownload={() => downloadOnePhoto(folder.photos[lightboxIndex])}
          />
        )}
      </div>
    )
  }

  // Folder grid view
  return (
    <div style={{ padding: '12px 16px' }}>
      {/* Connect Telegram banner */}
      {!telegramGroup ? (
        <div style={{
          background: 'linear-gradient(135deg, #229ED9 0%, #1A8AC8 100%)',
          borderRadius: 10,
          padding: '14px 18px',
          marginBottom: 16,
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
        }}>
          <div style={{ flexShrink: 0, fontSize: 28 }}>📷</div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>Connect a Telegram group</div>
            <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.5 }}>
              Site team sends photos to a project Telegram group with captions like &quot;Fire Stopping&quot; — they appear here automatically, sorted into folders.
            </div>
          </div>
          {canManage && (
            <button onClick={() => setShowConnect(true)} style={{
              background: 'white', color: '#1A8AC8', border: 0, borderRadius: 6,
              padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
            }}>Connect</button>
          )}
        </div>
      ) : (
        <div style={{
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '10px 14px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 12,
          color: 'var(--text2)',
        }}>
          <span style={{ fontSize: 18 }}>📷</span>
          <div style={{ flex: 1 }}>
            Connected to <strong>{telegramGroup.chat_title || 'Telegram group'}</strong>
            <span style={{ color: 'var(--text3)', marginLeft: 8 }}>chat ID {telegramGroup.chat_id}</span>
          </div>
          {canManage && (
            <button onClick={disconnectTelegram} style={{
              background: 'transparent', border: '1px solid var(--border)', borderRadius: 4,
              padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--text2)',
            }}>Disconnect</button>
          )}
        </div>
      )}

      {/* Folder grid */}
      {folders.length === 0 ? (
        <div style={{
          background: 'var(--surface)',
          border: '1px dashed var(--border)',
          borderRadius: 8,
          padding: '32px 20px',
          textAlign: 'center',
          color: 'var(--text3)',
          fontSize: 13,
        }}>
          {telegramGroup
            ? 'No photos yet. Send a photo to the Telegram group to get started.'
            : 'Photos will appear here once a Telegram group is connected.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {folders.map(f => (
            <FolderCard
              key={f.slug}
              folder={f}
              thumbUrl={thumbs[f.photos[0]?.id]}
              canManage={canManage}
              onOpen={() => setOpenFolder(f.slug)}
              onToggleVisibility={() => toggleFolderVisibility(f.slug, f.name)}
            />
          ))}
        </div>
      )}

      {showConnect && (
        <ConnectTelegramModal
          projectId={projectId}
          profileId={profile?.id}
          onClose={() => setShowConnect(false)}
          onConnected={(group) => {
            setTelegramGroup(group)
            setShowConnect(false)
          }}
        />
      )}
    </div>
  )
}

// ── FolderCard ─────────────────────────────────────────────────────────────
function FolderCard({ folder, thumbUrl, canManage, onOpen, onToggleVisibility }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      overflow: 'hidden',
      cursor: 'pointer',
      transition: 'transform 0.1s, box-shadow 0.15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}
      onClick={onOpen}>
      <div style={{
        aspectRatio: '4 / 3',
        background: thumbUrl ? `url(${thumbUrl}) center/cover no-repeat` : 'var(--surface2)',
        position: 'relative',
      }}>
        {!thumbUrl && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 24 }}>
            📷
          </div>
        )}
      </div>
      <div style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {folder.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              {folder.photos.length} photo{folder.photos.length === 1 ? '' : 's'}
            </div>
          </div>
          {canManage && (
            <button onClick={e => { e.stopPropagation(); onToggleVisibility() }} style={{
              flexShrink: 0,
              background: folder.visible ? '#EAF3DE' : 'var(--surface2)',
              color: folder.visible ? '#27500A' : 'var(--text3)',
              border: '1px solid ' + (folder.visible ? '#C0DD97' : 'var(--border)'),
              borderRadius: 999,
              padding: '3px 8px',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}>
              {folder.visible ? '● Visible' : '○ Hidden'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── PhotoTile ──────────────────────────────────────────────────────────────
function PhotoTile({ photo, url, selected, onToggleSelect, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        aspectRatio: '1 / 1',
        // Letterbox treatment so portrait photos show whole picture
        // instead of being cropped. Matches the portal fix.
        backgroundColor: 'var(--surface2)',
        backgroundImage: url ? `url(${url})` : undefined,
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
        borderRadius: 6,
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        // Visible selection state. A bright green border + small inset
        // shadow makes it obvious which photos are picked at a glance.
        outline: selected ? '2px solid var(--accent, #448a40)' : 'none',
        outlineOffset: -2,
      }}>
      {!url && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)' }}>
          ⏳
        </div>
      )}
      {/* Checkbox — top-left, always visible. Clicking it toggles
          selection without opening the lightbox. The label/box style
          makes it readable on either dark or light photos. */}
      <button
        onClick={e => { e.stopPropagation(); onToggleSelect?.() }}
        aria-label={selected ? 'Deselect photo' : 'Select photo'}
        style={{
          position: 'absolute', top: 6, left: 6, width: 22, height: 22,
          borderRadius: 4, cursor: 'pointer',
          border: '2px solid white',
          background: selected ? 'var(--accent, #448a40)' : 'rgba(0,0,0,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, color: 'white', fontWeight: 700, fontSize: 14, lineHeight: 1,
          boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
        }}>
        {selected ? '✓' : ''}
      </button>
      {photo.caption && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)',
          color: 'white', fontSize: 10, padding: '14px 8px 6px',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {photo.caption}
        </div>
      )}
    </div>
  )
}

// ── Lightbox ──────────────────────────────────────────────────────────────
function Lightbox({ photos, index, thumbs, onClose, onPrev, onNext, canManage, onDelete, onDownload }) {
  const photo = photos[index]
  const url = thumbs[photo.id]
  const hasPrev = index > 0
  const hasNext = index < photos.length - 1

  // Keyboard navigation. ← previous, → next, Esc close. Listener is
  // attached for the lightbox's lifetime and removed on close. We use
  // window so it works regardless of focus, but stop early if the user
  // is typing in an input (defensive — there shouldn't be inputs in
  // the lightbox today, but worth guarding against future additions).
  useEffect(() => {
    function onKey(e) {
      const tag = (e.target?.tagName || '').toUpperCase()
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowLeft') { e.preventDefault(); if (hasPrev) onPrev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (hasNext) onNext() }
      else if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasPrev, hasNext, onPrev, onNext, onClose])

  const taken = new Date(photo.taken_at).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      {/* Previous chevron — floats on the left edge of the viewport.
          Hidden (visibility: hidden) at index 0 so it reserves the space
          but doesn't render — keeps the photo position stable across
          navigations. */}
      <button
        onClick={e => { e.stopPropagation(); if (hasPrev) onPrev() }}
        aria-label="Previous photo"
        style={{
          position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)',
          width: 48, height: 48, borderRadius: '50%',
          background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
          color: 'white', fontSize: 24, lineHeight: 1, cursor: hasPrev ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: hasPrev ? 1 : 0.3,
        }}>‹</button>

      {/* Next chevron — mirror of above. */}
      <button
        onClick={e => { e.stopPropagation(); if (hasNext) onNext() }}
        aria-label="Next photo"
        style={{
          position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)',
          width: 48, height: 48, borderRadius: '50%',
          background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
          color: 'white', fontSize: 24, lineHeight: 1, cursor: hasNext ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: hasNext ? 1 : 0.3,
        }}>›</button>

      <div onClick={e => e.stopPropagation()} style={{
        maxWidth: '92vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {url ? (
          // key forces React to re-mount the <img> when the photo
          // changes, which makes the transition cleaner (avoids the
          // browser briefly showing the old image stretched to new size
          // before the new src loads).
          <img key={photo.id} src={url} alt="" style={{ maxWidth: '100%', maxHeight: '76vh', objectFit: 'contain', borderRadius: 4, background: '#000' }} />
        ) : (
          <div style={{ width: 400, height: 300, background: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>Loading…</div>
        )}
        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 6, padding: '10px 14px', color: 'white', fontSize: 12, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            {photo.caption && <div style={{ fontWeight: 600, marginBottom: 2 }}>{photo.caption}</div>}
            <div style={{ opacity: 0.7 }}>
              {taken}
              {photo.telegram_username && <> · @{photo.telegram_username}</>}
              <> · {index + 1} / {photos.length}</>
            </div>
          </div>
          {onDownload && (
            <button onClick={onDownload} style={{
              background: 'transparent', color: 'white', border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: 4, padding: '6px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}>Download</button>
          )}
          {canManage && (
            <button onClick={onDelete} style={{
              background: '#A32D2D', color: 'white', border: 0, borderRadius: 4,
              padding: '6px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}>Delete photo</button>
          )}
          <button onClick={onClose} style={{
            background: 'transparent', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 4,
            padding: '6px 12px', fontSize: 11, cursor: 'pointer',
          }}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── ConnectTelegramModal ──────────────────────────────────────────────────
function ConnectTelegramModal({ projectId, profileId, onClose, onConnected }) {
  const [chatId, setChatId] = useState('')
  const [chatTitle, setChatTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError('')
    const id = parseInt(chatId.trim(), 10)
    if (isNaN(id)) { setError('Chat ID must be a number (e.g. -1001234567890).'); return }

    setSaving(true)
    const { error: insErr } = await supabase.from('project_telegram_groups').insert({
      project_id: projectId,
      chat_id: id,
      chat_title: chatTitle.trim() || null,
      added_by: profileId || null,
    })
    setSaving(false)
    if (insErr) {
      // Postgres unique-violation = 23505. The chat_id column has a UNIQUE
      // constraint so a single Telegram chat can only be linked to one
      // project at a time. Give the user a useful hint instead of the raw
      // SQL error string.
      if (insErr.code === '23505') {
        // Try to look up which project the chat is already linked to so we
        // can name it. Best-effort — if the lookup fails we still show a
        // friendly message.
        const { data: existing } = await supabase
          .from('project_telegram_groups')
          .select('project_id, chat_title, projects!inner(project_name)')
          .eq('chat_id', id)
          .maybeSingle()
        const otherProject = existing?.projects?.project_name
        setError(
          otherProject
            ? `This Telegram chat is already connected to project "${otherProject}". Each chat can only be linked to one project at a time — disconnect it there first.`
            : 'This Telegram chat is already connected to another project. Each chat can only be linked to one project at a time — disconnect it there first.'
        )
        return
      }
      setError(insErr.message)
      return
    }

    onConnected({ chat_id: id, chat_title: chatTitle.trim() || null })
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--surface)', borderRadius: 10, maxWidth: 480, width: '100%',
        padding: 24, boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
      }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Connect Telegram group</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 18, lineHeight: 1.6 }}>
          1. In Telegram, add the BuildCore Photos bot to your project group.<br/>
          2. In the group, send <code style={{ background: 'var(--surface2)', padding: '1px 5px', borderRadius: 3 }}>/register</code>.<br/>
          3. The bot replies with a chat ID — paste it below.
        </div>

        <form onSubmit={submit}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>Chat ID *</label>
            <input
              type="text"
              autoFocus
              value={chatId}
              onChange={e => setChatId(e.target.value)}
              placeholder="-1001234567890"
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 5, fontSize: 13, background: 'var(--surface)', color: 'var(--text)' }}
              required />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>Group name (optional)</label>
            <input
              type="text"
              value={chatTitle}
              onChange={e => setChatTitle(e.target.value)}
              placeholder="Hopton Road Site Team"
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 5, fontSize: 13, background: 'var(--surface)', color: 'var(--text)' }} />
          </div>

          {error && <div style={{ fontSize: 12, color: '#A32D2D', marginBottom: 12 }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
