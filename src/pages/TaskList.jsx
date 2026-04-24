import { useNavigate, useParams } from 'react-router-dom'
import { IconChevron } from '../components/ui'

export default function TaskList() {
  const navigate = useNavigate()
  const { projectId } = useParams()

  return (
    <div>
      <button className="btn btn-sm" style={{ marginBottom: 16 }} onClick={() => navigate('/tasks')}>
        <IconChevron size={13} dir="left" /> Back to Task Tracker
      </button>
      <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', padding: 40 }}>
        <div style={{ fontSize: 14, marginBottom: 6 }}>Task list for project <code style={{ fontSize: 11, background: 'var(--surface2)', padding: '2px 6px', borderRadius: 3 }}>{projectId}</code></div>
        <div style={{ fontSize: 12 }}>Coming in Phase 2 — full task list with filters, sorting, and creation.</div>
      </div>
    </div>
  )
}
