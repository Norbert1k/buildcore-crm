import { Fragment, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PROJECT_STATUSES, DOCUMENT_TYPES, formatDate, formatCurrency, docStatusInfo } from '../lib/utils'
import { Avatar, Pill, Spinner, IconPlus, IconEdit, IconTrash, IconChevron, ConfirmDialog, Modal, Field } from '../components/ui'
import { useAuth } from '../lib/auth'
import GoogleDriveBrowser from '../components/GoogleDrivePicker'
import ProjectModal from '../components/ProjectModal'
import EAModal from '../components/EAModal'
import ProjectDocumentation from '../components/ProjectDocumentation'
import { drawCover, drawLetterhead, drawFooter, loadLogo, BRAND, fmtDateLong } from '../lib/pdfTemplate'
import HSHandover from '../components/HSHandover'
import SubcontractorDocs from '../components/SubcontractorDocs'

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

// ── Project File Search ───────────────────────────────────────────────────────
function ProjectFileSearch({ projectId }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const wrapRef = useState(null)[0]

  useEffect(() => {
    if (!query.trim()) { setResults(null); return }
    const timer = setTimeout(() => doSearch(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  async function doSearch(q) {
    setLoading(true)
    const term = `%${q}%`
    const [docRes, hsRes] = await Promise.all([
      supabase.from('project_doc_files').select('id, file_name, file_size, folder_key, subfolder_key, storage_path')
        .eq('project_id', projectId).ilike('file_name', term).limit(10),
      supabase.from('hs_files').select('id, file_name, file_size, folder_key, storage_path')
        .eq('project_id', projectId).ilike('file_name', term).limit(10),
    ])
    setResults({
      docs: (docRes.data || []).map(f => ({ ...f, section: 'Documents' })),
      hs: (hsRes.data || []).map(f => ({ ...f, section: 'H&S Handover' })),
    })
    setLoading(false)
  }

  async function downloadFile(file) {
    const bucket = file.section === 'H&S Handover' ? 'hs-handover' : 'project-docs'
    const { data } = await supabase.storage.from(bucket).createSignedUrl(file.storage_path, 120)
    if (data?.signedUrl) {
      try {
        const res = await fetch(data.signedUrl)
        const blob = await res.blob()
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.file_name
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(a.href), 2000)
      } catch { window.open(data.signedUrl, '_blank') }
    }
  }

  const hasResults = results && (results.docs.length + results.hs.length) > 0
  const allResults = results ? [...results.docs, ...results.hs] : []

  return (
    <div style={{ position: 'relative', marginBottom: 12 }}>
      <div style={{ position: 'relative' }}>
        <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', pointerEvents: 'none' }} width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.742 10.344a6.5 6.5 0 10-1.397 1.398l3.85 3.85a1 1 0 001.415-1.414l-3.868-3.834zm-5.24 1.4a5 5 0 110-10 5 5 0 010 10z"/>
        </svg>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search files across Documents & H&S Handover..."
          style={{ paddingLeft: 32, paddingRight: 32, fontSize: 13, height: 36, width: '100%' }}
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults(null) }} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text3)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
        )}
      </div>
      {query && results && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 200, overflow: 'hidden', maxHeight: 360, overflowY: 'auto' }}>
          {loading && <div style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text3)' }}>Searching...</div>}
          {!loading && !hasResults && <div style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text3)' }}>No files found for "{query}"</div>}
          {!loading && hasResults && allResults.map(f => (
            <div key={f.id} onClick={() => downloadFile(f)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer', transition: 'background .1s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <div style={{ width: 28, height: 28, borderRadius: 5, background: f.section === 'H&S Handover' ? '#e8f5e7' : '#E6F1FB', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {f.section === 'H&S Handover'
                  ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#448a40" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#378ADD" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                }
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>{f.file_name}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>
                  {f.section}{f.folder_key ? ' · ' + f.folder_key : ''}{f.subfolder_key ? ' / ' + f.subfolder_key : ''}
                </div>
              </div>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
            </div>
          ))}
        </div>
      )}
    </div>
  )
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
  const _tabKey = 'tab:' + window.location.pathname
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem(_tabKey) || 'documents')
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
  const [showOrderValue, setShowOrderValue] = useState(null)
  const [orderValueForm, setOrderValueForm] = useState('')
  const [savingOrderValue, setSavingOrderValue] = useState(false)
  const [showEditAssign, setShowEditAssign] = useState(null)
  const [editAssignForm, setEditAssignForm] = useState({ trade_on_project: '', start_date: '', end_date: '', contract_value: '', status: 'active' })
  const [savingEditAssign, setSavingEditAssign] = useState(false)
  const [showAddDoc, setShowAddDoc] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [assignForm, setAssignForm] = useState({ subcontractor_id: '', trade_on_project: '', category: 'contractual_work', start_date: '', end_date: '', contract_value: '', variation_amount: 0, variation_notes: '' })
  const [docForm, setDocForm] = useState({ document_name: '', document_type: 'rams', expiry_date: '', notes: '', subcontractor_id: '' })
  // EA state
  const [projectEAs, setProjectEAs] = useState([])
  const [allEAs, setAllEAs] = useState([])
  const [showAssignEA, setShowAssignEA] = useState(false)
  const [showEAProfile, setShowEAProfile] = useState(null)
  const [eaAssignForm, setEaAssignForm] = useState({ ea_id: '', submission_email: '' })
  const [confirmRemoveEA, setConfirmRemoveEA] = useState(null)
  // Inline sub docs state
  const [expandedSubId, setExpandedSubId] = useState(null)
  const [subFiles, setSubFiles] = useState([])

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    const [projRes, subsRes, docsRes, allSubsRes, eaRes, allEARes] = await Promise.all([
      supabase.from('projects').select('*, profiles!projects_project_manager_id_fkey(full_name)').eq('id', id).single(),
      supabase.from('project_subcontractors').select('*, subcontractors(id, company_name, trade, status, email, phone)').eq('project_id', id),
      supabase.from('project_documents').select('*, subcontractors(company_name), profiles!project_documents_uploaded_by_fkey(full_name)').eq('project_id', id).order('created_at', { ascending: false }),
      supabase.from('subcontractors').select('id, company_name, trade').order('company_name'),
      supabase.from('project_employer_agents').select('*, employer_agents(id, company_name, contact_name, email, phone, payment_submission_email, street_address, city, postcode)').eq('project_id', id),
      supabase.from('employer_agents').select('id, company_name, payment_submission_email, city').eq('status', 'active').order('company_name'),
    ])
    setProject(projRes.data)
    setDriveFolderId(projRes.data?.drive_folder_id || null)
    setDriveFolderName(projRes.data?.drive_folder_name || null)
    setSubs(subsRes.data || [])
    setDocs(docsRes.data || [])
    setAllSubs(allSubsRes.data || [])
    setProjectEAs(eaRes.data || [])
    setAllEAs(allEARes.data || [])
    // Load subcontractor files
    const { data: sfData } = await supabase.from('project_sub_files').select('*').eq('project_id', id).order('created_at', { ascending: false })
    setSubFiles(sfData || [])
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

  async function saveOrderValue() {
    if (!orderValueForm) return
    setSavingOrderValue(true)
    const ps = showOrderValue
    const newValue = parseFloat(orderValueForm) || 0
    await supabase.from('project_subcontractors').update({
      contract_value: newValue
    }).eq('id', ps.id)
    setSavingOrderValue(false)
    setShowOrderValue(null)
    setOrderValueForm('')
    load()
  }

  async function saveEditAssign() {
    const ps = showEditAssign
    if (!ps) return
    setSavingEditAssign(true)
    const payload = {
      trade_on_project: editAssignForm.trade_on_project || null,
      start_date: editAssignForm.start_date || null,
      end_date: editAssignForm.end_date || null,
      contract_value: editAssignForm.contract_value ? parseFloat(editAssignForm.contract_value) : null,
      status: editAssignForm.status || 'active',
    }
    await supabase.from('project_subcontractors').update(payload).eq('id', ps.id)
    setSavingEditAssign(false)
    setShowEditAssign(null)
    load()
  }

  async function assignSub() {
    await supabase.from('project_subcontractors').insert({ project_id: id, ...assignForm, contract_value: assignForm.contract_value || null })
    setShowAssignSub(false)
    setAssignForm({ subcontractor_id: '', trade_on_project: '', category: 'contractual_work', start_date: '', end_date: '', contract_value: '', variation_amount: 0, variation_notes: '' })
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

  async function assignEA() {
    if (!eaAssignForm.ea_id) return
    await supabase.from('project_employer_agents').insert({
      project_id: id,
      ea_id: eaAssignForm.ea_id,
      submission_email: eaAssignForm.submission_email || null,
    })
    setShowAssignEA(false)
    setEaAssignForm({ ea_id: '', submission_email: '' })
    load()
  }

  async function removeEA(peaId) {
    await supabase.from('project_employer_agents').delete().eq('id', peaId)
    setConfirmRemoveEA(null)
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
              {project.client_name && (
                <div>
                  <span style={{ color: 'var(--text3)', marginRight: 6 }}>Client:</span>
                  {project.client_id ? (
                    <span
                      onClick={() => navigate(`/clients/${project.client_id}`)}
                      style={{ fontWeight: 700, color: 'var(--text)', cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                      onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                    >{project.client_name}</span>
                  ) : (
                    <span style={{ fontWeight: 700, color: 'var(--text)' }}>{project.client_name}</span>
                  )}
                </div>
              )}
              {[
                ['Project Manager', project.profiles?.full_name],
                ['Location', [project.site_address, project.city, project.postcode].filter(Boolean).join(', ')],
                ['Start Date', formatDate(project.start_date)],
                ['End Date', formatDate(project.end_date)],
                ['Duration', calcDuration(project.start_date, project.end_date)],
                can('view_project_value') ? ['Contract Value', formatCurrency(project.value)] : null,
              ].filter(x => x && x[1] && x[1] !== '—').map(([k, v]) => (
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

      {/* Employers Agent — always visible directly under Project Description */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: projectEAs.length > 0 ? 8 : 0, padding: '8px 12px', background: '#042C53', borderRadius: 6, borderLeft: '3px solid #5b9bd5' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5b9bd5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <rect x="2" y="3" width="20" height="18" rx="2"/><path d="M8 3v3"/><path d="M16 3v3"/><circle cx="12" cy="13" r="3"/><path d="M6 21v-1a6 6 0 0 1 12 0v1"/>
          </svg>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#85B7EB' }}>Employers Agent</div>
          <div style={{ fontSize: 11, color: '#85B7EB99', flex: 1 }}>{projectEAs.length > 0 ? `${projectEAs.length} assigned` : 'None assigned'}</div>
          {(can('manage_projects') || can('manage_subcontractors')) && (
            <button className="btn btn-sm" style={{ borderColor: '#5b9bd5', color: '#85B7EB', background: 'transparent' }} onClick={() => setShowAssignEA(true)}>
              <IconPlus size={13} /> Assign EA
            </button>
          )}
        </div>
        {projectEAs.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Company</th><th>Contact</th><th>Email</th><th>Payment Application Email (This Project)</th><th></th></tr></thead>
              <tbody>
                {projectEAs.map(pea => (
                  <tr key={pea.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: pea.employer_agents ? 'pointer' : 'default' }}
                        onClick={() => pea.employer_agents && setShowEAProfile(pea.employer_agents)}
                        title={pea.employer_agents ? 'View company profile' : ''}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#E6F1FB', color: '#185FA5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, flexShrink: 0 }}>
                          {pea.employer_agents?.company_name?.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() || '?'}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, color: pea.employer_agents ? '#185FA5' : 'var(--text)' }}>
                            {pea.employer_agents?.company_name}
                          </div>
                          {(pea.employer_agents?.city || pea.employer_agents?.postcode) && (
                            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                              {pea.employer_agents?.city || ''}{pea.employer_agents?.city && pea.employer_agents?.postcode ? ' · ' : ''}{pea.employer_agents?.postcode || ''}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div>{pea.employer_agents?.contact_name || '—'}</div>
                      <div className="td-muted">{pea.employer_agents?.phone || ''}</div>
                    </td>
                    <td className="td-muted">{pea.employer_agents?.email || '—'}</td>
                    <td>
                      <span style={{ fontWeight: 500, color: 'var(--blue)' }}>
                        {pea.submission_email || pea.employer_agents?.payment_submission_email || <span style={{ color: 'var(--text3)', fontWeight: 400 }}>—</span>}
                      </span>
                    </td>
                    <td>
                      {can('manage_projects') && (
                        <button className="btn btn-sm btn-danger" onClick={() => setConfirmRemoveEA(pea.id)}><IconTrash size={12}/></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ProjectFileSearch projectId={id} />

      <div className="filter-tabs">
        <div className={`filter-tab ${activeTab === 'documents' ? 'active' : ''}`} onClick={() => { setActiveTab('documents'); localStorage.setItem(_tabKey, 'documents') }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Documents
        </div>
        <div className={`filter-tab ${activeTab === 'subcontractors' ? 'active' : ''}`} onClick={() => { setActiveTab('subcontractors'); localStorage.setItem(_tabKey, 'subcontractors') }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          Subcontractors<span className="tab-badge">{subs.filter(ps => { const c = ps.category && ps.category.trim() ? ps.category.trim() : 'contractual_work'; return c === 'contractual_work' }).length}</span>
        </div>
        <div className={`filter-tab ${activeTab === 'design_team' ? 'active' : ''}`} onClick={() => { setActiveTab('design_team'); localStorage.setItem(_tabKey, 'design_team') }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
          Design Team<span className="tab-badge">{subs.filter(ps => ps.category === 'design_team').length}</span>
        </div>
        {can('view_hs_handover') && (
        <div className={`filter-tab ${activeTab === 'hs' ? 'active' : ''}`} onClick={() => { setActiveTab('hs'); localStorage.setItem(_tabKey, 'hs') }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          H&S Handover
        </div>
        )}
        {can('view_photos') && (
        <div className={`filter-tab ${activeTab === 'photos' ? 'active' : ''}`} onClick={() => { setActiveTab('photos'); localStorage.setItem(_tabKey, 'photos') }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          Photos<span className="tab-badge">{photos.length}</span>
        </div>
        )}

        {can('view_case_study') && (
        <div className={`filter-tab ${activeTab === 'casestudy' ? 'active' : ''}`} onClick={() => { setActiveTab('casestudy'); localStorage.setItem(_tabKey, 'casestudy') }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Case Study
        </div>
        )}

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



      {activeTab === 'photos' && can('view_photos') && (
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

      {activeTab === 'casestudy' && can('view_case_study') && (
        <CaseStudy project={project} subs={subs} docs={docs} photos={photos} />
      )}

      {(activeTab === 'subcontractors' || activeTab === 'design_team') && (() => {
        const isDesignTeam = activeTab === 'design_team'
        const categoryKey = isDesignTeam ? 'design_team' : 'contractual_work'
        const catSubs = subs.filter(ps => {
          const c = ps.category && ps.category.trim() ? ps.category.trim() : 'contractual_work'
          return c === categoryKey
        })
        const catLabel = isDesignTeam ? 'Design Team' : 'Subcontractors'
        const catColor = isDesignTeam ? '#85B7EB' : '#97C459'
        const catBg = isDesignTeam ? '#042C53' : '#173404'
        return (
        <div>
          <div className="section-header">
            <div className="section-title">Assigned {catLabel}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(can('manage_projects') || can('manage_subcontractors')) && (
                <button className="btn btn-primary btn-sm" onClick={() => { setAssignForm(f => ({ ...f, category: categoryKey })); setShowAssignSub(true) }}>
                  <IconPlus size={13} /> Assign {catLabel === 'Subcontractors' ? 'Subcontractor' : 'Design Team'}
                </button>
              )}
            </div>
          </div>

          {catSubs.length === 0 ? (
            <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No {catLabel.toLowerCase()} assigned to this project yet.</div>
          ) : (
            <>
              <div style={{ marginBottom: 16 }}>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Company</th><th>Trade on Project</th><th>Start</th><th>End</th>{can('view_project_value') && <><th>Order Value</th><th>Variation</th><th>Total</th></>}<th>Status</th><th></th></tr></thead>
                    <tbody>
                      {catSubs.map(ps => {
                        const isExpanded = expandedSubId === ps.id
                        const colCount = 6 + (can('view_project_value') ? 3 : 0)
                        return (
                        <Fragment key={ps.id}>
                        <tr style={{ background: isExpanded ? 'var(--surface2)' : undefined }}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, flex: 1 }} onClick={() => setExpandedSubId(isExpanded ? null : ps.id)}>
                                <Avatar name={ps.subcontractors?.company_name} size="sm" />
                                <div>
                                  <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    {ps.subcontractors?.company_name}
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><polyline points="6 9 12 15 18 9"/></svg>
                                  </div>
                                  {subFiles.filter(f => f.project_sub_id === ps.id).length > 0 && (
                                    <span style={{ fontSize: 9, color: 'var(--blue)', fontWeight: 500 }}>{subFiles.filter(f => f.project_sub_id === ps.id).length} docs</span>
                                  )}
                                </div>
                              </div>
                              <span
                                onClick={e => { e.stopPropagation(); navigate(`/subcontractors/${ps.subcontractors?.id}`, { state: { from: `/projects/${id}` } }) }}
                                style={{ fontSize: 10, color: 'var(--accent)', cursor: 'pointer', whiteSpace: 'nowrap', padding: '2px 6px', borderRadius: 4, border: '0.5px solid var(--accent)', fontWeight: 500 }}>
                                View Profile
                              </span>
                            </div>
                          </td>
                          <td>{ps.subcontractors?.trade || ps.trade_on_project}</td>
                          <td className="td-muted">{formatDate(ps.start_date)}</td>
                          <td className="td-muted">{formatDate(ps.end_date)}</td>
                          {can('view_project_value') && (
                          <>
                          <td style={{ fontWeight: 500 }}>{ps.contract_value ? formatCurrency(ps.contract_value) : (
                            can('manage_projects') ? (
                              <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 8px' }} onClick={e => { e.stopPropagation(); setShowOrderValue(ps); setOrderValueForm('') }}>
                                + Add
                              </button>
                            ) : <span style={{ color: 'var(--text3)' }}>—</span>
                          )}</td>
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
                          </>
                          )}
                          <td><Pill cls={ps.status === 'active' ? 'pill-green' : 'pill-gray'}>{ps.status}</Pill></td>
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {can('manage_projects') && (
                                <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 8px' }} title="Edit assignment"
                                  onClick={e => {
                                    e.stopPropagation()
                                    setEditAssignForm({
                                      trade_on_project: ps.trade_on_project || '',
                                      start_date: ps.start_date ? ps.start_date.substring(0, 10) : '',
                                      end_date: ps.end_date ? ps.end_date.substring(0, 10) : '',
                                      contract_value: ps.contract_value != null ? String(ps.contract_value) : '',
                                      status: ps.status || 'active',
                                    })
                                    setShowEditAssign(ps)
                                  }}>
                                  <IconEdit size={12} />
                                </button>
                              )}
                              {can('manage_projects') && ps.variation_amount > 0 && (
                                <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 8px' }} title="Add variation" onClick={e => { e.stopPropagation(); setShowVariation(ps); setVariationForm({ amount: '', notes: '' }) }}>
                                  +VAR
                                </button>
                              )}
                              {can('manage_projects') && <button className="btn btn-sm btn-danger" onClick={() => setConfirmRemove(ps.id)}><IconTrash size={12}/></button>}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={colCount} style={{ padding: 0, background: 'var(--surface2)' }}>
                              <SubcontractorDocs projectId={id} projectSubId={ps.id} subFiles={subFiles.filter(f => f.project_sub_id === ps.id)} onReload={load} canManage={can('manage_projects') || can('manage_documents')} />
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      )})}
                    </tbody>
                  </table>
                </div>
              </div>
              {can('view_project_value') && catSubs.length > 1 && (() => {
                const totalOrder = catSubs.reduce((s, ps) => s + (parseFloat(ps.contract_value)||0), 0)
                const totalVar = catSubs.reduce((s, ps) => s + (parseFloat(ps.variation_amount)||0), 0)
                const totalAll = totalOrder + totalVar
                return (
                  <div style={{ display: 'flex', gap: 16, justifyContent: 'flex-end', padding: '12px 0', borderTop: '2px solid var(--border)', marginTop: 8 }}>
                    <div style={{ fontSize: 12, color: 'var(--text2)' }}>Total Order: <span style={{ fontWeight: 700, color: 'var(--text)' }}>{formatCurrency(totalOrder)}</span></div>
                    {totalVar > 0 && <div style={{ fontSize: 12, color: 'var(--amber)' }}>Variations: <span style={{ fontWeight: 700 }}>+{formatCurrency(totalVar)}</span></div>}
                    <div style={{ fontSize: 12, color: 'var(--green)' }}>Grand Total: <span style={{ fontWeight: 700 }}>{formatCurrency(totalAll)}</span></div>
                  </div>
                )
              })()}
            </>
          )}
        </div>
      )})()}

      {activeTab === 'documents' && (
        <div>
          {/* Project Documentation folder system */}
          <ProjectDocumentation projectId={id} projectName={project?.project_name} />

          {/* Divider */}
          <div style={{ margin: '24px 0', borderTop: '1px solid var(--border)' }} />

          {/* RAMS / Certs / project-linked docs */}
          <div className="section-header">
            <div className="section-title">RAMS & Compliance Documents</div>
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

      {/* Order Value Modal */}
      {showOrderValue && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setShowOrderValue(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', padding: 24, width: '100%', maxWidth: 440, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Add Order Value</h3>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>
              {showOrderValue.subcontractors?.company_name}
            </div>
            <Field label="Order Value (£) *">
              <input type="number" value={orderValueForm} onChange={e => setOrderValueForm(e.target.value)}
                placeholder="e.g. 50000" autoFocus />
            </Field>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn" onClick={() => setShowOrderValue(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveOrderValue} disabled={savingOrderValue || !orderValueForm}>
                {savingOrderValue ? 'Saving...' : 'Save Order Value'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Assignment Modal */}
      <Modal open={!!showEditAssign} onClose={() => setShowEditAssign(null)} title={showEditAssign ? `Edit: ${showEditAssign.subcontractors?.company_name}` : 'Edit Assignment'} size="sm"
        footer={<>
          <button className="btn" onClick={() => setShowEditAssign(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveEditAssign} disabled={savingEditAssign}>
            {savingEditAssign ? 'Saving…' : 'Save Changes'}
          </button>
        </>}>
        <div className="form-grid">
          <div className="full">
            <Field label="Trade on Project">
              <input value={editAssignForm.trade_on_project} onChange={e => setEditAssignForm(f => ({ ...f, trade_on_project: e.target.value }))} placeholder="e.g. Electrical" />
            </Field>
          </div>
          <Field label="Start Date">
            <input type="date" value={editAssignForm.start_date} onChange={e => setEditAssignForm(f => ({ ...f, start_date: e.target.value }))} />
          </Field>
          <Field label="End Date">
            <input type="date" value={editAssignForm.end_date} onChange={e => setEditAssignForm(f => ({ ...f, end_date: e.target.value }))} />
          </Field>
          {can('view_project_value') && (
            <div className="full">
              <Field label="Order Value (£)">
                <input type="number" value={editAssignForm.contract_value} onChange={e => setEditAssignForm(f => ({ ...f, contract_value: e.target.value }))} placeholder="e.g. 50000" min="0" step="100" />
              </Field>
            </div>
          )}
          <div className="full">
            <Field label="Status">
              <select value={editAssignForm.status} onChange={e => setEditAssignForm(f => ({ ...f, status: e.target.value }))}>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="on_hold">On Hold</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </Field>
          </div>
          {showEditAssign && showEditAssign.variation_amount > 0 && (
            <div className="full" style={{ background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', borderRadius: 6, padding: '10px 12px', fontSize: 12, color: 'var(--text2)' }}>
              <div style={{ fontWeight: 600, color: 'var(--amber)', marginBottom: 2 }}>Note: Variation of +{formatCurrency(showEditAssign.variation_amount)} is attached to this assignment.</div>
              <div>Use the +VAR button on the row to manage variations separately.</div>
            </div>
          )}
        </div>
      </Modal>

      {activeTab === 'hs' && can('view_hs_handover') && (
        <HSHandover projectId={id} projectName={project?.project_name} />
      )}

      {showEdit && <ProjectModal project={project} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); load() }} />}

      <Modal open={showAssignSub} onClose={() => setShowAssignSub(false)} title="Assign Subcontractor" size="sm"
        footer={<><button className="btn" onClick={() => setShowAssignSub(false)}>Cancel</button><button className="btn btn-primary" onClick={assignSub}>Assign</button></>}>
        <div className="form-grid">
          <div className="full"><Field label="Subcontractor *"><select value={assignForm.subcontractor_id} onChange={e => {
            const selected = allSubs.find(s => s.id === e.target.value)
            setAssignForm(f => ({ ...f, subcontractor_id: e.target.value, trade_on_project: selected?.trade || '' }))
          }}><option value="">Select…</option>{allSubs.filter(s => !subs.find(ps => ps.subcontractors?.id === s.id)).map(s => <option key={s.id} value={s.id}>{s.company_name} – {s.trade}</option>)}</select></Field></div>
          <div className="full"><Field label="Category *"><select value={assignForm.category} onChange={e => setAssignForm(f => ({ ...f, category: e.target.value }))}>
            <option value="design_team">Design Team</option>
            <option value="contractual_work">Contractual Work</option>
          </select></Field></div>
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

      {/* Assign EA Modal */}
      <Modal open={showAssignEA} onClose={() => setShowAssignEA(false)} title="Assign Employers Agent" size="sm"
        footer={<><button className="btn" onClick={() => setShowAssignEA(false)}>Cancel</button><button className="btn btn-primary" onClick={assignEA} disabled={!eaAssignForm.ea_id}>Assign</button></>}>
        <div className="form-grid">
          <div className="full"><Field label="Employers Agent *"><select value={eaAssignForm.ea_id} onChange={e => {
            const sel = allEAs.find(ea => ea.id === e.target.value)
            setEaAssignForm(f => ({ ...f, ea_id: e.target.value, submission_email: sel?.payment_submission_email || '' }))
          }}><option value="">Select EA…</option>{allEAs.filter(ea => !projectEAs.find(p => p.ea_id === ea.id)).map(ea => <option key={ea.id} value={ea.id}>{ea.company_name}</option>)}</select></Field></div>
          <div className="full"><Field label="Submission Email for this project">
            <input type="email" value={eaAssignForm.submission_email} onChange={e => setEaAssignForm(f => ({ ...f, submission_email: e.target.value }))} placeholder="Override default submission email (optional)" />
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Leave blank to use the EA's default submission email.</div>
          </Field></div>
        </div>
      </Modal>

      <ConfirmDialog open={!!confirmRemoveEA} onClose={() => setConfirmRemoveEA(null)} onConfirm={() => removeEA(confirmRemoveEA)} title="Remove Employers Agent" message="Remove this EA from the project?" danger />

      {showEAProfile && <EAModal ea={showEAProfile} onClose={() => setShowEAProfile(null)} onSaved={() => { setShowEAProfile(null); load() }} />}
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
      const trades = subs.map(s => s.subcontractors?.trade || s.trade_on_project).filter(Boolean).join(', ')
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

  async function exportPDF() {
    setExporting(true)
    try {
      // Lazy-load pdf-lib
      if (!window.PDFLib) {
        const script = document.createElement('script')
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'
        document.head.appendChild(script)
        await new Promise(r => { script.onload = r })
      }
      const { PDFDocument, StandardFonts, PageSizes } = window.PDFLib

      const pdf = await PDFDocument.create()
      const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold)
      const regFont = await pdf.embedFont(StandardFonts.Helvetica)
      const fonts = { boldFont, regFont }
      const logo = await loadLogo(pdf)

      const A4 = PageSizes.A4   // [595, 842]
      const A4_W = A4[0], A4_H = A4[1]

      const addressLines = [
        project.site_address || '',
        project.city || '',
        project.postcode || '',
      ].filter(Boolean)

      // ── Page 1: Branded cover ──
      const cover = pdf.addPage(A4)
      drawCover(cover, fonts, logo, {
        eyebrow: 'PROJECT CASE STUDY',
        title: project.project_name || 'Project',
        projectName: project.client_name ? `Client: ${project.client_name}` : undefined,
        addressLines,
      })

      // ── Page 2: Project details + overview ──
      const detailPage = pdf.addPage(A4)
      let y = drawLetterhead(detailPage, fonts, logo)

      detailPage.drawText('Project overview', { x: 32, y: y - 4, size: 20, font: boldFont, color: BRAND.text })
      y -= 30

      // Key facts grid
      const facts = [
        ['Client', project.client_name || '—'],
        ['Duration', duration || '—'],
        ['Value', project.value ? `£${Number(project.value).toLocaleString()}` : '—'],
        ['Status', (project.status?.charAt(0).toUpperCase() + project.status?.slice(1)) || '—'],
        ['Reference', project.project_ref || '—'],
        ['Project Manager', project.profiles?.full_name || '—'],
      ]
      const colW = (A4_W - 64) / 2
      for (let i = 0; i < facts.length; i++) {
        const [k, v] = facts[i]
        const col = i % 2
        const row = Math.floor(i / 2)
        const fx = 32 + col * colW
        const fy = y - row * 38
        // Light fill background for each fact
        detailPage.drawRectangle({ x: fx, y: fy - 28, width: colW - 8, height: 32, color: { r: 0.965, g: 0.961, b: 0.94 } })
        detailPage.drawText(k.toUpperCase(), { x: fx + 8, y: fy - 12, size: 8, font: regFont, color: BRAND.muted })
        detailPage.drawText(String(v), { x: fx + 8, y: fy - 24, size: 11, font: boldFont, color: BRAND.text })
      }
      y -= Math.ceil(facts.length / 2) * 38 + 16

      // Overview text
      const overview = aiOverview || project.description
      if (overview && overview.trim()) {
        if (y < 200) { /* fits */ }
        detailPage.drawText('Project description', { x: 32, y: y - 4, size: 14, font: boldFont, color: BRAND.green })
        y -= 18
        // Word-wrap helper
        const wrap = (text, maxW, size) => {
          const words = text.split(/\s+/)
          const lines = []
          let cur = ''
          for (const w of words) {
            const test = cur ? cur + ' ' + w : w
            if (regFont.widthOfTextAtSize(test, size) > maxW) {
              if (cur) lines.push(cur); cur = w
            } else { cur = test }
          }
          if (cur) lines.push(cur)
          return lines
        }
        const paras = overview.split(/\n\n+/)
        for (const para of paras) {
          const lines = wrap(para.replace(/\n/g, ' '), A4_W - 64, 11)
          for (const line of lines) {
            if (y < 80) break
            detailPage.drawText(line, { x: 32, y, size: 11, font: regFont, color: BRAND.text, lineHeight: 14 })
            y -= 16
          }
          y -= 8
          if (y < 80) break
        }
      }

      // ── Photos page (if any) ──
      const photoEntries = photos.slice(0, 6).filter(p => photoUrls[p.id])
      if (photoEntries.length > 0) {
        const photoPage = pdf.addPage(A4)
        let py = drawLetterhead(photoPage, fonts, logo)
        photoPage.drawText('Project photography', { x: 32, y: py - 4, size: 20, font: boldFont, color: BRAND.text })
        py -= 30

        // Embed each photo
        const photoW = (A4_W - 64 - 12) / 2  // 2 columns
        const photoH = photoW * 0.75
        let col = 0
        let cy = py
        for (const ph of photoEntries) {
          try {
            const r = await fetch(photoUrls[ph.id])
            const blob = await r.blob()
            const ab = await blob.arrayBuffer()
            let img = null
            try { img = await pdf.embedJpg(ab) } catch { img = await pdf.embedPng(ab) }
            const px = 32 + col * (photoW + 12)
            if (cy - photoH < 60) break  // ran out of room
            photoPage.drawImage(img, { x: px, y: cy - photoH, width: photoW, height: photoH })
            col++
            if (col >= 2) { col = 0; cy -= photoH + 12 }
          } catch (e) { console.warn('photo skip', ph.id, e) }
        }
      }

      // ── Team page (if any subs) ──
      if (subs && subs.length > 0) {
        const teamPage = pdf.addPage(A4)
        let ty = drawLetterhead(teamPage, fonts, logo)
        teamPage.drawText('Project team', { x: 32, y: ty - 4, size: 20, font: boldFont, color: BRAND.text })
        ty -= 30

        for (const ps of subs) {
          if (ty < 80) break
          const name = ps.subcontractors?.company_name || '—'
          const trade = ps.subcontractors?.trade || ps.trade_on_project || ''
          // Card
          teamPage.drawRectangle({ x: 32, y: ty - 36, width: A4_W - 64, height: 32, color: { r: 0.965, g: 0.961, b: 0.94 } })
          teamPage.drawText(name, { x: 44, y: ty - 18, size: 12, font: boldFont, color: BRAND.text })
          teamPage.drawText(trade, { x: 44, y: ty - 30, size: 10, font: regFont, color: BRAND.muted })
          ty -= 40
        }
      }

      // ── Footer page numbers on every content page ──
      const allPages = pdf.getPages()
      const total = allPages.length
      for (let i = 1; i < total; i++) {
        drawFooter(allPages[i], fonts, project.project_name || '', i + 1, total)
      }

      const bytes = await pdf.save()
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${project.project_name || 'Project'} - Case Study.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    } catch (e) {
      console.error('[CaseStudy.exportPDF]', e)
      alert('Export failed: ' + (e?.message || e))
    }
    setExporting(false)
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
                      <div style={{ fontSize: 11, color: '#888' }}>{ps.subcontractors?.trade || ps.trade_on_project}</div>
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
