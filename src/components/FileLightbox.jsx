import { useEffect } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// FileLightbox.jsx — shared file-viewer modal for the CRM.
//
// This mirrors the portal's FileLightbox: same look-and-feel, same viewer
// routing per file type:
//
//   • PDF                    → <iframe> with browser native PDF viewer
//   • Office docs (Word/    → <iframe> pointing at Microsoft Office Online,
//     Excel/PowerPoint)        which renders the file from the public URL
//   • Images (png/jpg/etc.)  → <img>
//   • Everything else        → "Cannot preview, please download"
//
// Office doc previews use Microsoft's free public viewer at
//   https://view.officeapps.live.com/op/embed.aspx
// This service requires the file URL to be publicly accessible. Supabase
// signed URLs ARE publicly fetchable for the duration they're valid (1 hour
// in our setup), so this works. We show a small notice in the header so
// staff knows the preview is rendered by a third party.
//
// Click backdrop / press ESC / click X to close. If `onDownload` is passed,
// a Download button appears in the header.
// ─────────────────────────────────────────────────────────────────────────────

function detectViewerKind(fileName) {
  const ext = (fileName?.split('.').pop() || '').toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) return 'office'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'].includes(ext)) return 'image'
  return 'unsupported'
}

export function canPreviewFile(fileName) {
  return detectViewerKind(fileName) !== 'unsupported'
}

export default function FileLightbox({ signedUrl, fileName, onClose, onDownload }) {
  // ESC + body scroll lock — registered while the modal is open. The modal
  // is considered "open" when we have a fileName, even if the signedUrl
  // hasn't arrived yet (caller may be fetching it asynchronously).
  const isOpen = !!fileName
  useEffect(() => {
    if (!isOpen) return
    function onKey(e) {
      if (e.key === 'Escape') onClose && onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const kind = detectViewerKind(fileName)
  // While the signedUrl is being generated asynchronously, the caller can
  // mount this component with a null url. Show a spinner-ish loading state
  // until the url arrives.
  const loadingUrl = !signedUrl

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
            {fileName}
          </div>
          {kind === 'office' && (
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, marginTop: 2 }}>
              Preview powered by Microsoft Office Online
            </div>
          )}
        </div>
        {onDownload && !loadingUrl && (
          <button
            onClick={e => { e.stopPropagation(); onDownload() }}
            style={{
              color: 'white',
              fontSize: 12, padding: '6px 12px',
              border: '0.5px solid rgba(255,255,255,0.25)',
              borderRadius: 6, background: 'rgba(255,255,255,0.06)',
              cursor: 'pointer',
            }}
          >
            ↓ Download
          </button>
        )}
        {!loadingUrl && (
          <a
            href={signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'white',
              fontSize: 12, padding: '6px 12px',
              border: '0.5px solid rgba(255,255,255,0.25)',
              borderRadius: 6, textDecoration: 'none',
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
            borderRadius: 6, background: 'transparent', cursor: 'pointer',
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

      {/* Viewer body */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          flex: 1, minHeight: 0, maxWidth: 1100, width: '100%', margin: '0 auto',
          background: kind === 'image' ? 'transparent' : 'white',
          borderRadius: 8, overflow: 'hidden',
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
            src={signedUrl + '#toolbar=1&navpanes=0&view=FitH'}
            title={fileName}
            style={{ width: '100%', height: '100%', border: 'none' }}
          />
        )}
        {!loadingUrl && kind === 'office' && (
          <iframe
            src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}`}
            title={fileName}
            style={{ width: '100%', height: '100%', border: 'none' }}
          />
        )}
        {!loadingUrl && kind === 'image' && (
          <img
            src={signedUrl}
            alt={fileName}
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
              href={signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-block',
                fontSize: 12, padding: '8px 16px',
                background: '#534AB7', color: 'white',
                borderRadius: 6, textDecoration: 'none',
              }}
            >
              Open in new tab
            </a>
          </div>
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
        Press ESC or click outside to close
      </div>
    </div>
  )
}
