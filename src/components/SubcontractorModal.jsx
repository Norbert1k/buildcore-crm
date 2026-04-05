import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { TRADES, SUB_STATUSES } from '../lib/utils'
import { Modal, Field } from './ui'
import { useAuth } from '../lib/auth'

export default function SubcontractorModal({ sub, onClose, onSaved }) {
  const { profile } = useAuth()
  const editing = !!sub

  const [form, setForm] = useState({
    company_name: sub?.company_name || '',
    contact_name: sub?.contact_name || '',
    trade: sub?.trade || TRADES[0],
    email: sub?.email || '',
    phone: sub?.phone || '',
    address: sub?.address || '',
    city: sub?.city || '',
    postcode: sub?.postcode || '',
    website: sub?.website || '',
    status: sub?.status || 'active',
    notes: sub?.notes || '',
  })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: '' })) }

  function validate() {
    const e = {}
    if (!form.company_name.trim()) e.company_name = 'Company name is required'
    if (!form.contact_name.trim()) e.contact_name = 'Contact name is required'
    if (!form.trade) e.trade = 'Trade is required'
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) e.email = 'Invalid email address'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save() {
    if (!validate()) return
    setSaving(true)
    const payload = { ...form }
    let result
    if (editing) {
      result = await supabase.from('subcontractors').update(payload).eq('id', sub.id)
    } else {
      payload.created_by = profile?.id
      result = await supabase.from('subcontractors').insert(payload)
    }
    setSaving(false)
    if (result.error) { setErrors({ _global: result.error.message }); return }
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit: ${sub.company_name}` : 'Add New Subcontractor'}
      size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Subcontractor'}
          </button>
        </>
      }
    >
      {errors._global && (
        <div style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red-border)', borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 13, marginBottom: 14 }}>
          {errors._global}
        </div>
      )}
      <div className="form-grid">
        <div className="form-section">Company Details</div>
        <div className="full">
          <Field label="Company Name *" error={errors.company_name}>
            <input value={form.company_name} onChange={e => set('company_name', e.target.value)} placeholder="e.g. Smith Electrical Ltd" autoFocus />
          </Field>
        </div>
        <Field label="Contact Name *" error={errors.contact_name}>
          <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)} placeholder="Primary contact" />
        </Field>
        <Field label="Trade / Specialty *" error={errors.trade}>
          <select value={form.trade} onChange={e => set('trade', e.target.value)}>
            {TRADES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Email Address" error={errors.email}>
          <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="contact@company.com" />
        </Field>
        <Field label="Phone Number">
          <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+44 7700 900000" />
        </Field>
        <Field label="Status">
          <select value={form.status} onChange={e => set('status', e.target.value)}>
            {Object.entries(SUB_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
        <Field label="Website">
          <input value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://www.company.com" />
        </Field>
        <div className="form-section">Address</div>
        <div className="full">
          <Field label="Street Address">
            <input value={form.address} onChange={e => set('address', e.target.value)} placeholder="123 High Street" />
          </Field>
        </div>
        <Field label="City / Town">
          <input value={form.city} onChange={e => set('city', e.target.value)} placeholder="London" />
        </Field>
        <Field label="Postcode">
          <input value={form.postcode} onChange={e => set('postcode', e.target.value)} placeholder="SW1A 1AA" />
        </Field>
        <div className="form-section">Notes</div>
        <div className="full">
          <Field label="Internal Notes">
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any internal notes about this subcontractor…" style={{ minHeight: 80 }} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
