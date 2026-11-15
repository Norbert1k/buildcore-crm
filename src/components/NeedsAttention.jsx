import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// "Needs attention" — what the watchdog found across the active jobs.
// Urgent first. Each item: open it, fix it (when the CRM can do it safely),
// mark it done, snooze it, or say it's not relevant (it won't come back).
const SEV = { urgent: { label: 'Urgent', cls: 'na-urgent' }, soon: { label: 'Soon', cls: 'na-soon' }, info: { label: 'Tidy-up', cls: 'na-info' } }
const ORDER = { urgent: 0, soon: 1, info: 2 }
const FIX_LABEL = { show_pa: 'Show to client', archive_older_pa: 'Keep newest', draft_report: 'Draft it now' }

export default function NeedsAttention({ projectId = null, limit = 8 }) {
  const navigate = useNavigate()
  const [items, setItems] = useState(null)
  const [missing, setMissing] = useState(false)
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(null)
  const [checking, setChecking] = useState(false)

  async function load() {
    let q = supabase.from('crm_alerts').select('*').eq('status', 'open')
      .or(`snoozed_until.is.null,snoozed_until.lt.${new Date().toISOString()}`)
    if (projectId) q = q.eq('project_id', projectId)
    const { data, error } = await q.limit(300)
    if (error) { if (/crm_alerts/.test(error.message)) setMissing(true); setItems([]); return }
    setItems((data || []).sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || String(a.due_date || '9').localeCompare(String(b.due_date || '9'))))
  }
  useEffect(() => { load() }, [projectId])

  async function setStatus(a, patch) {
    setBusy(a.id)
    const { data: u } = await supabase.auth.getUser()
    await supabase.from('crm_alerts').update({ ...patch, ...(patch.status ? { resolved_at: new Date().toISOString(), resolved_by: u?.user?.id || null } : {}) }).eq('id', a.id)
    setBusy(null); load()
  }
  async function fix(a) {
    setBusy(a.id)
    const { data, error } = await supabase.functions.invoke('watchdog', { body: { action: 'fix', id: a.id } })
    setBusy(null)
    if (error || data?.error) { alert('Couldn’t fix: ' + (data?.error || error.message)); return }
    load()
  }
  async function checkNow() {
    setChecking(true)
    await supabase.functions.invoke('watchdog', { body: { action: 'run' } })
    setChecking(false); load()
  }

  if (missing) return null
  const list = items || []
  const shown = all ? list : list.slice(0, limit)
  const urgent = list.filter(a => a.severity === 'urgent').length

  return (
    <div className="na card">
      <div className="na-h">
        <div>
          <div className="na-t">Needs attention</div>
          <div className="na-s">{items === null ? 'Checking…' : list.length ? `${list.length} item${list.length === 1 ? '' : 's'}${urgent ? ` · ${urgent} urgent` : ''}` : 'All clear'}</div>
        </div>
        <button className="btn btn-sm" onClick={checkNow} disabled={checking}>{checking ? 'Checking…' : 'Check now'}</button>
      </div>
      {shown.map(a => (
        <div key={a.id} className="na-row">
          <span className={'na-sev ' + SEV[a.severity].cls}>{SEV[a.severity].label}</span>
          <div className="na-main">
            <button className="na-title" onClick={() => a.action_url && navigate(a.action_url)}>{a.title}</button>
            {a.detail && <div className="na-detail">{a.detail}</div>}
            <div className="na-actions">
              {a.action_url && <button className="btn btn-sm" onClick={() => navigate(a.action_url)}>{a.action_label || 'Open'}</button>}
              {a.fix && FIX_LABEL[a.fix] && <button className="btn btn-sm btn-primary" disabled={busy === a.id} onClick={() => fix(a)}>{busy === a.id && a.fix === 'draft_report' ? 'Drafting… (about a minute)' : FIX_LABEL[a.fix]}</button>}
              <button className="na-link" disabled={busy === a.id} onClick={() => setStatus(a, { status: 'done' })}>Done</button>
              <button className="na-link" disabled={busy === a.id} onClick={() => setStatus(a, { snoozed_until: new Date(Date.now() + 3 * 864e5).toISOString() })}>Snooze 3 days</button>
              <button className="na-link" disabled={busy === a.id} onClick={() => setStatus(a, { status: 'dismissed' })} title="Won't be raised again">Not relevant</button>
            </div>
          </div>
        </div>
      ))}
      {list.length > limit && <button className="na-more" onClick={() => setAll(v => !v)}>{all ? 'Show fewer' : `Show all ${list.length}`}</button>}
    </div>
  )
}
