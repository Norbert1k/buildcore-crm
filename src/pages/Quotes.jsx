import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { formatCurrency } from '../lib/utils'
import { Pill, Spinner, EmptyState } from '../components/ui'
import QuoteDetailDrawer from '../components/QuoteDetailDrawer'

// ─────────────────────────────────────────────────────────────────────────────
// Quotes page — cross-project quote index, grouped by TASK.
//
// One row per task (not per quote). The "decision" is the unit of
// interest: did we accept a quote yet, or are we still deciding?
//
// Reads from task_quotes_full and aggregates client-side. Click a row →
// QuoteDetailDrawer slides in with the full breakdown + documents.
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

// Compute the task-level decision status from its quotes:
//   - any accepted              → decided
//   - any pending               → pending
//   - all rejected/expired      → closed
function deriveTaskStatus(quotes) {
  if (quotes.some(q => q.status === 'accepted')) return 'decided'
  if (quotes.some(q => q.status === 'pending'))  return 'pending'
  return 'closed'
}

export default function Quotes() {
  const [rows, setRows] = useState([])           // raw quote rows from view
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [drawerTaskId, setDrawerTaskId] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('task_quotes_full')
      .select('*')
      .order('received_date', { ascending: false, nullsLast: true })
    if (error) {
      console.warn('[Quotes] load error', error)
      setRows([])
      setLoading(false)
      return
    }
    setRows(data || [])
    setLoading(false)
  }

  // Group quote rows by task_id.
  const taskGroups = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      if (!map.has(r.task_id)) {
        map.set(r.task_id, {
          task_id:      r.task_id,
          task_title:   r.task_title,
          project_id:   r.project_id,
          project_name: r.project_name,
          project_ref:  r.project_ref,
          quotes:       [],
          latest_received: null,
        })
      }
      const g = map.get(r.task_id)
      g.quotes.push(r)
      // Track latest received date for sort.
      if (r.received_date && (!g.latest_received || r.received_date > g.latest_received)) {
        g.latest_received = r.received_date
      }
    }
    // Sort groups by latest received DESC (nullsLast).
    return Array.from(map.values()).sort((a, b) => {
      if (!a.latest_received && !b.latest_received) return 0
      if (!a.latest_received) return 1
      if (!b.latest_received) return -1
      return b.latest_received.localeCompare(a.latest_received)
    })
  }, [rows])

  // Apply filters to grouped tasks.
  const filtered = useMemo(() => {
    let list = taskGroups
    if (projectFilter !== 'all') list = list.filter(g => g.project_id === projectFilter)
    if (statusFilter !== 'all') {
      list = list.filter(g => deriveTaskStatus(g.quotes) === statusFilter)
    }
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(g =>
        (g.task_title || '').toLowerCase().includes(s)
        || (g.project_name || '').toLowerCase().includes(s)
        || (g.project_ref || '').toLowerCase().includes(s)
        || g.quotes.some(q => (q.vendor_name || q.vendor_name_text || '').toLowerCase().includes(s))
      )
    }
    return list
  }, [taskGroups, projectFilter, statusFilter, search])

  // Per-project breakdown for the top table. Each project row shows
  // pending count, decided count, committed total (sum of accepted
  // amounts), and pending total (sum of pending amounts). Plus a
  // totals row at the bottom.
  const projectStats = useMemo(() => {
    // Bucket tasks by project_id.
    const byProject = new Map()
    for (const g of taskGroups) {
      if (!byProject.has(g.project_id)) {
        byProject.set(g.project_id, {
          project_id:   g.project_id,
          project_name: g.project_name || '(unnamed)',
          project_ref:  g.project_ref,
          taskGroups:   [],
        })
      }
      byProject.get(g.project_id).taskGroups.push(g)
    }
    // Compute counts/sums per project.
    const rowsOut = []
    for (const p of byProject.values()) {
      let pending = 0, decided = 0
      let committedSum = 0, pendingSum = 0
      for (const g of p.taskGroups) {
        const s = deriveTaskStatus(g.quotes)
        if (s === 'pending') {
          pending++
          const pendingAmounts = g.quotes.filter(q => q.status === 'pending' && q.amount != null)
          pendingSum += pendingAmounts.reduce((sum, q) => sum + Number(q.amount), 0)
        } else if (s === 'decided') {
          decided++
          const accepted = g.quotes.find(q => q.status === 'accepted')
          if (accepted?.amount != null) committedSum += Number(accepted.amount)
        }
      }
      rowsOut.push({
        ...p,
        pending, decided, committedSum, pendingSum,
        color: colorForString(p.project_name),
      })
    }
    rowsOut.sort((a, b) => (a.project_name || '').localeCompare(b.project_name || ''))
    // Totals.
    const totals = rowsOut.reduce((t, r) => ({
      pending: t.pending + r.pending,
      decided: t.decided + r.decided,
      committedSum: t.committedSum + r.committedSum,
      pendingSum: t.pendingSum + r.pendingSum,
    }), { pending: 0, decided: 0, committedSum: 0, pendingSum: 0 })
    return { rows: rowsOut, totals }
  }, [taskGroups])

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner /></div>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Quotes</h2>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 2 }}>
            {taskGroups.length} task{taskGroups.length === 1 ? '' : 's'} with quotes · {rows.length} quote{rows.length === 1 ? '' : 's'} total
          </p>
        </div>
      </div>

      {/* Projects breakdown — replaces the 4 summary cards.
          Click a project row to filter the task list below.
          Click the same row again (or "Total") to clear. */}
      {projectStats.rows.length > 0 && (
        <div style={{
          background: 'var(--surface2)',
          borderRadius: 'var(--radius-lg)',
          padding: '4px 0',
          marginBottom: 20,
          overflow: 'hidden',
        }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--text3)', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                <th style={{ padding: '10px 16px', fontWeight: 600 }}>Project</th>
                <th style={{ padding: '10px', fontWeight: 600, textAlign: 'right' }}>Pending</th>
                <th style={{ padding: '10px', fontWeight: 600, textAlign: 'right' }}>Decided</th>
                <th style={{ padding: '10px', fontWeight: 600, textAlign: 'right' }}>Committed</th>
                <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>On the table</th>
              </tr>
            </thead>
            <tbody>
              {projectStats.rows.map(r => {
                const isActive = projectFilter === r.project_id
                return (
                  <tr key={r.project_id}
                    onClick={() => setProjectFilter(isActive ? 'all' : r.project_id)}
                    style={{
                      borderTop: '1px solid var(--border)',
                      cursor: 'pointer',
                      background: isActive ? 'var(--surface)' : 'transparent',
                    }}>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{ display: 'inline-block', width: 3, height: 16, background: r.color, verticalAlign: 'middle', marginRight: 8 }} />
                      <span style={{ fontWeight: isActive ? 600 : 400 }}>{r.project_name}</span>
                      {r.project_ref && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text3)' }}>{r.project_ref}</span>}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right', color: r.pending > 0 ? '#BA7517' : 'var(--text3)', fontWeight: r.pending > 0 ? 600 : 400, fontVariantNumeric: 'tabular-nums' }}>
                      {r.pending}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right', color: r.decided > 0 ? 'var(--text)' : 'var(--text3)', fontVariantNumeric: 'tabular-nums' }}>
                      {r.decided}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right', color: r.committedSum > 0 ? 'var(--text)' : 'var(--text3)', fontVariantNumeric: 'tabular-nums' }}>
                      {r.committedSum > 0 ? formatCurrency(r.committedSum) : '—'}
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text3)', fontVariantNumeric: 'tabular-nums' }}>
                      {r.pendingSum > 0 ? formatCurrency(r.pendingSum) : '—'}
                    </td>
                  </tr>
                )
              })}
              {projectStats.rows.length > 1 && (
                <tr
                  onClick={() => setProjectFilter('all')}
                  style={{
                    borderTop: '1px solid var(--border)',
                    background: 'rgba(0,0,0,0.02)',
                    cursor: 'pointer',
                  }}>
                  <td style={{ padding: '10px 16px', fontWeight: 600, color: 'var(--text2)', fontSize: 11 }}>Total</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{projectStats.totals.pending}</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{projectStats.totals.decided}</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(projectStats.totals.committedSum)}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(projectStats.totals.pendingSum)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', fontSize: 13 }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search task, project, vendor..." style={{ paddingLeft: 30, width: 280 }} />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 'auto', minWidth: 130 }}>
          <option value="all">All statuses</option>
          <option value="pending">Pending decision</option>
          <option value="decided">Decided</option>
          <option value="closed">Closed</option>
        </select>
        {projectFilter !== 'all' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)' }}>
            <span>Filtered to {projectStats.rows.find(r => r.project_id === projectFilter)?.project_name || 'project'}</span>
            <button
              type="button"
              onClick={() => setProjectFilter('all')}
              className="btn btn-sm"
              style={{ padding: '2px 8px', fontSize: 11 }}>
              Clear
            </button>
          </div>
        )}
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
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Quotes</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Status</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'right' }}>Decision</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Latest</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(g => {
                const status = deriveTaskStatus(g.quotes)
                const accepted = g.quotes.find(q => q.status === 'accepted')
                return (
                  <tr key={g.task_id}
                    onClick={() => setDrawerTaskId(g.task_id)}
                    style={{ cursor: 'pointer', borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {g.project_ref ? `${g.project_ref} · ` : ''}{g.project_name || '—'}
                      </div>
                      <div style={{ fontWeight: 500 }}>{g.task_title || '(no title)'}</div>
                    </td>
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
      )}

      {drawerTaskId && (
        <QuoteDetailDrawer
          taskId={drawerTaskId}
          onClose={() => setDrawerTaskId(null)}
        />
      )}
    </div>
  )
}

// Small palette of stripe colors for project rows. Hash the project
// name → pick from this list deterministically. Same project always
// gets the same color across reloads.
const STRIPE_COLORS = ['#185FA5', '#3B6D11', '#534AB7', '#0F6E56', '#BA7517', '#993C1D', '#D4537E']
function colorForString(str) {
  if (!str) return STRIPE_COLORS[0]
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return STRIPE_COLORS[Math.abs(hash) % STRIPE_COLORS.length]
}
