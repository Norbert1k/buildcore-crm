import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PROJECT_STATUSES, DOCUMENT_TYPES, formatDate, formatCurrency, docStatusInfo } from '../lib/utils'
import { Avatar, Pill, Spinner, IconPlus, IconEdit, IconTrash, IconChevron, ConfirmDialog, Modal, Field } from '../components/ui'
import { useAuth } from '../lib/auth'
import GoogleDriveBrowser from '../components/GoogleDrivePicker'
import ProjectModal from '../components/ProjectModal'

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const [project, setProject] = useState(null)
  const [subs, setSubs] = useState([])
  const [docs, setDocs] = useState([])
  const [allSubs, setAllSubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('subcontractors')
  const [driveFolderId, setDriveFolderId] = useState(null)
  const [driveFolderName, setDriveFolderName] = useState(null)
  const [showEdit, setShowEdit] = useState(false)
  const [showAssignSub, setShowAssignSub] = useState(false)
  const [showAddDoc, setShowAddDoc] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [assignForm, setAssignForm] = useState({ subcontractor_id: '', trade_on_project: '', start_date: '', end_date: '', contract_value: '' })
  const [docForm, setDocForm] = useState({ document_name: '', document_type: 'rams', expiry_date: '', notes: '', subcontractor_id: '' })

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    const [projRes, subsRes, docsRes, allSubsRes] = await Promise.all([
      supabase.from('projects').select('*, profiles!projects_project_manager_id_fkey(full_name)').eq('id', id).single(),
      supabase.from('project_subcontractors').select('*, subcontractors(id, company_name, trade, status, email, phone)').eq('project_id', id),
      supabase.from('project_documents').select('*, subcontractors(company_name), profiles!project_documents_uploaded_by_fkey(full_name)').eq('project_id', id).order('created_at', { ascending: false }),
      supabase.from('subcontractors').select('id, company_name, trade').order('company_name'),
    ])
    setProject(projRes.data)
    setDriveFolderId(projRes.data?.drive_folder_id || null)
    setDriveFolderName(projRes.data?.drive_folder_name || null)
    setSubs(subsRes.data || [])
    setDocs(docsRes.data || [])
    setAllSubs(allSubsRes.data || [])
    setLoading(false)
  }

  async function assignSub() {
    await supabase.from('project_subcontractors').insert({ project_id: id, ...assignForm, contract_value: assignForm.contract_value || null })
    setShowAssignSub(false)
    setAssignForm({ subcontractor_id: '', trade_on_project: '', start_date: '', end_date: '', contract_value: '' })
    load()
  }

  async function removeSub(psId) {
    await supabase.from('project_subcontractors').delete().eq('id', psId)
    setConfirmRemove(null)
    load()
  }

  async function addDoc() {
    await supabase.from('project_documents').insert({ project_id: id, ...docForm })
    setShowAddDoc(false)
    setDocForm({ document_name: '', document_type: 'rams', expiry_date: '', notes: '', subcontractor_id: '' })
    load()
  }

  if (loading) return <Spinner />
  if (!project) return <div style={{ padding: 40, color: 'var(--text2)' }}>Project not found.</div>

  return (
    <div>
      <button className="btn btn-sm" style={{ marginBottom: 16 }} onClick={() => navigate('/projects')}>
        <IconChevron size={13} dir="left" /> Back
      </button>

      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 20, fontWeight: 600 }}>{project.project_name}</h2>
              {project.project_ref && <span style={{ color: 'var(--text3)', fontSize: 13 }}>#{project.project_ref}</span>}
              <Pill cls={PROJECT_STATUSES[project.status]?.cls || 'pill-gray'}>{PROJECT_STATUSES[project.status]?.label}</Pill>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '4px 20px', fontSize: 13 }}>
              {[
                ['Client', project.client_name],
                ['Project Manager', project.profiles?.full_name],
                ['Location', [project.site_address, project.city, project.postcode].filter(Boolean).join(', ')],
                ['Start Date', formatDate(project.start_date)],
                ['End Date', formatDate(project.end_date)],
                ['Contract Value', formatCurrency(project.value)],
              ].filter(([, v]) => v && v !== '—').map(([k, v]) => (
                <div key={k}><span style={{ color: 'var(--text3)', marginRight: 6 }}>{k}:</span><span>{v}</span></div>
              ))}
            </div>
            {project.description && <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text2)' }}>{project.description}</div>}
          </div>
          {can('manage_projects') && <button className="btn btn-sm" onClick={() => setShowEdit(true)}><IconEdit size={13} /> Edit</button>}
        </div>
      </div>

      <div className="filter-tabs">
        <div className={`filter-tab ${activeTab === 'subcontractors' ? 'active' : ''}`} onClick={() => setActiveTab('subcontractors')}>Subcontractors ({subs.length})</div>
        <div className={`filter-tab ${activeTab === 'documents' ? 'active' : ''}`} onClick={() => setActiveTab('documents')}>Project Documents ({docs.length})</div>
      </div>

      {activeTab === 'subcontractors' && (
        <div>
          <div className="section-header">
            <div className="section-title">Assigned Subcontractors</div>
            {can('manage_projects') && <button className="btn btn-primary btn-sm" onClick={() => setShowAssignSub(true)}><IconPlus size={13} /> Assign Subcontractor</button>}
          </div>
          {subs.length === 0 ? (
            <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No subcontractors assigned to this project yet.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Company</th><th>Trade on Project</th><th>Contact</th><th>Start</th><th>End</th><th>Contract Value</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {subs.map(ps => (
                    <tr key={ps.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => navigate(`/subcontractors/${ps.subcontractors?.id}`)}>
                          <Avatar name={ps.subcontractors?.company_name} size="sm" />
                          <span style={{ fontWeight: 500 }}>{ps.subcontractors?.company_name}</span>
                        </div>
                      </td>
                      <td>{ps.trade_on_project || ps.subcontractors?.trade}</td>
                      <td className="td-muted">{ps.subcontractors?.phone || '—'}</td>
                      <td className="td-muted">{formatDate(ps.start_date)}</td>
                      <td className="td-muted">{formatDate(ps.end_date)}</td>
                      <td>{formatCurrency(ps.contract_value)}</td>
                      <td><Pill cls={ps.status === 'active' ? 'pill-green' : 'pill-gray'}>{ps.status}</Pill></td>
                      <td>{can('manage_projects') && <button className="btn btn-sm btn-danger" onClick={() => setConfirmRemove(ps.id)}><IconTrash size={12}/></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'documents' && (
        <div>
          <div className="section-header">
            <div className="section-title">Project Documents (RAMS, Certs, etc.)</div>
            {can('manage_documents') && <button className="btn btn-primary btn-sm" onClick={() => setShowAddDoc(true)}><IconPlus size={13}/> Add Document</button>}
          </div>
          {docs.length === 0 ? (
            <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No project documents uploaded yet.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Document</th><th>Type</th><th>Subcontractor</th><th>Expiry</th><th>Status</th><th>Approved</th></tr></thead>
                <tbody>
                  {docs.map(d => {
                    const info = docStatusInfo(d.expiry_date)
                    return (
                      <tr key={d.id}>
                        <td style={{ fontWeight: 500 }}>{d.document_name}</td>
                        <td className="td-muted">{DOCUMENT_TYPES[d.document_type] || d.document_type}</td>
                        <td>{d.subcontractors?.company_name || '—'}</td>
                        <td className="td-muted">{formatDate(d.expiry_date)}</td>
                        <td>{info && <Pill cls={info.cls}>{info.label}</Pill>}</td>
                        <td>{d.approved ? <Pill cls="pill-green">Approved</Pill> : <Pill cls="pill-gray">Pending</Pill>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showEdit && <ProjectModal project={project} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); load() }} />}

      <Modal open={showAssignSub} onClose={() => setShowAssignSub(false)} title="Assign Subcontractor" size="sm"
        footer={<><button className="btn" onClick={() => setShowAssignSub(false)}>Cancel</button><button className="btn btn-primary" onClick={assignSub}>Assign</button></>}>
        <div className="form-grid">
          <div className="full"><Field label="Subcontractor *"><select value={assignForm.subcontractor_id} onChange={e => setAssignForm(f => ({ ...f, subcontractor_id: e.target.value }))}><option value="">Select…</option>{allSubs.filter(s => !subs.find(ps => ps.subcontractors?.id === s.id)).map(s => <option key={s.id} value={s.id}>{s.company_name} – {s.trade}</option>)}</select></Field></div>
          <div className="full"><Field label="Role / Trade on this project"><input value={assignForm.trade_on_project} onChange={e => setAssignForm(f => ({ ...f, trade_on_project: e.target.value }))} placeholder="e.g. Electrical installation" /></Field></div>
          <Field label="Start Date"><input type="date" value={assignForm.start_date} onChange={e => setAssignForm(f => ({ ...f, start_date: e.target.value }))} /></Field>
          <Field label="End Date"><input type="date" value={assignForm.end_date} onChange={e => setAssignForm(f => ({ ...f, end_date: e.target.value }))} /></Field>
          <div className="full"><Field label="Contract Value (£)"><input type="number" value={assignForm.contract_value} onChange={e => setAssignForm(f => ({ ...f, contract_value: e.target.value }))} placeholder="0" /></Field></div>
        </div>
      </Modal>

      <Modal open={showAddDoc} onClose={() => setShowAddDoc(false)} title="Add Project Document" size="sm"
        footer={<><button className="btn" onClick={() => setShowAddDoc(false)}>Cancel</button><button className="btn btn-primary" onClick={addDoc}>Save</button></>}>
        <div className="form-grid">
          <div className="full"><Field label="Document Name *"><input value={docForm.document_name} onChange={e => setDocForm(f => ({ ...f, document_name: e.target.value }))} placeholder="e.g. RAMS for groundworks" /></Field></div>
          <div className="full"><Field label="Document Type"><select value={docForm.document_type} onChange={e => setDocForm(f => ({ ...f, document_type: e.target.value }))}>{Object.entries(DOCUMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field></div>
          <div className="full"><Field label="Linked Subcontractor"><select value={docForm.subcontractor_id} onChange={e => setDocForm(f => ({ ...f, subcontractor_id: e.target.value || null }))}><option value="">None (project-wide)</option>{subs.map(ps => <option key={ps.id} value={ps.subcontractors?.id}>{ps.subcontractors?.company_name}</option>)}</select></Field></div>
          <Field label="Expiry Date"><input type="date" value={docForm.expiry_date} onChange={e => setDocForm(f => ({ ...f, expiry_date: e.target.value }))} /></Field>
          <div className="full"><Field label="Notes"><input value={docForm.notes} onChange={e => setDocForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" /></Field></div>
        </div>
      </Modal>

      <ConfirmDialog open={!!confirmRemove} onClose={() => setConfirmRemove(null)} onConfirm={() => removeSub(confirmRemove)} title="Remove subcontractor" message="Remove this subcontractor from the project? Their profile and documents are not affected." danger />
    </div>
  )
}
