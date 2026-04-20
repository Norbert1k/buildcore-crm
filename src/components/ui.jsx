import { useState } from 'react'
import { avatarColor, initials } from '../lib/utils'

// ── Avatar ───────────────────────────────────────────────────
export function Avatar({ name, size = 'md', style: extraStyle }) {
  const c = avatarColor(name)
  const sizeClass = size === 'sm' ? 'avatar avatar-sm' : size === 'lg' ? 'avatar avatar-lg' : 'avatar'
  return (
    <div className={sizeClass} style={{ background: c.bg, color: c.color, ...extraStyle }}>
      {initials(name)}
    </div>
  )
}

// ── Pill ─────────────────────────────────────────────────────
export function Pill({ children, cls = 'pill-gray', style }) {
  return <span className={`pill ${cls}`} style={style}>{children}</span>
}

// ── Modal ────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, size = 'md', footer }) {
  if (!open) return null

  function handleOverlayKeyDown(e) {
    // Prevent Backspace from propagating beyond the modal (stops browser-back / route-back)
    if (e.key === 'Backspace') {
      const tag = e.target.tagName
      const editable = e.target.isContentEditable
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable
      if (!isInput) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    // Allow Escape to close modal
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="modal-overlay" onKeyDown={handleOverlayKeyDown}>
      <div className={`modal modal-${size}`}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="btn btn-sm btn-icon" onClick={onClose}>
            <IconX size={15} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

// ── Confirm Dialog ───────────────────────────────────────────
export function ConfirmDialog({ open, onClose, onConfirm, title, message, danger }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>Confirm</button>
      </>}>
      <p style={{ color: 'var(--text2)', fontSize: 14, lineHeight: 1.6 }}>{message}</p>
    </Modal>
  )
}

// ── Form Field ───────────────────────────────────────────────
export function Field({ label, children, error }) {
  return (
    <div>
      {label && <label>{label}</label>}
      {children}
      {error && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 3 }}>{error}</div>}
    </div>
  )
}

