import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCurrency, formatMoney, sortBy } from '../lib/utils'
import { Spinner, EmptyState, Modal, Field, IconPlus } from './ui'
import { useAuth } from '../lib/auth'

// ─────────────────────────────────────────────────────────────────────────────
// Quote requests — one list, four stages.
//
//   Out for pricing → To decide → Awarded → Closed
//
// Used by the Quotes page (all jobs, with job chips) and by a job's
// Commercial › Quotes (projectId set). Same records as before: a request is a
// `tasks` row, its prices are `task_quotes`; `task_quote_invites` (036) adds
// who was asked to price. Every read here tolerates 036 not being run yet.
// ─────────────────────────────────────────────────────────────────────────────

export const STAGES = [
  { key: 'pricing', label: 'Out for pricing', color: '#185FA5' },
  { key: 'decide',  label: 'To decide',       color: '#BA7517' },
  { key: 'awarded', label: 'Awarded',         color: '#428B40' },
  { key: 'closed',  label: 'Closed',          color: '#9AA39B' },
]

const live = q => q.status !== 'rejected' && q.status !== 'expired'
const priced = q => q.amount != null && Number(q.amount) > 0

// Where a request is, from its own status and its quotes
export function stageOf(task, quotes) {
  if (quotes.some(q => q.status === 'accepted')) return 'awarded'
  if (task.status === 'closed') return 'closed'
  if (quotes.some(q => priced(q) && live(q))) return 'decide'
  return 'pricing'
}

const sameVendor = (a, b) =>
  (a.supplier_id && a.supplier_id === b.supplier_id) ||
  (a.subcontractor_id && a.subcontractor_id === b.subcontractor_id) ||
  (!!a.vendor_name_text && !!b.vendor_name_text && a.vendor_name_text.trim().toLowerCase() === b.vendor_name_text.trim().toLowerCase())

// Who's been asked, who's returned a price, who declined
export function supplierStatus(invites, quotes) {
  const rows = invites.map(i => ({ ...i, quote: quotes.find(q => sameVendor(i, q)) || null }))
  // Quotes from firms nobody logged as "asked" still count as asked + returned
  quotes.forEach(q => { if (!rows.some(r => r.quote?.id === q.id) && !invites.some(i => sameVendor(i, q))) rows.push({ id: 'q:' + q.id, vendor_name_text: q.vendor_name_text, supplier_id: q.supplier_id, subcontractor_id: q.subcontractor_id, status: 'asked', quote: q, implicit: true }) })
  const returned = rows.filter(r => r.quote).length
  const declined = rows.filter(r => !r.quote && r.status === 'declined').length
  return { rows, asked: rows.length, returned, declined, waiting: rows.length - returned - declined }
}

const todayIso = () => new Date().toISOString().slice(0, 10)
const fmtDay = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'
const initials = n => (n || '').split(/\s+/).filter(Boolean).map((w, i, a) => i === 0 ? w : (i === a.length - 1 ? w[0] + '.' : '')).filter(Boolean).join(' ')

