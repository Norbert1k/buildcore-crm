// ─────────────────────────────────────────────────────────────────────────────
// Commercial › Contract — the job's contract terms and parties, filled in by
// the CRM from emails and documents (job-facts), checked by a person.
//
//   • To check: what the CRM found that waits for a person — money, awards,
//     the client, new firms, anything that differs from what's entered.
//     Accept (money can be corrected first) or Reject.
//   • Contract: the terms, each showing where it came from. Editable.
//   • Filled by the CRM: what it filled on its own, with Undo.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { formatDate } from '../lib/utils'
import { Spinner } from './ui'
import { tidyMoney } from '../lib/reportValuation'

const TERMS = [
  { key: 'contract_sum', label: 'Contract sum', on: 'projects', col: 'value', kind: 'money' },
  { key: 'retention_pct', label: 'Retention', on: 'projects', col: 'retention_pct', kind: 'pct' },
  { key: 'retention_release', label: 'Retention release', on: 'contract', col: 'retention_release', kind: 'text' },
  { key: 'lads_amount', label: 'Liquidated damages (LADs)', on: 'contract', col: 'lads_amount', kind: 'money' },
  { key: 'start_date', label: 'Start date', on: 'projects', col: 'start_date', kind: 'date' },
  { key: 'completion_date', label: 'Completion date', on: 'projects', col: 'end_date', kind: 'date' },
  { key: 'form', label: 'Form of contract', on: 'contract', col: 'contract_form', kind: 'text' },
  { key: 'contract_date', label: 'Contract date', on: 'contract', col: 'contract_date', kind: 'date' },
  { key: 'reference', label: 'Contract reference', on: 'contract', col: 'contract_ref', kind: 'text' },
  { key: 'payment_terms', label: 'Payment terms', on: 'contract', col: 'payment_terms', kind: 'text' },
  { key: 'defects_period_months', label: 'Defects period', on: 'contract', col: 'defects_period_months', kind: 'months' },
  { key: 'insurance', label: 'Insurance required', on: 'contract', col: 'insurance', kind: 'text' },
]
const MONEY_KEYS = new Set(['contract_sum', 'retention_pct', 'lads_amount'])

function show(t, v, per) {
  if (v == null || v === '') return null
  if (t.kind === 'money') return '£' + tidyMoney(v) + (t.key === 'lads_amount' && per ? ` per ${per}` : '')
  if (t.kind === 'pct') return `${v}%`
  if (t.kind === 'date') return formatDate(String(v).slice(0, 10))
  if (t.kind === 'months') return `${v} month${Number(v) === 1 ? '' : 's'}`
  return String(v)
}
const from = l => !l ? 'From a document' : /^email/i.test(l) ? l : `From ${l}`
const ago = d => {
  if (!d) return ''
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 30 ? `${days} days ago` : formatDate(String(d).slice(0, 10))
}

