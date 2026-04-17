import { useState, useEffect } from 'react'

/**
 * UploadProgress — shows a floating toast-style progress indicator during file uploads.
 * 
 * Props:
 *   uploadState: { active: boolean, files: string[], current: number, total: number, errors: string[] }
 *     - active: whether an upload is in progress
 *     - files: array of filenames being uploaded
 *     - current: index of file currently uploading (0-based)
 *     - total: total number of files
 *     - errors: array of error messages
 */
export default function UploadProgress({ uploadState }) {
  const [visible, setVisible] = useState(false)
  const [fadeOut, setFadeOut] = useState(false)

  useEffect(() => {
    if (uploadState?.active) {
      setVisible(true)
      setFadeOut(false)
    } else if (visible) {
      // When upload finishes, show "Complete" briefly then fade out
      const timer = setTimeout(() => setFadeOut(true), 1800)
      const hide = setTimeout(() => setVisible(false), 2400)
      return () => { clearTimeout(timer); clearTimeout(hide) }
    }
  }, [uploadState?.active])

  if (!visible) return null

  const { files = [], current = 0, total = 0, active, errors = [] } = uploadState || {}
  const done = !active
  const pct = total > 0 ? Math.round(((done ? total : current) / total) * 100) : 0
  const currentFile = files[current] || ''

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg, 12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      padding: '14px 18px', minWidth: 280, maxWidth: 380,
      transition: 'opacity .4s, transform .4s',
      opacity: fadeOut ? 0 : 1,
      transform: fadeOut ? 'translateY(10px)' : 'translateY(0)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {done ? (
          <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--green-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M10 3L5 8.5 2 5.5" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
        ) : (
          <div style={{
            width: 22, height: 22, borderRadius: '50%',
            border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
            animation: 'spin .7s linear infinite', flexShrink: 0,
          }} />
        )}
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          {done
            ? `${total} file${total !== 1 ? 's' : ''} uploaded`
            : `Uploading ${current + 1} of ${total}…`
          }
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        width: '100%', height: 6, background: 'var(--surface2)',
        borderRadius: 3, overflow: 'hidden', marginBottom: 6,
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: done ? 'var(--green)' : 'var(--accent)',
          borderRadius: 3,
          transition: 'width .3s ease',
        }} />
      </div>

      {/* Current filename */}
      {!done && currentFile && (
        <div style={{ fontSize: 11, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {currentFile}
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--red)' }}>
          {errors.length} file{errors.length !== 1 ? 's' : ''} failed to upload
        </div>
      )}
    </div>
  )
}

/**
 * useUploadProgress hook — provides upload state and a wrapper function.
 * 
 * Usage:
 *   const { uploadState, trackUpload } = useUploadProgress()
 *   
 *   async function uploadFiles(fileList) {
 *     await trackUpload(fileList, async (file, index) => {
 *       // upload logic for one file
 *     })
 *   }
 *   
 *   return <><UploadProgress uploadState={uploadState} /> ... </>
 */
export function useUploadProgress() {
  const [uploadState, setUploadState] = useState({
    active: false, files: [], current: 0, total: 0, errors: [],
  })

  async function trackUpload(fileList, uploadFn) {
    const files = Array.from(fileList)
    if (!files.length) return
    const fileNames = files.map(f => f.name)
    setUploadState({ active: true, files: fileNames, current: 0, total: files.length, errors: [] })

    const errors = []
    for (let i = 0; i < files.length; i++) {
      setUploadState(prev => ({ ...prev, current: i }))
      try {
        await uploadFn(files[i], i)
      } catch (err) {
        errors.push(files[i].name)
        console.error('Upload failed:', files[i].name, err)
      }
    }

    setUploadState({ active: false, files: fileNames, current: files.length, total: files.length, errors })
  }

  return { uploadState, trackUpload }
}
