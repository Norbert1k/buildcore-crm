import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { SUB_STATUSES, DOCUMENT_TYPES, formatDate, formatDateTime, docStatusInfo, daysUntilExpiry, formatCurrency, complianceScore, NOTE_TYPES, exportToCSV } from '../lib/utils'
import { Avatar, Pill, Spinner, Modal, Field, IconPlus, IconEdit, IconTrash, IconChevron, ConfirmDialog } from '../components/ui'
import { useAuth } from '../lib/auth'
import SubcontractorModal from '../components/SubcontractorModal'
import DocumentModal from '../components/DocumentModal'

export default function SubcontractorDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can, profile } = useAuth()
  const [sub, setSub] = useState(null)
  const [docs, setDocs] = useState([])
  const [projects, setProjects] = useState([])
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('documents')
  const [showEditSub, setShowEditSub] = useState(false)
  const [showDocModal, setShowDocModal] = useState(false)
  const [editingDoc, setEditingDoc] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [showNoteModal, setShowNoteModal] = useState(false)
  const [noteForm, setNoteForm] = useState({ note: '', note_type: 'note' })
  const [savingNote, setSavingNote] = useState(false)

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    const [subRes, docsRes, projRes, notesRes] = await Promise.all([
      supabase.from('subcontractors').select('*').eq('id', id).single(),
      supabase.from('documents_with_status').select('*').eq('subcontractor_id', id).order('document_type'),
      supabase.from('project_subcontractors').select('*, projects(id, project_name, project_ref, status, start_date, end_date)').eq('subcontractor_id', id),
      supabase.from('subcontractor_notes').select('*, profiles(full_name)').eq('subcontractor_id', id).order('created_at', { ascending: false }),
    ])
    setSub(subRes.data)
    setDocs(docsRes.data || [])
    setProjects(projRes.data || [])
    setNotes(notesRes.data || [])
    setLoading(false)
  }

  async function deleteDoc(docId) {
    await supabase.from('documents').delete().eq('id', docId)
    setConfirmDelete(null)
    load()
  }

  async function saveNote() {
    if (!noteForm.note.trim()) return
    setSavingNote(true)
    await supabase.from('subcontractor_notes').insert({
      subcontractor_id: id,
      note: noteForm.note,
      note_type: noteForm.note_type,
      created_by: profile?.id,
    })
    setSavingNote(false)
    setShowNoteModal(false)
    setNoteForm({ note: '', note_type: 'note' })
    load()
  }

  async function deleteNote(noteId) {
    await supabase.from('subcontractor_notes').delete().eq('id', noteId)
    load()
  }

  function exportDocs() {
    const rows = docs.map(d => ({
      Document: DOCUMENT_TYPES[d.document_type] || d.document_name,
      Name: d.document_name,
      Reference: d.reference_number || '',
      'Issue Date': formatDate(d.issue_date),
      'Expiry Date': formatDate(d.expiry_date),
      Status: d.status || '',
      Notes: d.notes || '',
    }))
    exportToCSV(rows, `${sub.company_name}-documents.csv`)
  }

  if (loading) return <Spinner />
  if (!sub) return <div style={{ padding: 40, color: 'var(--text2)' }}>Subcontractor not found.</div>

  const expired = docs.filter(d => d.status === 'expired')
  const expiring = docs.filter(d => d.status === 'expiring_soon')
  const score = complianceScore(docs)

  return (
    <div>
      <button className="btn btn-sm" style={{ marginBottom: 16 }} onClick={() => navigate('/subcontractors')}>
        <IconChevron size={13} dir="left" /> Back
      </button>

      {/* Header */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
          <Avatar name={sub.company_name} size="lg" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>{sub.company_name}</h2>
              <Pill cls={SUB_STATUSES[sub.status]?.cls || 'pill-gray'}>{SUB_STATUSES[sub.status]?.label || sub.status}</Pill>
              <Pill cls="pill-blue">{sub.trade}</Pill>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {score && <ComplianceBadge score={score.score} />}
            {can('manage_subcontractors') && (
              <button className="btn btn-sm" onClick={() => setShowEditSub(true)}><IconEdit size={13} /> Edit</button>
            )}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px 24px' }}>
          {[
            ['Contact', sub.contact_name],
            ['Email', sub.email],
            ['Phone', sub.phone],
            ['Location', [sub.city, sub.postcode].filter(Boolean).join(' ')],
            ['Address', sub.address],
            ['Website', sub.website],
          ].filter(([, v]) => v).map(([k, v]) => (
            <div key={k} style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{k}</span>
              <span style={{ color: k === 'Email' || k === 'Website' ? 'var(--blue)' : 'var(--text)', wordBreak: 'break-all' }}>{v}</span>
            </div>
          ))}
        </div>
        {sub.notes && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--text2)' }}>
            {sub.notes}
          </div>
        )}
      </div>

      {/* Compliance alerts */}
      {(expired.length > 0 || expiring.length > 0) && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          {expired.length > 0 && <div style={{ flex: 1, minWidth: 200, background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 13, color: 'var(--red)', fontWeight: 500 }}>⚠ {expired.length} expired document{expired.length > 1 ? 's' : ''}</div>}
          {expiring.length > 0 && <div style={{ flex: 1, minWidth: 200, background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 13, color: 'var(--amber)', fontWeight: 500 }}>! {expiring.length} expiring within 30 days</div>}
        </div>
      )}

      {/* Tabs */}
      <div className="filter-tabs">
        <div className={`filter-tab ${activeTab === 'documents' ? 'active' : ''}`} onClick={() => setActiveTab('documents')}>Documents ({docs.length})</div>
        <div className={`filter-tab ${activeTab === 'activity' ? 'active' : ''}`} onClick={() => setActiveTab('activity')}>Activity ({notes.length})</div>
        <div className={`filter-tab ${activeTab === 'projects' ? 'active' : ''}`} onClick={() => setActiveTab('projects')}>Projects ({projects.length})</div>
      </div>

      {/* Documents tab */}
      {activeTab === 'documents' && (
        <div>
          <div className="section-header">
            <div className="section-title">Compliance Documents</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {docs.length > 0 && <button className="btn btn-sm" onClick={exportDocs}>↓ Export CSV</button>}
              {can('manage_documents') && (
                <button className="btn btn-primary btn-sm" onClick={() => { setEditingDoc(null); setShowDocModal(true) }}>
                  <IconPlus size={13} /> Add Document
                </button>
              )}
            </div>
          </div>
          {docs.length === 0 ? (
            <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No documents uploaded yet.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Document</th><th>Reference</th><th>Issue Date</th><th>Expiry Date</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {docs.map(doc => {
                    const info = docStatusInfo(doc.expiry_date)
                    const days = daysUntilExpiry(doc.expiry_date)
                    return (
                      <tr key={doc.id}>
                        <td>
                          <div style={{ fontWeight: 500 }}>{DOCUMENT_TYPES[doc.document_type] || doc.document_name}</div>
                          {doc.document_name !== DOCUMENT_TYPES[doc.document_type] && <div className="td-muted">{doc.document_name}</div>}
                          {doc.file_name && <div style={{ fontSize: 11, color: 'var(--blue)', marginTop: 2 }}>📎 {doc.file_name}</div>}
                        </td>
                        <td className="td-muted">{doc.reference_number || '—'}</td>
                        <td className="td-muted">{formatDate(doc.issue_date)}</td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{formatDate(doc.expiry_date)}</div>
                          {days !== null && <div style={{ fontSize: 11, color: days < 0 ? 'var(--red)' : days <= 30 ? 'var(--amber)' : 'var(--text3)' }}>
                            {days < 0 ? `${Math.abs(days)}d ago` : days === 0 ? 'Today' : `${days}d left`}
                          </div>}
                        </td>
                        <td><Pill cls={info?.cls || 'pill-gray'}>{info?.label || 'Unknown'}</Pill></td>
                        <td>
                          {can('manage_documents') && (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn btn-sm" onClick={() => { setEditingDoc(doc); setShowDocModal(true) }}><IconEdit size={12} /></button>
                              <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(doc.id)}><IconTrash size={12} /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Activity tab */}
      {activeTab === 'activity' && (
        <div>
          <div className="section-header">
            <div className="section-title">Activity Log</div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowNoteModal(true)}>
              <IconPlus size={13} /> Add Note
            </button>
          </div>
          {notes.length === 0 ? (
            <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No activity recorded yet. Add a note to track calls, visits or issues.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {notes.map(n => {
                const nt = NOTE_TYPES[n.note_type] || NOTE_TYPES.note
                return (
                  <div key={n.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', display: 'flex', gap: 12 }}>
                    <div style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>{nt.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: nt.color, background: 'var(--surface2)', padding: '1px 7px', borderRadius: 10 }}>{nt.label}</span>
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>{formatDateTime(n.created_at)}</span>
                        {n.profiles?.full_name && <span style={{ fontSize: 11, color: 'var(--text3)' }}>by {n.profiles.full_name}</span>}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{n.note}</div>
                    </div>
                    {can('manage_subcontractors') && (
                      <button className="btn btn-sm btn-danger" style={{ flexShrink: 0, alignSelf: 'flex-start' }} onClick={() => deleteNote(n.id)}><IconTrash size={12} /></button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Projects tab */}
      {activeTab === 'projects' && (
        <div>
          <div className="section-title" style={{ marginBottom: 12 }}>Assigned Projects</div>
          {projects.length === 0 ? (
            <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Not assigned to any projects.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Project</th><th>Ref</th><th>Dates</th><th>Contract Value</th><th>Status</th></tr></thead>
                <tbody>
                  {projects.map(ps => (
                    <tr key={ps.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${ps.project_id}`)}>
                      <td style={{ fontWeight: 500 }}>{ps.projects?.project_name}</td>
                      <td className="td-muted">{ps.projects?.project_ref || '—'}</td>
                      <td className="td-muted">{formatDate(ps.start_date)} – {formatDate(ps.end_date)}</td>
                      <td>{formatCurrency(ps.contract_value)}</td>
                      <td><Pill cls={ps.status === 'active' ? 'pill-green' : ps.status === 'completed' ? 'pill-blue' : 'pill-gray'}>{ps.status}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Add Note Modal */}
      <Modal open={showNoteModal} onClose={() => setShowNoteModal(false)} title="Add Activity Note" size="sm"
        footer={<><button className="btn" onClick={() => setShowNoteModal(false)}>Cancel</button><button className="btn btn-primary" onClick={saveNote} disabled={savingNote || !noteForm.note.trim()}>{savingNote ? 'Saving...' : 'Add Note'}</button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Type">
            <select value={noteForm.note_type} onChange={e => setNoteForm(f => ({ ...f, note_type: e.target.value }))}>
              {Object.entries(NOTE_TYPES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </Field>
          <Field label="Note *">
            <textarea value={noteForm.note} onChange={e => setNoteForm(f => ({ ...f, note: e.target.value }))} placeholder="What happened? Add any relevant details..." style={{ minHeight: 100 }} autoFocus />
          </Field>
        </div>
      </Modal>

      {showEditSub && <SubcontractorModal sub={sub} onClose={() => setShowEditSub(false)} onSaved={() => { setShowEditSub(false); load() }} />}
      {showDocModal && <DocumentModal doc={editingDoc} subcontractorId={id} onClose={() => setShowDocModal(false)} onSaved={() => { setShowDocModal(false); load() }} />}
      <ConfirmDialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={() => deleteDoc(confirmDelete)} title="Delete document" message="Are you sure you want to delete this document? This cannot be undone." danger />
    </div>
  )
}

function ComplianceBadge({ score }) {
  const color = score >= 80 ? 'var(--green)' : score >= 50 ? 'var(--amber)' : 'var(--red)'
  const bg = score >= 80 ? 'var(--green-bg)' : score >= 50 ? 'var(--amber-bg)' : 'var(--red-bg)'
  return <div style={{ background: bg, color, fontWeight: 700, fontSize: 13, padding: '4px 10px', borderRadius: 20, flexShrink: 0 }}>{score}%</div>
}
