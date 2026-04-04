import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { DOCUMENT_TYPES } from '../lib/utils'
import { Modal, Field } from './ui'
import { useAuth } from '../lib/auth'

export default function DocumentModal({ doc, subcontractorId, onClose, onSaved }) {
  const { profile } = useAuth()
  const editing = !!doc

  const [form, setForm] = useState({
    document_type: doc?.document_type || 'rams',
    document_name: doc?.document_name || '',
    reference_number: doc?.reference_number || '',
    issue_date: doc?.issue_date || '',
    expiry_date: doc?.expiry_date || '',
    notes: doc?.notes || '',
    _nameManuallySet: false,
  })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  function set(k, v) {
    setForm(f => {
      const next = { ...f, [k]: v }
      if (k === 'document_type' && !editing && !f._nameManuallySet) {
        next.document_name = DOCUMENT_TYPES[v] || ''
      }
      return next
    })
    setErrors(e => ({ ...e, [k]: '' }))
  }

  function setName(v) {
    setForm(f => ({ ...f, document_name: v, _nameManuallySet: true }))
  }

  function validate() {
    const e = {}
    if (!form.document_name.trim()) e.document_name = 'Document name is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save() {
    if (!validate()) return
    setSaving(true)
    const payload = {
      document_type: form.document_type,
      document_name: form.document_name,
      reference_number: form.reference_number || null,
      issue_date: form.issue_date || null,
      expiry_date: form.expiry_date || null,
      notes: form.notes || null,
      subcontractor_id: subcontractorId,
      uploaded_by: profile?.id,
    }
    let result
    if (editing) {
      result = await supabase.from('documents').update(payload).eq('id', doc.id)
    } else {
      result = await supabase.from('documents').insert(payload)
    }
    setSaving(false)
    if (result.error) { setErrors({ _global: result.error.message }); return }
    onSaved()
  }

  const docGroups = {
    'Insurance': ['public_liability', 'employers_liability', 'professional_indemnity'],
    'Health & Safety': ['rams', 'method_statement', 'risk_assessment', 'f10_notification'],
    'Certifications': ['cscs_card', 'gas_safe', 'niceic', 'chas', 'constructionline', 'trade_certificate'],
    'Quality & Environment': ['iso_9001', 'iso_14001', 'iso_45001'],
    'Other': ['other'],
  }

  const days = form.expiry_date
    ? Math.round((new Date(form.expiry_date) - new Date()) / 86400000)
    : null

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Edit Document' : 'Add Document'}
      size="md"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Document'}
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
        <div className="full">
          <Field label="Document Type">
            <select value={form.document_type} onChange={e => set('document_type', e.target.value)}>
              {Object.entries(docGroups).map(([group, keys]) => (
                <optgroup key={group} label={group}>
                  {keys.map(k => <option key={k} value={k}>{DOCUMENT_TYPES[k]}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
        </div>
        <div className="full">
          <Field label="Document Name *" error={errors.document_name}>
            <input value={form.document_name} onChange={e => setName(e.target.value)} placeholder="e.g. Employers Liability Certificate 2025" />
          </Field>
        </div>
        <Field label="Reference / Certificate Number">
          <input value={form.reference_number} onChange={e => set('reference_number', e.target.value)} placeholder="e.g. EL-2025-00123" />
        </Field>
        <div />
        <Field label="Issue Date">
          <input type="date" value={form.issue_date} onChange={e => set('issue_date', e.target.value)} />
        </Field>
        <Field label="Expiry Date">
          <input type="date" value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)} />
        </Field>
        {days !== null && days < 0 && (
          <div className="full" style={{ background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 12, color: 'var(--red)' }}>
            This date is in the past — document will be marked as expired.
          </div>
        )}
        {days !== null && days >= 0 && days <= 30 && (
          <div className="full" style={{ background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 12, color: 'var(--amber)' }}>
            This document expires in {days} day{days !== 1 ? 's' : ''} — it will trigger an alert.
          </div>
        )}
        <div className="full">
          <Field label="Notes">
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="e.g. Covers up to £5m, renewed annually…" style={{ minHeight: 72 }} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
