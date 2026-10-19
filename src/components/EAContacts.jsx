import { useState } from 'react'
import { supabase } from '../lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// People at an Employers Agent firm (employer_agent_contacts) and which of them
// look after a given job (project_employer_agents.contact_ids).
// Everything here tolerates the table not existing yet, so the CRM keeps
// working if the SQL hasn't been run.
// ─────────────────────────────────────────────────────────────────────────────

const okEmail = e => !e || /^\S+@\S+\.\S+$/.test(e.trim())

// { ea_id: [contacts] } for the given firms
export async function loadEAContacts(eaIds) {
  const ids = [...new Set((eaIds || []).filter(Boolean))]
  if (!ids.length) return {}
  const { data, error } = await supabase.from('employer_agent_contacts').select('*').in('ea_id', ids).order('sort').order('created_at')
  if (error) return {}
  const out = {}
  for (const c of data || []) (out[c.ea_id] ||= []).push(c)
  return out
}

// Keep the firm's own contact fields pointing at the main person, so lists
// and older screens that read employer_agents.contact_name stay right.
async function syncPrimary(eaId, list) {
  const p = list.find(c => c.is_primary) || list[0]
  if (!p) return
  await supabase.from('employer_agents').update({ contact_name: p.name, email: p.email || null, phone: p.phone || null }).eq('id', eaId)
}

// The people for one assignment, falling back to the firm's own contact
export function peopleFor(pea, contactsByEa) {
  const all = contactsByEa[pea.ea_id] || []
  const chosen = (pea.contact_ids || []).map(id => all.find(c => c.id === id)).filter(Boolean)
  if (chosen.length) return chosen
  const ea = pea.employer_agents
  return ea?.contact_name || ea?.email ? [{ id: 'firm', name: ea.contact_name || ea.email, email: ea.email, phone: ea.phone }] : []
}

// ── Editor used in the EA firm form ──────────────────────────────────────────
export function ContactsEditor({ rows, setRows, error }) {
  const set = (i, k, v) => setRows(r => r.map((c, j) => j === i ? { ...c, [k]: v } : c))
  const makePrimary = i => setRows(r => r.map((c, j) => ({ ...c, is_primary: j === i })))
  const remove = i => setRows(r => {
    const next = r.filter((_, j) => j !== i)
    if (next.length && !next.some(c => c.is_primary)) next[0] = { ...next[0], is_primary: true }
    return next
  })
  const add = () => setRows(r => [...r, { _new: true, name: '', job_title: '', email: '', phone: '', is_primary: r.length === 0 }])
  return (
    <div className="full">
      <div className="eac-list">
        {rows.length === 0 && <div className="eac-empty">No people added yet.</div>}
        {rows.map((c, i) => (
          <div key={c.id || `n${i}`} className="eac-row">
            <div className="eac-grid">
              <input value={c.name} onChange={e => set(i, 'name', e.target.value)} placeholder="Full name *" />
              <input value={c.job_title || ''} onChange={e => set(i, 'job_title', e.target.value)} placeholder="Role, e.g. Senior EA" />
              <input type="email" value={c.email || ''} onChange={e => set(i, 'email', e.target.value)} placeholder="Email" style={okEmail(c.email) ? null : { borderColor: 'var(--red)' }} />
              <input value={c.phone || ''} onChange={e => set(i, 'phone', e.target.value)} placeholder="Phone" />
            </div>
            <div className="eac-actions">
              <label title="Main contact for this firm"><input type="radio" checked={!!c.is_primary} onChange={() => makePrimary(i)} /> Main</label>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(i)} title="Remove person">✕</button>
            </div>
          </div>
        ))}
      </div>
      {error && <div className="eac-err">{error}</div>}
      <button type="button" className="btn btn-sm" onClick={add} style={{ marginTop: 8 }}>+ Add person</button>
    </div>
  )
}

