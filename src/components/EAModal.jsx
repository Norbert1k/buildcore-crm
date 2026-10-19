import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Modal, Field } from './ui'
import { useAuth } from '../lib/auth'
import { ContactsEditor, loadEAContacts, saveContacts, validateContacts } from './EAContacts'

const missingTable = e => /does not exist|schema cache|employer_agent_contacts/i.test(e?.message || '')

export default function EAModal({ ea, onClose, onSaved }) {
  const { profile, division } = useAuth()
  const editing = !!ea

  const [form, setForm] = useState({
    company_name: ea?.company_name || '',
    contact_name: ea?.contact_name || '',
    phone: ea?.phone || '',
    email: ea?.email || '',
    payment_submission_email: ea?.payment_submission_email || '',
    website: ea?.website || '',
    status: ea?.status || 'active',
    street_address: ea?.street_address || '',
    city: ea?.city || '',
    postcode: ea?.postcode || '',
    notes: ea?.notes || '',
  })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  // People at the firm — several per firm, chosen per job when assigning
  const firmPerson = ea?.contact_name || ea?.email ? [{ _new: true, name: ea.contact_name || ea.email || '', job_title: '', email: ea.email || '', phone: ea.phone || '', is_primary: true }] : []
  const [people, setPeople] = useState(editing ? firmPerson : [])
  const [original, setOriginal] = useState([])
  useEffect(() => {
    if (!editing) return
    loadEAContacts([ea.id]).then(m => { const list = m[ea.id] || []; if (list.length) { setPeople(list); setOriginal(list) } })
  }, [ea?.id])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: '' })) }

  function validate() {
    const e = {}
    if (!form.company_name.trim()) e.company_name = 'Company name is required'
    const pe = validateContacts(people); if (pe) e.people = pe
    if (form.payment_submission_email && !/^\S+@\S+\.\S+$/.test(form.payment_submission_email)) e.payment_submission_email = 'Invalid email address'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save() {
    if (!validate()) return
    setSaving(true)
    // The firm's own contact fields follow the main person
    const main = people.filter(c => c.name?.trim()).find(c => c.is_primary) || people.find(c => c.name?.trim())
    const payload = { ...form, contact_name: main?.name?.trim() || '', email: main?.email?.trim() || '', phone: main?.phone?.trim() || '' }
    let result, eaId = ea?.id
    if (editing) {
      result = await supabase.from('employer_agents').update(payload).eq('id', ea.id)
    } else {
      payload.created_by = profile?.id
      payload.division = division   // EA firms are divisional
      result = await supabase.from('employer_agents').insert(payload).select('id').single()
      eaId = result.data?.id
    }
    if (result.error) { setSaving(false); setErrors({ _global: result.error.message }); return }
    try { if (eaId) await saveContacts(eaId, people, original, profile?.id) }
    catch (e) { if (!missingTable(e)) { setSaving(false); setErrors({ _global: 'Firm saved, but the people list could not be saved: ' + e.message }); return } }
    setSaving(false)
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit: ${ea.company_name}` : 'Add Employers Agent'}
      size="md"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add EA'}
          </button>
        </>
      }
    >
      {errors._global && (
        <div style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red-border)', borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 14, marginBottom: 14 }}>
          {errors._global}
        </div>
      )}
      <div className="form-grid">
        <div className="form-section">Company Details</div>
        <div className="full">
          <Field label="Company Name *" error={errors.company_name}>
            <input value={form.company_name} onChange={e => set('company_name', e.target.value)} placeholder="e.g. Arcadis LLP" autoFocus />
          </Field>
        </div>
        <Field label="Status">
          <select value={form.status} onChange={e => set('status', e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
        <div className="form-section">People at this firm</div>
        <div className="full" style={{ fontSize: 13, color: 'var(--text3)', marginTop: -4 }}>Add everyone you deal with. When you assign this firm to a job you pick which of them look after it.</div>
        <ContactsEditor rows={people} setRows={setPeople} error={errors.people} />
        <div className="form-section">Payment Application</div>
        <div className="full">
          <Field label="Payment Application Submission Email" error={errors.payment_submission_email}>
            <input type="email" value={form.payment_submission_email} onChange={e => set('payment_submission_email', e.target.value)} placeholder="valuations@company.com" />
          </Field>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
            Default email for submitting payment applications. Can be overridden per-project when assigning.
          </div>
        </div>
        <Field label="Website">
          <input value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://www.company.com" />
        </Field>
        <div className="form-section">Address</div>
        <div className="full">
          <Field label="Street Address">
            <input value={form.street_address} onChange={e => set('street_address', e.target.value)} placeholder="e.g. 10 Finsbury Square" />
          </Field>
        </div>
        <Field label="City / Town">
          <input value={form.city} onChange={e => set('city', e.target.value)} placeholder="London" />
        </Field>
        <Field label="Postcode">
          <input value={form.postcode} onChange={e => set('postcode', e.target.value)} placeholder="EC2A 1AF" />
        </Field>
        <div className="form-section">Notes</div>
        <div className="full">
          <Field label="Internal Notes">
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any internal notes about this EA…" style={{ minHeight: 80 }} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
