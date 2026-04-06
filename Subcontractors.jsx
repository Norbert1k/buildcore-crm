import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatDate, daysUntilExpiry, DOCUMENT_TYPES, complianceScore } from '../lib/utils'
import { Spinner, Pill, Avatar, IconAlert, IconChevron, IconPlus } from '../components/ui'
import { useAuth } from '../lib/auth'

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const { profile, can } = useAuth()

  useEffect(() => { loadDashboard() }, [])

  async function loadDashboard() {
    const [subsRes, docsRes, projectsRes, suppliersRes] = await Promise.all([
      supabase.from('subcontractors').select('id, status, company_name, documents_with_status(id, expiry_date, status)'),
      supabase.from('documents_with_status').select('id, document_name, document_type, expiry_date, status, subcontractor_id, subcontractors(company_name, trade)').in('status', ['expired', 'expiring_soon']).order('expiry_date'),
      supabase.from('projects').select('id, status'),
      supabase.from('suppliers').select('id, status'),
    ])
    setData({
      subs: subsRes.data || [],
      alerts: docsRes.data || [],
      projects: projectsRes.data || [],
      suppliers: suppliersRes.data || [],
    })
    setLoading(false)
  }

  if (loading) return <Spinner />
  const { subs, alerts, projects, suppliers } = data
  const expired = alerts.filter(a => a.status === 'expired')
  const expiring = alerts.filter(a => a.status === 'expiring_soon')
  const activeSubs = subs.filter(s => s.status === 'active' || s.status === 'approved').length
  const activeProjects = projects.filter(p => p.status === 'active').length

  // Worst compliance subs
  const subsWithScores = subs
    .map(s => ({ ...s, score: complianceScore(s.documents_with_status) }))
    .filter(s => s.score && s.score.score < 100)
    .sort((a, b) => a.score.score - b.score.score)
    .slice(0, 3)

  return (
    <div>
      {/* Welcome */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Welcome back{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}</h2>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 2 }}>{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>

      {/* Quick actions */}
      {can('manage_subcontractors') && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/subcontractors')}>
            <IconPlus size={13} /> Add Subcontractor
          </button>
          <button className="btn btn-sm" onClick={() => navigate('/projects')}>
            <IconPlus size={13} /> New Project
          </button>
          <button className="btn btn-sm" onClick={() => navigate('/suppliers')}>
            <IconPlus size={13} /> Add Supplier
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/subcontractors')}>
          <div className="stat-label">Subcontractors</div>
          <div className="stat-value">{subs.length}</div>
          <div className="stat-sub">{activeSubs} active</div>
        </div>
        <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/projects')}>
          <div className="stat-label">Active Projects</div>
          <div className="stat-value">{activeProjects}</div>
          <div className="stat-sub">{projects.length} total</div>
        </div>
        <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/documents')}>
          <div className="stat-label">Expired Documents</div>
          <div className={`stat-value ${expired.length > 0 ? 'red' : 'green'}`}>{expired.length}</div>
          <div className="stat-sub">{expired.length > 0 ? 'Action needed' : 'All clear'}</div>
        </div>
        <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/documents')}>
          <div className="stat-label">Expiring Within 30d</div>
          <div className={`stat-value ${expiring.length > 0 ? 'amber' : 'green'}`}>{expiring.length}</div>
          <div className="stat-sub">Review soon</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20 }}>

        {/* Alerts */}
        {alerts.length > 0 && (
          <div>
            <div className="section-header">
              <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <IconAlert size={15} /> Compliance Alerts
              </div>
              <button className="btn btn-sm" onClick={() => navigate('/documents')}>View all →</button>
            </div>
            {expired.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Expired — immediate action</div>
                {expired.slice(0, 4).map(a => (
                  <AlertRow key={a.id} alert={a} type="expired" onClick={() => navigate(`/subcontractors/${a.subcontractor_id}`)} />
                ))}
                {expired.length > 4 && <div style={{ fontSize: 12, color: 'var(--text3)', padding: '4px 0' }}>+{expired.length - 4} more</div>}
              </div>
            )}
            {expiring.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Expiring soon</div>
                {expiring.slice(0, 4).map(a => (
                  <AlertRow key={a.id} alert={a} type="expiring" onClick={() => navigate(`/subcontractors/${a.subcontractor_id}`)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* All clear */}
        {alerts.length === 0 && (
          <div style={{ background: 'var(--green-bg)', border: '1px solid var(--green-border)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 32, height: 32, background: 'var(--green)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="14" height="14" fill="#fff" viewBox="0 0 16 16"><path d="M13.485 1.431a1.473 1.473 0 012.284 1.851l-8.56 13.095a1.473 1.473 0 01-2.284.18L1.42 12.87a1.473 1.473 0 012.12-2.05l2.41 2.49 7.535-11.878z"/></svg>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--green)', marginBottom: 2 }}>All documents valid</div>
              <div style={{ fontSize: 13, color: 'var(--green)' }}>No expired or expiring-soon documents.</div>
            </div>
          </div>
        )}

        {/* Compliance scores */}
        {subsWithScores.length > 0 && (
          <div>
            <div className="section-header">
              <div className="section-title">Lowest Compliance</div>
              <button className="btn btn-sm" onClick={() => navigate('/subcontractors')}>View all →</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {subsWithScores.map(s => (
                <div key={s.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => navigate(`/subcontractors/${s.id}`)}>
                  <Avatar name={s.company_name} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{s.company_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{s.score.expired} expired, {s.score.expiring} expiring</div>
                  </div>
                  <ComplianceBadge score={s.score.score} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ComplianceBadge({ score }) {
  const color = score >= 80 ? 'var(--green)' : score >= 50 ? 'var(--amber)' : 'var(--red)'
  const bg = score >= 80 ? 'var(--green-bg)' : score >= 50 ? 'var(--amber-bg)' : 'var(--red-bg)'
  return (
    <div style={{ background: bg, color, fontWeight: 700, fontSize: 13, padding: '4px 10px', borderRadius: 20, flexShrink: 0 }}>
      {score}%
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
        <div style={{ fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{alert.subcontractors?.company_name}</div>
        <div style={{ fontSize: 12, opacity: .8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{DOCUMENT_TYPES[alert.document_type] || alert.document_name}</div>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
        {isExp ? `${Math.abs(days)}d ago` : `${days}d left`}
      </div>
      <IconChevron size={14} />
    </div>
  )
}
