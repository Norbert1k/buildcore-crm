import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCurrency } from '../lib/utils'
import { Pill, Spinner, EmptyState } from './ui'

// ─────────────────────────────────────────────────────────────────────────────
// ProjectQuotesTab — quotes view scoped to one project.
//
// Renders inside ProjectDetail under activeTab === 'quotes'. Mirrors the
// top-level Quotes page in style but with project-specific summaries and
// a quotes-by-task roll-up that the cross-project view doesn't have.
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

export default function ProjectQuotesTab({ projectId }) {
  const navigate = useNavigate()
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)

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
      setQuotes([])
      setLoading(false)
      return
    }
    setQuotes(data || [])
    setLoading(false)
  }

  // Summary numbers for the project.
  const stats = useMemo(() => {
    const accepted = quotes.filter(q => q.status === 'accepted')
    const pending  = quotes.filter(q => q.status === 'pending')
    const acceptedSum = accepted.reduce((s, q) => s + Number(q.amount || 0), 0)
    const pendingSum  = pending.reduce((s, q) => s + Number(q.amount || 0), 0)

    // Savings vs lowest: for each task where multiple priced quotes exist
    // AND one was accepted, savings = (accepted - lowest of siblings).
    // Negative if the accepted quote wasn't the lowest (i.e. they chose
    // someone more expensive — still useful info).
    const byTask = new Map()
    for (const q of quotes) {
      if (q.amount == null) continue
      if (!byTask.has(q.task_id)) byTask.set(q.task_id, [])
      byTask.get(q.task_id).push(q)
    }
    let savings = 0
    for (const taskQuotes of byTask.values()) {
      if (taskQuotes.length < 2) continue
      const acc = taskQuotes.find(q => q.status === 'accepted')
      if (!acc) continue
      const lowest = taskQuotes.reduce((a, b) => Number(a.amount) <= Number(b.amount) ? a : b)
      // If they picked the lowest, savings vs the AVG of the others —
      // proxy for "what they avoided spending". Otherwise show as a
      // negative number (overpaid).
      if (lowest.id === acc.id) {
        const others = taskQuotes.filter(q => q.id !== acc.id)
        const avgOthers = others.reduce((s, q) => s + Number(q.amount), 0) / others.length
        savings += avgOthers - Number(acc.amount)
      } else {
        savings -= Number(acc.amount) - Number(lowest.amount)
      }
    }

    return {
      acceptedCount: accepted.length,
      acceptedSum,
      pendingCount: pending.length,
      pendingSum,
      savings,
    }
  }, [quotes])

  // Quotes grouped by task for the roll-up view.
  const byTask = useMemo(() => {
    const map = new Map()
    for (const q of quotes) {
      if (!map.has(q.task_id)) {
        map.set(q.task_id, {
          task_id: q.task_id,
          task_title: q.task_title,
          quotes: [],
        })
      }
      map.get(q.task_id).quotes.push(q)
    }
    return Array.from(map.values())
      .sort((a, b) => (b.quotes[0]?.received_date || '').localeCompare(a.quotes[0]?.received_date || ''))
  }, [quotes])

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>

  if (quotes.length === 0) {
    return (
      <EmptyState
        icon="📑"
        title="No quotes on this project yet"
        message="Add quotes from inside any task to see them here. Quotes are tracked per-task and rolled up across the project."
      />
    )
  }

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
        <div className="stat-card" style={{ borderLeftColor: '#448a40' }}>
          <div className="stat-label">Quoted cost (accepted)</div>
          <div className="stat-value" style={{ fontSize: 18 }}>{formatCurrency(stats.acceptedSum)}</div>
          <div className="stat-sub">{stats.acceptedCount} accepted quote{stats.acceptedCount === 1 ? '' : 's'}</div>
        </div>
        <div className="stat-card" style={{ borderLeftColor: '#854f0b' }}>
          <div className="stat-label">Pending decisions</div>
          <div className="stat-value">{stats.pendingCount}</div>
          <div className="stat-sub">{formatCurrency(stats.pendingSum)} to allocate</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Savings vs lowest</div>
          <div className="stat-value" style={{ fontSize: 18, color: stats.savings >= 0 ? 'var(--text)' : '#a32d2d' }}>
            {stats.savings >= 0 ? '' : '−'}{formatCurrency(Math.abs(stats.savings))}
          </div>
          <div className="stat-sub">{stats.savings >= 0 ? 'avoided extra spend' : 'paid above lowest'}</div>
        </div>
      </div>

      {/* Quotes by task — roll-up */}
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Quotes by task</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
        {byTask.map(group => {
          const accepted = group.quotes.find(q => q.status === 'accepted')
          const pending  = group.quotes.filter(q => q.status === 'pending')
          const pillState = accepted ? 'decided' : (pending.length > 0 ? 'pending' : 'closed')
          const pillCls   = pillState === 'decided' ? 'pill-green'
                          : pillState === 'pending' ? 'pill-gray'
                          : 'pill-gray'
          const pillText  = pillState === 'decided' ? 'Decided'
                          : pillState === 'pending' ? 'Pending'
                          : 'Closed'
          // Subtitle: e.g. "3 quotes · accepted Heatech £3,950" or
          // "2 quotes · awaiting decision"
          let subtitle
          if (accepted) {
            subtitle = `${group.quotes.length} quote${group.quotes.length === 1 ? '' : 's'} · accepted ${accepted.vendor_name || accepted.vendor_name_text}`
              + (accepted.amount != null ? ` £${Number(accepted.amount).toLocaleString('en-GB')}` : '')
          } else if (pending.length > 0) {
            subtitle = `${group.quotes.length} quote${group.quotes.length === 1 ? '' : 's'} · awaiting decision`
          } else {
            subtitle = `${group.quotes.length} quote${group.quotes.length === 1 ? '' : 's'}`
          }
          return (
            <div key={group.task_id}
              onClick={() => navigate(`/tasks/${group.task_id}`)}
              style={{
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                padding: '10px 12px', cursor: 'pointer', background: 'var(--surface)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{group.task_title || '(no title)'}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{subtitle}</div>
              </div>
              <Pill cls={pillCls}>{pillText}</Pill>
            </div>
          )
        })}
      </div>

      {/* All quotes — flat list */}
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>All quotes</div>
      <div className="table-wrap">
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface2)', color: 'var(--text2)', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
              <th style={{ padding: '10px 12px', fontWeight: 600 }}>Task</th>
              <th style={{ padding: '10px 12px', fontWeight: 600 }}>Vendor</th>
              <th style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'right' }}>Amount</th>
              <th style={{ padding: '10px 12px', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '10px 12px', fontWeight: 600 }}>Received</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map(q => (
              <tr key={q.id}
                onClick={() => navigate(`/tasks/${q.task_id}`)}
                style={{ cursor: 'pointer', borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 12px', fontSize: 12 }}>{q.task_title || '—'}</td>
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
    </div>
  )
}
