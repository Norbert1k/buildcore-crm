import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { formatCurrency } from '../lib/utils'
import { Pill, Spinner, EmptyState } from './ui'
import QuoteDetailDrawer from './QuoteDetailDrawer'

// ─────────────────────────────────────────────────────────────────────────────
// ProjectQuotesTab — quotes view scoped to one project.
//
// Same task-grouped pattern as the top-level Quotes page, but limited
// to one project. Click a row → drawer with quotes + documents.
// ─────────────────────────────────────────────────────────────────────────────

const TASK_STATUS_PILL = {
  decided: 'pill-green',
  pending: 'pill-amber',
  closed:  'pill-gray',
}
const TASK_STATUS_LABEL = {
  decided: 'Decided',
  pending: 'Pending',
  closed:  'Closed',
}

function deriveTaskStatus(quotes) {
  if (quotes.some(q => q.status === 'accepted')) return 'decided'
  if (quotes.some(q => q.status === 'pending'))  return 'pending'
  return 'closed'
}

export default function ProjectQuotesTab({ projectId }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [drawerTaskId, setDrawerTaskId] = useState(null)

  useEffect(() => {
    if (!projectId) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('task_quotes_full')
      .select('*')
      .eq('project_id', projectId)
      .order('received_date', { ascending: false, nullsLast: true })
    if (error) {
      console.warn('[ProjectQuotesTab] load error', error)
      setRows([])
      setLoading(false)
      return
    }
    setRows(data || [])
    setLoading(false)
  }

  // Group by task.
  const taskGroups = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      if (!map.has(r.task_id)) {
        map.set(r.task_id, {
          task_id:    r.task_id,
          task_title: r.task_title,
          quotes:     [],
          latest_received: null,
        })
      }
      const g = map.get(r.task_id)
      g.quotes.push(r)
      if (r.received_date && (!g.latest_received || r.received_date > g.latest_received)) {
        g.latest_received = r.received_date
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (!a.latest_received && !b.latest_received) return 0
      if (!a.latest_received) return 1
      if (!b.latest_received) return -1
      return b.latest_received.localeCompare(a.latest_received)
    })
  }, [rows])

  // Project-scoped stats.
  const stats = useMemo(() => {
    let pending = 0, decided = 0, committedSum = 0, pendingSum = 0

    // Savings vs lowest: for each task with 2+ priced quotes AND an
    // accepted, sum the difference between accepted and lowest (or avg
    // of others if accepted IS the lowest — proxy for "what they
    // avoided spending").
    let savings = 0

    for (const g of taskGroups) {
      const s = deriveTaskStatus(g.quotes)
      if (s === 'pending') {
        pending++
        const pendingAmounts = g.quotes.filter(q => q.status === 'pending' && q.amount != null)
        pendingSum += pendingAmounts.reduce((sum, q) => sum + Number(q.amount), 0)
      } else if (s === 'decided') {
        decided++
        const accepted = g.quotes.find(q => q.status === 'accepted')
        if (accepted?.amount != null) committedSum += Number(accepted.amount)

        const pricedQs = g.quotes.filter(q => q.amount != null && q.amount > 0)
        if (pricedQs.length >= 2 && accepted?.amount != null) {
          const lowest = pricedQs.reduce((a, b) => Number(a.amount) <= Number(b.amount) ? a : b)
          if (lowest.id === accepted.id) {
            const others = pricedQs.filter(q => q.id !== accepted.id)
            const avgOthers = others.reduce((sum, q) => sum + Number(q.amount), 0) / others.length
            savings += avgOthers - Number(accepted.amount)
          } else {
            savings -= Number(accepted.amount) - Number(lowest.amount)
          }
        }
      }
    }
    return { pending, pendingSum, decided, committedSum, savings }
  }, [taskGroups])

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>

  if (taskGroups.length === 0) {
    return (
      <EmptyState
        icon="📑"
        title="No quotes on this project yet"
        message="Add quotes from inside any task to see them here. Quotes are tracked per task and rolled up across the project."
      />
    )
  }

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
        <div className="stat-card" style={{ borderLeftColor: '#448a40' }}>
          <div className="stat-label">Quoted cost (accepted)</div>
          <div className="stat-value" style={{ fontSize: 18 }}>{formatCurrency(stats.committedSum)}</div>
          <div className="stat-sub">{stats.decided} decided task{stats.decided === 1 ? '' : 's'}</div>
        </div>
        <div className="stat-card" style={{ borderLeftColor: '#854f0b' }}>
          <div className="stat-label">Pending decisions</div>
          <div className="stat-value">{stats.pending}</div>
          <div className="stat-sub">{formatCurrency(stats.pendingSum)} on the table</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Savings vs lowest</div>
          <div className="stat-value" style={{ fontSize: 18, color: stats.savings >= 0 ? 'var(--text)' : '#a32d2d' }}>
            {stats.savings >= 0 ? '' : '−'}{formatCurrency(Math.abs(stats.savings))}
          </div>
          <div className="stat-sub">{stats.savings >= 0 ? 'avoided extra spend' : 'paid above lowest'}</div>
        </div>
      </div>

      {/* Task-grouped table */}
      <div className="table-wrap">
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface2)', color: 'var(--text2)', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
              <th style={{ padding: '10px 12px', fontWeight: 600 }}>Task</th>
              <th style={{ padding: '10px 12px', fontWeight: 600 }}>Quotes</th>
              <th style={{ padding: '10px 12px', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'right' }}>Decision</th>
              <th style={{ padding: '10px 12px', fontWeight: 600 }}>Latest</th>
            </tr>
          </thead>
          <tbody>
            {taskGroups.map(g => {
              const status = deriveTaskStatus(g.quotes)
              const accepted = g.quotes.find(q => q.status === 'accepted')
              return (
                <tr key={g.task_id}
                  onClick={() => setDrawerTaskId(g.task_id)}
                  style={{ cursor: 'pointer', borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>{g.task_title || '(no title)'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    {g.quotes.length} quote{g.quotes.length === 1 ? '' : 's'}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <Pill cls={TASK_STATUS_PILL[status]}>{TASK_STATUS_LABEL[status]}</Pill>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {accepted ? (
                      <span>
                        {accepted.amount != null
                          ? `£${Number(accepted.amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : '—'}
                        <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 400 }}>{accepted.vendor_name || accepted.vendor_name_text}</div>
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text3)' }}>{status === 'pending' ? 'awaiting' : '—'}</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--text2)', fontSize: 12 }}>
                    {g.latest_received
                      ? new Date(g.latest_received).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                      : <span style={{ color: 'var(--text3)' }}>—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {drawerTaskId && (
        <QuoteDetailDrawer
          taskId={drawerTaskId}
          onClose={() => setDrawerTaskId(null)}
        />
      )}
    </div>
  )
}
