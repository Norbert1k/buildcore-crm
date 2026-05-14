import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCurrency } from '../lib/utils'
import { Pill, Spinner, EmptyState } from '../components/ui'

// ─────────────────────────────────────────────────────────────────────────────
// Quotes page — cross-project quote index.
//
// Reads from the task_quotes_full SQL view which denormalises:
//   task_quotes + tasks + projects + suppliers + subcontractors + profiles
//
// One row per quote. Row click → navigates to the parent task so the user
// can edit / accept / reject from there. The page is read-only — all
// quote management still happens inside TaskDetail.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  pending:  'Pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
  expired:  'Expired',
}
const STATUS_PILL = {
  pending:  'pill-gray',
  accepted: 'pill-green',
  rejected: 'pill-red',
  expired:  'pill-gray',
}
const KIND_LABEL = {
  supplier:      'Supplier',
  subcontractor: 'Subcontractor',
  design_team:   'Design Team',
  freetext:      'Other',
}

export default function Quotes() {
  const navigate = useNavigate()
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('task_quotes_full')
      .select('*')
      .order('received_date', { ascending: false, nullsLast: true })
    if (error) {
      console.warn('[Quotes] load error', error)
      setQuotes([])
      setLoading(false)
      return
    }
    setQuotes(data || [])
    setLoading(false)
  }

  // Distinct project list for the filter dropdown.
  const projectOptions = useMemo(() => {
    const map = new Map()
    for (const q of quotes) {
      if (q.project_id && !map.has(q.project_id)) {
        map.set(q.project_id, q.project_name || '(unnamed)')
      }
    }
    return Array.from(map, ([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [quotes])

  // Filtered list shown in the table.
  const filtered = useMemo(() => {
    let list = quotes
    if (projectFilter !== 'all') list = list.filter(q => q.project_id === projectFilter)
    if (statusFilter !== 'all')  list = list.filter(q => q.status === statusFilter)
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(q =>
        (q.vendor_name || '').toLowerCase().includes(s)
        || (q.task_title || '').toLowerCase().includes(s)
        || (q.project_name || '').toLowerCase().includes(s)
        || (q.project_ref || '').toLowerCase().includes(s)
      )
    }
    return list
  }, [quotes, projectFilter, statusFilter, search])

  // Stat numbers — compute from the full unfiltered list so the cards
  // always reflect the database, not the current view.
  const stats = useMemo(() => {
    const byStatus = { pending: [], accepted: [], rejected: [], expired: [] }
    for (const q of quotes) (byStatus[q.status] ||= []).push(q)
    const sumOf = (arr) => arr.reduce((s, q) => s + Number(q.amount || 0), 0)
    // 7 days back
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const thisWeek = quotes.filter(q => q.received_date && q.received_date >= weekAgo)
    return {
      pending:  { count: byStatus.pending.length,  sum: sumOf(byStatus.pending) },
      accepted: { count: byStatus.accepted.length, sum: sumOf(byStatus.accepted) },
      rejected: { count: byStatus.rejected.length, sum: sumOf(byStatus.rejected) },
      thisWeek: { count: thisWeek.length },
    }
  }, [quotes])

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner /></div>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Quotes</h2>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 2 }}>
            {quotes.length} quote{quotes.length === 1 ? '' : 's'} across all projects
          </p>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-label">Pending</div>
          <div className="stat-value">{stats.pending.count}</div>
          <div className="stat-sub">{formatCurrency(stats.pending.sum)} total</div>
        </div>
        <div className="stat-card" style={{ borderLeftColor: '#448a40' }}>
          <div className="stat-label">Accepted</div>
          <div className="stat-value">{stats.accepted.count}</div>
          <div className="stat-sub">{formatCurrency(stats.accepted.sum)} committed</div>
        </div>
        <div className="stat-card" style={{ borderLeftColor: '#a32d2d' }}>
          <div className="stat-label">Rejected</div>
          <div className="stat-value">{stats.rejected.count}</div>
          <div className="stat-sub">{formatCurrency(stats.rejected.sum)} declined</div>
        </div>
        <div className="stat-card" style={{ borderLeftColor: '#185fa5' }}>
          <div className="stat-label">Last 7 days</div>
          <div className="stat-value">{stats.thisWeek.count}</div>
          <div className="stat-sub">new quotes received</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', fontSize: 13 }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vendor, task, project..." style={{ paddingLeft: 30, width: 280 }} />
        </div>
        <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
          <option value="all">All projects</option>
          {projectOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 'auto', minWidth: 130 }}>
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          icon="📑"
          title="No quotes found"
          message={search || projectFilter !== 'all' || statusFilter !== 'all'
            ? 'Try adjusting your filters.'
            : 'Add quotes from inside any task to see them here.'}
        />
      ) : (
        <div className="table-wrap">
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface2)', color: 'var(--text2)', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Project / Task</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Vendor</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'right' }}>Amount</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Status</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Received</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(q => (
                <tr key={q.id}
                  onClick={() => navigate(`/tasks/${q.task_id}`)}
                  style={{ cursor: 'pointer', borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                      {q.project_ref ? `${q.project_ref} · ` : ''}{q.project_name || '—'}
                    </div>
                    <div style={{ fontWeight: 500 }}>{q.task_title || '(no title)'}</div>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div>{q.vendor_name || q.vendor_name_text}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                      {KIND_LABEL[q.vendor_kind] || ''}
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {q.amount != null
                      ? `${q.currency === 'GBP' ? '£' : (q.currency + ' ')}${Number(q.amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : <span style={{ color: 'var(--text3)' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <Pill cls={STATUS_PILL[q.status] || 'pill-gray'}>
                      {STATUS_LABELS[q.status] || q.status}
                    </Pill>
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--text2)', fontSize: 12 }}>
                    {q.received_date
                      ? new Date(q.received_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                      : <span style={{ color: 'var(--text3)' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
