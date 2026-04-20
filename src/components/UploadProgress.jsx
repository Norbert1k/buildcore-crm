import { useState, useEffect } from 'react'

/**
 * UploadProgress — centered modal-style progress overlay during file uploads.
 *
 * Dim background + centered card so uploads are impossible to miss.
 * Blocks interaction while uploading; fades out on completion.
 *
 * Props:
 *   uploadState: { active: boolean, files: string[], current: number, total: number, errors: string[] }
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
      const timer = setTimeout(() => setFadeOut(true), 1400)
      const hide = setTimeout(() => setVisible(false), 1900)
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
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.5)',
      zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
      transition: 'opacity .4s',
      opacity: fadeOut ? 0 : 1,
      pointerEvents: fadeOut ? 'none' : 'auto',
    }}>
      <style>{`@keyframes uploadSpin { to { transform: rotate(360deg) } }`}</style>
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg, 12px)',
        boxShadow: '0 12px 48px rgba(0,0,0,0.28)',
        padding: '22px 26px',
        width: '100%', maxWidth: 420,
        transform: fadeOut ? 'scale(0.96)' : 'scale(1)',
        transition: 'transform .35s ease, opacity .35s',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          {done ? (
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--green-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13 4L6 11 3 8" stroke="var(--green)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          ) : (
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              border: '3px solid var(--border)', borderTopColor: '#448a40',
              animation: 'uploadSpin .7s linear infinite', flexShrink: 0,
            }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
              {done
                ? `${total} file${total !== 1 ? 's' : ''} uploaded`
                : `Uploading files…`
              }
            </div>
            {!done && (
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                {current + 1} of {total} · {pct}%
              </div>
            )}
            {done && errors.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 2 }}>
                Upload complete
              </div>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{
          width: '100%', height: 8, background: 'var(--surface2)',
          borderRadius: 4, overflow: 'hidden', marginBottom: 10,
        }}>
          <div style={{
            width: `${pct}%`, height: '100%',
            background: done ? 'var(--green)' : '#448a40',
            borderRadius: 4,
            transition: 'width .3s ease',
          }} />
        </div>

        {/* Current filename */}
        {!done && currentFile && (
          <div style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ color: 'var(--text3)' }}>Current: </span>{currentFile}
          </div>
        )}

        {/* Errors */}
        {errors.length > 0 && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 6, fontSize: 12, color: 'var(--red)' }}>
            {errors.length} file{errors.length !== 1 ? 's' : ''} failed to upload
          </div>
        )}
      </div>
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
