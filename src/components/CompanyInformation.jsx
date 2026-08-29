import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ── Company Information panel ────────────────────────────────────────────────
// A collapsible "Company Information" dropdown shown at the top of Company
// Documents. Holds the firm's master details (company, addresses, contacts,
// directors, banking, staff). Editable by ADMINS only. Sensitive blocks
// (directors' personal details + banking) are only shown to roles with the
// view_company_bank permission.
//
// Data lives in the single-row company_information table as JSONB, so fields
// can be edited freely.

export default function CompanyInformation() {
  const { can } = useAuth()
  const canEdit = can('manage_company_info')         // admin only
  const canSeeSensitive = can('view_company_bank')    // banking + director personal

  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError('')
    const { data: row, error: e } = await supabase
      .from('company_information').select('data').eq('id', 1).maybeSingle()
    if (e) { setError('Could not load company information: ' + e.message); setLoading(false); return }
    setData(row?.data || {})
    setLoading(false)
  }

  function startEdit() {
    setDraft(JSON.parse(JSON.stringify(data || {})))
    setEditing(true)
    setOpen(true)
  }
  function cancelEdit() { setEditing(false); setDraft(null); setError('') }

  async function save() {
    setSaving(true); setError('')
    const { error: e } = await supabase
      .from('company_information')
      .upsert({ id: 1, data: draft, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    setSaving(false)
    if (e) { setError('Save failed: ' + e.message); return }
    setData(draft); setEditing(false); setDraft(null)
  }

  // Draft helpers
  const setField = (section, key, value) =>
    setDraft(d => ({ ...d, [section]: { ...(d[section] || {}), [key]: value } }))
  const setListItem = (section, idx, key, value) =>
    setDraft(d => ({ ...d, [section]: (d[section] || []).map((it, i) => i === idx ? { ...it, [key]: value } : it) }))
  const addListItem = (section, blank) =>
    setDraft(d => ({ ...d, [section]: [...(d[section] || []), blank] }))
  const removeListItem = (section, idx) =>
    setDraft(d => ({ ...d, [section]: (d[section] || []).filter((_, i) => i !== idx) }))

  if (loading) return null

  const d = editing ? draft : (data || {})
  const company = d.company || {}
  const addresses = d.addresses || {}
  const contacts = d.contacts || {}
  const directors = d.directors || []
  const banking = d.banking || {}
  const staff = d.staff || []

  return (
    <div style={{ border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 16, overflow: 'hidden', background: 'var(--surface)' }}>
      {/* Header */}
      <div onClick={() => !editing && setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', cursor: editing ? 'default' : 'pointer', background: 'var(--surface2)' }}>
        <span style={{ fontSize: 18 }}>🏛️</span>
        <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>Company Information</span>
        {canEdit && !editing && (
          <button onClick={e => { e.stopPropagation(); startEdit() }}
            style={btn}>Edit</button>
        )}
        {editing && (
          <span style={{ display: 'flex', gap: 6 }}>
            <button onClick={cancelEdit} style={btn}>Cancel</button>
            <button onClick={save} disabled={saving} style={{ ...btn, ...btnGreen }}>{saving ? 'Saving…' : 'Save'}</button>
          </span>
        )}
        {!editing && <span style={{ color: 'var(--text3)', fontSize: 13 }}>{open ? '▾' : '▸'}</span>}
      </div>

      {error && <div style={{ padding: '8px 14px', color: '#993C1D', background: '#FAECE7', fontSize: 12 }}>{error}</div>}

      {(open || editing) && (
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Company details */}
          <Section title="Company Details">
            <Field label="Trading Name" v={company.trading_name} editing={editing} onChange={x => setField('company', 'trading_name', x)} />
            <Field label="Trading Style" v={company.trading_style} editing={editing} onChange={x => setField('company', 'trading_style', x)} />
            <Field label="Company Registration No." v={company.company_registration_no} editing={editing} onChange={x => setField('company', 'company_registration_no', x)} />
            <Field label="VAT Registration No." v={company.vat_registration_no} editing={editing} onChange={x => setField('company', 'vat_registration_no', x)} />
            <Field label="Incorporated On" v={company.incorporated_on} editing={editing} onChange={x => setField('company', 'incorporated_on', x)} />
            <Field label="Companies House" v={company.companies_house_url} editing={editing} link onChange={x => setField('company', 'companies_house_url', x)} />
          </Section>

          {/* Addresses */}
          <Section title="Address">
            <Field label="Registered / Principal Office" v={addresses.registered_office} editing={editing} onChange={x => setField('addresses', 'registered_office', x)} />
          </Section>

          {/* Contacts */}
          <Section title="Contact Information">
            <Field label="General Enquiries" v={contacts.general_enquiries} editing={editing} onChange={x => setField('contacts', 'general_enquiries', x)} />
            <Field label="Payments Contact" v={contacts.payments_contact} editing={editing} onChange={x => setField('contacts', 'payments_contact', x)} />
            <Field label="Invoices / Statements" v={contacts.invoices_statements} editing={editing} onChange={x => setField('contacts', 'invoices_statements', x)} />
          </Section>

          {/* Directors — sensitive (personal details) */}
          {canSeeSensitive ? (
            <Section title="Directors" onAdd={editing ? () => addListItem('directors', { name: '', dob: '', phone: '' }) : null}>
              {directors.map((dir, i) => (
                <div key={i} style={listCard}>
                  {editing && <button onClick={() => removeListItem('directors', i)} style={removeBtn}>✕</button>}
                  <Field label="Name" v={dir.name} editing={editing} onChange={x => setListItem('directors', i, 'name', x)} />
                  <Field label="DOB" v={dir.dob} editing={editing} onChange={x => setListItem('directors', i, 'dob', x)} />
                  <Field label="Phone" v={dir.phone} editing={editing} onChange={x => setListItem('directors', i, 'phone', x)} />
                </div>
              ))}
            </Section>
          ) : (
            <Section title="Directors"><LockedNote /></Section>
          )}

          {/* Banking — sensitive */}
          {canSeeSensitive ? (
            <Section title="Banking Details">
              <Field label="Bank" v={banking.bank} editing={editing} onChange={x => setField('banking', 'bank', x)} />
              <Field label="Branch" v={banking.branch} editing={editing} onChange={x => setField('banking', 'branch', x)} />
              <Field label="Sort Code" v={banking.sort_code} editing={editing} onChange={x => setField('banking', 'sort_code', x)} />
              <Field label="Account No." v={banking.account_no} editing={editing} onChange={x => setField('banking', 'account_no', x)} />
            </Section>
          ) : (
            <Section title="Banking Details"><LockedNote /></Section>
          )}

          {/* Staff */}
          <Section title="Staff" onAdd={editing ? () => addListItem('staff', { name: '', role: '', phone: '' }) : null}>
            {staff.map((s, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: editing ? '1.4fr 1.4fr 1fr 24px' : '1.4fr 1.4fr 1fr', gap: 8, alignItems: 'center', padding: '3px 0' }}>
                {editing ? <>
                  <input value={s.name} onChange={e => setListItem('staff', i, 'name', e.target.value)} placeholder="Name" style={inp} />
                  <input value={s.role} onChange={e => setListItem('staff', i, 'role', e.target.value)} placeholder="Role" style={inp} />
                  <input value={s.phone} onChange={e => setListItem('staff', i, 'phone', e.target.value)} placeholder="Phone" style={inp} />
                  <button onClick={() => removeListItem('staff', i)} style={removeBtn}>✕</button>
                </> : <>
                  <span style={{ fontSize: 13 }}>{s.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--text2)' }}>{s.role}</span>
                  <span style={{ fontSize: 12, color: 'var(--text2)' }}>{s.phone}</span>
                </>}
              </div>
            ))}
          </Section>
        </div>
      )}
    </div>
  )
}

function Section({ title, children, onAdd }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, color: 'var(--text3)', textTransform: 'uppercase' }}>{title}</span>
        <div style={{ flex: 1, height: '0.5px', background: 'var(--border)' }} />
        {onAdd && <button onClick={onAdd} style={btn}>+ Add</button>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  )
}

function Field({ label, v, editing, onChange, link }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10, alignItems: 'center' }}>
      <span style={{ fontSize: 12, color: 'var(--text3)' }}>{label}</span>
      {editing
        ? <input value={v || ''} onChange={e => onChange(e.target.value)} style={inp} />
        : link && v
          ? <a href={v} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--blue, #378ADD)', wordBreak: 'break-all' }}>{v}</a>
          : <span style={{ fontSize: 13, color: 'var(--text)' }}>{v || '—'}</span>}
    </div>
  )
}

function LockedNote() {
  return <span style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>🔒 Restricted — you don't have permission to view this section.</span>
}

const btn = { fontSize: 11, lineHeight: '22px', padding: '0 10px', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }
const btnGreen = { border: '0.5px solid #448a40', color: '#448a40' }
const inp = { fontSize: 13, width: '100%' }
const listCard = { position: 'relative', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }
const removeBtn = { position: 'absolute', top: 6, right: 6, background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 13 }
