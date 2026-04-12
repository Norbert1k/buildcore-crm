import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCurrency } from '../lib/utils'
import { Spinner, IconChevron } from '../components/ui'
import { useAuth } from '../lib/auth'

const STATUS_COLORS = {
  active:    { bar: '#448a40', text: '#fff', label: 'Active' },
  tender:    { bar: '#378ADD', text: '#fff', label: 'Tender' },
  on_hold:   { bar: '#BA7517', text: '#fff', label: 'On Hold' },
  completed: { bar: '#888780', text: '#fff', label: 'Completed' },
  cancelled: { bar: '#E24B4A', text: '#fff', label: 'Cancelled' },
}

function addMonths(d, n) {
  const r = new Date(d)
  r.setMonth(r.getMonth() + n)
  return r
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function daysBetween(a, b) {
  return (new Date(b) - new Date(a)) / 86400000
}

export default function ProjectCalendar() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewStart, setViewStart] = useState(() => startOfMonth(addMonths(new Date(), -2)))
  const [monthsShown] = useState(12)
  const [tooltip, setTooltip] = useState(null)
  const [filterStatus, setFilterStatus] = useState('all')
  const [hoveredId, setHoveredId] = useState(null)
  const ganttRef = useRef(null)
  const navigate = useNavigate()
  const { can } = useAuth()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('projects')
      .select('id, project_name, project_ref, start_date, end_date, status, value, client_name')
      .not('start_date', 'is', null)
      .not('end_date', 'is', null)
      .order('start_date', { ascending: true })
    setProjects(data || [])
    setLoading(false)
  }

  const viewEnd = addMonths(viewStart, monthsShown)
  const totalDays = daysBetween(viewStart, viewEnd)
  const today = new Date()

  const filtered = filterStatus === 'all'
    ? projects
    : projects.filter(p => p.status === filterStatus)

  // Visible projects (overlap with view window)
  const visible = filtered.filter(p => {
    const ps = new Date(p.start_date)
    const pe = new Date(p.end_date)
    return pe >= viewStart && ps <= viewEnd
  })

  // Monthly workload
  const monthlyLoad = []
  for (let m = 0; m < monthsShown; m++) {
    const ms = new Date(viewStart.getFullYear(), viewStart.getMonth() + m, 1)
    const me = addMonths(ms, 1)
    const active = projects.filter(p => {
      if (!['active', 'tender'].includes(p.status)) return false
      const ps = new Date(p.start_date), pe = new Date(p.end_date)
      return ps < me && pe > ms
    })
    const value = active.reduce((s, p) => s + (parseFloat(p.value) || 0), 0)
    monthlyLoad.push({ date: ms, count: active.length, value })
  }
  const maxCount = Math.max(...monthlyLoad.map(m => m.count), 1)

  const LABEL_W = 200

  function getBarStyle(p, containerWidth) {
    const dayW = containerWidth / totalDays
    const ps = new Date(p.start_date)
    const pe = new Date(p.end_date)
    const clampS = ps < viewStart ? viewStart : ps
    const clampE = pe > viewEnd ? viewEnd : pe
    const left = daysBetween(viewStart, clampS) * dayW
    const width = Math.max(daysBetween(clampS, clampE) * dayW, 3)
    return { left, width }
  }

  const rangeLabel =
    viewStart.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) + ' – ' +
    new Date(viewEnd - 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

  if (loading) return <Spinner />

  return (
    <div style={{ fontFamily: 'var(--font, inherit)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-sm" onClick={() => navigate('/projects')}>
            <IconChevron size={13} dir="left" /> Back to Projects
          </button>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>Project Calendar</h2>
            <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 2 }}>{projects.length} projects · showing {visible.length}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Status filter */}
          {['all', 'active', 'tender', 'on_hold', 'completed'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`btn btn-sm ${filterStatus === s ? 'btn-primary' : ''}`}
              style={{ fontSize: 11 }}>
              {s === 'all' ? 'All' : STATUS_COLORS[s]?.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {Object.entries(STATUS_COLORS).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text2)' }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: v.bar }} />
            {v.label}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text2)' }}>
          <div style={{ width: 2, height: 14, background: '#E24B4A', borderRadius: 1 }} />
          Today
        </div>
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <button className="btn btn-sm" onClick={() => setViewStart(v => addMonths(v, -6))}>← 6 months</button>
        <button className="btn btn-sm" onClick={() => setViewStart(startOfMonth(addMonths(new Date(), -2)))}>Today</button>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', minWidth: 180, textAlign: 'center' }}>{rangeLabel}</span>
        <button className="btn btn-sm" onClick={() => setViewStart(v => addMonths(v, 6))}>6 months →</button>
      </div>

      {/* Gantt chart */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        {visible.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            No projects with dates found in this period
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }} ref={ganttRef}>
            <GanttChart
              projects={visible}
              viewStart={viewStart}
              viewEnd={viewEnd}
              totalDays={totalDays}
              monthsShown={monthsShown}
              today={today}
              labelWidth={LABEL_W}
              hoveredId={hoveredId}
              setHoveredId={setHoveredId}
              onProjectClick={id => navigate(`/projects/${id}`)}
              setTooltip={setTooltip}
            />
          </div>
        )}
      </div>

      {/* Workload chart */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>
          Monthly workload — active &amp; tender projects
        </div>
        <WorkloadChart monthlyLoad={monthlyLoad} maxCount={maxCount} monthsShown={monthsShown} showValues={can('view_project_value')} />
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 10,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 12,
          zIndex: 1000, pointerEvents: 'none', maxWidth: 260,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{tooltip.name}</div>
          {tooltip.ref && <div style={{ color: 'var(--text3)', marginBottom: 4 }}>Ref: {tooltip.ref}</div>}
          {tooltip.client && <div style={{ color: 'var(--text2)', marginBottom: 4 }}>Client: {tooltip.client}</div>}
          <div style={{ color: 'var(--text2)', marginBottom: tooltip.value ? 4 : 0 }}>
            {new Date(tooltip.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} –{' '}
            {new Date(tooltip.end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
          {tooltip.value && can('view_project_value') && <div style={{ color: 'var(--green)', fontWeight: 600 }}>{formatCurrency(tooltip.value)}</div>}
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text3)' }}>Click to open project →</div>
        </div>
      )}
    </div>
  )
}