export default function JobContract({ projectId, project, onChanged }) {
  const { can } = useAuth()
  const seeMoney = can('view_project_value')
  const [fills, setFills] = useState(null)
  const [contract, setContract] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState({})        // fill id → corrected value
  const [termEdit, setTermEdit] = useState(null)   // { key, value }
  const [reading, setReading] = useState(false)
  const [readNote, setReadNote] = useState('')

  async function load() {
    const [f, c] = await Promise.all([
      supabase.from('job_fills').select('*').eq('project_id', projectId).in('status', ['pending', 'applied']).order('created_at', { ascending: false }).limit(200),
      supabase.from('project_contract').select('*').eq('project_id', projectId).maybeSingle(),
    ])
    if (f.error && /job_fills|schema cache/i.test(f.error.message)) { setErr('Run supabase-sql/045_job_facts.sql to switch this on.'); setFills([]); return }
    setFills(f.data || [])
    setContract(c.data || null)
  }
  useEffect(() => { load() }, [projectId])

  async function act(body, id) {
    setBusy(id); setErr('')
    const { data, error } = await supabase.functions.invoke('job-facts', { body })
    setBusy('')
    if (error || data?.error) {
      // The function's own message (e.g. "That row has been used since…"), not "non-2xx"
      let msg = data?.error
      try { if (!msg && error?.context) msg = (await error.context.json())?.error } catch { /* not JSON */ }
      setErr(msg || (/non-2xx/i.test(error?.message || '') ? 'The CRM couldn\u2019t finish that just now — try again in a minute.' : error?.message))
      return false
    }
    await load(); onChanged?.()
    return data
  }

  async function saveTerm(t, raw) {
    setBusy('term:' + t.key); setErr('')
    let v = raw === '' ? null : raw
    if (v != null && (t.kind === 'money' || t.kind === 'pct' || t.kind === 'months')) {
      v = parseFloat(String(v).replace(/[£,%\s]/g, ''))
      if (!Number.isFinite(v)) { setErr('That isn’t a number'); setBusy(''); return }
    }
    const { error } = t.on === 'projects'
      ? await supabase.from('projects').update({ [t.col]: v }).eq('id', projectId)
      : await supabase.from('project_contract').upsert({ project_id: projectId, [t.col]: v, updated_at: new Date().toISOString() }, { onConflict: 'project_id' })
    setBusy('')
    if (error) { setErr(error.message); return }
    setTermEdit(null)
    await load(); onChanged?.()
  }

  async function readDocs() {
    setReading(true); setReadNote('')
    const r = await act({ action: 'backfill', project_id: projectId, limit: 2 }, 'read')
    setReading(false)
    if (!r) return
    const skipped = (r.results || []).filter(x => x.error).map(x => `${x.file} (${x.error})`)
    setReadNote(r.read
      ? `Read ${r.read - skipped.length} document${r.read - skipped.length === 1 ? '' : 's'}${skipped.length ? `; couldn\u2019t read ${skipped.join(', ')}` : ''}${r.left ? ` — ${r.left} more in 01. Project Order, press again` : ''}.`
      : 'Nothing new to read in 01. Project Order.')
  }

  if (fills == null) return <div style={{ padding: 30, textAlign: 'center' }}><Spinner /></div>
  const pending = fills.filter(f => f.status === 'pending')
  const applied = fills.filter(f => f.status === 'applied')
  const sourceOf = key => fills.find(f => f.kind === 'contract' && f.field === key && f.status === 'applied')
  const valueOf = t => t.on === 'projects' ? project?.[t.col] : contract?.[t.col]

  return (
    <div className="jc">
      {err && <div className="jc-err">{err}</div>}

      <div className="jc-head">
        <div>
          <div className="jc-title">Contract &amp; parties</div>
          <div className="jc-sub">Filled in by the CRM from the job's emails and documents. Money, awards, the client and new firms wait for you.</div>
        </div>
        <button className="btn btn-sm" onClick={readDocs} disabled={reading}>{reading ? 'Reading…' : 'Read job documents'}</button>
      </div>
      {readNote && <div className="jc-note">{readNote}</div>}

      {/* To check */}
      <section className="jc-card">
        <div className="jc-card-title">To check {pending.length ? <span className="jc-count">{pending.length}</span> : null}</div>
        {!pending.length && <div className="jc-empty">Nothing waiting.</div>}
        {pending.map(f => {
          const money = f.kind === 'contract' && MONEY_KEYS.has(f.field)
          const hidden = money && !seeMoney
          return (
            <div key={f.id} className="jc-row">
              <div className="jc-row-main">
                <div className="jc-row-label">{f.label}</div>
                {money && seeMoney ? (
                  <input className="jc-input" inputMode="decimal" value={edit[f.id] ?? (f.field === 'retention_pct' ? String(f.value?.v ?? '') : tidyMoney(f.value?.v))}
                    onChange={e => setEdit(s => ({ ...s, [f.id]: e.target.value }))}
                    onBlur={e => f.field !== 'retention_pct' && setEdit(s => ({ ...s, [f.id]: tidyMoney(e.target.value) }))} />
                ) : (
                  <div className="jc-row-value">{hidden ? 'Hidden — needs contract value access' : f.display}</div>
                )}
                {money && seeMoney && (f.field === 'lads_amount' || f.field === 'retention_pct') && (
                  <div className="jc-row-meta">{f.field === 'lads_amount' ? `£ per ${f.value?.per || 'week'}` : '%'}</div>
                )}
                {f.previous != null && f.kind === 'contract' && !hidden && (
                  <div className="jc-row-meta">Now: {show(TERMS.find(t => t.key === f.field) || {}, f.previous) || 'blank'}</div>
                )}
                {f.why && !hidden && <div className="jc-row-why">{f.why}</div>}
                <div className="jc-row-meta">{from(f.source_label)} · {ago(f.source_date || f.created_at)}</div>
              </div>
              {!hidden && (
                <div className="jc-row-actions">
                  <button className="btn btn-primary btn-sm" disabled={!!busy}
                    onClick={() => act({ action: 'decide', fill_id: f.id, accept: true, value: money && edit[f.id] != null ? edit[f.id] : undefined }, f.id)}>
                    {busy === f.id ? '…' : 'Accept'}</button>
                  <button className="btn btn-sm" disabled={!!busy} onClick={() => act({ action: 'decide', fill_id: f.id, accept: false }, f.id)}>Reject</button>
                </div>
              )}
            </div>
          )
        })}
      </section>

      {/* Contract terms */}
      <section className="jc-card">
        <div className="jc-card-title">Contract</div>
        <div className="jc-terms">
          {TERMS.map(t => {
            if (MONEY_KEYS.has(t.key) && !seeMoney) return null
            const v = valueOf(t)
            const src = sourceOf(t.key)
            const editing = termEdit?.key === t.key
            return (
              <div key={t.key} className="jc-term">
                <div className="jc-term-label">{t.label}</div>
                {editing ? (
                  <div className="jc-term-edit">
                    <input autoFocus className="jc-input" type={t.kind === 'date' ? 'date' : 'text'} value={termEdit.value}
                      inputMode={t.kind === 'text' || t.kind === 'date' ? undefined : 'decimal'}
                      onChange={e => setTermEdit({ key: t.key, value: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') saveTerm(t, termEdit.value); if (e.key === 'Escape') setTermEdit(null) }} />
                    <button className="btn btn-primary btn-sm" disabled={busy === 'term:' + t.key} onClick={() => saveTerm(t, termEdit.value)}>Save</button>
                    <button className="btn btn-sm" onClick={() => setTermEdit(null)}>Cancel</button>
                  </div>
                ) : (
                  <button className="jc-term-value" onClick={() => setTermEdit({ key: t.key, value: v == null ? '' : t.kind === 'money' ? tidyMoney(v) : t.kind === 'date' ? String(v).slice(0, 10) : String(v) })}>
                    {show(t, v, contract?.lads_per) || <span className="jc-blank">Not set</span>}
                  </button>
                )}
                {src && !editing && <div className="jc-term-src">CRM · {src.source_label || 'a document'}</div>}
              </div>
            )
          })}
        </div>
      </section>

      {/* Filled by the CRM */}
      <section className="jc-card">
        <div className="jc-card-title">Filled in by the CRM</div>
        {!applied.length && <div className="jc-empty">Nothing yet — it fills in as emails and documents for this job come in.</div>}
        {applied.slice(0, 60).map(f => {
          const hidden = f.kind === 'contract' && MONEY_KEYS.has(f.field) && !seeMoney
          return (
            <div key={f.id} className="jc-log">
              <div className="jc-log-main">
                <span className="jc-log-label">{f.label}</span>
                <span className="jc-log-value">{hidden ? '—' : f.display}</span>
                <span className="jc-row-meta">{f.decided_by ? 'Accepted · ' : ''}{f.source_label || ''} · {ago(f.decided_at || f.created_at)}</span>
              </div>
              {!f.decided_by && !f.field.startsWith('ea_contact:') && !f.field.startsWith('contact:') && (
                <button className="btn btn-sm jc-undo" disabled={!!busy} onClick={() => act({ action: 'undo', fill_id: f.id }, f.id)}>{busy === f.id ? '…' : 'Undo'}</button>
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}
