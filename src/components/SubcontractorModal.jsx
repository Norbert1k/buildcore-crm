import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { TRADES, DESIGN_TEAM_TRADES, SUB_STATUSES } from '../lib/utils'
import { Modal, Field } from './ui'
import { useAuth } from '../lib/auth'

export default function SubcontractorModal({ sub, onClose, onSaved, defaultCategory }) {
  const { profile } = useAuth()
  const editing = !!sub

  const [form, setForm] = useState({
    company_name: sub?.company_name || '',
    contact_name: sub?.contact_name || '',
    contact_role: sub?.contact_role || '',
    trade: sub?.trade || TRADES[0],
    email: sub?.email || '',
    phone: sub?.phone || '',
    address: sub?.address || '',
    city: sub?.city || '',
    postcode: sub?.postcode || '',
    website: sub?.website || '',
    status: sub?.status || 'active',
    vat_number: sub?.vat_number || '',
    cis_number: sub?.cis_number || '',
    cis_verified: sub?.cis_verified || false,
    notes: sub?.notes || '',
    category: sub?.category || defaultCategory || 'subcontractor',
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

  const isDesignTeam = form.category === 'design_team' || defaultCategory === 'design_team'
  const entityLabel = isDesignTeam ? 'Design Team' : 'Subcontractor'

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit: ${sub.company_name}` : `Add New ${entityLabel}`}
      size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : `Add ${entityLabel}`}
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
        <Field label="Contact Role / Job Title">
          <select value={form.contact_role} onChange={e => set('contact_role', e.target.value)}>
            <option value="">— Select role —</option>
            {['Director','Managing Director','Contracts Manager','Site Manager','Project Manager','Quantity Surveyor','Estimator','Foreman','H&S Manager','Office Manager','Accounts','Engineer','Supervisor','Other'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Trade / Specialty *" error={errors.trade}>
          <select value={form.trade} onChange={e => {
            set('trade', e.target.value)
            if (!editing) set('category', DESIGN_TEAM_TRADES.includes(e.target.value) ? 'design_team' : 'subcontractor')
          }}>
            {TRADES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Category">
          <select value={form.category} onChange={e => set('category', e.target.value)}>
            <option value="subcontractor">Subcontractor</option>
            <option value="design_team">Design Team</option>
            <option value="both">Both</option>
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
        <div className="form-section">Compliance Numbers</div>
        <Field label="VAT Number">
          <input value={form.vat_number} onChange={e => set('vat_number', e.target.value)} placeholder="e.g. GB123456789" />
        </Field>
        <Field label="CIS Number">
          <input value={form.cis_number} onChange={e => set('cis_number', e.target.value)} placeholder="e.g. 1234567890" />
        </Field>
        <div className="full">
          <div onClick={() => set('cis_verified', !form.cis_verified)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 14px', borderRadius: 'var(--radius)', border: `1.5px solid ${form.cis_verified ? 'var(--green)' : 'var(--border)'}`, background: form.cis_verified ? 'var(--green-bg)' : 'var(--surface2)' }}>
            <div style={{ width: 20, height: 20, borderRadius: 4, border: `2px solid ${form.cis_verified ? 'var(--green)' : 'var(--border2)'}`, background: form.cis_verified ? 'var(--green)' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {form.cis_verified && <svg width="11" height="11" viewBox="0 0 12 12"><path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: form.cis_verified ? 'var(--green)' : 'var(--text)' }}>✓ CIS verified with HMRC</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>Tick when HMRC verification has been completed</div>
            </div>
          </div>
        </div>
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
