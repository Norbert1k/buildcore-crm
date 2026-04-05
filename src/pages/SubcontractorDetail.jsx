import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { SUB_STATUSES, DOCUMENT_TYPES, formatDate, docStatusInfo, daysUntilExpiry, formatCurrency } from '../lib/utils'
import { Avatar, Pill, Spinner, Modal, Field, IconPlus, IconEdit, IconTrash, IconUpload, IconChevron, ConfirmDialog } from '../components/ui'
import { useAuth } from '../lib/auth'
import SubcontractorModal from '../components/SubcontractorModal'
import DocumentModal from '../components/DocumentModal'

export default function SubcontractorDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const [sub, setSub] = useState(null)
  const [docs, setDocs] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('documents')
  const [showEditSub, setShowEditSub] = useState(false)
  const [showDocModal, setShowDocModal] = useState(false)
  const [editingDoc, setEditingDoc] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    const [subRes, docsRes, projRes] = await Promise.all([
      supabase.from('subcontractors').select('*').eq('id', id).single(),
      supabase.from('documents_with_status').select('*').eq('subcontractor_id', id).order('document_type'),
      supabase.from('project_subcontractors').select('*, projects(id, project_name, project_ref, status, start_date, end_date)').eq('subcontractor_id', id),
    ])
    setSub(subRes.data)
    setDocs(docsRes.data || [])
    setProjects(projRes.data || [])
    setLoading(false)
  }

  async function deleteDoc(docId) {
    await supabase.from('documents').delete().eq('id', docId)
    setConfirmDelete(null)
    load()
  }

  if (loading) return <Spinner />
  if (!sub) return <div style={{ padding: 40, color: 'var(--text2)' }}>Subcontractor not found.</div>

  const expired = docs.filter(d => d.status === 'expired')
  const expiring = docs.filter(d => d.status === 'expiring_soon')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <button className="btn btn-sm" onClick={() => navigate('/subcontractors')}>
          <IconChevron size={13} dir="left" /> Back
        </button>
      </div>

      {/* Header card */}
      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 12 }}>
          <Avatar name={sub.company_name} size="lg" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>{sub.company_name}</h2>
              <Pill cls={SUB_STATUSES[sub.status]?.cls || 'pill-gray'}>{SUB_STATUSES[sub.status]?.label || sub.status}</Pill>
              <Pill cls="pill-blue">{sub.trade}</Pill>
            </div>
          </div>
          {can('manage_subcontractors') && (
            <button className="btn btn-sm" style={{ flexShrink: 0 }} onClick={() => setShowEditSub(true)}><IconEdit size={13} /> Edit</button>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px 24px' }}>
          {[
            ['Contact', sub.contact_name],
            ['Email', sub.email],
            ['Phone', sub.phone],
            ['Location', [sub.city, sub.postcode].filter(Boolean).join(' ')],
            ['Address', sub.address],
            ['Website', sub.website],
          ].filter(([, v]) => v).map(([k, v]) => (
            <div key={k} style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{k}</span>
              <span style={{ color: k === 'Email' || k === 'Website' ? 'var(--blue)' : 'var(--text)', wordBreak: 'break-all' }}>{v}</span>
            </div>
          ))}
        </div>
        {sub.notes && (
          <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--text2)' }}>
            {sub.notes}
          </div>
        )}
      </div>

      {/* Compliance summary */}
      {(expired.length > 0 || expiring.length > 0) && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          {expired.length > 0 && <div style={{ flex: 1, background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 13, color: 'var(--red)', fontWeight: 500 }}>⚠ {expired.length} expired document{expired.length > 1 ? 's' : ''} — action required</div>}
          {expiring.length > 0 && <div style={{ flex: 1, background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 13, color: 'var(--amber)', fontWeight: 500 }}>! {expiring.length} document{expiring.length > 1 ? 's' : ''} expiring within 30 days</div>}
        </div>
      )}

      {/* Tabs */}
      <div className="filter-tabs">
        <div className={`filter-tab ${activeTab === 'documents' ? 'active' : ''}`} onClick={() => setActiveTab('documents')}>
          Documents ({docs.length})
        </div>
        <div className={`filter-tab ${activeTab === 'projects' ? 'active' : ''}`} onClick={() => setActiveTab('projects')}>
          Projects ({projects.length})
        </div>
      </div>

      {activeTab === 'documents' && (
        <div>
          <div className="section-header">
            <div className="section-title">Compliance Documents</div>
            {can('manage_documents') && (
              <button className="btn btn-primary btn-sm" onClick={() => { setEditingDoc(null); setShowDocModal(true) }}>
                <IconPlus size={13} /> Add Document
              </button>
            )}
          </div>
          {docs.length === 0 ? (
            <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
              No documents uploaded yet.
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Reference</th>
                    <th>Issue Date</th>
                    <th>Expiry Date</th>
                    <th>Status</th>
                    <th>Notes</th>
                    <th></th>
                  </tr>
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
                        <td className="td-muted" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.notes || '—'}</td>
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

      {activeTab === 'projects' && (
        <div>
          <div className="section-title" style={{ marginBottom: 14 }}>Assigned Projects</div>
          {projects.length === 0 ? (
            <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Not assigned to any projects.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Project</th><th>Ref</th><th>Role on Project</th><th>Dates</th><th>Contract Value</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {projects.map(ps => (
                    <tr key={ps.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${ps.project_id}`)}>
                      <td style={{ fontWeight: 500 }}>{ps.projects?.project_name}</td>
                      <td className="td-muted">{ps.projects?.project_ref || '—'}</td>
                      <td>{ps.trade_on_project || sub.trade}</td>
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

      {showEditSub && <SubcontractorModal sub={sub} onClose={() => setShowEditSub(false)} onSaved={() => { setShowEditSub(false); load() }} />}
      {showDocModal && <DocumentModal doc={editingDoc} subcontractorId={id} onClose={() => setShowDocModal(false)} onSaved={() => { setShowDocModal(false); load() }} />}
      <ConfirmDialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={() => deleteDoc(confirmDelete)} title="Delete document" message="Are you sure you want to delete this document? This cannot be undone." danger />
    </div>
  )
}
