import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Avatar, Pill, Modal, Field, IconPlus, IconEdit, IconTrash, ConfirmDialog } from './ui'
import { useAuth } from '../lib/auth'

const JOB_TITLES = [
  'Director', 'Managing Director', 'Contracts Manager', 'Site Manager',
  'Project Manager', 'Quantity Surveyor', 'Estimator', 'Foreman',
  'Health & Safety Manager', 'Office Manager', 'Accounts', 'Engineer',
  'Supervisor', 'Other'
]

export default function ContactsTab({ subcontractorId, contacts, onRefresh }) {
  const { can } = useAuth()
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const primary = contacts.find(c => c.is_primary)
  const others = contacts.filter(c => !c.is_primary)
  const sorted = [...(primary ? [primary] : []), ...others]

  async function setPrimary(contactId) {
    // Remove primary from all
    await supabase.from('subcontractor_contacts')
      .update({ is_primary: false })
      .eq('subcontractor_id', subcontractorId)
    // Set new primary
    await supabase.from('subcontractor_contacts')
      .update({ is_primary: true })
      .eq('id', contactId)
    onRefresh()
  }

  async function deleteContact(id) {
    await supabase.from('subcontractor_contacts').delete().eq('id', id)
    setConfirmDelete(null)
    onRefresh()
  }

  return (
    <div>
      <div className="section-header">
        <div className="section-title">Contacts ({contacts.length})</div>
        {can('manage_documents') && (
          <button className="btn btn-primary btn-sm" onClick={() => { setEditing(null); setShowModal(true) }}>
            <IconPlus size={13} /> Add Contact
          </button>
        )}
      </div>

      {contacts.length === 0 ? (
        <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
          No contacts added yet. Add the key people at this company.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
          {sorted.map(c => (
            <ContactCard
              key={c.id}
              contact={c}
              canEdit={can('manage_documents')}
              onEdit={() => { setEditing(c); setShowModal(true) }}
              onDelete={() => setConfirmDelete(c.id)}
              onSetPrimary={() => setPrimary(c.id)}
            />
          ))}
        </div>
      )}

      {showModal && (
        <ContactModal
          contact={editing}
          subcontractorId={subcontractorId}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); onRefresh() }}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => deleteContact(confirmDelete)}
        title="Remove contact"
        message="Remove this contact? This cannot be undone."
        danger
      />
    </div>
  )
}

function ContactCard({ contact, canEdit, onEdit, onDelete, onSetPrimary }) {
  return (
    <div style={{
      background: 'var(--surface)', border: `1px solid ${contact.is_primary ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-lg)', padding: '14px 16px',
      borderTop: contact.is_primary ? '3px solid var(--accent)' : '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <Avatar name={contact.full_name} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{contact.full_name}</div>
            {contact.is_primary && <Pill cls="pill-green" style={{ fontSize: 10 }}>Primary</Pill>}
          </div>
          {contact.job_title && (
            <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, marginTop: 2 }}>{contact.job_title}</div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13 }}>
        {contact.phone && (
          <a href={`tel:${contact.phone}`} style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)', textDecoration: 'none' }}>
            <span style={{ fontSize: 14 }}>📞</span>
            <span>{contact.phone}</span>
          </a>
        )}
        {contact.mobile && (
          <a href={`tel:${contact.mobile}`} style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)', textDecoration: 'none' }}>
            <span style={{ fontSize: 14 }}>📱</span>
            <span>{contact.mobile}</span>
          </a>
        )}
        {contact.email && (
          <a href={`mailto:${contact.email}`} style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--blue)', textDecoration: 'none', overflow: 'hidden' }}>
            <span style={{ fontSize: 14 }}>✉️</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact.email}</span>
          </a>
        )}
        {contact.notes && (
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4, fontStyle: 'italic' }}>{contact.notes}</div>
        )}
      </div>

      {canEdit && (
        <div style={{ display: 'flex', gap: 6, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          {!contact.is_primary && (
            <button className="btn btn-sm" style={{ flex: 1, justifyContent: 'center', fontSize: 11 }} onClick={onSetPrimary}>
              Set Primary
            </button>
          )}
          <button className="btn btn-sm" onClick={onEdit}><IconEdit size={12} /></button>
          <button className="btn btn-sm btn-danger" onClick={onDelete}><IconTrash size={12} /></button>
        </div>
      )}
    </div>
  )
}

function ContactModal({ contact, subcontractorId, onClose, onSaved }) {
  const editing = !!contact
  const [form, setForm] = useState({
    full_name: contact?.full_name || '',
    job_title: contact?.job_title || '',
    email: contact?.email || '',
    phone: contact?.phone || '',
    mobile: contact?.mobile || '',
    is_primary: contact?.is_primary || false,
    notes: contact?.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    if (!form.full_name.trim()) { setError('Full name is required'); return }
    setSaving(true)
    const payload = { ...form, subcontractor_id: subcontractorId }

    // If setting as primary, remove primary from others first
    if (form.is_primary) {
      await supabase.from('subcontractor_contacts')
        .update({ is_primary: false })
        .eq('subcontractor_id', subcontractorId)
    }

    let result
    if (editing) {
      result = await supabase.from('subcontractor_contacts').update(payload).eq('id', contact.id)
    } else {
      result = await supabase.from('subcontractor_contacts').insert(payload)
    }
    setSaving(false)
    if (result.error) { setError(result.error.message); return }
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit: ${contact.full_name}` : 'Add Contact'}
      size="sm"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Contact'}
          </button>
        </>
      }
    >
      {error && (
        <div style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red-border)', borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 13, marginBottom: 14 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Full Name *">
          <input value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="e.g. John Smith" autoFocus />
        </Field>
        <Field label="Job Title / Role">
          <select value={form.job_title} onChange={e => set('job_title', e.target.value)}>
            <option value="">— Select role —</option>
            {JOB_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Phone (office)">
          <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+44 ..." />
        </Field>
        <Field label="Mobile">
          <input value={form.mobile} onChange={e => set('mobile', e.target.value)} placeholder="+44 7..." />
        </Field>
        <Field label="Email">
          <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="john@company.com" />
        </Field>
        <Field label="Notes">
          <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="e.g. Best to call mornings" />
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontWeight: 400 }}>
          <input
            type="checkbox"
            checked={form.is_primary}
            onChange={e => set('is_primary', e.target.checked)}
            style={{ width: 16, height: 16, flexShrink: 0 }}
          />
          <span>Set as primary contact for this company</span>
        </label>
      </div>
    </Modal>
  )
}
