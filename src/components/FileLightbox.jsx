import { useEffect, useRef, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// FileLightbox.jsx — shared file-viewer modal for the CRM.
//
// SUPPORTS TWO MODES:
//
//   1. SINGLE-FILE MODE (legacy / unchanged behaviour):
//      <FileLightbox
//        signedUrl={...}    // pre-fetched URL
//        fileName={...}
//        onClose={...}
//        onDownload={...}   // optional, called when Download clicked
//      />
//      No prev/next arrows. Drop-in compatible with existing callers.
//
//   2. LIST MODE (new — flick through multiple files):
//      <FileLightbox
//        files={[{id, file_name, ...}, ...]}  // array of file objects
//        currentIndex={n}                      // which one to show
//        onIndexChange={(newIdx) => ...}      // user pressed prev/next
//        getSignedUrl={async file => '...'}    // caller provides URL
//        onClose={...}
//        onDownload={(file) => ...}            // receives the file object
//      />
//      Renders prev/next arrows + a "3 / 27" indicator.
//      Keyboard ← / → navigate.
//      Skips non-previewable files when flipping (no dead arrows).
//
// VIEWER ROUTING per file type:
//   • PDF                    → <iframe> with browser native PDF viewer
//   • Office docs (Word/    → <iframe> pointing at Microsoft Office Online
//     Excel/PowerPoint)
//   • Images (png/jpg/etc.)  → <img>
//   • .eml (email)           → "Open in new tab" (best UX for emails)
//   • Everything else        → "Cannot preview"
//
// Office doc previews use Microsoft's free public viewer at
//   https://view.officeapps.live.com/op/embed.aspx
// Supabase signed URLs work because they're publicly fetchable.
//
// Click backdrop / press ESC / click X to close.
// ─────────────────────────────────────────────────────────────────────────────

function detectViewerKind(fileName) {
  const ext = (fileName?.split('.').pop() || '').toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) return 'office'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'heic', 'heif'].includes(ext)) return 'image'
  return 'unsupported'
}

export function canPreviewFile(fileName) {
  return detectViewerKind(fileName) !== 'unsupported'
}

