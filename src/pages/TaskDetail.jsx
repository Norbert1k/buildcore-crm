import { useNavigate, useParams } from 'react-router-dom'
import { IconChevron } from '../components/ui'

export default function TaskDetail() {
  const navigate = useNavigate()
  const { taskId } = useParams()

  return (
    <div>
      <button className="btn btn-sm" style={{ marginBottom: 16 }} onClick={() => navigate(-1)}>
        <IconChevron size={13} dir="left" /> Back
      </button>
      <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', padding: 40 }}>
        <div style={{ fontSize: 14, marginBottom: 6 }}>Task <code style={{ fontSize: 11, background: 'var(--surface2)', padding: '2px 6px', borderRadius: 3 }}>{taskId}</code></div>
        <div style={{ fontSize: 12 }}>Single-task detail page coming in Phase 3 — live notes, file uploads, EML viewer, activity log.</div>
      </div>
    </div>
  )
}
