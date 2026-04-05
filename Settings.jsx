import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatDate, daysUntilExpiry, DOCUMENT_TYPES, SUB_STATUSES, PROJECT_STATUSES } from '../lib/utils'
import { Spinner, Pill, Avatar, IconAlert, IconChevron } from '../components/ui'

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => { loadDashboard() }, [])

  async function loadDashboard() {
    const [subsRes, docsRes, projectsRes] = await Promise.all([
      supabase.from('subcontractors').select('id, status'),
      supabase.from('documents_with_status').select('id, document_name, document_type, expiry_date, status, subcontractor_id, subcontractors(company_name, trade)').in('status', ['expired', 'expiring_soon']).order('expiry_date'),
      supabase.from('projects').select('id, status'),
    ])
    setData({
      subs: subsRes.data || [],
      alerts: docsRes.data || [],
      projects: projectsRes.data || [],
    })
    setLoading(false)
  }

  if (loading) return <Spinner />
  const { subs, alerts, projects } = data
  const expired = alerts.filter(a => a.status === 'expired')
  const expiring = alerts.filter(a => a.status === 'expiring_soon')
  const activeSubs = subs.filter(s => s.status === 'active' || s.status === 'approved').length
  const activeProjects = projects.filter(p => p.status === 'active').length

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Subcontractors</div>
          <div className="stat-value">{subs.length}</div>
          <div className="stat-sub">{activeSubs} active / approved</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Projects</div>
          <div className="stat-value">{activeProjects}</div>
          <div className="stat-sub">{projects.length} total projects</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Expired Documents</div>
          <div className={`stat-value ${expired.length > 0 ? 'red' : 'green'}`}>{expired.length}</div>
          <div className="stat-sub">{expired.length > 0 ? 'Immediate action needed' : 'All clear'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Expiring Within 30d</div>
          <div className={`stat-value ${expiring.length > 0 ? 'amber' : 'green'}`}>{expiring.length}</div>
          <div className="stat-sub">Requires attention soon</div>
        </div>
      </div>

      {alerts.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div className="section-header">
            <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <IconAlert size={15} />
              Compliance Alerts
            </div>
            <button className="btn btn-sm" onClick={() => navigate('/documents')}>View all documents →</button>
          </div>

          {expired.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Expired — immediate action</div>
              {expired.slice(0, 5).map(a => (
                <AlertRow key={a.id} alert={a} type="expired" onClick={() => navigate(`/subcontractors/${a.subcontractor_id}`)} />
              ))}
              {expired.length > 5 && <div style={{ fontSize: 12, color: 'var(--text3)', padding: '4px 0' }}>+{expired.length - 5} more expired documents</div>}
            </div>
          )}

          {expiring.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Expiring soon</div>
              {expiring.slice(0, 5).map(a => (
                <AlertRow key={a.id} alert={a} type="expiring" onClick={() => navigate(`/subcontractors/${a.subcontractor_id}`)} />
              ))}
            </div>
          )}
        </div>
      )}

      {alerts.length === 0 && (
        <div style={{ background: 'var(--green-bg)', border: '1px solid var(--green-border)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, background: 'var(--green)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" fill="#fff" viewBox="0 0 16 16"><path d="M13.485 1.431a1.473 1.473 0 012.284 1.851l-8.56 13.095a1.473 1.473 0 01-2.284.18L1.42 12.87a1.473 1.473 0 012.12-2.05l2.41 2.49 7.535-11.878z"/></svg>
          </div>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--green)', marginBottom: 2 }}>All compliance documents are valid</div>
            <div style={{ fontSize: 13, color: 'var(--green)' }}>No expired or expiring-soon documents across all subcontractors.</div>
          </div>
        </div>
      )}
    </div>
  )
}

function AlertRow({ alert, type, onClick }) {
  const days = daysUntilExpiry(alert.expiry_date)
  const isExp = type === 'expired'
  return (
    <div className={`alert-item ${isExp ? 'alert-expired' : 'alert-warning'}`} style={{ cursor: 'pointer' }} onClick={onClick}>
      <Avatar name={alert.subcontractors?.company_name} size="sm" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 13 }}>{alert.subcontractors?.company_name}</div>
        <div style={{ fontSize: 12, opacity: .8 }}>{DOCUMENT_TYPES[alert.document_type] || alert.document_name}</div>
      </div>
      <div style={{ fontSize: 12, fontWeight: 500, flexShrink: 0 }}>
        {isExp ? `Expired ${Math.abs(days)}d ago` : `${days}d left`}
      </div>
      <IconChevron size={14} />
    </div>
  )
}