export default function FileLightbox({
  // Single-file mode
  signedUrl,
  fileName,
  onClose,
  onDownload,
  // List mode
  files,
  currentIndex,
  onIndexChange,
  getSignedUrl,
}) {
  const isListMode = Array.isArray(files) && typeof currentIndex === 'number' && typeof getSignedUrl === 'function'

  // ── List-mode state ────────────────────────────────────────────────────
  // Cache fetched URLs per file id so flipping back-and-forth is cheap.
  const urlCacheRef = useRef(new Map())
  const [listSignedUrl, setListSignedUrl] = useState(null)

  const currentFile = isListMode ? files[currentIndex] : null
  const effectiveFileName = isListMode ? (currentFile?.file_name || '') : fileName
  const effectiveSignedUrl = isListMode ? listSignedUrl : signedUrl

  // Fetch URL for the current file in list mode.
  useEffect(() => {
    if (!isListMode || !currentFile) { setListSignedUrl(null); return }
    const cache = urlCacheRef.current
    const key = currentFile.id ?? currentFile.storage_path
    if (cache.has(key)) {
      setListSignedUrl(cache.get(key))
      return
    }
    setListSignedUrl(null)
    let cancelled = false
    getSignedUrl(currentFile).then(url => {
      if (cancelled) return
      if (url) cache.set(key, url)
      setListSignedUrl(url || null)
    }).catch(() => {
      if (!cancelled) setListSignedUrl(null)
    })
    return () => { cancelled = true }
  }, [isListMode, currentFile, getSignedUrl])

  // Pre-fetch the next previewable file's URL so flipping forward feels instant.
  // Walks the list to the next previewable item, fetches its URL into cache.
  useEffect(() => {
    if (!isListMode || listSignedUrl == null) return
    const nextIdx = findNextPreviewableIndex(files, currentIndex, +1)
    if (nextIdx == null || nextIdx === currentIndex) return
    const nextFile = files[nextIdx]
    if (!nextFile) return
    const cache = urlCacheRef.current
    const key = nextFile.id ?? nextFile.storage_path
    if (cache.has(key)) return
    let cancelled = false
    getSignedUrl(nextFile).then(url => {
      if (cancelled || !url) return
      cache.set(key, url)
    }).catch(() => { /* silent */ })
    return () => { cancelled = true }
  }, [isListMode, listSignedUrl, files, currentIndex, getSignedUrl])

  // ── Open / close state lock ────────────────────────────────────────────
  const isOpen = !!effectiveFileName
  useEffect(() => {
    if (!isOpen) return
    function onKey(e) {
      if (e.key === 'Escape') onClose && onClose()
      if (isListMode && e.key === 'ArrowRight') goNext()
      if (isListMode && e.key === 'ArrowLeft')  goPrev()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, onClose, isListMode, currentIndex, files])

  // ── Navigation helpers (only used in list mode) ───────────────────────
  function goPrev() {
    if (!isListMode) return
    const idx = findNextPreviewableIndex(files, currentIndex, -1)
    if (idx != null && idx !== currentIndex) onIndexChange(idx)
  }
  function goNext() {
    if (!isListMode) return
    const idx = findNextPreviewableIndex(files, currentIndex, +1)
    if (idx != null && idx !== currentIndex) onIndexChange(idx)
  }

  // Count previewable files for the "3 / 27" indicator.
  const previewableCount = isListMode
    ? files.filter(f => canPreviewFile(f.file_name || '')).length
    : 0
  // What's the 1-based position of the current file among previewables?
  const previewablePosition = isListMode
    ? files.slice(0, currentIndex + 1).filter(f => canPreviewFile(f.file_name || '')).length
    : 0
  const hasPrev = isListMode && findNextPreviewableIndex(files, currentIndex, -1) != null
  const hasNext = isListMode && findNextPreviewableIndex(files, currentIndex, +1) != null

  if (!isOpen) return null

  const kind = detectViewerKind(effectiveFileName)
  const loadingUrl = !effectiveSignedUrl

  function handleDownload(e) {
    e.stopPropagation()
    if (!onDownload) return
    if (isListMode) onDownload(currentFile)
    else onDownload()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(8, 11, 18, 0.92)',
        display: 'flex', flexDirection: 'column',
        padding: 'clamp(8px, 2vw, 24px)',
        gap: 12,
      }}
    >
      {/* Header */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '8px 12px', maxWidth: 1100, width: '100%', margin: '0 auto',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'white', fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {effectiveFileName}
          </div>
          {kind === 'office' && (
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, marginTop: 2 }}>
              Preview powered by Microsoft Office Online
            </div>
          )}
          {isListMode && previewableCount > 1 && (
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 2 }}>
              {previewablePosition} of {previewableCount}
            </div>
          )}
        </div>
        {onDownload && !loadingUrl && (
          <button
            onClick={handleDownload}
            style={{
              color: 'white',
              fontSize: 12, padding: '6px 12px',
              border: '0.5px solid rgba(255,255,255,0.25)',
              borderRadius: 'var(--radius)', background: 'rgba(255,255,255,0.06)',
              cursor: 'pointer',
            }}
          >
            ↓ Download
          </button>
        )}
        {!loadingUrl && (
          <a
            href={effectiveSignedUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{
              color: 'white',
              fontSize: 12, padding: '6px 12px',
              border: '0.5px solid rgba(255,255,255,0.25)',
              borderRadius: 'var(--radius)', textDecoration: 'none',
              background: 'rgba(255,255,255,0.06)',
            }}
          >
            Open in new tab
          </a>
        )}
        <button
          onClick={onClose}
          style={{
            color: 'white',
            fontSize: 14, padding: '6px 10px', lineHeight: 1,
            border: '0.5px solid rgba(255,255,255,0.25)',
            borderRadius: 'var(--radius)', background: 'transparent', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
          aria-label="Close preview"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
          Close
        </button>
      </div>

      {/* Viewer body wrapper — includes side nav arrows in list mode */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          flex: 1, minHeight: 0, maxWidth: 1100, width: '100%', margin: '0 auto',
          display: 'flex', alignItems: 'stretch', gap: 8,
          position: 'relative',
        }}
      >
        {/* Prev arrow (list mode only) */}
        {isListMode && (
          <button
            onClick={e => { e.stopPropagation(); goPrev() }}
            disabled={!hasPrev}
            aria-label="Previous file"
            title="Previous (←)"
            style={{
              position: 'absolute', left: -8, top: '50%', transform: 'translateY(-50%)',
              zIndex: 2,
              width: 44, height: 44, borderRadius: 99,
              border: '0.5px solid rgba(255,255,255,0.25)',
              background: hasPrev ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.2)',
              color: hasPrev ? 'white' : 'rgba(255,255,255,0.3)',
              cursor: hasPrev ? 'pointer' : 'default',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        )}

        {/* Viewer */}
        <div
          style={{
            flex: 1, minWidth: 0,
            background: kind === 'image' ? 'transparent' : 'white',
            borderRadius: 'var(--radius)', overflow: 'hidden',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {loadingUrl && (
            <div style={{ padding: 32, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              Loading preview…
            </div>
          )}
          {!loadingUrl && kind === 'pdf' && (
            <iframe
              key={effectiveSignedUrl}
              src={effectiveSignedUrl + '#toolbar=1&navpanes=0&view=FitH'}
              title={effectiveFileName}
              style={{ width: '100%', height: '100%', border: 'none' }}
            />
          )}
          {!loadingUrl && kind === 'office' && (
            <iframe
              key={effectiveSignedUrl}
              src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(effectiveSignedUrl)}`}
              title={effectiveFileName}
              style={{ width: '100%', height: '100%', border: 'none' }}
            />
          )}
          {!loadingUrl && kind === 'image' && (
            <img
              key={effectiveSignedUrl}
              src={effectiveSignedUrl}
              alt={effectiveFileName}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            />
          )}
          {!loadingUrl && kind === 'unsupported' && (
            <div style={{ padding: 32, textAlign: 'center', color: '#0a0a0a' }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>
                Cannot preview this file type
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
                Use the Download button or open the file in a new tab to view it.
              </div>
              <a
                href={effectiveSignedUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block',
                  fontSize: 12, padding: '8px 16px',
                  background: '#534AB7', color: 'white',
                  borderRadius: 'var(--radius)', textDecoration: 'none',
                }}
              >
                Open in new tab
              </a>
            </div>
          )}
        </div>

        {/* Next arrow (list mode only) */}
        {isListMode && (
          <button
            onClick={e => { e.stopPropagation(); goNext() }}
            disabled={!hasNext}
            aria-label="Next file"
            title="Next (→)"
            style={{
              position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)',
              zIndex: 2,
              width: 44, height: 44, borderRadius: 99,
              border: '0.5px solid rgba(255,255,255,0.25)',
              background: hasNext ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.2)',
              color: hasNext ? 'white' : 'rgba(255,255,255,0.3)',
              cursor: hasNext ? 'pointer' : 'default',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        )}
      </div>

      {/* Hint at bottom */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          textAlign: 'center', color: 'rgba(255,255,255,0.5)',
          fontSize: 11,
        }}
      >
        {isListMode && previewableCount > 1
          ? 'Use ← → to navigate · ESC to close'
          : 'Press ESC or click outside to close'}
      </div>
    </div>
  )
}

// Walk the file list from `fromIndex` in `dir` (+1 forward, -1 back),
// skip files whose extension is not previewable, return the index of
// the first previewable hit. Returns null if none found.
function findNextPreviewableIndex(files, fromIndex, dir) {
  if (!Array.isArray(files) || files.length === 0) return null
  let i = fromIndex + dir
  while (i >= 0 && i < files.length) {
    if (canPreviewFile(files[i].file_name || '')) return i
    i += dir
  }
  return null
}
