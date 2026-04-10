import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PROJECT_STATUSES, DOCUMENT_TYPES, formatDate, formatCurrency, docStatusInfo } from '../lib/utils'
import { Avatar, Pill, Spinner, IconPlus, IconEdit, IconTrash, IconChevron, ConfirmDialog, Modal, Field } from '../components/ui'
import { useAuth } from '../lib/auth'
import GoogleDriveBrowser from '../components/GoogleDrivePicker'
import ProjectModal from '../components/ProjectModal'

function calcDuration(start, end) {
  if (!start || !end) return null
  const days = Math.round((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24))
  if (days < 0) return null
  if (days < 7) return days + ' day' + (days !== 1 ? 's' : '')
  if (days < 30) return Math.round(days / 7) + ' week' + (Math.round(days / 7) !== 1 ? 's' : '')
  if (days < 365) return Math.round(days / 30) + ' month' + (Math.round(days / 30) !== 1 ? 's' : '')
  const yrs = (new Date(end).getFullYear() - new Date(start).getFullYear())
  return yrs + ' year' + (yrs !== 1 ? 's' : '')
}

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
  const [photos, setPhotos] = useState([])
  const [programmes, setProgrammes] = useState([])
  const [uploadingProgramme, setUploadingProgramme] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [photoCaption, setPhotoCaption] = useState('')
  const [previewPhoto, setPreviewPhoto] = useState(null)
  const [showAssignSub, setShowAssignSub] = useState(false)
  const [showVariation, setShowVariation] = useState(null)
  const [variationForm, setVariationForm] = useState({ amount: '', notes: '' })
  const [savingVariation, setSavingVariation] = useState(false)
  const [showAddDoc, setShowAddDoc] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [assignForm, setAssignForm] = useState({ subcontractor_id: '', trade_on_project: '', start_date: '', end_date: '', contract_value: '', variation_amount: 0, variation_notes: '' })
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
    // Load project photos
    const { data: photosData } = await supabase.from('project_photos').select('*').eq('project_id', id).order('created_at', { ascending: false })
    setPhotos(photosData || [])
    const { data: progData } = await supabase.from('project_programmes').select('*').eq('project_id', id).order('created_at', { ascending: false })
    setProgrammes(progData || [])
    setLoading(false)
  }

  async function uploadProgramme(files) {
    if (!files.length) return
    setUploadingProgramme(true)
    for (const file of files) {
      const path = `projects/${id}/programmes/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('company-docs').upload(path, file)
      if (!error) {
        const isPdf = file.name.toLowerCase().endsWith('.pdf')
        const isMpp = file.name.toLowerCase().endsWith('.mpp') || file.name.toLowerCase().endsWith('.mppx')
        await supabase.from('project_programmes').insert({
          project_id: id,
          storage_path: path,
          file_name: file.name,
          file_size: file.size,
          file_type: isPdf ? 'pdf' : isMpp ? 'mpp' : 'other',
        })
      }
    }
    setUploadingProgramme(false)
    const { data } = await supabase.from('project_programmes').select('*').eq('project_id', id).order('created_at', { ascending: false })
    setProgrammes(data || [])
  }

  async function deleteProgramme(prog) {
    await supabase.storage.from('company-docs').remove([prog.storage_path])
    await supabase.from('project_programmes').delete().eq('id', prog.id)
    setProgrammes(p => p.filter(x => x.id !== prog.id))
  }

  async function downloadProgramme(prog) {
    const { data } = await supabase.storage.from('company-docs').createSignedUrl(prog.storage_path, 60)
    if (data?.signedUrl) {
      const a = document.createElement('a')
      a.href = data.signedUrl
      a.download = prog.file_name
      a.click()
    }
  }

  async function uploadPhoto(files) {
    if (!files.length) return
    setUploadingPhoto(true)
    for (const file of files) {
      const path = `projects/${id}/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('company-docs').upload(path, file)
      if (!error) {
        await supabase.from('project_photos').insert({
          project_id: id,
          storage_path: path,
          file_name: file.name,
          file_size: file.size,
          caption: photoCaption || '',
        })
      }
    }
    setPhotoCaption('')
    setUploadingPhoto(false)
    const { data } = await supabase.from('project_photos').select('*').eq('project_id', id).order('created_at', { ascending: false })
    setPhotos(data || [])
  }

  async function deletePhoto(photo) {
    await supabase.storage.from('company-docs').remove([photo.storage_path])
    await supabase.from('project_photos').delete().eq('id', photo.id)
    setPhotos(p => p.filter(x => x.id !== photo.id))
  }

  async function getPhotoUrl(path) {
    const { data } = await supabase.storage.from('company-docs').createSignedUrl(path, 3600)
    return data?.signedUrl
  }

  async function openPhotoPreview(photo) {
    const url = await getPhotoUrl(photo.storage_path)
    setPreviewPhoto({ ...photo, url })
  }

  async function saveVariation() {
    if (!variationForm.amount) return
    setSavingVariation(true)
    const ps = showVariation
    const currentVariation = parseFloat(ps.variation_amount) || 0
    const addAmount = parseFloat(variationForm.amount) || 0
    const newVariation = currentVariation + addAmount
    const newNotes = ps.variation_notes
      ? ps.variation_notes + '\n' + new Date().toLocaleDateString('en-GB') + ': £' + addAmount.toLocaleString() + (variationForm.notes ? ' — ' + variationForm.notes : '')
      : new Date().toLocaleDateString('en-GB') + ': £' + addAmount.toLocaleString() + (variationForm.notes ? ' — ' + variationForm.notes : '')
    await supabase.from('project_subcontractors').update({
      variation_amount: newVariation,
      variation_notes: newNotes
    }).eq('id', ps.id)
    setSavingVariation(false)
    setShowVariation(null)
    setVariationForm({ amount: '', notes: '' })
    load()
  }

  async function assignSub() {
    await supabase.from('project_subcontractors').insert({ project_id: id, ...assignForm, contract_value: assignForm.contract_value || null })
    setShowAssignSub(false)
    setAssignForm({ subcontractor_id: '', trade_on_project: '', start_date: '', end_date: '', contract_value: '', variation_amount: 0, variation_notes: '' })
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
                ['Duration', calcDuration(project.start_date, project.end_date)],
                ['Contract Value', formatCurrency(project.value)],
              ].filter(([, v]) => v && v !== '—').map(([k, v]) => (
                <div key={k}><span style={{ color: 'var(--text3)', marginRight: 6 }}>{k}:</span><span>{v}</span></div>
              ))}
            </div>

          </div>
          {can('manage_projects') && <button className="btn btn-sm" onClick={() => setShowEdit(true)}><IconEdit size={13} /> Edit</button>}
        </div>
      </div>

      {project.description && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Project Description</div>
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{project.description}</div>
        </div>
      )}

      <div className="filter-tabs">
        <div className={`filter-tab ${activeTab === 'subcontractors' ? 'active' : ''}`} onClick={() => setActiveTab('subcontractors')}>Subcontractors ({subs.length})</div>
        <div className={`filter-tab ${activeTab === 'documents' ? 'active' : ''}`} onClick={() => setActiveTab('documents')}>Project Documents ({docs.length})</div>
        <div className={`filter-tab ${activeTab === 'photos' ? 'active' : ''}`} onClick={() => setActiveTab('photos')}>📷 Photos ({photos.length})</div>
        <div className={`filter-tab ${activeTab === 'programme' ? 'active' : ''}`} onClick={() => setActiveTab('programme')}>📅 Programme ({programmes.length})</div>
        <div className={`filter-tab ${activeTab === 'casestudy' ? 'active' : ''}`} onClick={() => setActiveTab('casestudy')}>📄 Case Study</div>
      </div>

      {activeTab === 'files' && (
        <div>
          <div className="section-header" style={{ marginBottom: 14 }}>
            <div>
              <div className="section-title">Google Drive</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {driveFolderId ? (
                  <>
                    <span>Linked: <strong>{driveFolderName || driveFolderId}</strong></span>
                    <button className="btn btn-sm btn-danger" style={{ fontSize: 11 }} onClick={async () => {
                      await supabase.from('projects').update({ drive_folder_id: null, drive_folder_name: null }).eq('id', id)
                      setDriveFolderId(null)
                      setDriveFolderName(null)
                    }}>✕ Unlink</button>
                  </>
                ) : 'Connect Google Drive to browse and upload files for this project'}
              </div>
            </div>
          </div>
          <GoogleDriveBrowser
            linkedFolderId={driveFolderId}
            projectName={project?.project_name}
            onLinkFolder={async (folderId, folderName) => {
              await supabase.from('projects').update({ drive_folder_id: folderId, drive_folder_name: folderName }).eq('id', id)
              setDriveFolderId(folderId)
              setDriveFolderName(folderName)
            }}
          />
        </div>
      )}

      {activeTab === 'programme' && (
        <div>
          <div className="section-header" style={{ marginBottom: 16 }}>
            <div>
              <div className="section-title">Project Programme</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Upload PDF or Microsoft Project (.mpp) files</div>
            </div>
            {can('manage_projects') && (
              <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
                {uploadingProgramme ? 'Uploading...' : '+ Upload Programme'}
                <input type="file" multiple accept=".pdf,.mpp,.mppx,.xlsx,.xls" style={{ display: 'none' }}
                  onChange={e => uploadProgramme(Array.from(e.target.files))} disabled={uploadingProgramme} />
              </label>
            )}
          </div>
          {programmes.length === 0 ? (
            <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13, padding: 40 }}>
              No programme uploaded yet — upload a PDF or Microsoft Project file
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
              {programmes.map(prog => (
                <ProgrammeCard key={prog.id} prog={prog} onDownload={() => downloadProgramme(prog)} onDelete={() => deleteProgramme(prog)} canDelete={can('manage_projects')} />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'photos' && (
        <div>
          <div className="section-header" style={{ marginBottom: 16 }}>
            <div className="section-title">Project Photos</div>
            {can('manage_projects') && (
              <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
                {uploadingPhoto ? 'Uploading...' : '📷 Upload Photos'}
                <input type="file" multiple accept="image/*" style={{ display: 'none' }}
                  onChange={e => uploadPhoto(Array.from(e.target.files))} disabled={uploadingPhoto} />
              </label>
            )}
          </div>
          {photos.length === 0 ? (
            <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13, padding: 40 }}>
              No photos yet — upload project photos to showcase your work
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {photos.map(photo => (
                <PhotoCard key={photo.id} photo={photo} onPreview={() => openPhotoPreview(photo)} onDelete={() => deletePhoto(photo)} canDelete={can('manage_projects')} />
              ))}
            </div>
          )}
          {/* Photo preview modal */}
          {previewPhoto && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setPreviewPhoto(null)}>
              <div style={{ maxWidth: 900, width: '100%' }} onClick={e => e.stopPropagation()}>
                <img src={previewPhoto.url} alt={previewPhoto.caption || previewPhoto.file_name} style={{ width: '100%', maxHeight: '80vh', objectFit: 'contain', borderRadius: 8 }} />
                {previewPhoto.caption && <div style={{ color: 'white', textAlign: 'center', marginTop: 12, fontSize: 14 }}>{previewPhoto.caption}</div>}
                <div style={{ textAlign: 'center', marginTop: 12 }}>
                  <button className="btn" onClick={() => setPreviewPhoto(null)} style={{ color: 'white', borderColor: 'rgba(255,255,255,0.3)' }}>✕ Close</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'casestudy' && (
        <CaseStudy project={project} subs={subs} docs={docs} photos={photos} />
      )}

      {activeTab === 'subcontractors' && (
        <div>
          <div className="section-header">
            <div className="section-title">Assigned Subcontractors</div>
            {(can('manage_projects') || can('manage_subcontractors')) && <button className="btn btn-primary btn-sm" onClick={() => setShowAssignSub(true)}><IconPlus size={13} /> Assign Subcontractor</button>}
          </div>
          {subs.length === 0 ? (
            <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No subcontractors assigned to this project yet.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Company</th><th>Trade on Project</th><th>Start</th><th>End</th><th>Order Value</th><th>Variation</th><th>Total</th><th>Status</th><th></th></tr></thead>
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
                      <td className="td-muted">{formatDate(ps.start_date)}</td>
                      <td className="td-muted">{formatDate(ps.end_date)}</td>
                      <td style={{ fontWeight: 500 }}>{ps.contract_value ? formatCurrency(ps.contract_value) : <span style={{ color: 'var(--text3)' }}>—</span>}</td>
                      <td>
                        {ps.variation_amount > 0 ? (
                          <div>
                            <span style={{ color: 'var(--amber)', fontWeight: 600 }}>+{formatCurrency(ps.variation_amount)}</span>
                            {ps.variation_notes && ps.variation_notes.split('\n').map((line, i) => (
                              <div key={i} style={{ fontSize: 10, color: 'var(--text2)', marginTop: 2 }}>{line}</div>
                            ))}
                          </div>
                        ) : (
                          can('manage_projects') && (
                            <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 8px' }} onClick={e => { e.stopPropagation(); setShowVariation(ps); setVariationForm({ amount: '', notes: '' }) }}>
                              + Add
                            </button>
                          )
                        )}
                      </td>
                      <td style={{ fontWeight: 600, color: (parseFloat(ps.contract_value)||0) + (parseFloat(ps.variation_amount)||0) > 0 ? 'var(--text)' : 'var(--text3)' }}>
                        {(parseFloat(ps.contract_value)||0) + (parseFloat(ps.variation_amount)||0) > 0
                          ? formatCurrency((parseFloat(ps.contract_value)||0) + (parseFloat(ps.variation_amount)||0))
                          : '—'}
                      </td>
                      <td><Pill cls={ps.status === 'active' ? 'pill-green' : 'pill-gray'}>{ps.status}</Pill></td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {can('manage_projects') && ps.variation_amount > 0 && (
                            <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 8px' }} title="Add variation" onClick={e => { e.stopPropagation(); setShowVariation(ps); setVariationForm({ amount: '', notes: '' }) }}>
                              +VAR
                            </button>
                          )}
                          {can('manage_projects') && <button className="btn btn-sm btn-danger" onClick={() => setConfirmRemove(ps.id)}><IconTrash size={12}/></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {subs.length > 1 && (() => {
                  const totalOrder = subs.reduce((s, ps) => s + (parseFloat(ps.contract_value)||0), 0)
                  const totalVar = subs.reduce((s, ps) => s + (parseFloat(ps.variation_amount)||0), 0)
                  const totalAll = totalOrder + totalVar
                  return (
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface2)' }}>
                        <td colSpan={4} style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>Total</td>
                        <td style={{ padding: '8px 12px', fontWeight: 700 }}>{formatCurrency(totalOrder)}</td>
                        <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--amber)' }}>{totalVar > 0 ? '+' + formatCurrency(totalVar) : '—'}</td>
                        <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--green)' }}>{formatCurrency(totalAll)}</td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  )
                })()}
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
                {subs.length > 1 && (() => {
                  const totalOrder = subs.reduce((s, ps) => s + (parseFloat(ps.contract_value)||0), 0)
                  const totalVar = subs.reduce((s, ps) => s + (parseFloat(ps.variation_amount)||0), 0)
                  const totalAll = totalOrder + totalVar
                  return (
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface2)' }}>
                        <td colSpan={4} style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>Total</td>
                        <td style={{ padding: '8px 12px', fontWeight: 700 }}>{formatCurrency(totalOrder)}</td>
                        <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--amber)' }}>{totalVar > 0 ? '+' + formatCurrency(totalVar) : '—'}</td>
                        <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--green)' }}>{formatCurrency(totalAll)}</td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  )
                })()}
              </table>
            </div>
          )}
        </div>
      )}

      {/* Variation Modal */}
      {showVariation && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setShowVariation(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', padding: 24, width: '100%', maxWidth: 440, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Add Variation</h3>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>
              {showVariation.subcontractors?.company_name} · Current order: {formatCurrency(showVariation.contract_value)}
              {showVariation.variation_amount > 0 && <> · Existing variation: <span style={{ color: 'var(--amber)' }}>+{formatCurrency(showVariation.variation_amount)}</span></>}
            </div>
            {showVariation.variation_notes && (
              <div style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 12, color: 'var(--text2)', marginBottom: 16, maxHeight: 100, overflowY: 'auto' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', marginBottom: 4 }}>VARIATION HISTORY</div>
                {showVariation.variation_notes.split('\n').map((line, i) => <div key={i}>{line}</div>)}
              </div>
            )}
            <Field label="Variation Amount (£) *">
              <input type="number" value={variationForm.amount} onChange={e => setVariationForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="e.g. 5000" autoFocus />
            </Field>
            <div style={{ marginTop: 12 }}>
              <Field label="Description (optional)">
                <input value={variationForm.notes} onChange={e => setVariationForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="e.g. Additional groundworks due to unforeseen conditions" />
              </Field>
            </div>
            {variationForm.amount && (
              <div style={{ background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 13, marginTop: 12 }}>
                <div style={{ color: 'var(--amber)', fontWeight: 600 }}>New total for {showVariation.subcontractors?.company_name}:</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
                  {formatCurrency((parseFloat(showVariation.contract_value)||0) + (parseFloat(showVariation.variation_amount)||0) + (parseFloat(variationForm.amount)||0))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn" onClick={() => setShowVariation(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveVariation} disabled={savingVariation || !variationForm.amount}>
                {savingVariation ? 'Saving...' : 'Save Variation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showEdit && <ProjectModal project={project} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); load() }} />}

      <Modal open={showAssignSub} onClose={() => setShowAssignSub(false)} title="Assign Subcontractor" size="sm"
        footer={<><button className="btn" onClick={() => setShowAssignSub(false)}>Cancel</button><button className="btn btn-primary" onClick={assignSub}>Assign</button></>}>
        <div className="form-grid">
          <div className="full"><Field label="Subcontractor *"><select value={assignForm.subcontractor_id} onChange={e => {
            const selected = allSubs.find(s => s.id === e.target.value)
            setAssignForm(f => ({ ...f, subcontractor_id: e.target.value, trade_on_project: selected?.trade || '' }))
          }}><option value="">Select…</option>{allSubs.filter(s => !subs.find(ps => ps.subcontractors?.id === s.id)).map(s => <option key={s.id} value={s.id}>{s.company_name} – {s.trade}</option>)}</select></Field></div>
          <Field label="Start Date"><input type="date" value={assignForm.start_date} onChange={e => setAssignForm(f => ({ ...f, start_date: e.target.value }))} /></Field>
          <Field label="End Date"><input type="date" value={assignForm.end_date} onChange={e => setAssignForm(f => ({ ...f, end_date: e.target.value }))} /></Field>
          <div className="full"><Field label="Order Value (£)"><input type="number" value={assignForm.contract_value} onChange={e => setAssignForm(f => ({ ...f, contract_value: e.target.value }))} placeholder="e.g. 50000" /></Field></div>
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

// ── Photo Card Component ─────────────────────────────────────
function PhotoCard({ photo, onPreview, onDelete, canDelete }) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    supabase.storage.from('company-docs').createSignedUrl(photo.storage_path, 3600)
      .then(({ data }) => { if (data?.signedUrl) setUrl(data.signedUrl) })
  }, [photo.storage_path])

  return (
    <div style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div style={{ height: 160, background: 'var(--surface2)', overflow: 'hidden', cursor: 'pointer', position: 'relative' }} onClick={onPreview}>
        {url ? (
          <img src={url} alt={photo.caption || photo.file_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text3)' }}>Loading...</div>
        )}
      </div>
      <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {photo.caption || photo.file_name}
        </div>
        {canDelete && (
          <button className="btn btn-sm btn-danger" style={{ fontSize: 11, padding: '2px 6px', flexShrink: 0 }} onClick={onDelete}>✕</button>
        )}
      </div>
    </div>
  )
}

// ── Case Study Component ─────────────────────────────────────
function CaseStudy({ project, subs, docs, photos }) {
  const [photoUrls, setPhotoUrls] = useState({})
  const [aiOverview, setAiOverview] = useState(null)
  const [generatingAI, setGeneratingAI] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    photos.slice(0, 6).forEach(async p => {
      const { data } = await supabase.storage.from('company-docs').createSignedUrl(p.storage_path, 3600)
      if (data?.signedUrl) setPhotoUrls(u => ({ ...u, [p.id]: data.signedUrl }))
    })
  }, [photos])

  async function generateAIOverview() {
    if (!project.description) return
    setGeneratingAI(true)
    try {
      const duration = calcDuration(project.start_date, project.end_date)
      const trades = subs.map(s => s.trade_on_project || s.subcontractors?.trade).filter(Boolean).join(', ')
      const prompt = `You are writing a professional project case study for City Construction Ltd, a UK construction company. 
Rewrite the following project description into a compelling, professional 2-3 paragraph overview suitable for a client-facing case study PDF.
Use professional construction industry language. Highlight the scope, complexity and value delivered. Do not invent facts.

Project: ${project.project_name}
Client: ${project.client_name || 'Confidential'}
Value: ${project.value ? '£' + Number(project.value).toLocaleString() : 'Not specified'}
Duration: ${duration || 'Not specified'}
Trades involved: ${trades || 'Various'}
Original description: ${project.description}

Write only the overview text, no headings or labels.`

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }]
        })
      })
      const data = await response.json()
      const text = data.content?.[0]?.text
      if (text) setAiOverview(text)
    } catch (e) { console.error(e) }
    setGeneratingAI(false)
  }

  function exportPDF() {
    const el = document.getElementById('case-study-content')
    if (!el) return
    setExporting(true)
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
    script.onload = () => {
      window.html2pdf().set({
        margin: 0,
        filename: `${project.project_name} - Case Study.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      }).from(el).save().then(() => setExporting(false))
    }
    document.head.appendChild(script)
  }

  const duration = calcDuration(project.start_date, project.end_date)
  const overviewText = aiOverview || project.description

  return (
    <div>
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="section-title">Case Study</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>Auto-compiled from project data — AI enhances the overview</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {project.description && (
            <button className="btn btn-sm" onClick={generateAIOverview} disabled={generatingAI}>
              {generatingAI ? '✨ Writing...' : aiOverview ? '✨ Regenerate' : '✨ AI Overview'}
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={exportPDF} disabled={exporting}>
            {exporting ? 'Generating...' : '⬇ Export PDF'}
          </button>
        </div>
      </div>

      {aiOverview && (
        <div style={{ background: 'var(--green-bg)', border: '1px solid var(--green-border)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 12, color: 'var(--green)', marginBottom: 16 }}>
          ✨ AI has enhanced the project overview — review below before exporting
        </div>
      )}

      <div id="case-study-content" style={{ background: 'white', color: '#1a1a1a', fontFamily: 'Arial, sans-serif', maxWidth: 794 }}>
        {/* Header */}
        <div style={{ background: '#448a40', padding: '32px 40px', color: 'white' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: '0.1em', opacity: 0.8, marginBottom: 4 }}>PROJECT CASE STUDY</div>
              <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.2 }}>{project.project_name}</div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, opacity: 0.9 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>City Construction</div>
              <div>cltd.co.uk</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {[
              ['Client', project.client_name || '—'],
              ['Duration', duration || '—'],
              ['Value', project.value ? `£${Number(project.value).toLocaleString()}` : '—'],
              ['Status', project.status?.charAt(0).toUpperCase() + project.status?.slice(1) || '—'],
            ].map(([k, v]) => (
              <div key={k} style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontSize: 10, opacity: 0.8, marginBottom: 4 }}>{k.toUpperCase()}</div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: '32px 40px' }}>
          {/* Overview */}
          {overviewText && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#448a40', borderBottom: '2px solid #448a40', paddingBottom: 6, marginBottom: 12 }}>PROJECT OVERVIEW</div>
              <div style={{ fontSize: 13, lineHeight: 1.8, color: '#333', whiteSpace: 'pre-wrap' }}>{overviewText}</div>
            </div>
          )}

          {/* Details */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#448a40', borderBottom: '2px solid #448a40', paddingBottom: 6, marginBottom: 12 }}>PROJECT DETAILS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 13 }}>
              {[
                ['Location', [project.site_address, project.city, project.postcode].filter(Boolean).join(', ')],
                ['Start Date', project.start_date ? new Date(project.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null],
                ['Completion', project.end_date ? new Date(project.end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null],
                ['Project Manager', project.profiles?.full_name],
                ['Reference', project.project_ref],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k} style={{ borderBottom: '1px solid #f0f0f0', paddingBottom: 6, paddingTop: 6, display: 'flex', gap: 8 }}>
                  <span style={{ color: '#888', minWidth: 120 }}>{k}:</span>
                  <span style={{ fontWeight: 500 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Photos */}
          {Object.keys(photoUrls).length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#448a40', borderBottom: '2px solid #448a40', paddingBottom: 6, marginBottom: 12 }}>PROJECT PHOTOGRAPHY</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {photos.slice(0, 6).map(p => photoUrls[p.id] ? (
                  <div key={p.id}>
                    <img src={photoUrls[p.id]} alt={p.caption || ''} style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: 4 }} crossOrigin="anonymous" />
                    {p.caption && <div style={{ fontSize: 10, color: '#888', textAlign: 'center', marginTop: 3 }}>{p.caption}</div>}
                  </div>
                ) : null)}
              </div>
            </div>
          )}

          {/* Team */}
          {subs.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#448a40', borderBottom: '2px solid #448a40', paddingBottom: 6, marginBottom: 12 }}>PROJECT TEAM</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {subs.map(ps => (
                  <div key={ps.id} style={{ border: '1px solid #eee', borderRadius: 6, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#e8f5e7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#448a40', flexShrink: 0 }}>
                      {ps.subcontractors?.company_name?.charAt(0) || '?'}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{ps.subcontractors?.company_name}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>{ps.trade_on_project || ps.subcontractors?.trade}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div style={{ borderTop: '1px solid #eee', paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 11, color: '#999' }}>City Construction Ltd · cltd.co.uk</div>
            <div style={{ fontSize: 11, color: '#999' }}>Generated {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Programme Card Component ─────────────────────────────────
function ProgrammeCard({ prog, onDownload, onDelete, canDelete }) {
  const [pdfThumb, setPdfThumb] = useState(null)
  const [loadingThumb, setLoadingThumb] = useState(false)
  const [viewUrl, setViewUrl] = useState(null)
  const isPdf = prog.file_type === 'pdf'
  const isMpp = prog.file_type === 'mpp'

  useEffect(() => {
    if (!isPdf) return
    setLoadingThumb(true)
    supabase.storage.from('company-docs').createSignedUrl(prog.storage_path, 3600)
      .then(({ data }) => {
        if (data?.signedUrl) { setPdfThumb(data.signedUrl); setViewUrl(data.signedUrl) }
        setLoadingThumb(false)
      })
  }, [prog.storage_path, isPdf])

  async function openView() {
    if (viewUrl) { window.open(viewUrl, '_blank'); return }
    const { data } = await supabase.storage.from('company-docs').createSignedUrl(prog.storage_path, 3600)
    if (data?.signedUrl) { setViewUrl(data.signedUrl); window.open(data.signedUrl, '_blank') }
  }

  const fileSize = prog.file_size ? (prog.file_size / 1024 / 1024).toFixed(1) + ' MB' : ''

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--surface)' }}>
      {/* Thumbnail area — larger than company docs */}
      <div style={{ height: 180, background: 'var(--surface2)', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {isPdf && pdfThumb ? (
          <iframe
            src={`${pdfThumb}#page=1&zoom=page-fit&toolbar=0&navpanes=0&scrollbar=0`}
            style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }}
            title={prog.file_name}
          />
        ) : isPdf && loadingThumb ? (
          <div style={{ color: 'var(--text3)', fontSize: 12 }}>Loading preview...</div>
        ) : isMpp ? (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <div style={{ width: 56, height: 56, background: '#1a73e8', borderRadius: 8, margin: '0 auto 10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" fill="white" fillOpacity=".2"/><path d="M7 8h10M7 12h6M7 16h8" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1a73e8' }}>Microsoft Project</div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>.{prog.file_name.split('.').pop().toUpperCase()} file</div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <div style={{ width: 56, height: 56, background: 'var(--surface3, var(--border))', borderRadius: 8, margin: '0 auto 10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="var(--text3)" strokeWidth="1.5"/><polyline points="14 2 14 8 20 8" stroke="var(--text3)" strokeWidth="1.5"/></svg>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{prog.file_name.split('.').pop().toUpperCase()} file</div>
          </div>
        )}
        {/* Overlay download button */}
        <button onClick={onDownload} style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span style={{ fontSize: 11, color: 'white', fontWeight: 600 }}>Download</span>
        </button>
      </div>
      {/* Footer */}
      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>{prog.file_name}</div>
        {fileSize && <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>{fileSize}</div>}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="btn btn-sm" style={{ flex: 1, fontSize: 11, padding: '5px 6px' }} onClick={openView}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4 }}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            {isMpp ? 'Download to View' : 'View'}
          </button>
          <button className="btn btn-sm" style={{ fontSize: 11, padding: '5px 8px' }} onClick={onDownload} title="Download">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          {canDelete && (
            <button className="btn btn-sm btn-danger" style={{ fontSize: 11, padding: '5px 8px' }} onClick={onDelete}>✕</button>
          )}
        </div>
      </div>
    </div>
  )
}