// ── Activity Meta — "Uploaded by X • Edited by Y 3 days ago" ─
export function ActivityMeta({ uploadedByName, updatedByName, createdByName, createdAt, updatedAt, compact }) {
  function timeAgo(dateStr) {
    if (!dateStr) return null
    const d = new Date(dateStr); const now = new Date()
    const s = Math.floor((now - d) / 1000)
    if (s < 60) return 'just now'
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
    const days = Math.floor(h / 24); if (days < 30) return `${days}d ago`
    const months = Math.floor(days / 30); if (months < 12) return `${months}mo ago`
    return `${Math.floor(months / 12)}y ago`
  }
  // Prefer most recent action: updated_by if different from uploaded_by and updated_at > created_at
  const uploaderName = uploadedByName || createdByName
  const wasEdited = updatedByName && updatedAt && createdAt && new Date(updatedAt).getTime() - new Date(createdAt).getTime() > 5000
  const editorName = wasEdited ? updatedByName : null
  if (!uploaderName && !editorName) return null
  const fontSize = compact ? 10 : 11
  return (
    <div style={{ fontSize, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
      {uploaderName && (
        <span title={createdAt ? new Date(createdAt).toLocaleString('en-GB') : ''}>
          <span style={{ opacity: 0.7 }}>Added by</span> <strong style={{ fontWeight: 500, color: 'var(--text2)' }}>{uploaderName}</strong>
          {createdAt && <span style={{ opacity: 0.7 }}> · {timeAgo(createdAt)}</span>}
        </span>
      )}
      {editorName && (
        <>
          <span style={{ opacity: 0.4 }}>•</span>
          <span title={updatedAt ? new Date(updatedAt).toLocaleString('en-GB') : ''}>
            <span style={{ opacity: 0.7 }}>Last edited by</span> <strong style={{ fontWeight: 500, color: 'var(--text2)' }}>{editorName}</strong>
            {updatedAt && <span style={{ opacity: 0.7 }}> · {timeAgo(updatedAt)}</span>}
          </span>
        </>
      )}
    </div>
  )
}

// ── Loading ──────────────────────────────────────────────────
export function Spinner({ size = 20 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div style={{
        width: size, height: size, border: '2px solid var(--border)',
        borderTop: '2px solid var(--text)', borderRadius: '50%',
        animation: 'spin .7s linear infinite'
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ── Empty State ──────────────────────────────────────────────
export function EmptyState({ icon, title, message, action }) {
  return (
    <div className="empty-state">
      {icon && <div style={{ fontSize: 32, marginBottom: 12, opacity: .4 }}>{icon}</div>}
      <div style={{ fontWeight: 600, color: 'var(--text2)', marginBottom: 4 }}>{title}</div>
      <div style={{ marginBottom: action ? 16 : 0 }}>{message}</div>
      {action}
    </div>
  )
}

// ── Icons (inline SVG) ───────────────────────────────────────
function Icon({ path, size = 16, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, ...style }}>
      <path d={path} />
    </svg>
  )
}

export const IconDashboard = ({ size }) => <Icon size={size} path="M1 9h6V1H1v8zm0 6h6v-4H1v4zm8 0h6V7h-6v8zm0-14v4h6V1h-6z" />
export const IconUsers = ({ size }) => <Icon size={size} path="M8 8a3 3 0 100-6 3 3 0 000 6zm-5 6s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3z" />
export const IconDoc = ({ size }) => <Icon size={size} path="M4 0h5.5L13 3.5V14a2 2 0 01-2 2H4a2 2 0 01-2-2V2a2 2 0 012-2zm5 1v3h3l-3-3zm-4 6h6v1H5V7zm0 2h6v1H5V9zm0 2h4v1H5v-1z" />
export const IconProject = ({ size }) => <Icon size={size} path="M14 2H2a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1V3a1 1 0 00-1-1zM2 13V5h12v8H2zm2-5h8v1H4V8zm0 2h5v1H4v-1z" />
export const IconAlert = ({ size }) => <Icon size={size} path="M8 0a8 8 0 100 16A8 8 0 008 0zm0 4v5H7V4h1zm0 7v1.5H7V11h1z" />
export const IconSettings = ({ size }) => <Icon size={size} path="M8 5a3 3 0 100 6 3 3 0 000-6zm6.1 2.2l-1.5-.3a5 5 0 00-.4-1l.9-1.2-1.8-1.8-1.2.9a5 5 0 00-1-.4l-.3-1.5H6.2l-.3 1.5a5 5 0 00-1 .4l-1.2-.9L1.9 4.7l.9 1.2a5 5 0 00-.4 1l-1.5.3v2.6l1.5.3c.1.4.2.7.4 1l-.9 1.2 1.8 1.8 1.2-.9c.3.2.6.3 1 .4l.3 1.5h2.6l.3-1.5c.4-.1.7-.2 1-.4l1.2.9 1.8-1.8-.9-1.2c.2-.3.3-.6.4-1l1.5-.3V7.2z" />
export const IconX = ({ size }) => <Icon size={size} path="M12.7 4.7l-1.4-1.4L8 6.6 4.7 3.3 3.3 4.7 6.6 8l-3.3 3.3 1.4 1.4L8 9.4l3.3 3.3 1.4-1.4L9.4 8z" />
export const IconPlus = ({ size }) => <Icon size={size} path="M8 1v6H2v2h6v6h2V9h6V7H10V1H8z" />
export const IconEdit = ({ size }) => <Icon size={size} path="M11.5 2.5l2 2L4 14H2v-2L11.5 2.5zM10 4l2 2-8 8H2v-2l8-8z" />
export const IconTrash = ({ size }) => <Icon size={size} path="M3 5h10v9a1 1 0 01-1 1H4a1 1 0 01-1-1V5zm3 0V3h4v2M1 5h14" />
export const IconEye = ({ size }) => <Icon size={size} path="M8 3C4.7 3 1.9 5.1 1 8c.9 2.9 3.7 5 7 5s6.1-2.1 7-5c-.9-2.9-3.7-5-7-5zm0 8a3 3 0 110-6 3 3 0 010 6zm0-5a2 2 0 100 4 2 2 0 000-4z" />
export const IconEyeOff = ({ size }) => (
  <svg width={size||16} height={size||16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
    <path d="M1 1l14 14"/>
    <path d="M6.7 6.7a2 2 0 002.6 2.6"/>
    <path d="M9.36 4.12A5.9 5.9 0 008 4C4.7 4 1.9 6.1 1 9c.27.88.68 1.67 1.2 2.35"/>
    <path d="M5.4 12.6A6.1 6.1 0 008 13c3.3 0 6.1-2.1 7-5a7.4 7.4 0 00-2.8-3.6"/>
  </svg>
)

// ── Password Input — text field with eye toggle ─────────────
export function PasswordInput({ value, onChange, placeholder, autoFocus, name, id, disabled, required, style }) {
  const [visible, setVisible] = useState(false)
  return (
    <div style={{ position: 'relative', ...style }}>
      <input
        type={visible ? 'text' : 'password'}
        value={value || ''}
        onChange={onChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        name={name}
        id={id}
        disabled={disabled}
        required={required}
        style={{ width: '100%', paddingRight: 38 }}
      />
      <button
        type="button"
        onClick={() => setVisible(v => !v)}
        tabIndex={-1}
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
        style={{
          position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: '4px 6px', borderRadius: 4, color: 'var(--text3)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          lineHeight: 0,
        }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}
      >
        {visible ? <IconEyeOff size={15} /> : <IconEye size={15} />}
      </button>
    </div>
  )
}
export const IconSearch = ({ size }) => <Icon size={size} path="M11.742 10.344a6.5 6.5 0 10-1.397 1.398l3.85 3.85a1 1 0 001.415-1.414l-3.868-3.834zm-5.24 1.4a5 5 0 110-10 5 5 0 010 10z" />
export const IconChevron = ({ size, dir = 'right' }) => {
  const paths = { right:'M6 3l5 5-5 5', left:'M10 3L5 8l5 5', down:'M3 6l5 5 5-5', up:'M3 10l5-5 5 5' }
  return <svg width={size||16} height={size||16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><path d={paths[dir]}/></svg>
}
export const IconBuilding = ({ size }) => <Icon size={size} path="M2 14V4l5-3 5 3v10H2zm4 0V9h2v5H6zm-3-8v1h1V6H3zm0 2v1h1V8H3zm4-2v1h1V6H7zm0 2v1h1V8H7z" />
export const IconCalendar = ({ size }) => <Icon size={size} path="M4 1v2H2a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1h-2V1h-1v2H5V1H4zm-2 5h12v8H2V6z" />
export const IconUpload = ({ size }) => <Icon size={size} path="M8 1L4 5h3v7h2V5h3L8 1zM2 13v2h12v-2H2z" />
export const IconDownload = ({ size }) => <Icon size={size} path="M8 11l4-4H9V1H7v6H4l4 4zM2 13v2h12v-2H2z" />
