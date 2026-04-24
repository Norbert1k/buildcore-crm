import { useNavigate } from 'react-router-dom'
import { IconChevron } from '../components/ui'

export default function TasksGlobal() {
  const navigate = useNavigate()
  return (
    <div>
      <button className="btn btn-sm" style={{ marginBottom: 16 }} onClick={() => navigate('/tasks')}>
        <IconChevron size={13} dir="left" /> Back to Task Tracker
      </button>
      <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', padding: 40 }}>
        <div style={{ fontSize: 14, marginBottom: 6 }}>All Active Tasks — Global View</div>
        <div style={{ fontSize: 12 }}>Cross-project task view coming in Phase 2 — with filters by assignee, priority, project.</div>
      </div>
    </div>
  )
}
