import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCurrency, daysUntilExpiry, DOCUMENT_TYPES, ROLE_PERMISSIONS } from '../lib/utils'
import { Spinner, Avatar, IconPlus } from '../components/ui'
import { useAuth } from '../lib/auth'
import { useAllowedSubIds } from '../lib/access'

// ─────────────────────────────────────────────────────────────────────────────
// Home — "what needs me today": live projects with their programme position,
// compliance that needs action, and the tender pipeline. Count-only queries
// where only a number is shown.
// ─────────────────────────────────────────────────────────────────────────────

function programmePct(start, end) {
  if (!start || !end) return null
  const s = new Date(start).getTime(), e = new Date(end).getTime(), now = Date.now()
  if (!(e > s)) return null
  return Math.max(0, Math.min(100, Math.round((now - s) / (e - s) * 100)))
}
function weeksLeft(end) {
  if (!end) return null
  const w = Math.round((new Date(end).getTime() - Date.now()) / (7 * 864e5))
  return w
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const navigate = useNavigate()
  const { profile, can, division, canAccessProject } = useAuth()
  // Same visibility rules as the menu: each section only shows for roles
  // that can open the page behind it; money only with view_project_value.
  const nav = (ROLE_PERMISSIONS[profile?.role] || ROLE_PERMISSIONS.viewer).nav
  const seeSubs = nav.includes('subcontractors')
  const seeCompliance = nav.includes('documents')

  const allowedSubs = useAllowedSubIds()   // site managers: only subs on their projects
  useEffect(() => { if (allowedSubs !== undefined) load() }, [division, allowedSubs])

  async function load() {
    // select('*') — never fails because a column is missing on one database
    const [projRes, docsRes, subsCount, subsActive, clientRes] = await Promise.all([
      supabase.from('projects').select('*').eq('division', division).order('project_ref', { ascending: false }),
      supabase.from('documents_with_status').select('id, document_name, document_type, expiry_date, status, subcontractor_id, subcontractors(company_name, trade)').in('status', ['expired', 'expiring_soon']).order('expiry_date'),
      allowedSubs ? supabase.from('subcontractors').select('id, status').in('id', [...allowedSubs]) : supabase.from('subcontractors').select('id', { count: 'exact', head: true }),
      allowedSubs ? Promise.resolve(null) : supabase.from('subcontractors').select('id', { count: 'exact', head: true }).in('status', ['active', 'approved']),
      supabase.from('clients').select('id, name'),
    ])
    const clientName = Object.fromEntries((clientRes?.data || []).map(c => [c.id, c.name]))
    for (const [n, r] of [['projects', projRes], ['docs', docsRes]]) if (r?.error) console.error('[Dashboard] ' + n, r.error)
    const projects = (projRes.data || []).filter(p => canAccessProject(p.id)).map(p => ({ ...p, client_name: p.client_name || clientName[p.client_id] || '' }))
    const mine = allowedSubs ? (subsCount.data || []) : null
    setData({ projects, alerts: docsRes.data || [],
      subsTotal: mine ? mine.length : (subsCount.count || 0),
      subsActive: mine ? mine.filter(s => ['active', 'approved'].includes(s.status)).length : (subsActive.count || 0) })
  }

  if (!data) return <Spinner />
  const { projects, alerts, subsTotal, subsActive } = data
  const live = projects.filter(p => p.status === 'active')
  const tender = projects.filter(p => p.status === 'tender')
  const expired = alerts.filter(a => a.status === 'expired')
  const expiring = alerts.filter(a => a.status === 'expiring_soon')
  const showValue = can('view_project_value')
  const liveValue = live.reduce((n, p) => n + (Number(p.value) || 0), 0)
  const tenderValue = tender.reduce((n, p) => n + (Number(p.value) || 0), 0)
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="home">
      <div className="home-head">
        <div>
          <h2>{greeting}{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}</h2>
          <p>{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="home-actions">
          {can('manage_subcontractors') && <button className="btn" onClick={() => navigate('/subcontractors')}><IconPlus size={13} /> Subcontractor</button>}
          {can('manage_projects') && <button className="btn btn-primary" onClick={() => navigate('/projects')}><IconPlus size={13} /> New project</button>}
        </div>
      </div>

      <div className={`home-kpis${[seeSubs, seeCompliance].filter(Boolean).length < 2 ? ' few' : ''}`}>
        <button className="home-kpi" onClick={() => navigate('/projects')}>
          <span className="home-kpi-label">Live projects</span>
          <span className="home-kpi-value">{live.length}</span>
          <span className="home-kpi-sub">{showValue && liveValue ? formatCurrency(liveValue) + ' in contract' : `${projects.length} in total`}</span>
        </button>
        <button className="home-kpi" onClick={() => navigate('/projects')}>
          <span className="home-kpi-label">Tenders</span>
          <span className="home-kpi-value">{tender.length}</span>
          <span className="home-kpi-sub">{showValue && tenderValue ? formatCurrency(tenderValue) + ' pipeline' : 'in the pipeline'}</span>
        </button>
        {seeSubs && <button className="home-kpi" onClick={() => navigate('/subcontractors')}>
          <span className="home-kpi-label">Subcontractors</span>
          <span className="home-kpi-value">{subsActive}</span>
          <span className="home-kpi-sub">active of {subsTotal}</span>
        </button>}
        {seeCompliance && <button className={`home-kpi${expired.length ? ' bad' : expiring.length ? ' warn' : ''}`} onClick={() => navigate('/subcontractors/compliance')}>
          <span className="home-kpi-label">Compliance</span>
          <span className="home-kpi-value">{expired.length + expiring.length}</span>
          <span className="home-kpi-sub">{expired.length} expired · {expiring.length} expiring</span>
        </button>}
      </div>

      <div className="home-grid">
        <section className="card home-card">
          <div className="home-card-head">
            <h3>Live projects</h3>
            <button className="btn btn-sm" onClick={() => navigate('/projects')}>All projects</button>
          </div>
          {live.length === 0 && <div className="empty-state">No live projects.</div>}
          <div className="home-proj-list">
            {live.map(p => {
              const pct = programmePct(p.start_date, p.end_date)
              const wl = weeksLeft(p.end_date)
              return (
                <button key={p.id} className="home-proj" onClick={() => navigate(`/projects/${p.id}`)}>
                  <span className="ref-chip"><span className="ref-lbl">REF</span><span className="ref-num">{p.project_ref || '—'}</span></span>
                  <span className="home-proj-main">
                    <span className="home-proj-name">{p.project_name}</span>
                    <span className="home-proj-meta">{[p.client_name, p.city || p.town].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="home-proj-prog" title={pct != null ? `${pct}% of programme elapsed` : 'No programme dates'}>
                    <span className="home-bar"><span style={{ width: (pct ?? 0) + '%' }} className={wl != null && wl < 0 ? 'over' : ''} /></span>
                    <span className="home-proj-weeks">{wl == null ? 'No end date' : wl < 0 ? `${-wl} wk over` : `${wl} wk left`}</span>
                  </span>
                  {showValue && <span className="home-proj-value">{p.value ? formatCurrency(p.value) : '—'}</span>}
                </button>
              )
            })}
          </div>
        </section>

        <div className="home-side">
          {seeCompliance && <section className="card home-card">
            <div className="home-card-head">
              <h3>Compliance</h3>
              <button className="btn btn-sm" onClick={() => navigate('/subcontractors/compliance')}>View all</button>
            </div>
            {expired.length + expiring.length === 0
              ? <div className="home-ok">All subcontractor documents are in date.</div>
              : (
                <div className="home-alerts">
                  {[...expired, ...expiring].slice(0, 6).map(a => {
                    const d = daysUntilExpiry(a.expiry_date)
                    const isExp = a.status === 'expired'
                    return (
                      <button key={a.id} className={`home-alert ${isExp ? 'bad' : 'warn'}`} onClick={() => navigate(`/subcontractors/${a.subcontractor_id}`)}>
                        <Avatar name={a.subcontractors?.company_name} size="sm" />
                        <span className="home-alert-main">
                          <span className="home-alert-name">{a.subcontractors?.company_name}</span>
                          <span className="home-alert-doc">{a.document_name || DOCUMENT_TYPES[a.document_type] || 'Document'}</span>
                        </span>
                        <span className="home-alert-when">{isExp ? `${Math.abs(d)}d ago` : `${d}d left`}</span>
                      </button>
                    )
                  })}
                </div>
              )}
          </section>}

          <section className="card home-card">
            <div className="home-card-head"><h3>Tenders</h3></div>
            {tender.length === 0 && <div className="home-ok">No tenders in progress.</div>}
            <div className="home-tenders">
              {tender.map(p => (
                <button key={p.id} className="home-tender" onClick={() => navigate(`/projects/${p.id}`)}>
                  <span className="ref-chip"><span className="ref-lbl">REF</span><span className="ref-num">{p.project_ref || '—'}</span></span>
                  <span className="home-tender-name">{p.project_name}</span>
                  {showValue && <span className="home-tender-value">{p.value ? formatCurrency(p.value) : ''}</span>}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
