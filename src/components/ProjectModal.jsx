import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { PROJECT_STATUSES } from '../lib/utils'
import { Modal, Field } from './ui'
import { useAuth } from '../lib/auth'

export default function ProjectModal({ project, onClose, onSaved }) {
  const { profile } = useAuth()
  const editing = !!project
  const [managers, setManagers] = useState([])

  const [form, setForm] = useState({
    project_name: project?.project_name || '',
    project_ref: project?.project_ref || '',
    client_name: project?.client_name || '',
    site_address: project?.site_address || '',
    city: project?.city || '',
    postcode: project?.postcode || '',
    status: project?.status || 'active',
    start_date: project?.start_date || '',
    end_date: project?.end_date || '',
    project_manager_id: project?.project_manager_id || '',
    value: project?.value || '',
    description: project?.description || '',
  })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('role', ['admin', 'project_manager'])
      .order('full_name')
      .then(({ data }) => setManagers(data || []))
  }, [])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: '' })) }

  function validate() {
    const e = {}
    if (!form.project_name.trim()) e.project_name = 'Project name is required'
    if (form.end_date && form.start_date && form.end_date < form.start_date) {
      e.end_date = 'End date cannot be before start date'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save() {
    if (!validate()) return
    setSaving(true)
    const payload = {
      ...form,
      value: form.value ? parseFloat(form.value) : null,
      project_manager_id: form.project_manager_id || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
    }

    let error
    if (editing) {
      ;({ error } = await supabase.from('projects').update(payload).eq('id', project.id))
    } else {
      payload.created_by = profile?.id
      ;({ error } = await supabase.from('projects').insert(payload))
    }
    setSaving(false)
    if (error) { setErrors({ _global: error.message }); return }
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit — ${project.project_name}` : 'Create New Project'}
      size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Project'}
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
        <div className="form-section">Project Details</div>

        <div className="full">
          <Field label="Project Name *" error={errors.project_name}>
            <input value={form.project_name} onChange={e => set('project_name', e.target.value)} placeholder="e.g. Riverside Apartments — Phase 2" autoFocus />
          </Field>
        </div>

        <Field label="Project Reference">
          <input value={form.project_ref} onChange={e => set('project_ref', e.target.value)} placeholder="e.g. PRJ-2025-042" />
        </Field>

        <Field label="Client Name">
          <input value={form.client_name} onChange={e => set('client_name', e.target.value)} placeholder="Client company or individual" />
        </Field>

        <Field label="Status">
          <select value={form.status} onChange={e => set('status', e.target.value)}>
            {Object.entries(PROJECT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>

        <Field label="Project Manager">
          <select value={form.project_manager_id} onChange={e => set('project_manager_id', e.target.value)}>
            <option value="">— Unassigned —</option>
            {managers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </select>
        </Field>

        <Field label="Contract Value (£)">
          <input type="number" value={form.value} onChange={e => set('value', e.target.value)} placeholder="0" min="0" step="1000" />
        </Field>

        <div className="form-section">Dates</div>

        <Field label="Start Date">
          <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
        </Field>

        <Field label="End Date" error={errors.end_date}>
          <input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
        </Field>

        <div className="form-section">Site Address</div>

        <div className="full">
          <Field label="Site Address">
            <input value={form.site_address} onChange={e => set('site_address', e.target.value)} placeholder="Street address of the site" />
          </Field>
        </div>

        <Field label="City / Town">
          <input value={form.city} onChange={e => set('city', e.target.value)} placeholder="London" />
        </Field>

        <Field label="Postcode">
          <input value={form.postcode} onChange={e => set('postcode', e.target.value)} placeholder="SW1A 1AA" />
        </Field>

        <div className="form-section">Additional Info</div>

        <div className="full">
          <Field label="Description / Notes">
            <textarea value={form.description} onChange={e => set('description', e.target.value)} placeholder="Project scope, notes, or any additional details…" />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