function GanttChart({ projects, viewStart, viewEnd, totalDays, monthsShown, today, labelWidth, hoveredId, setHoveredId, onProjectClick, setTooltip }) {
  const [width, setWidth] = useState(700)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width
      if (w > 0) setWidth(Math.max(w - labelWidth, 300))
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [labelWidth])

  const dayW = width / totalDays
  const ROW_H = 44

  // Month headers
  const months = []
  let cur = new Date(viewStart.getFullYear(), viewStart.getMonth(), 1)
  while (cur < viewEnd) {
    const next = addMonths(cur, 1)
    const clampS = cur < viewStart ? viewStart : cur
    const clampE = next > viewEnd ? viewEnd : next
    const w = daysBetween(clampS, clampE) * dayW
    months.push({ date: new Date(cur), left: daysBetween(viewStart, clampS) * dayW, width: w })
    cur = next
  }

  // Today line
  const todayLeft = today >= viewStart && today <= viewEnd
    ? daysBetween(viewStart, today) * dayW
    : null

  return (
    <div ref={containerRef} style={{ display: 'flex', minWidth: labelWidth + 300 }}>
      {/* Label column */}
      <div style={{ width: labelWidth, flexShrink: 0, borderRight: '1px solid var(--border)' }}>
        <div style={{ height: 36, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 14px' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)' }}>PROJECT</span>
        </div>
        {projects.map(p => (
          <div key={p.id}
            onClick={() => onProjectClick(p.id)}
            style={{
              height: ROW_H, borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', padding: '0 14px',
              cursor: 'pointer', background: hoveredId === p.id ? 'var(--surface2)' : 'transparent',
              transition: 'background 0.1s'
            }}
            onMouseEnter={() => setHoveredId(p.id)}
            onMouseLeave={() => setHoveredId(null)}>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text)' }}>{p.project_name}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>{p.client_name || p.project_ref || ''}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Grid area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Month headers */}
        <div style={{ height: 36, borderBottom: '1px solid var(--border)', display: 'flex', position: 'relative' }}>
          {months.map((m, i) => (
            <div key={i} style={{
              position: 'absolute', left: m.left, width: m.width,
              height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 500, color: 'var(--text3)',
              borderRight: '1px solid var(--border)'
            }}>
              {m.width > 30 ? m.date.toLocaleDateString('en-GB', { month: 'short', year: m.date.getMonth() === 0 ? 'numeric' : undefined }) : ''}
            </div>
          ))}
        </div>

        {/* Rows */}
        {projects.map(p => {
          const ps = new Date(p.start_date)
          const pe = new Date(p.end_date)
          const clampS = ps < viewStart ? viewStart : ps
          const clampE = pe > viewEnd ? viewEnd : pe
          const left = daysBetween(viewStart, clampS) * dayW
          const barW = Math.max(daysBetween(clampS, clampE) * dayW, 4)
          const color = STATUS_COLORS[p.status]?.bar || '#888'
          const truncated = ps < viewStart
          const truncatedEnd = pe > viewEnd

          return (
            <div key={p.id} style={{
              height: ROW_H, borderBottom: '1px solid var(--border)',
              position: 'relative', background: hoveredId === p.id ? 'var(--surface2)' : 'transparent',
              transition: 'background 0.1s'
            }}
              onMouseEnter={() => setHoveredId(p.id)}
              onMouseLeave={() => { setHoveredId(null); setTooltip(null) }}>

              {/* Month stripes */}
              {months.map((m, i) => (
                <div key={i} style={{
                  position: 'absolute', left: m.left, width: m.width, top: 0, bottom: 0,
                  background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.02)',
                  borderRight: '1px solid var(--border)'
                }} />
              ))}

              {/* Bar */}
              <div
                onClick={() => onProjectClick(p.id)}
                onMouseMove={e => setTooltip({ x: e.clientX, y: e.clientY, name: p.project_name, ref: p.project_ref, client: p.client_name, start: p.start_date, end: p.end_date, value: p.value })}
                onMouseLeave={() => setTooltip(null)}
                style={{
                  position: 'absolute', left, top: 8, width: barW, height: 28,
                  background: color, borderRadius: truncated ? '0 4px 4px 0' : truncatedEnd ? '4px 0 0 4px' : 4,
                  display: 'flex', alignItems: 'center', padding: '0 8px',
                  fontSize: 11, fontWeight: 500, color: '#fff',
                  cursor: 'pointer', zIndex: 2,
                  opacity: hoveredId === p.id ? 1 : 0.85,
                  transition: 'opacity 0.1s',
                  overflow: 'hidden', whiteSpace: 'nowrap'
                }}>
                {barW > 80 ? p.project_name : barW > 30 ? p.project_ref || '' : ''}
              </div>

              {/* Today line */}
              {todayLeft !== null && (
                <div style={{
                  position: 'absolute', left: todayLeft, top: 0, bottom: 0,
                  width: 2, background: '#E24B4A', zIndex: 3, pointerEvents: 'none'
                }} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WorkloadChart({ monthlyLoad, maxCount, monthsShown, showValues }) {
  const [containerW, setContainerW] = useState(600)
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    const obs = new ResizeObserver(e => setContainerW(e[0].contentRect.width))
    obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])

  const colW = Math.floor((containerW - 4) / monthsShown)
  const today = new Date()

  return (
    <div ref={ref}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 60 }}>
        {monthlyLoad.map((m, i) => {
          const h = m.count > 0 ? Math.max((m.count / maxCount) * 52, 8) : 2
          const isCurrentMonth = today.getMonth() === m.date.getMonth() && today.getFullYear() === m.date.getFullYear()
          const barColor = m.count >= 5 ? '#E24B4A' : m.count >= 3 ? '#BA7517' : '#448a40'
          return (
            <div key={i} style={{ width: colW, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: 60 }}
              title={`${m.date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}: ${m.count} project${m.count !== 1 ? 's' : ''}${showValues && m.value ? ' · ' + formatCurrency(m.value) : ''}`}>
              {m.count > 0 && (
                <div style={{ fontSize: 9, fontWeight: 700, color: barColor, marginBottom: 2 }}>{m.count}</div>
              )}
              <div style={{
                width: Math.max(colW - 4, 4), height: h,
                background: barColor, borderRadius: '3px 3px 0 0',
                opacity: isCurrentMonth ? 1 : 0.65,
                outline: isCurrentMonth ? `2px solid ${barColor}` : 'none',
                outlineOffset: 1
              }} />
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 2, marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
        {monthlyLoad.map((m, i) => {
          const isCurrentMonth = today.getMonth() === m.date.getMonth() && today.getFullYear() === m.date.getFullYear()
          return (
            <div key={i} style={{
              width: colW, flexShrink: 0, fontSize: 9, textAlign: 'center',
              color: isCurrentMonth ? 'var(--green)' : 'var(--text3)',
              fontWeight: isCurrentMonth ? 700 : 400
            }}>
              {m.date.toLocaleDateString('en-GB', { month: 'short' })}
              {m.date.getMonth() === 0 && (
                <div style={{ fontSize: 8, color: 'var(--text3)' }}>{m.date.getFullYear()}</div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 11, color: 'var(--text3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 10, height: 10, borderRadius: 2, background: '#448a40' }} /> 1–2 projects</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 10, height: 10, borderRadius: 2, background: '#BA7517' }} /> 3–4 projects</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 10, height: 10, borderRadius: 2, background: '#E24B4A' }} /> 5+ projects</div>
      </div>
    </div>
  )
}