export function validateContacts(rows) {
  for (const c of rows) {
    if (!c.name?.trim() && (c.email?.trim() || c.phone?.trim() || c.job_title?.trim())) return 'Every person needs a name.'
    if (!okEmail(c.email)) return `"${c.email}" is not a valid email address.`
  }
  return ''
}

// Save the edited list for a firm: insert new, update changed, delete removed.
export async function saveContacts(eaId, rows, original, userId) {
  const keep = rows.filter(c => c.name?.trim()).map((c, i) => ({ ...c, sort: i }))
  if (keep.length && !keep.some(c => c.is_primary)) keep[0].is_primary = true
  const removed = (original || []).filter(o => !keep.find(c => c.id === o.id))
  for (const o of removed) {
    const { error } = await supabase.from('employer_agent_contacts').delete().eq('id', o.id)
    if (error) throw error
  }
  for (const c of keep) {
    const row = { name: c.name.trim(), job_title: c.job_title?.trim() || null, email: c.email?.trim() || null, phone: c.phone?.trim() || null, is_primary: !!c.is_primary, sort: c.sort }
    const { error } = c.id
      ? await supabase.from('employer_agent_contacts').update(row).eq('id', c.id)
      : await supabase.from('employer_agent_contacts').insert({ ...row, ea_id: eaId, created_by: userId || null })
    if (error) throw error
  }
  await syncPrimary(eaId, keep)
}

// ── Picker used when assigning an EA to a job ────────────────────────────────
// contacts: the firm's people · value: chosen ids · onAdded(newContact)
export function ContactPicker({ eaId, contacts, value, onChange, onAdded, canAdd = true }) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', job_title: '', email: '', phone: '' })
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const toggle = id => onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id])

  async function add() {
    if (!form.name.trim()) { setErr('Name is required'); return }
    if (!okEmail(form.email)) { setErr('That email doesn\'t look right'); return }
    setSaving(true)
    const { data, error } = await supabase.from('employer_agent_contacts').insert({
      ea_id: eaId, name: form.name.trim(), job_title: form.job_title.trim() || null, email: form.email.trim() || null, phone: form.phone.trim() || null,
      is_primary: contacts.length === 0, sort: contacts.length,
    }).select('*').single()
    setSaving(false)
    if (error) { setErr(/does not exist|schema cache/i.test(error.message) ? 'People list not set up yet — run 035_ea_contacts.sql in Supabase.' : error.message); return }
    if (contacts.length === 0) await syncPrimary(eaId, [data])
    onAdded(data); onChange([...value, data.id])
    setForm({ name: '', job_title: '', email: '', phone: '' }); setAdding(false); setErr('')
  }

  return (
    <div className="eac-pick">
      {contacts.length === 0 && !adding && <div className="eac-empty">No people saved for this firm yet.</div>}
      {contacts.map(c => (
        <label key={c.id} className={`eac-opt${value.includes(c.id) ? ' on' : ''}`}>
          <input type="checkbox" checked={value.includes(c.id)} onChange={() => toggle(c.id)} />
          <span className="eac-who">
            <b>{c.name}</b>{c.job_title && <span className="eac-role">{c.job_title}</span>}{c.is_primary && <span className="eac-main">Main</span>}
            <span className="eac-meta">{[c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details'}</span>
          </span>
        </label>
      ))}
      {canAdd && (adding ? (
        <div className="eac-add">
          <div className="eac-grid">
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name *" autoFocus />
            <input value={form.job_title} onChange={e => setForm(f => ({ ...f, job_title: e.target.value }))} placeholder="Role" />
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" />
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone" />
          </div>
          {err && <div className="eac-err">{err}</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button type="button" className="btn btn-sm btn-primary" onClick={add} disabled={saving}>{saving ? 'Saving…' : 'Add to firm and select'}</button>
            <button type="button" className="btn btn-sm" onClick={() => { setAdding(false); setErr('') }}>Cancel</button>
          </div>
        </div>
      ) : <button type="button" className="btn btn-sm" onClick={() => setAdding(true)} style={{ marginTop: 6 }}>+ Add a new person at this firm</button>)}
    </div>
  )
}
