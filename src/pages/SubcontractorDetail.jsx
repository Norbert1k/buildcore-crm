import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { SUB_STATUSES, DOCUMENT_TYPES, formatDate, formatDateTime, docStatusInfo, daysUntilExpiry, formatCurrency, complianceScore, NOTE_TYPES, exportToCSV } from '../lib/utils'
import { Avatar, Pill, Spinner, Modal, Field, IconPlus, IconEdit, IconTrash, IconChevron, ConfirmDialog } from '../components/ui'
import { useAuth } from '../lib/auth'
import SubcontractorModal from '../components/SubcontractorModal'
import DocumentModal from '../components/DocumentModal'
import ContactsTab from '../components/ContactsTab'
import PerformanceTab, { RatingBadge, calcRating } from '../components/PerformanceTab'

export default function SubcontractorDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can, profile } = useAuth()
  const [sub, setSub] = useState(null)
  const [docs, setDocs] = useState([])
  const [projects, setProjects] = useState([])
  const [notes, setNotes] = useState([])
  const [contacts, setContacts] = useState([])
  const [ratings, setRatings] = useState([])
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
    const [subRes, docsRes, projRes, notesRes, contactsRes, ratingsRes] = await Promise.all([
      supabase.from('subcontractors').select('*').eq('id', id).single(),
      supabase.from('documents_with_status').select('*').eq('subcontractor_id', id).order('document_type'),
      supabase.from('project_subcontractors').select('*, projects(id, project_name, project_ref, status, start_date, end_date)').eq('subcontractor_id', id),
      supabase.from('subcontractor_notes').select('*, profiles(full_name)').eq('subcontractor_id', id).order('created_at', { ascending: false }),
      supabase.from('subcontractor_contacts').select('*').eq('subcontractor_id', id).order('is_primary', { ascending: false }),
      supabase.from('performance_ratings').select('*, profiles(full_name), projects(project_name)').eq('subcontractor_id', id).order('created_at', { ascending: false }),
    ])
    setSub(subRes.data)
    setDocs(docsRes.data || [])
    setProjects(projRes.data || [])
    setNotes(notesRes.data || [])
    setContacts(contactsRes.data || [])
    setRatings(ratingsRes.data || [])
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
  const rating = calcRating(ratings)
  const allProjects = projects.map(ps => ps.projects).filter(Boolean)

  // Format address properly
  const addressParts = [sub.address, sub.city, sub.postcode].filter(Boolean)
  const fullAddress = addressParts.join(', ')
  const locationDisplay = [sub.city, sub.postcode].filter(Boolean).join(', ')

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
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {score && <div style={{ background: score.score >= 80 ? 'var(--green-bg)' : score.score >= 50 ? 'var(--amber-bg)' : 'var(--red-bg)', color: score.score >= 80 ? 'var(--green)' : score.score >= 50 ? 'var(--amber)' : 'var(--red)', fontWeight: 700, fontSize: 12, padding: '3px 10px', borderRadius: 20 }}>Docs {score.score}%</div>}
            {rating && <RatingBadge ratings={ratings} />}
            {can('manage_subcontractors') && (
              <button className="btn btn-sm" onClick={() => setShowEditSub(true)}><IconEdit size={13} /> Edit</button>
            )}
          </div>
        </div>

        {/* Contact details grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px 24px', marginBottom: sub.vat_number || sub.cis_number ? 12 : 0 }}>
          {[
            ['Contact', sub.contact_name ? `${sub.contact_name}${sub.contact_role ? ` (${sub.contact_role})` : ''}` : null],
            ['Email', sub.email],
            ['Phone', sub.phone],
            ['Location', locationDisplay],
            ['Address', fullAddress],
          ].filter(([, v]) => v).map(([k, v]) => (
            <div key={k} style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{k}</span>
              {k === 'Email' ? (
                <a href={`mailto:${v}`} style={{ color: 'var(--blue)', textDecoration: 'none', wordBreak: 'break-all' }}>{v}</a>
              ) : k === 'Website' ? (
                <a href={v.startsWith('http') ? v : `https://${v}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)', textDecoration: 'none' }}>{v}</a>
              ) : (
                <span style={{ color: 'var(--text)', wordBreak: 'break-word' }}>{v}</span>
              )}
            </div>
          ))}

          {/* Website — clickable */}
          {sub.website && (
            <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Website</span>
              <a href={sub.website.startsWith('http') ? sub.website : `https://${sub.website}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)', textDecoration: 'none', wordBreak: 'break-all' }}>
                {sub.website}
              </a>
            </div>
          )}
        </div>

        {/* VAT & CIS */}
        {(sub.vat_number || sub.cis_number) && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: '10px 14px', background: 'var(--surface2)', borderRadius: 'var(--radius)', fontSize: 13, marginBottom: 4 }}>
            {sub.vat_number && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>VAT No.</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600 }}>{sub.vat_number}</span>
              </div>
            )}
            {sub.cis_number && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>CIS No.</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600 }}>{sub.cis_number}</span>
                {sub.cis_verified && <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>✓ Verified</span>}
              </div>
            )}
          </div>
        )}

        {/* Notes */}
        {sub.notes && (
          <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--text2)', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
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
        {[
          ['documents', `Documents (${docs.length})`],
          ['contacts', `Contacts (${contacts.length})`],
          ['performance', `Performance (${ratings.length})`],
          ['activity', `Activity (${notes.length})`],
          ['projects', `Projects (${projects.length})`],
        ].map(([key, label]) => (
          <div key={key} className={`filter-tab ${activeTab === key ? 'active' : ''}`} onClick={() => setActiveTab(key)}>{label}</div>
        ))}
      </div>

      {/* Documents */}
      {activeTab === 'documents' && (
        <div>
          <div className="section-header">
            <div className="section-title">Compliance Documents</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {docs.length > 0 && <button className="btn btn-sm" onClick={exportDocs}>↓ CSV</button>}
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
                <thead><tr><th>Document</th><th>Reference</th><th>Issue Date</th><th>Expiry Date</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {docs.map(doc => {
                    const info = docStatusInfo(doc.expiry_date)
                    const days = daysUntilExpiry(doc.expiry_date)
                    return (
                      <tr key={doc.id}>
                        <td>
                          <div style={{ fontWeight: 500 }}>{DOCUMENT_TYPES[doc.document_type] || doc.document_name}</div>
                          {doc.document_name !== DOCUMENT_TYPES[doc.document_type] && <div className="td-muted">{doc.document_name}</div>}
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

      {/* Contacts */}
      {activeTab === 'contacts' && (
        <ContactsTab subcontractorId={id} contacts={contacts} onRefresh={load} />
      )}

      {/* Performance */}
      {activeTab === 'performance' && (
        <PerformanceTab
          subcontractorId={id}
          subName={sub.company_name}
          subEmail={sub.email}
          ratings={ratings}
          projects={allProjects}
          onRefresh={load}
        />
      )}

      {/* Activity */}
      {activeTab === 'activity' && (
        <div>
          <div className="section-header">
            <div className="section-title">Activity Log</div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowNoteModal(true)}>
              <IconPlus size={13} /> Add Note
            </button>
          </div>
          {notes.length === 0 ? (
            <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No activity recorded yet.</div>
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

      {/* Projects */}
      {activeTab === 'projects' && (
        <div>
          <div className="section-title" style={{ marginBottom: 12 }}>Assigned Projects</div>
          {projects.length === 0 ? (
            <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Not assigned to any projects.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Project</th><th>Ref</th><th>Dates</th><th>Value</th><th>Status</th></tr></thead>
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
            <textarea value={noteForm.note} onChange={e => setNoteForm(f => ({ ...f, note: e.target.value }))} placeholder="What happened?" style={{ minHeight: 100 }} autoFocus />
          </Field>
        </div>
      </Modal>

      {showEditSub && <SubcontractorModal sub={sub} onClose={() => setShowEditSub(false)} onSaved={() => { setShowEditSub(false); load() }} />}
      {showDocModal && <DocumentModal doc={editingDoc} subcontractorId={id} onClose={() => setShowDocModal(false)} onSaved={() => { setShowDocModal(false); load() }} />}
      <ConfirmDialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={() => deleteDoc(confirmDelete)} title="Delete document" message="Are you sure? This cannot be undone." danger />
    </div>
  )
}