export default function QuoteRequests({ projectId = null }) {
  const { can, profile, division, canAccessProject } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [stage, setStage] = useState(null)
  const [job, setJob] = useState('all')
  const [search, setSearch] = useState('')
  const [mine, setMine] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showOld, setShowOld] = useState(false)

  useEffect(() => { load() }, [projectId, division])

  async function load() {
    setData(null)
    const projQ = supabase.from('projects').select('id, project_name, project_ref, division')
    const taskQ = supabase.from('tasks').select('*').order('created_at', { ascending: false })
    const [{ data: projs }, { data: tasks }] = await Promise.all([
      projectId ? projQ.eq('id', projectId) : projQ,
      projectId ? taskQ.eq('project_id', projectId) : taskQ,
    ])
    const pmap = Object.fromEntries((projs || []).filter(p => projectId || (p.division || 'construction') === division).map(p => [p.id, p]))
    const list = (tasks || []).filter(t => pmap[t.project_id] && canAccessProject(t.project_id))
    const ids = list.map(t => t.id)
    const chunk = async (table, sel) => {
      const out = []
      for (let i = 0; i < ids.length; i += 150) {
        const { data: rows, error } = await supabase.from(table).select(sel).in('task_id', ids.slice(i, i + 150))
        if (error) return out   // e.g. 036 not run yet
        out.push(...(rows || []))
      }
      return out
    }
    const [quotes, invites, asg] = await Promise.all([
      chunk('task_quotes', 'id, task_id, amount, currency, status, vendor_name_text, supplier_id, subcontractor_id, building_ordinals, received_date, created_at'),
      chunk('task_quote_invites', 'id, task_id, vendor_name_text, supplier_id, subcontractor_id, status'),
      chunk('task_assignees', 'task_id, user_id, profiles(full_name)'),
    ])
    const by = (rows, id) => rows.filter(r => r.task_id === id)
    const reqs = list.map(t => {
      const qs = by(quotes, t.id)
      const sup = supplierStatus(by(invites, t.id), qs)
      const pr = qs.filter(q => priced(q) && live(q))
      const lowest = pr.length ? pr.reduce((a, b) => Number(a.amount) <= Number(b.amount) ? a : b) : null
      const scopes = new Set(pr.map(q => (Array.isArray(q.building_ordinals) && q.building_ordinals.length ? [...q.building_ordinals].sort().join(',') : '')))
      const highest = pr.length ? pr.reduce((a, b) => Number(a.amount) >= Number(b.amount) ? a : b) : null
      const spread = pr.length > 1 && scopes.size === 1 ? (Number(highest.amount) - Number(lowest.amount)) / Number(lowest.amount) : null
      const owners = by(asg, t.id)
      const latest = qs.reduce((m, q) => { const d = q.received_date || q.created_at; return d && (!m || d > m) ? d : m }, null)
      return { task: t, project: pmap[t.project_id], quotes: qs, sup, lowest, spread, owners, latest,
        accepted: qs.find(q => q.status === 'accepted') || null, stage: stageOf(t, qs),
        // Quote request = marked as one, or already has quotes / suppliers asked.
        // Everything else is an old Task Tracker task (not shown in the stages).
        isQuote: t.is_quote === true || qs.length > 0 || sup.rows.length > 0 }
    })
    setData(reqs)
    setStage(s => s || (reqs.some(r => r.stage === 'decide') ? 'decide' : 'pricing'))
  }

  const today = todayIso()
  const filtered = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    return data
      .filter(r => r.isQuote)
      .filter(r => job === 'all' || r.task.project_id === job)
      .filter(r => !mine || r.owners.some(o => o.user_id === profile?.id))
      .filter(r => !q || [r.task.title, r.project?.project_name, r.project?.project_ref, ...r.quotes.map(x => x.vendor_name_text), ...r.sup.rows.map(x => x.vendor_name_text)]
        .some(v => String(v || '').toLowerCase().includes(q)))
  }, [data, job, mine, search, profile?.id])

  if (!data) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner /></div>

  const inStage = k => filtered.filter(r => r.stage === k)
  const shown = inStage(stage).sort((a, b) => {
    if (stage === 'pricing') return (a.task.return_by || '9999').localeCompare(b.task.return_by || '9999')
    return String(b.latest || b.task.created_at).localeCompare(String(a.latest || a.task.created_at))
  })
  const metric = {
    pricing: (() => { const rs = inStage('pricing'); const w = rs.reduce((s, r) => s + r.sup.waiting, 0); const late = rs.filter(r => r.task.return_by && r.task.return_by < today).length
      return [w ? `waiting on ${w} return${w === 1 ? '' : 's'}` : 'nothing logged as asked', late ? `${late} overdue` : null].filter(Boolean).join(' · ') })(),
    decide: (() => { const sum = inStage('decide').reduce((s, r) => s + (r.lowest ? Number(r.lowest.amount) : 0), 0); return sum ? `${formatCurrency(sum)} lowest prices` : 'prices in, no choice yet' })(),
    awarded: (() => { const sum = inStage('awarded').reduce((s, r) => s + (r.accepted?.amount ? Number(r.accepted.amount) : 0), 0); return sum ? `${formatCurrency(sum)} committed` : 'supplier chosen' })(),
    closed: 'cancelled or not needed',
  }
  const oldTasks = data.filter(r => !r.isQuote && r.task.status !== 'closed' && (job === 'all' || r.task.project_id === job))
  async function sortOld(r, asQuote) {
    const patch = asQuote ? { is_quote: true } : { is_quote: false, status: 'closed', closed_at: new Date().toISOString(), closed_by: profile?.id }
    const { error } = await supabase.from('tasks').update(patch).eq('id', r.task.id)
    if (error) { alert(/is_quote|schema cache/.test(error.message) ? 'Run 037_quote_flag.sql in Supabase first.' : error.message); return }
    setData(d => d.map(x => x.task.id === r.task.id ? { ...x, task: { ...x.task, ...patch }, isQuote: asQuote, stage: asQuote ? x.stage : 'closed' } : x))
  }
  const jobs = projectId ? [] : sortBy(Object.values(data.filter(r => r.isQuote).reduce((m, r) => {
    const p = r.project; if (!p) return m
    m[p.id] ||= { id: p.id, label: p.project_name, n: 0 }
    if (r.stage === 'pricing' || r.stage === 'decide') m[p.id].n++
    return m
  }, {})).filter(j => j.n > 0 || j.id === job), 'label')

  return (
    <div className="qr">
      {!projectId && (
        <div className="qr-head">
          <div><h2>Quotes</h2><p>Every package you're pricing, from request to order</p></div>
          {can('manage_projects') && <button className="btn btn-primary" onClick={() => setShowNew(true)}><IconPlus size={13} /> New quote request</button>}
        </div>
      )}
      {projectId && can('manage_projects') && (
        <div className="qr-head qr-head-sm"><span /><button className="btn btn-sm btn-primary" onClick={() => setShowNew(true)}><IconPlus size={12} /> New quote request</button></div>
      )}

      <div className="qr-stages" role="tablist">
        {STAGES.map(s => (
          <button key={s.key} type="button" role="tab" aria-selected={stage === s.key} className={`qr-stage${stage === s.key ? ' on' : ''}`} onClick={() => setStage(s.key)} style={{ '--st': s.color }}>
            <span className="qr-stage-l">{s.label}</span>
            <span className="qr-stage-n">{inStage(s.key).length}</span>
            <span className="qr-stage-m">{metric[s.key]}</span>
          </button>
        ))}
      </div>

      <div className="qr-tools">
        <input className="qr-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search package, job or supplier…" />
        {!projectId && jobs.length > 0 && (
          <div className="qr-chips">
            <button type="button" className={`qr-chip${job === 'all' ? ' on' : ''}`} onClick={() => setJob('all')}>All jobs</button>
            {jobs.map(j => <button key={j.id} type="button" className={`qr-chip${job === j.id ? ' on' : ''}`} onClick={() => setJob(job === j.id ? 'all' : j.id)}>{j.label}{j.n ? ` · ${j.n}` : ''}</button>)}
          </div>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className={`qr-chip${mine ? ' on' : ''}`} onClick={() => setMine(v => !v)}>Mine only</button>
      </div>

      {oldTasks.length > 0 && (
        <div className="qr-old">
          <button type="button" className="qr-old-h" onClick={() => setShowOld(v => !v)}>
            <b>{oldTasks.length} old Task Tracker task{oldTasks.length === 1 ? '' : 's'}</b> not shown above — they aren't quote requests.
            <span>{showOld ? 'Hide' : 'Review'}</span>
          </button>
          {showOld && (
            <div className="qr-old-list">
              {oldTasks.map(r => (
                <div key={r.task.id} className="qr-old-row">
                  <button type="button" className="qr-old-t" onClick={() => navigate(`/tasks/${r.task.id}`)}><b>{r.task.title}</b><small>{r.project?.project_name}</small></button>
                  {can('manage_projects') && <>
                    <button type="button" className="btn btn-sm" onClick={() => sortOld(r, true)}>It's a quote</button>
                    <button type="button" className="btn btn-sm" onClick={() => sortOld(r, false)}>Close it</button>
                  </>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {shown.length === 0
        ? <EmptyState icon="📑" title={`Nothing ${STAGES.find(s => s.key === stage)?.label.toLowerCase()}`} message={search || job !== 'all' || mine ? 'Try clearing the filters.' : stage === 'pricing' ? 'Start one with “New quote request”.' : 'Requests move here as they progress.'} />
        : (
          <div className="qr-table" role="table">
            <div className="qr-row qr-row-h" role="row">
              <span>Package</span>
              <span>{stage === 'awarded' ? 'Awarded to' : 'Suppliers'}</span>
              <span className="num">{stage === 'awarded' ? 'Price' : 'Lowest'}</span>
              <span className="num">{stage === 'awarded' ? 'Quotes' : 'Spread'}</span>
              <span>{stage === 'pricing' ? 'Return by' : 'Latest'}</span>
              <span>Owner</span>
            </div>
            {shown.map(r => {
              const late = r.stage === 'pricing' && r.task.return_by && r.task.return_by < today
              return (
                <button key={r.task.id} type="button" role="row" className={`qr-row${r.stage === 'closed' ? ' muted' : ''}`} onClick={() => navigate(`/tasks/${r.task.id}`)}>
                  <span className="qr-pkg"><b>{r.task.title}</b>{!projectId && <small>{r.project?.project_ref ? `${r.project.project_ref} · ` : ''}{r.project?.project_name}</small>}</span>
                  {r.stage === 'awarded'
                    ? <span className="qr-sup"><b>{r.accepted.vendor_name_text || '—'}</b></span>
                    : <span className="qr-sup">
                        {r.sup.asked > 0 && <span className="qr-dots">{r.sup.rows.slice(0, 8).map(x => <i key={x.id} className={x.quote ? 'y' : x.status === 'declined' ? 'd' : ''} />)}</span>}
                        {r.sup.asked === 0 ? <span className="qr-muted">none logged</span> : `${r.sup.returned} of ${r.sup.asked - r.sup.declined} in${r.sup.declined ? ` · ${r.sup.declined} declined` : ''}`}
                      </span>}
                  <span className="num"><b>{r.stage === 'awarded' ? (r.accepted.amount != null ? formatMoney(r.accepted.amount) : '—') : r.lowest ? formatMoney(r.lowest.amount) : '—'}</b></span>
                  <span className="num qr-muted">{r.stage === 'awarded' ? r.quotes.length : r.spread != null ? `+${Math.round(r.spread * 100)}%` : '—'}</span>
                  <span className={late ? 'qr-late' : 'qr-muted'}>{r.stage === 'pricing' ? (r.task.return_by ? fmtDay(r.task.return_by) + (late ? ' · overdue' : '') : '—') : fmtDay(r.latest || r.task.created_at)}</span>
                  <span className="qr-muted qr-owner">{r.owners.map(o => initials(o.profiles?.full_name)).join(', ') || '—'}</span>
                </button>
              )
            })}
          </div>
        )}

      <NewQuoteRequest open={showNew} onClose={() => setShowNew(false)} projectId={projectId} />
    </div>
  )
}

// New request — same records as before (tasks + assignee + activity)
function NewQuoteRequest({ open, onClose, projectId }) {
  const { profile, division, canAccessProject } = useAuth()
  const navigate = useNavigate()
  const [projects, setProjects] = useState([])
  const blank = { project_id: projectId || '', title: '', description: '', priority: 'medium', return_by: '', budget: '' }
  const [form, setForm] = useState(blank)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!open) return
    setForm(blank)
    if (projectId) return
    supabase.from('projects').select('id, project_name, project_ref').eq('division', division)
      .then(({ data }) => setProjects(sortBy((data || []).filter(p => canAccessProject(p.id)), 'project_ref').reverse()))
  }, [open, division, projectId])
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  async function create() {
    if (!form.project_id || !form.title.trim()) return
    setSaving(true)
    try {
      const row = { project_id: form.project_id, title: form.title.trim(), description: form.description.trim() || null, priority: form.priority, status: 'active', created_by: profile?.id, is_quote: true }
      if (form.return_by) row.return_by = form.return_by
      if (form.budget) row.budget = Number(String(form.budget).replace(/[£,\s]/g, '')) || null
      let { data: task, error } = await supabase.from('tasks').insert(row).select().single()
      // A column whose SQL hasn't been run yet: drop just that one and try again
      for (let tries = 0; error && tries < 3; tries++) {
        const col = ['is_quote', 'return_by', 'budget'].find(c => c in row && new RegExp(c).test(error.message))
        if (!col) break
        delete row[col]
        ;({ data: task, error } = await supabase.from('tasks').insert(row).select().single())
      }
      if (error) throw error
      if (profile?.id) await supabase.from('task_assignees').insert({ task_id: task.id, user_id: profile.id })
      await supabase.from('task_activity').insert({ task_id: task.id, actor_id: profile?.id, action: 'created', details: { title: row.title, priority: row.priority } })
      onClose()
      navigate(`/tasks/${task.id}`)
    } catch (e) { alert('Could not create: ' + e.message) }
    setSaving(false)
  }
  return (
    <Modal open={open} onClose={() => !saving && onClose()} title="New quote request" size="sm"
      footer={<>
        <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn btn-primary" onClick={create} disabled={saving || !form.title.trim() || !form.project_id}>{saving ? 'Creating…' : 'Create'}</button>
      </>}>
      <div className="form-grid">
        {!projectId && <div className="full"><Field label="Job *">
          <select value={form.project_id} onChange={e => set('project_id', e.target.value)}>
            <option value="">Select a job…</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.project_ref ? `${p.project_ref} · ` : ''}{p.project_name}</option>)}
          </select>
        </Field></div>}
        <div className="full"><Field label="What is being priced *">
          <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Roofing package — Block B" autoFocus />
        </Field></div>
        <div className="full"><Field label="Scope / notes">
          <textarea value={form.description} onChange={e => set('description', e.target.value)} placeholder="Scope, drawings, anything suppliers need to know…" style={{ minHeight: 70 }} />
        </Field></div>
        <Field label="Prices back by"><input type="date" value={form.return_by} onChange={e => set('return_by', e.target.value)} /></Field>
        <Field label="Budget (£, optional)"><input inputMode="decimal" value={form.budget} onChange={e => set('budget', e.target.value)} placeholder="e.g. 50,000" /></Field>
        <Field label="Priority">
          <select value={form.priority} onChange={e => set('priority', e.target.value)}>
            <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select>
        </Field>
      </div>
    </Modal>
  )
}
