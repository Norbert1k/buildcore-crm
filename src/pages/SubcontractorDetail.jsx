import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
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
  const location = useLocation()
  const backPath = location.state?.from || '/subcontractors'
  const { can, profile } = useAuth()
  const [sub, setSub] = useState(null)
  const [docs, setDocs] = useState([])
  const [projects, setProjects] = useState([])
  const [notes, setNotes] = useState([])
  const [contacts, setContacts] = useState([])
  const [ratings, setRatings] = useState([])
  const [availableProjects, setAvailableProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const _tabKey = 'tab:' + window.location.pathname
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem(_tabKey) || 'documents')
  const [showEditSub, setShowEditSub] = useState(false)
  const [approvingPayment, setApprovingPayment] = useState(false)
  const [showDocModal, setShowDocModal] = useState(false)
  const [editingDoc, setEditingDoc] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [confirmDeleteSub, setConfirmDeleteSub] = useState(false)
  const [showBlacklistModal, setShowBlacklistModal] = useState(false)
  const [blacklistForm, setBlacklistForm] = useState({ reason: '' })
  const [savingBlacklist, setSavingBlacklist] = useState(false)
  const [confirmUnblacklist, setConfirmUnblacklist] = useState(false)
  const [showNoteModal, setShowNoteModal] = useState(false)
  const [noteForm, setNoteForm] = useState({ note: '', note_type: 'note' })
  const [savingNote, setSavingNote] = useState(false)
  const [previewDoc, setPreviewDoc] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    const [subRes, docsRes, projRes, allProjRes, notesRes, contactsRes, ratingsRes] = await Promise.all([
      supabase.from('subcontractors').select('*').eq('id', id).single(),
      supabase.from('documents_with_status').select('*').eq('subcontractor_id', id).order('document_type'),
      supabase.from('project_subcontractors').select('id, project_id, start_date, end_date, contract_value, variation_amount, variation_notes, status, trade_on_project, projects(id, project_name, project_ref, status, start_date, end_date, client_name)').eq('subcontractor_id', id),
      supabase.from('projects').select('id, project_name, project_ref, status').eq('status', 'active').order('project_name'),
      supabase.from('subcontractor_notes').select('*, profiles(full_name)').eq('subcontractor_id', id).order('created_at', { ascending: false }),
      supabase.from('subcontractor_contacts').select('*').eq('subcontractor_id', id).order('is_primary', { ascending: false }),
      supabase.from('performance_ratings').select('*, profiles(full_name), projects(project_name)').eq('subcontractor_id', id).order('created_at', { ascending: false }),
    ])
    setSub(subRes.data)
    setDocs(docsRes.data || [])
    setProjects(projRes.data || [])
    setAvailableProjects(allProjRes?.data || [])
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

  // File preview helpers — opens docs inline (modal), same pattern as Documentation/H&S
  function docFileTypeInfo(fileName) {
    const n = (fileName || '').toLowerCase()
    return {
      isImage: /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n),
      isPdf: /\.pdf$/i.test(n),
    }
  }

  async function openDocPreview(doc) {
    if (!doc?.storage_path) return
    setPreviewDoc(doc)
    setPreviewUrl(null)
    const { data } = await supabase.storage.from('project-docs').createSignedUrl(doc.storage_path, 3600)
    if (data?.signedUrl) setPreviewUrl(data.signedUrl)
  }

  async function triggerDocDownload() {
    if (!previewUrl || !previewDoc) return
    try {
      const res = await fetch(previewUrl)
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = previewDoc.file_name || 'document'
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    } catch (e) {
      window.open(previewUrl, '_blank')
    }
  }


  async function togglePaymentApproval() {
    setApprovingPayment(true)
    const newVal = !sub.approved
    await supabase.from('subcontractors').update({
      approved: newVal,
      approved_by: newVal ? profile?.id : null,
      approved_at: newVal ? new Date().toISOString() : null,
    }).eq('id', id)
    setSub(s => ({ ...s, approved: newVal, approved_by: newVal ? profile?.id : null, approved_at: newVal ? new Date().toISOString() : null }))
    setApprovingPayment(false)
  }

  async function blacklistSub() {
    if (!blacklistForm.reason.trim()) { alert('A reason is required.'); return }
    setSavingBlacklist(true)
    const now = new Date().toISOString()
    const { error } = await supabase.from('subcontractors').update({
      blacklisted: true,
      blacklisted_at: now,
      blacklisted_by: profile?.id,
      blacklist_reason: blacklistForm.reason.trim(),
    }).eq('id', id)
    if (error) {
      console.error('[blacklist]', error)
      alert('Blacklist failed: ' + error.message)
      setSavingBlacklist(false); return
    }
    setSub(s => ({ ...s, blacklisted: true, blacklisted_at: now, blacklisted_by: profile?.id, blacklist_reason: blacklistForm.reason.trim() }))
    setShowBlacklistModal(false)
    setBlacklistForm({ reason: '' })
    setSavingBlacklist(false)
  }

  async function unblacklistSub() {
    setSavingBlacklist(true)
    const { error } = await supabase.from('subcontractors').update({
      blacklisted: false,
      blacklisted_at: null,
      blacklisted_by: null,
      blacklist_reason: null,
    }).eq('id', id)
    if (error) {
      console.error('[unblacklist]', error)
      alert('Unblacklist failed: ' + error.message)
      setSavingBlacklist(false); return
    }
    setSub(s => ({ ...s, blacklisted: false, blacklisted_at: null, blacklisted_by: null, blacklist_reason: null }))
    setConfirmUnblacklist(false)
    setSavingBlacklist(false)
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

  async function deleteSub() {
    await supabase.from('subcontractors').delete().eq('id', id)
    navigate('/subcontractors')
  }

  function exportDocs() {
    const rows = docs.map(d => ({
      Document: DOCUMENT_TYPES[d.document_type] || d.document_name,
      Name: d.document_name,
      Reference: d.reference_number || '',
      'Cover Amount (£)': d.cover_amount || '',
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
  const assignedProjectsList = projects.map(ps => ps.projects).filter(Boolean)

  // Format address properly
  const addressParts = [sub.address, sub.city, sub.postcode].filter(Boolean)
  const fullAddress = addressParts.join(', ')
  const locationDisplay = [sub.city, sub.postcode].filter(Boolean).join(', ')

  return (
    <div>
      <button className="btn btn-sm" style={{ marginBottom: 16 }} onClick={() => navigate(backPath)}>
        <IconChevron size={13} dir="left" /> Back
      </button>

      {/* Blacklist banner — prominent red warning */}
      {sub.blacklisted && (
        <div style={{ background: '#fee', border: '2px solid #c00', borderRadius: 8, padding: 14, marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ fontSize: 22, lineHeight: 1 }}>⛔</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#c00', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              BLACKLISTED — DO NOT USE
            </div>
            <div style={{ fontSize: 12, color: '#8a0000', marginBottom: 4 }}>
              <strong>Reason:</strong> {sub.blacklist_reason || '—'}
            </div>
            <div style={{ fontSize: 11, color: '#8a0000', opacity: 0.8 }}>
              Cannot be assigned to any project. Blacklisted{sub.blacklisted_at ? ' on ' + formatDate(sub.blacklisted_at) : ''}.
            </div>
          </div>
          {profile?.role === 'admin' && (
            <button className="btn btn-sm" onClick={() => setConfirmUnblacklist(true)} style={{ flexShrink: 0 }}>
              Remove from Blacklist
            </button>
          )}
        </div>
      )}

      {/* Header */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
          <Avatar name={sub.company_name} size="lg" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>{sub.company_name}</h2>
              <Pill cls={SUB_STATUSES[sub.status]?.cls || 'pill-gray'}>{SUB_STATUSES[sub.status]?.label || sub.status}</Pill>
              <Pill cls="pill-blue">{sub.trade}</Pill>
              {sub.approved ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--green-bg)', border: '1px solid var(--green-border)', borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: 'var(--green)' }}>
                  ✓ Approved for Payment
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: 'var(--amber)' }}>
                  ⏳ Pending Approval
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {score && <div style={{ background: score.score >= 80 ? 'var(--green-bg)' : score.score >= 50 ? 'var(--amber-bg)' : 'var(--red-bg)', color: score.score >= 80 ? 'var(--green)' : score.score >= 50 ? 'var(--amber)' : 'var(--red)', fontWeight: 700, fontSize: 12, padding: '3px 10px', borderRadius: 20 }}>Docs {score.score}%</div>}
            {rating && <RatingBadge ratings={ratings} />}
            {(can('manage_users') || profile?.role === 'accountant') && (
              <button
                className={`btn btn-sm ${sub.approved ? 'btn-danger' : 'btn-primary'}`}
                onClick={togglePaymentApproval}
                disabled={approvingPayment}
                title={sub.approved ? 'Click to revoke payment approval' : 'Click to approve for payment'}
              >
                {approvingPayment ? '...' : sub.approved ? '✕ Revoke Approval' : '✓ Approve for Payment'}
              </button>
            )}
            {can('manage_subcontractors') && (
              <button className="btn btn-sm" onClick={() => setShowEditSub(true)}><IconEdit size={13} /> Edit</button>
            )}
            {profile?.role === 'admin' && !sub.blacklisted && (
              <button className="btn btn-sm btn-danger" onClick={() => setShowBlacklistModal(true)} title="Blacklist this subcontractor">
                ⛔ Blacklist
              </button>
            )}
            {can('delete') && (
              <button className="btn btn-sm btn-danger" onClick={() => setConfirmDeleteSub(true)}><IconTrash size={13} /> Delete</button>
            )}
          </div>
        </div>

        {/* Payment approval info */}
        {sub.approved && sub.approved_at && (
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10, marginTop: -6 }}>
            Approved for payment by accounts on {new Date(sub.approved_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        )}
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

        {/* VAT & UTR */}
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
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>UTR</span>
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
        <div className={`filter-tab ${activeTab === 'documents' ? 'active' : ''}`} onClick={() => { setActiveTab('documents'); localStorage.setItem(_tabKey, 'documents') }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Documents<span className="tab-badge">{docs.length}</span>
        </div>
        <div className={`filter-tab ${activeTab === 'contacts' ? 'active' : ''}`} onClick={() => { setActiveTab('contacts'); localStorage.setItem(_tabKey, 'contacts') }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Contacts<span className="tab-badge">{contacts.length}</span>
        </div>
        <div className={`filter-tab ${activeTab === 'performance' ? 'active' : ''}`} onClick={() => { setActiveTab('performance'); localStorage.setItem(_tabKey, 'performance') }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          Performance<span className="tab-badge">{ratings.length}</span>
        </div>
        <div className={`filter-tab ${activeTab === 'activity' ? 'active' : ''}`} onClick={() => { setActiveTab('activity'); localStorage.setItem(_tabKey, 'activity') }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Activity<span className="tab-badge">{notes.length}</span>
        </div>
        <div className={`filter-tab ${activeTab === 'projects' ? 'active' : ''}`} onClick={() => { setActiveTab('projects'); localStorage.setItem(_tabKey, 'projects') }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          Projects<span className="tab-badge">{projects.length}</span>
        </div>
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
                <thead><tr><th>Document</th><th>Reference</th><th>File</th><th>Issue Date</th><th>Expiry Date</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {docs.map(doc => {
                    const info = docStatusInfo(doc.expiry_date)
                    const days = daysUntilExpiry(doc.expiry_date)
                    const linkedCount = doc.storage_path
                      ? docs.filter(d => d.storage_path === doc.storage_path).length
                      : 0
                    return (
                      <tr key={doc.id}>
                        <td>
                          <div style={{ fontWeight: 500 }}>{DOCUMENT_TYPES[doc.document_type] || doc.document_name}</div>
                          {doc.document_name !== DOCUMENT_TYPES[doc.document_type] && <div className="td-muted">{doc.document_name}</div>}
                          {doc.cover_amount > 0 && (
                            <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500, marginTop: 2 }}>
                              £{Number(doc.cover_amount).toLocaleString('en-GB')} cover
                            </div>
                          )}
                        </td>
                        <td className="td-muted">{doc.reference_number || '—'}</td>
                        <td>
                          {doc.storage_path ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <button
                                className="btn btn-sm"
                                style={{ fontSize: 11, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
                                onClick={() => openDocPreview(doc)}
                                title={doc.file_name || 'View file'}>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                View
                              </button>
                              {linkedCount > 1 && (
                                <span title={`Same file shared by ${linkedCount} document types`}
                                  style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--blue-bg, #e6f1fb)', color: 'var(--blue, #185FA5)', fontWeight: 600 }}>
                                  🔗 {linkedCount}
                                </span>
                              )}
                            </div>
                          ) : <span style={{ color: 'var(--text3)', fontSize: 11 }}>No file</span>}
                        </td>
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
          projects={assignedProjectsList}
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
      {activeTab === 'projects' && <ProjectsTab projects={projects} navigate={navigate} />}


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

      <ConfirmDialog
        open={confirmDeleteSub}
        onClose={() => setConfirmDeleteSub(false)}
        onConfirm={deleteSub}
        title="Delete subcontractor"
        message={`Are you sure you want to permanently delete ${sub?.company_name}? This will also delete all their documents, contacts, notes and performance ratings. This cannot be undone.`}
        danger
      />
      {showEditSub && <SubcontractorModal sub={sub} onClose={() => setShowEditSub(false)} onSaved={() => { setShowEditSub(false); load() }} />}
      {showDocModal && <DocumentModal doc={editingDoc} subcontractorId={id} onClose={() => setShowDocModal(false)} onSaved={() => { setShowDocModal(false); load() }} />}
      <ConfirmDialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={() => deleteDoc(confirmDelete)} title="Delete document" message="Are you sure? This cannot be undone." danger />

      {/* Blacklist modal (admin only) */}
      <Modal open={showBlacklistModal} onClose={() => { if (!savingBlacklist) { setShowBlacklistModal(false); setBlacklistForm({ reason: '' }) } }} title={`Blacklist ${sub.company_name}`} size="sm"
        footer={<>
          <button className="btn" onClick={() => { setShowBlacklistModal(false); setBlacklistForm({ reason: '' }) }} disabled={savingBlacklist}>Cancel</button>
          <button className="btn btn-danger" onClick={blacklistSub} disabled={savingBlacklist || !blacklistForm.reason.trim()}>
            {savingBlacklist ? 'Blacklisting...' : '⛔ Confirm Blacklist'}
          </button>
        </>}>
        <div style={{ padding: '10px 14px', background: '#fee', border: '1px solid #fcc', borderRadius: 6, marginBottom: 14, fontSize: 12, color: '#8a0000' }}>
          This will prevent <strong>{sub.company_name}</strong> from being assigned to any project. The block is enforced at the database level and cannot be bypassed. Only an administrator can remove the blacklist.
        </div>
        <Field label="Reason (required)">
          <textarea
            value={blacklistForm.reason}
            onChange={e => setBlacklistForm({ reason: e.target.value })}
            placeholder="e.g. Repeated H&S breaches on site; unresolved payment dispute; safety certification revoked"
            style={{ minHeight: 80 }}
            autoFocus
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={confirmUnblacklist}
        onClose={() => setConfirmUnblacklist(false)}
        onConfirm={unblacklistSub}
        title="Remove from blacklist"
        message={`Remove ${sub.company_name} from the blacklist? They will be eligible to assign to projects again.`}
      />

      {/* Compliance Document Preview */}
      {previewDoc && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => { setPreviewDoc(null); setPreviewUrl(null) }}>
          <div style={{ position: 'absolute', top: 20, right: 20, display: 'flex', gap: 8, zIndex: 1001 }}>
            {previewUrl && (
              <button onClick={e => { e.stopPropagation(); triggerDocDownload() }}
                style={{ fontSize: 12, padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>
                ↓ Download
              </button>
            )}
            <button onClick={() => { setPreviewDoc(null); setPreviewUrl(null) }}
              style={{ fontSize: 12, padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>
              ✕ Close
            </button>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginBottom: 12 }}>
            {previewDoc.file_name || previewDoc.document_name}
          </div>
          {previewUrl ? (
            docFileTypeInfo(previewDoc.file_name).isImage
              ? <img src={previewUrl} alt={previewDoc.file_name} style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 8 }} onClick={e => e.stopPropagation()} />
              : docFileTypeInfo(previewDoc.file_name).isPdf
              ? <iframe src={previewUrl} style={{ width: '95vw', height: '92vh', border: 'none', borderRadius: 8 }} title={previewDoc.file_name} onClick={e => e.stopPropagation()} />
              : <iframe src={'https://docs.google.com/gview?url=' + encodeURIComponent(previewUrl) + '&embedded=true'} style={{ width: '95vw', height: '92vh', border: 'none', borderRadius: 8, background: '#fff' }} title={previewDoc.file_name} onClick={e => e.stopPropagation()} />
          ) : (
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>Loading…</div>
          )}
        </div>
      )}
    </div>
  )
}

function ProjectsTab({ projects, navigate }) {
  const running = projects.filter(ps => ps.projects?.status === 'active' || ps.projects?.status === 'tender' || ps.projects?.status === 'on_hold')
  const completed = projects.filter(ps => ps.projects?.status === 'completed' || ps.projects?.status === 'cancelled')
  const totalOrderValue = projects.reduce((s, ps) => s + (parseFloat(ps.contract_value)||0), 0)
  const totalVariation = projects.reduce((s, ps) => s + (parseFloat(ps.variation_amount)||0), 0)

  function ProjectRow({ ps }) {
    return (
      <tr style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${ps.project_id}`)}>
        <td>
          <div style={{ fontWeight: 500, color: 'var(--text)' }}>{ps.projects?.project_name}</div>
          {ps.projects?.client_name && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{ps.projects?.client_name}</div>}
        </td>
        <td className="td-muted">{ps.projects?.project_ref || '—'}</td>
        <td className="td-muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(ps.start_date)} – {formatDate(ps.end_date)}</td>
        <td style={{ fontWeight: 500 }}>{ps.contract_value ? formatCurrency(ps.contract_value) : <span style={{ color: 'var(--text3)' }}>—</span>}</td>
        <td>
          {ps.variation_amount > 0 ? (
            <div>
              <span style={{ color: 'var(--amber)', fontWeight: 600 }}>+{formatCurrency(ps.variation_amount)}</span>
              {ps.variation_notes && ps.variation_notes.split('\n').map((line, i) => (
                <div key={i} style={{ fontSize: 10, color: 'var(--text2)' }}>{line}</div>
              ))}
            </div>
          ) : <span style={{ color: 'var(--text3)' }}>—</span>}
        </td>
        <td style={{ fontWeight: 600 }}>
          {(parseFloat(ps.contract_value)||0) + (parseFloat(ps.variation_amount)||0) > 0
            ? formatCurrency((parseFloat(ps.contract_value)||0) + (parseFloat(ps.variation_amount)||0))
            : '—'}
        </td>
        <td>
          <Pill cls={ps.projects?.status === 'active' ? 'pill-green' : ps.projects?.status === 'tender' ? 'pill-blue' : ps.projects?.status === 'completed' ? 'pill-gray' : 'pill-amber'}>
            {ps.projects?.status?.charAt(0).toUpperCase() + ps.projects?.status?.slice(1) || ps.status}
          </Pill>
        </td>
      </tr>
    )
  }

  if (projects.length === 0) return (
    <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13, padding: 40 }}>Not assigned to any projects yet.</div>
  )

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
        <div className="stat-card"><div className="stat-label">Running</div><div className="stat-value green">{running.length}</div></div>
        <div className="stat-card"><div className="stat-label">Completed</div><div className="stat-value">{completed.length}</div></div>
        <div className="stat-card"><div className="stat-label">Total Order Value</div><div className="stat-value" style={{ fontSize: 16 }}>{totalOrderValue > 0 ? formatCurrency(totalOrderValue) : '—'}</div></div>
        {totalVariation > 0 && <div className="stat-card"><div className="stat-label">Total Variations</div><div className="stat-value amber" style={{ fontSize: 16 }}>+{formatCurrency(totalVariation)}</div></div>}
        {totalOrderValue > 0 && <div className="stat-card" style={{ borderTop: '3px solid var(--green)' }}><div className="stat-label">Grand Total</div><div className="stat-value green" style={{ fontSize: 16 }}>{formatCurrency(totalOrderValue + totalVariation)}</div></div>}
      </div>

      {running.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)' }} /> Running Projects ({running.length})
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Project</th><th>Ref</th><th>Dates</th><th>Order Value</th><th>Variation</th><th>Total</th><th>Status</th></tr></thead>
              <tbody>{running.map(ps => <ProjectRow key={ps.id} ps={ps} />)}</tbody>
            </table>
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text3)' }} /> Completed Projects ({completed.length})
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Project</th><th>Ref</th><th>Dates</th><th>Order Value</th><th>Variation</th><th>Total</th><th>Status</th></tr></thead>
              <tbody>{completed.map(ps => <ProjectRow key={ps.id} ps={ps} />)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
