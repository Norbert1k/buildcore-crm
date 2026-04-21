import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { DOCUMENT_TYPES } from '../lib/utils'
import { Modal, Field } from './ui'
import { useAuth } from '../lib/auth'

const INSURANCE_TYPES = ['public_liability', 'employers_liability', 'professional_indemnity']

export default function DocumentModal({ doc, subcontractorId, onClose, onSaved }) {
  const { profile } = useAuth()
  const editing = !!doc

  // Types is an array — multi-select for new docs; locked to the one type when editing
  const [types, setTypes] = useState(editing ? [doc.document_type] : ['rams'])
  const [form, setForm] = useState({
    document_name: doc?.document_name || '',
    reference_number: doc?.reference_number || '',
    issue_date: doc?.issue_date || '',
    expiry_date: doc?.expiry_date || '',
    notes: doc?.notes || '',
    _nameManuallySet: !!doc,
  })
  const [file, setFile] = useState(null)          // new file to upload (required for new, optional when editing)
  const [dragging, setDragging] = useState(false)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  function setName(v) {
    setForm(f => ({ ...f, document_name: v, _nameManuallySet: true }))
  }

  function toggleType(key) {
    if (editing) return // can't change type list when editing a single row
    setTypes(prev => {
      const next = prev.includes(key) ? prev.filter(t => t !== key) : [...prev, key]
      // Auto-set document_name from the first selected type, unless the user has typed their own name
      if (!form._nameManuallySet) {
        if (next.length === 1) {
          setForm(f => ({ ...f, document_name: DOCUMENT_TYPES[next[0]] || '' }))
        } else if (next.length > 1) {
          const labels = next.map(t => DOCUMENT_TYPES[t] || t)
          setForm(f => ({ ...f, document_name: labels.join(' + ') }))
        } else {
          setForm(f => ({ ...f, document_name: '' }))
        }
      }
      return next
    })
    setErrors(e => ({ ...e, types: '' }))
  }

  const hasInsurance = types.some(t => INSURANCE_TYPES.includes(t))

  function validate() {
    const e = {}
    if (types.length === 0) e.types = 'Select at least one document type'
    if (!form.document_name.trim()) e.document_name = 'Document name is required'
    if (hasInsurance && !form.expiry_date) e.expiry_date = 'Expiry date is required for insurance documents'
    // File is required when adding a new document (not when editing existing)
    if (!editing && !file) e.file = 'Please attach the document file'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save() {
    if (!validate()) return
    setSaving(true)

    let storagePath = doc?.storage_path || null
    let fileName = doc?.file_name || null
    let fileSize = doc?.file_size || null

    // Upload file to storage (new or replacement)
    if (file) {
      const safeName = file.name.replace(/[^\w.\-]/g, '_')
      storagePath = `subcontractors/${subcontractorId}/compliance/${Date.now()}-${safeName}`
      const { error: upErr } = await supabase.storage.from('project-docs').upload(storagePath, file)
      if (upErr) {
        setSaving(false)
        setErrors({ _global: 'Upload failed: ' + upErr.message })
        return
      }
      fileName = file.name
      fileSize = file.size
    }

    const basePayload = {
      document_name: form.document_name.trim(),
      reference_number: form.reference_number || null,
      issue_date: form.issue_date || null,
      expiry_date: form.expiry_date || null,
      notes: form.notes || null,
      subcontractor_id: subcontractorId,
      uploaded_by: profile?.id,
      storage_path: storagePath,
      file_name: fileName,
      file_size: fileSize,
    }

    let result
    if (editing) {
      // Update this row
      const updatePayload = { ...basePayload, document_type: doc.document_type }
      result = await supabase.from('documents').update(updatePayload).eq('id', doc.id).select()

      // If we uploaded a NEW file and this doc was linked to siblings (shared storage_path),
      // push the new file reference + metadata to all siblings so they stay in sync.
      if (file && doc.storage_path) {
        const siblingPayload = {
          storage_path: storagePath,
          file_name: fileName,
          file_size: fileSize,
          reference_number: form.reference_number || null,
          issue_date: form.issue_date || null,
          expiry_date: form.expiry_date || null,
          notes: form.notes || null,
        }
        await supabase.from('documents')
          .update(siblingPayload)
          .eq('storage_path', doc.storage_path)
          .neq('id', doc.id)
      }
    } else {
      // Insert one row per selected type, all sharing the same storage_path
      const rows = types.map(t => ({ ...basePayload, document_type: t }))
      result = await supabase.from('documents').insert(rows).select()
    }

    if (result.error) {
      setSaving(false)
      setErrors({ _global: 'Save failed: ' + result.error.message })
      return
    }

    // Verify storage_path actually made it into the DB. If it didn't, the DB
    // columns don't exist yet — roll back and tell the user.
    if (file && Array.isArray(result.data) && result.data.length > 0) {
      const persisted = result.data[0].storage_path
      if (!persisted) {
        // Clean up the orphaned storage file and the rows we just inserted
        if (storagePath) await supabase.storage.from('project-docs').remove([storagePath])
        if (!editing) {
          const ids = result.data.map(r => r.id)
          if (ids.length) await supabase.from('documents').delete().in('id', ids)
        }
        setSaving(false)
        setErrors({ _global: 'Database migration not applied yet — file columns are missing. Please run the add_document_storage_path.sql migration in Supabase, then try again.' })
        return
      }
    }

    setSaving(false)
    onSaved()
  }

  // Drop handler
  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer?.files?.[0]
    if (f) { setFile(f); setErrors(er => ({ ...er, file: '' })) }
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
            {saving ? 'Saving…' : editing ? 'Save Changes' : types.length > 1 ? `Add ${types.length} Documents` : 'Add Document'}
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
        {/* Document Type(s) — checkbox list for new, label for edit */}
        <div className="full">
          <Field label={editing ? 'Document Type' : 'Document Type(s) — tick all that this file covers *'} error={errors.types}>
            {editing ? (
              <div style={{ padding: '10px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14, color: 'var(--text)' }}>
                {DOCUMENT_TYPES[doc.document_type] || doc.document_type}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 10, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                {Object.entries(docGroups).map(([group, keys]) => (
                  <div key={group}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{group}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {keys.map(k => {
                        const on = types.includes(k)
                        return (
                          <label key={k}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 6,
                              padding: '6px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                              background: on ? 'var(--accent)' : 'var(--surface)',
                              color: on ? '#fff' : 'var(--text)',
                              border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border)'),
                              userSelect: 'none',
                              transition: 'background .1s, color .1s'
                            }}>
                            <input type="checkbox" checked={on} onChange={() => toggleType(k)} style={{ display: 'none' }} />
                            <span style={{
                              width: 12, height: 12, borderRadius: 3, flexShrink: 0,
                              border: '1.5px solid ' + (on ? '#fff' : 'var(--text3)'),
                              background: on ? '#fff' : 'transparent',
                              display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}>
                              {on && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="4"><polyline points="20 6 9 17 4 12"/></svg>}
                            </span>
                            {DOCUMENT_TYPES[k]}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
                {types.length > 1 && (
                  <div style={{ background: 'var(--blue-bg, #e6f1fb)', color: 'var(--blue, #185FA5)', padding: '6px 10px', borderRadius: 5, fontSize: 11, fontWeight: 500 }}>
                    ✓ Will create {types.length} linked rows. One file, one set of details — all {types.length} will share expiry, reference, and notes.
                  </div>
                )}
              </div>
            )}
          </Field>
        </div>

        {/* File upload / drop zone */}
        <div className="full">
          <Field label={editing ? 'Replace file (optional)' : 'Document File *'} error={errors.file}>
            <div onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => document.getElementById('_doc_file_input')?.click()}
              style={{
                padding: '18px 14px',
                border: '1.5px dashed ' + (errors.file ? 'var(--red-border)' : dragging ? 'var(--accent)' : 'var(--border)'),
                borderRadius: 8,
                background: dragging ? 'rgba(68, 138, 64, 0.08)' : 'var(--surface2)',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'border .1s, background .1s',
              }}>
              {file ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.7"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', wordBreak: 'break-all' }}>{file.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{(file.size / 1024).toFixed(1)} KB</div>
                  </div>
                  <button type="button" onClick={e => { e.stopPropagation(); setFile(null) }}
                    style={{ fontSize: 11, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>
                    Remove
                  </button>
                </div>
              ) : editing && doc?.file_name ? (
                <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                  <div style={{ fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>📎 {doc.file_name}</div>
                  <div>Drop a new file here to replace, or click to browse</div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                  <div style={{ marginBottom: 4, fontWeight: 500, color: 'var(--text2)' }}>
                    📎 Drop your file here or click to browse
                  </div>
                  <div>PDF, image, or any document format</div>
                </div>
              )}
              <input
                id="_doc_file_input"
                type="file"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); setErrors(er => ({ ...er, file: '' })) } }}
              />
            </div>
          </Field>
        </div>

        <div className="full">
          <Field label="Document Name *" error={errors.document_name}>
            <input value={form.document_name} onChange={e => setName(e.target.value)} placeholder="e.g. Employers Liability Certificate 2025" />
          </Field>
        </div>
        <Field label="Reference / Certificate Number">
          <input value={form.reference_number} onChange={e => setForm(f => ({ ...f, reference_number: e.target.value }))} placeholder="e.g. EL-2025-00123" />
        </Field>
        <div />
        <Field label="Issue Date">
          <input type="date" value={form.issue_date} onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))} />
        </Field>
        <Field label={hasInsurance ? 'Expiry Date *' : 'Expiry Date'} error={errors.expiry_date}>
          <input type="date" value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} />
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
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. Covers up to £5m, renewed annually…" style={{ minHeight: 72 }} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
