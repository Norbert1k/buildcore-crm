import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Spinner, Field, IconPlus, IconTrash, ConfirmDialog } from './ui'

// Default % groups so first-time users have a sensible starting point — based on a typical CCG report
const DEFAULT_GROUPS = [
  { name: 'Substructure & Frame', items: [
    { label: 'Substructure', percent: 0 },
    { label: 'Frame / blockwork', percent: 0 },
    { label: 'Stairs / Cores', percent: 0 },
    { label: 'External walls', percent: 0 },
    { label: 'Steel Remedials (SF)', percent: 0 },
    { label: 'Structural remedials', percent: 0 },
  ]},
  { name: 'Roof & Envelope', items: [
    { label: 'Roof Structure', percent: 0 },
    { label: 'Roof Coverings', percent: 0 },
    { label: 'Windows GF', percent: 0 },
    { label: 'Windows FF', percent: 0 },
    { label: 'Windows SF', percent: 0 },
    { label: 'External Doors', percent: 0 },
    { label: 'Cladding', percent: 0 },
    { label: 'External Finishes', percent: 0 },
  ]},
  { name: 'Internal Finishes', items: [
    { label: 'Drylining 1st fix GF', percent: 0 },
    { label: 'Drylining 1st fix FF', percent: 0 },
    { label: 'Drylining 1st fix SF', percent: 0 },
    { label: 'UFH GF / manifolds', percent: 0 },
    { label: 'UFH FF / manifolds', percent: 0 },
    { label: 'UFH SF / manifolds', percent: 0 },
    { label: 'UFH TF / manifolds', percent: 0 },
    { label: 'Screed GF', percent: 0 },
    { label: 'Screed FF', percent: 0 },
    { label: 'Screed SF', percent: 0 },
    { label: 'Screed TF', percent: 0 },
    { label: 'Drylining 2nd fix', percent: 0 },
    { label: 'Tiling', percent: 0 },
  ]},
  { name: 'MEP', items: [
    { label: 'Mechanical / Plumbing 1st fix GF', percent: 0 },
    { label: 'Mechanical / Plumbing 1st fix FF', percent: 0 },
    { label: 'Mechanical / Plumbing 1st fix SF', percent: 0 },
    { label: 'Mechanical / Plumbing 1st fix TF', percent: 0 },
    { label: 'Electrical 1st fix GF', percent: 0 },
    { label: 'Electrical 1st fix FF', percent: 0 },
    { label: 'Electrical 1st fix SF', percent: 0 },
    { label: 'Electrical 1st fix TF', percent: 0 },
  ]},
  { name: 'Sprinklers & Firestopping', items: [
    { label: 'Sprinklers GF', percent: 0 },
    { label: 'Sprinklers FF', percent: 0 },
    { label: 'Sprinklers SF', percent: 0 },
    { label: 'Sprinklers TF', percent: 0 },
    { label: 'Firestopping GF', percent: 0 },
    { label: 'Firestopping FF', percent: 0 },
    { label: 'Firestopping SF', percent: 0 },
    { label: 'Firestopping TF', percent: 0 },
  ]},
  { name: 'Utilities', items: [
    { label: 'Electrical UKPS – Coordination ongoing', percent: 0 },
    { label: 'Mains Water UKPS – Coordination ongoing', percent: 0 },
    { label: 'Comms BT / Data (TBC)', percent: 0 },
    { label: 'Metering TBC', percent: 0 },
  ]},
]

// Format YYYY-MM-DD or ISO date string as DD/MM/YYYY (UTC-safe)
function fmtDateUK(d) {
  if (!d) return ''
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  try { return new Date(d).toLocaleDateString('en-GB') } catch { return '' }
}

// Generate next PPR-YYYY-MM number for this project
async function nextReportNumber(projectId) {
  const now = new Date()
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const baseNumber = `PPR-${ym}`
  // Check for existing same-month reports — append -01, -02, etc.
  const { data } = await supabase.from('progress_reports').select('report_number')
    .eq('project_id', projectId).ilike('report_number', `${baseNumber}%`)
  if (!data || data.length === 0) return baseNumber
  let suffix = 1
  while (data.some(r => r.report_number === `${baseNumber}-${String(suffix).padStart(2, '0')}`)) suffix++
  return `${baseNumber}-${String(suffix).padStart(2, '0')}`
}

export default function ProgressReportEditor({ projectId, projectName, reportId, onClose, onSaved }) {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [report, setReport] = useState(null)
  const [photos, setPhotos] = useState([])
  const [uploading, setUploading] = useState(false)
  const [confirmDeletePhoto, setConfirmDeletePhoto] = useState(null)
  const [activeTab, setActiveTab] = useState('info')
  const fileInputRef = useRef(null)

  useEffect(() => { load() }, [reportId, projectId])

  async function load() {
    setLoading(true)
    try {
      if (reportId) {
        // Existing report — load it
        const [rRes, pRes] = await Promise.all([
          supabase.from('progress_reports').select('*').eq('id', reportId).single(),
          supabase.from('progress_report_photos').select('*').eq('report_id', reportId).order('display_order'),
        ])
        if (rRes.error) throw rRes.error
        setReport(rRes.data)
        setPhotos(pRes.data || [])
        setDirty(false)
      } else {
        // New report — pre-fill from latest previous report for this project (if any)
        const { data: prev } = await supabase.from('progress_reports').select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        const number = await nextReportNumber(projectId)
        // Get project info for sensible defaults
        const { data: proj } = await supabase.from('projects').select('project_name, project_ref, address, postcode, employer_name').eq('id', projectId).maybeSingle()
        setReport({
          id: null,
          project_id: projectId,
          report_number: number,
          report_date: new Date().toISOString().slice(0, 10),
          job_no: prev?.job_no || (proj?.project_ref ? `${projectName} – ${proj.project_ref}` : projectName || ''),
          employer: prev?.employer || proj?.employer_name || '',
          client_pm: prev?.client_pm || '',
          contract_administrator: prev?.contract_administrator || '',
          surveyor: prev?.surveyor || '',
          main_contractor: prev?.main_contractor || 'City Construction Group',
          mc_pm: prev?.mc_pm || '',
          site_manager: prev?.site_manager || '',
          start_on_site: prev?.start_on_site || null,
          contract_completion: prev?.contract_completion || null,
          target_completion: prev?.target_completion || null,
          estimated_completion: prev?.estimated_completion || null,
          current_phase: prev?.current_phase || '',
          overall_progress: prev?.overall_progress || '',
          delays_text: prev?.delays_text || '',
          delays_reason: prev?.delays_reason || '',
          // Carry forward % values + sub items per user spec
          programme_groups: prev?.programme_groups || DEFAULT_GROUPS,
          pm_statement: prev?.pm_statement || '',
          hs_text: prev?.hs_text || 'Zero health and safety incidents have occurred during this reporting period.',
          valuations: prev?.valuations || [],
          variations: prev?.variations || [],
          risks: prev?.risks || [],
          rfis: prev?.rfis || [],
          aob: prev?.aob || '',
        })
        setPhotos([])
        setDirty(true)
      }
    } catch (e) { console.error('[ProgressReport] load error:', e); alert('Load failed: ' + e.message) }
    setLoading(false)
  }

  function patch(field, value) { setReport(r => ({ ...r, [field]: value })); setDirty(true) }

  async function save() {
    if (!report) return
    setSaving(true)
    try {
      const payload = { ...report }
      delete payload.id
      let savedId = report.id
      if (savedId) {
        const { error } = await supabase.from('progress_reports').update(payload).eq('id', savedId)
        if (error) throw error
      } else {
        payload.created_by = profile?.id
        const { data, error } = await supabase.from('progress_reports').insert(payload).select('id').single()
        if (error) throw error
        savedId = data.id
        setReport(r => ({ ...r, id: savedId }))
      }
      if (onSaved) onSaved(savedId)
      setDirty(false)
    } catch (e) {
      console.error('[ProgressReport] save error:', e)
      alert('Save failed: ' + e.message)
    }
    setSaving(false)
  }

  async function uploadPhotos(fileList) {
    if (!fileList || fileList.length === 0) return
    if (!report?.id) {
      // Save first to get a report ID
      await save()
      // refetch the now-saved report ID
      // (save() updates report.id state; we need a brief delay or chain it)
      setTimeout(() => uploadPhotos(fileList), 200)
      return
    }
    setUploading(true)
    const errors = []
    let nextOrder = (photos[photos.length - 1]?.display_order || 0) + 1
    for (const f of Array.from(fileList)) {
      try {
        const ext = f.name.split('.').pop()
        const path = `${report.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        const { error: upErr } = await supabase.storage.from('progress-photos').upload(path, f, { upsert: false })
        if (upErr) throw upErr
        const { error: dbErr } = await supabase.from('progress_report_photos').insert({
          report_id: report.id, storage_path: path, file_name: f.name, file_size: f.size, display_order: nextOrder++,
        })
        if (dbErr) throw dbErr
      } catch (e) { errors.push(`${f.name}: ${e.message}`) }
    }
    if (errors.length) alert('Some uploads failed:\n' + errors.join('\n'))
    setUploading(false)
    // Refresh photos
    const { data } = await supabase.from('progress_report_photos').select('*').eq('report_id', report.id).order('display_order')
    setPhotos(data || [])
  }

  async function deletePhoto(photoId) {
    const p = photos.find(x => x.id === photoId)
    if (p) await supabase.storage.from('progress-photos').remove([p.storage_path])
    await supabase.from('progress_report_photos').delete().eq('id', photoId)
    setPhotos(photos.filter(x => x.id !== photoId))
    setConfirmDeletePhoto(null)
  }

  // ─── PDF Export ──────────────────────────────────────────
  async function exportPDF() {
    if (!report?.id) { alert('Save the report first'); return }
    await generateProgressReportPdf(report, photos, projectName)
  }

  // Helper editors for arrays
  const addRowToArr = (key, blank) => patch(key, [...(report[key] || []), blank])
  const updateRowInArr = (key, idx, patchObj) => patch(key, report[key].map((r, i) => i === idx ? { ...r, ...patchObj } : r))
  const removeRowFromArr = (key, idx) => patch(key, report[key].filter((_, i) => i !== idx))

  if (loading) return (
    <Overlay onClose={onClose}>
      <div style={{ padding: 60, textAlign: 'center' }}><Spinner /></div>
    </Overlay>
  )
  if (!report) return null

  const tabs = [
    { id: 'info', label: '1. Project Info' },
    { id: 'programme', label: '2. Programme & %' },
    { id: 'statement', label: '3. PM Statement & H&S' },
    { id: 'commercial', label: '4. Valuations & Variations' },
    { id: 'risks', label: '5. Risks & RFIs' },
    { id: 'photos', label: `6. Photos (${photos.length})` },
  ]

  return (
    <Overlay onClose={onClose}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            📋 {report.report_number} — {projectName}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            {report.id ? 'Editing existing report' : 'New report (not yet saved)'}
          </div>
        </div>
        <button className={'btn btn-sm' + (dirty ? ' btn-primary' : '')} onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : dirty ? (report.id ? 'Save changes' : 'Create report') : '✓ Saved'}
        </button>
        {report.id && (
          <button className="btn btn-sm" onClick={exportPDF} disabled={saving}>
            📄 Export PDF
          </button>
        )}
        <button className="btn btn-sm" onClick={onClose}>Close</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, padding: '0 14px', borderBottom: '1px solid var(--border)', flexShrink: 0, overflow: 'auto' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{
              padding: '10px 14px', fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
              border: 'none', borderBottom: '2px solid ' + (activeTab === t.id ? 'var(--accent)' : 'transparent'),
              background: 'transparent', cursor: 'pointer',
              color: activeTab === t.id ? 'var(--text)' : 'var(--text3)',
              whiteSpace: 'nowrap',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {activeTab === 'info' && <InfoTab report={report} patch={patch} />}
        {activeTab === 'programme' && <ProgrammeTab report={report} patch={patch} />}
        {activeTab === 'statement' && <StatementTab report={report} patch={patch} />}
        {activeTab === 'commercial' && <CommercialTab report={report} addRow={addRowToArr} updateRow={updateRowInArr} removeRow={removeRowFromArr} />}
        {activeTab === 'risks' && <RisksTab report={report} patch={patch} addRow={addRowToArr} updateRow={updateRowInArr} removeRow={removeRowFromArr} />}
        {activeTab === 'photos' && (
          <PhotosTab photos={photos} uploading={uploading} onUpload={uploadPhotos}
            onDelete={(id) => setConfirmDeletePhoto(id)} fileInputRef={fileInputRef}
            reportSaved={!!report.id} />
        )}
      </div>

      <ConfirmDialog open={!!confirmDeletePhoto} onClose={() => setConfirmDeletePhoto(null)}
        onConfirm={() => deletePhoto(confirmDeletePhoto)} title="Delete photo" message="Remove this photo from the report?" danger />
    </Overlay>
  )
}

// ─── Subcomponents ──────────────────────────────────────────

function Overlay({ children, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1500, display: 'flex', alignItems: 'stretch', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg)', borderRadius: 8, width: '100%', maxWidth: 1100, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}

function InfoTab({ report, patch }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 800 }}>
      <Section title="1.1 Project Information">
        <Grid2>
          <Field label="Job No"><input value={report.job_no || ''} onChange={e => patch('job_no', e.target.value)} /></Field>
          <Field label="Employer"><input value={report.employer || ''} onChange={e => patch('employer', e.target.value)} /></Field>
          <Field label="Project Manager (Client)"><input value={report.client_pm || ''} onChange={e => patch('client_pm', e.target.value)} /></Field>
          <Field label="Contract Administrator"><input value={report.contract_administrator || ''} onChange={e => patch('contract_administrator', e.target.value)} /></Field>
          <Field label="Surveyor"><input value={report.surveyor || ''} onChange={e => patch('surveyor', e.target.value)} /></Field>
          <Field label="Main Contractor"><input value={report.main_contractor || ''} onChange={e => patch('main_contractor', e.target.value)} /></Field>
          <Field label="Project Manager (MC)"><input value={report.mc_pm || ''} onChange={e => patch('mc_pm', e.target.value)} /></Field>
          <Field label="Site Manager"><input value={report.site_manager || ''} onChange={e => patch('site_manager', e.target.value)} /></Field>
        </Grid2>
      </Section>

      <Section title="1.2 Programme Summary">
        <Grid2>
          <Field label="Start on Site"><input type="date" value={report.start_on_site || ''} onChange={e => patch('start_on_site', e.target.value || null)} /></Field>
          <Field label="Contract Completion"><input type="date" value={report.contract_completion || ''} onChange={e => patch('contract_completion', e.target.value || null)} /></Field>
          <Field label="Target Completion"><input type="date" value={report.target_completion || ''} onChange={e => patch('target_completion', e.target.value || null)} /></Field>
          <Field label="Estimated Completion"><input type="date" value={report.estimated_completion || ''} onChange={e => patch('estimated_completion', e.target.value || null)} /></Field>
          <Field label="Current Phase"><input value={report.current_phase || ''} onChange={e => patch('current_phase', e.target.value)} placeholder="e.g. Construction works ongoing" /></Field>
          <Field label="Overall Progress"><textarea value={report.overall_progress || ''} onChange={e => patch('overall_progress', e.target.value)} placeholder="e.g. Circa 25% complete reflecting substructure..." style={{ minHeight: 60 }} /></Field>
          <Field label="Delays since last visit"><input value={report.delays_text || ''} onChange={e => patch('delays_text', e.target.value)} placeholder="e.g. 4-6 weeks" /></Field>
          <Field label="Delays Reason"><textarea value={report.delays_reason || ''} onChange={e => patch('delays_reason', e.target.value)} placeholder="e.g. Structural remedial works..." style={{ minHeight: 50 }} /></Field>
        </Grid2>
      </Section>
    </div>
  )
}

function ProgrammeTab({ report, patch }) {
  const groups = report.programme_groups || []

  function setGroup(idx, newGroup) {
    patch('programme_groups', groups.map((g, i) => i === idx ? newGroup : g))
  }
  function addGroup() {
    patch('programme_groups', [...groups, { name: 'New Group', items: [] }])
  }
  function removeGroup(idx) {
    if (!window.confirm('Remove this entire group?')) return
    patch('programme_groups', groups.filter((_, i) => i !== idx))
  }
  function addItem(gIdx) {
    setGroup(gIdx, { ...groups[gIdx], items: [...groups[gIdx].items, { label: 'New item', percent: 0 }] })
  }
  function updateItem(gIdx, iIdx, patchObj) {
    setGroup(gIdx, {
      ...groups[gIdx],
      items: groups[gIdx].items.map((it, i) => i === iIdx ? { ...it, ...patchObj } : it),
    })
  }
  function removeItem(gIdx, iIdx) {
    setGroup(gIdx, { ...groups[gIdx], items: groups[gIdx].items.filter((_, i) => i !== iIdx) })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--text2)', padding: '10px 14px', background: 'var(--surface2)', borderRadius: 6 }}>
        Track % completion across trade categories. Add or remove groups and line items as needed for this project.
      </div>
      {groups.map((g, gIdx) => (
        <div key={gIdx} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <input value={g.name} onChange={e => setGroup(gIdx, { ...g, name: e.target.value })}
              style={{ flex: 1, fontSize: 13, fontWeight: 600, padding: '4px 8px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text)' }} />
            <button className="btn btn-sm btn-danger" onClick={() => removeGroup(gIdx)} title="Remove group"><IconTrash size={11} /></button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {g.items.map((it, iIdx) => (
              <div key={iIdx} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 30px', gap: 8, alignItems: 'center' }}>
                <input value={it.label} onChange={e => updateItem(gIdx, iIdx, { label: e.target.value })}
                  style={{ fontSize: 12, padding: '4px 8px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="number" min="0" max="100" value={it.percent} onChange={e => updateItem(gIdx, iIdx, { percent: Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)) })}
                    style={{ width: 60, fontSize: 12, padding: '4px 6px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)' }} />
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>%</span>
                </div>
                <button onClick={() => removeItem(gIdx, iIdx)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 13 }} title="Remove">✕</button>
              </div>
            ))}
            <button className="btn btn-sm" onClick={() => addItem(gIdx)} style={{ alignSelf: 'flex-start', marginTop: 4 }}>
              <IconPlus size={11} /> Add item
            </button>
          </div>
        </div>
      ))}
      <button className="btn btn-primary btn-sm" onClick={addGroup} style={{ alignSelf: 'flex-start' }}>
        <IconPlus size={12} /> Add group
      </button>
    </div>
  )
}

function StatementTab({ report, patch }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 800 }}>
      <Section title="1.4 Project Manager's Statement">
        <textarea value={report.pm_statement || ''} onChange={e => patch('pm_statement', e.target.value)}
          placeholder="Works progressing across structure, envelope and initial MEP installations..."
          style={{ minHeight: 280, fontSize: 12, lineHeight: 1.6 }} />
      </Section>
      <Section title="2. Health & Safety Matters">
        <textarea value={report.hs_text || ''} onChange={e => patch('hs_text', e.target.value)}
          style={{ minHeight: 80, fontSize: 12 }} />
      </Section>
    </div>
  )
}

function CommercialTab({ report, addRow, updateRow, removeRow }) {
  const valuations = report.valuations || []
  const variations = report.variations || []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Section title="3.1 Valuations">
        <Table headers={['No', 'Date Submitted', 'Amount Claimed (Net) £', 'Amount Agreed (Net) £', '']}>
          {valuations.map((v, i) => (
            <tr key={i}>
              <td><input value={v.no || ''} onChange={e => updateRow('valuations', i, { no: e.target.value })} style={S.cell} /></td>
              <td><input type="date" value={v.date_submitted || ''} onChange={e => updateRow('valuations', i, { date_submitted: e.target.value })} style={S.cell} /></td>
              <td><input value={v.amount_claimed || ''} onChange={e => updateRow('valuations', i, { amount_claimed: e.target.value })} style={S.cell} /></td>
              <td><input value={v.amount_agreed || ''} onChange={e => updateRow('valuations', i, { amount_agreed: e.target.value })} style={S.cell} /></td>
              <td><button onClick={() => removeRow('valuations', i)} style={S.removeBtn}>✕</button></td>
            </tr>
          ))}
        </Table>
        <button className="btn btn-sm" onClick={() => addRow('valuations', { no: String(valuations.length + 1), date_submitted: '', amount_claimed: '', amount_agreed: '' })}>
          <IconPlus size={11} /> Add valuation
        </button>
      </Section>

      <Section title="3.2 Variations">
        <Table headers={['Inst. No', 'SI Ref', 'Issue Date', 'Details', 'Scope', 'Cost Impact', 'Time Impact', 'Agreed Cost', 'Instructed', '']}>
          {variations.map((v, i) => (
            <tr key={i}>
              <td><input value={v.instruction_no || ''} onChange={e => updateRow('variations', i, { instruction_no: e.target.value })} style={S.cell} /></td>
              <td><input value={v.si_ref || ''} onChange={e => updateRow('variations', i, { si_ref: e.target.value })} style={S.cell} /></td>
              <td><input type="date" value={v.issue_date || ''} onChange={e => updateRow('variations', i, { issue_date: e.target.value })} style={S.cell} /></td>
              <td><input value={v.instruction_details || ''} onChange={e => updateRow('variations', i, { instruction_details: e.target.value })} style={S.cell} /></td>
              <td><input value={v.scope_impact || ''} onChange={e => updateRow('variations', i, { scope_impact: e.target.value })} style={S.cell} /></td>
              <td><input value={v.cost_impact || ''} onChange={e => updateRow('variations', i, { cost_impact: e.target.value })} style={S.cell} /></td>
              <td><input value={v.time_impact || ''} onChange={e => updateRow('variations', i, { time_impact: e.target.value })} style={S.cell} /></td>
              <td><input value={v.agreed_cost || ''} onChange={e => updateRow('variations', i, { agreed_cost: e.target.value })} style={S.cell} /></td>
              <td><input value={v.instructed || ''} onChange={e => updateRow('variations', i, { instructed: e.target.value })} style={S.cell} /></td>
              <td><button onClick={() => removeRow('variations', i)} style={S.removeBtn}>✕</button></td>
            </tr>
          ))}
        </Table>
        <button className="btn btn-sm" onClick={() => addRow('variations', { instruction_no: 'VO' + (variations.length + 1), si_ref: '', issue_date: '', instruction_details: '', scope_impact: '', cost_impact: '', time_impact: '', agreed_cost: '', instructed: '' })}>
          <IconPlus size={11} /> Add variation
        </button>
      </Section>
    </div>
  )
}

function RisksTab({ report, patch, addRow, updateRow, removeRow }) {
  const risks = report.risks || []
  const rfis = report.rfis || []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Section title="4. Project Risks">
        <Table headers={['#', 'Description', 'Consequence', 'RAG', 'Mitigation', '']}>
          {risks.map((r, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td><input value={r.description || ''} onChange={e => updateRow('risks', i, { description: e.target.value })} style={S.cell} /></td>
              <td><textarea value={r.consequence || ''} onChange={e => updateRow('risks', i, { consequence: e.target.value })} style={{ ...S.cell, minHeight: 40 }} /></td>
              <td>
                <select value={r.risk_rag || 'green'} onChange={e => updateRow('risks', i, { risk_rag: e.target.value })} style={S.cell}>
                  <option value="red">🔴 Red</option>
                  <option value="amber">🟡 Amber</option>
                  <option value="green">🟢 Green</option>
                </select>
              </td>
              <td><textarea value={r.mitigation || ''} onChange={e => updateRow('risks', i, { mitigation: e.target.value })} style={{ ...S.cell, minHeight: 40 }} /></td>
              <td><button onClick={() => removeRow('risks', i)} style={S.removeBtn}>✕</button></td>
            </tr>
          ))}
        </Table>
        <button className="btn btn-sm" onClick={() => addRow('risks', { description: '', consequence: '', risk_rag: 'amber', mitigation: '' })}>
          <IconPlus size={11} /> Add risk
        </button>
      </Section>

      <Section title="5. Requests For Information (RFIs)">
        <Table headers={['No', 'Description', 'Status', '']}>
          {rfis.map((r, i) => (
            <tr key={i}>
              <td><input value={r.rfi_no || ''} onChange={e => updateRow('rfis', i, { rfi_no: e.target.value })} style={{ ...S.cell, width: 80 }} /></td>
              <td><input value={r.description || ''} onChange={e => updateRow('rfis', i, { description: e.target.value })} style={S.cell} /></td>
              <td>
                <select value={r.status || 'open'} onChange={e => updateRow('rfis', i, { status: e.target.value })} style={S.cell}>
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                </select>
              </td>
              <td><button onClick={() => removeRow('rfis', i)} style={S.removeBtn}>✕</button></td>
            </tr>
          ))}
        </Table>
        <button className="btn btn-sm" onClick={() => addRow('rfis', { rfi_no: '', description: '', status: 'open' })}>
          <IconPlus size={11} /> Add RFI
        </button>
      </Section>

      <Section title="6. Any Other Business">
        <textarea value={report.aob || ''} onChange={e => patch('aob', e.target.value)}
          placeholder="Anything else..." style={{ minHeight: 100 }} />
      </Section>
    </div>
  )
}

function PhotosTab({ photos, uploading, onUpload, onDelete, fileInputRef, reportSaved }) {
  const [previewMap, setPreviewMap] = useState({})

  useEffect(() => {
    photos.forEach(async p => {
      if (previewMap[p.id]) return
      const { data } = await supabase.storage.from('progress-photos').createSignedUrl(p.storage_path, 3600)
      if (data?.signedUrl) setPreviewMap(prev => ({ ...prev, [p.id]: data.signedUrl }))
    })
  }, [photos])

  return (
    <div>
      <div style={{ marginBottom: 16, padding: '12px 14px', background: 'var(--surface2)', borderRadius: 6, fontSize: 12, color: 'var(--text2)' }}>
        Upload progress photos (any quantity). They'll auto-flow into pages on the PDF export.
        {!reportSaved && <div style={{ marginTop: 4, color: '#b87a00' }}>⚠ Save the report first before uploading photos.</div>}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label className="btn btn-primary" style={{ cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
          {uploading ? 'Uploading…' : '+ Upload photos'}
          <input ref={fileInputRef} type="file" multiple accept="image/*"
            onChange={e => { onUpload(e.target.files); e.target.value = '' }} disabled={uploading} style={{ display: 'none' }} />
        </label>
      </div>

      {photos.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 40, fontSize: 12 }}>
          No photos yet.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
          {photos.map(p => (
            <div key={p.id} style={{ position: 'relative', aspectRatio: '1', borderRadius: 6, overflow: 'hidden', background: 'var(--surface2)', border: '0.5px solid var(--border)' }}>
              {previewMap[p.id] ? (
                <img src={previewMap[p.id]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt={p.file_name} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 11 }}>Loading…</div>
              )}
              <button onClick={() => onDelete(p.id)}
                style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(204,0,0,0.85)', color: 'white', border: 'none', borderRadius: 3, padding: '2px 6px', cursor: 'pointer', fontSize: 10, fontWeight: 700 }}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Reusable mini-components
function Section({ title, children }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{title}</div>
      <div>{children}</div>
    </div>
  )
}

function Grid2({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>{children}</div>
}

function Table({ headers, children }) {
  return (
    <div style={{ overflow: 'auto', border: '0.5px solid var(--border)', borderRadius: 4, marginBottom: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--surface2)' }}>
            {headers.map((h, i) => <th key={i} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text3)', borderBottom: '0.5px solid var(--border)' }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

const S = {
  cell: { width: '100%', padding: '4px 6px', border: '0.5px solid var(--border)', borderRadius: 3, background: 'var(--surface)', color: 'var(--text)', fontSize: 11, fontFamily: 'inherit' },
  removeBtn: { background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 13, padding: 4 },
}

// ─── Standalone PDF export (callable from outside the editor) ───
export async function generateProgressReportPdf(report, photos, projectName) {
  if (!report?.id) { alert('Report not saved'); return }
  try {
      // Lazy-load jsPDF + autoTable from CDN
      const loadScript = (src) => new Promise((resolve, reject) => {
        const s = document.createElement('script'); s.src = src
        s.onload = resolve; s.onerror = () => reject(new Error('Failed to load ' + src))
        document.head.appendChild(s)
      })
      if (!window.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
      if (!window.jspdf?.jsPDF?.API?.autoTable) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js')
      const { jsPDF } = window.jspdf

      // Load CCG logo
      let logoDataUrl = null
      try {
        const resp = await fetch('/cltd-logo.jpg')
        if (resp.ok) {
          const blob = await resp.blob()
          logoDataUrl = await new Promise(res => {
            const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(blob)
          })
        }
      } catch (e) { console.warn('logo load failed', e) }

      // Load all photo blobs as data URLs (need to embed in PDF)
      const photoDataUrls = []
      for (const p of photos) {
        try {
          const { data } = await supabase.storage.from('progress-photos').createSignedUrl(p.storage_path, 600)
          if (!data?.signedUrl) continue
          const r = await fetch(data.signedUrl)
          const blob = await r.blob()
          const dataUrl = await new Promise(res => { const fr = new FileReader(); fr.onloadend = () => res(fr.result); fr.readAsDataURL(blob) })
          photoDataUrls.push({ dataUrl, mime: blob.type || 'image/jpeg' })
        } catch (e) { console.warn('photo skipped', p.file_name, e) }
      }

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageW = doc.internal.pageSize.getWidth()   // 210mm
      const pageH = doc.internal.pageSize.getHeight()  // 297mm

      // ─ Letterhead drawn on every page after the cover ─
      // 28mm logo standard (matches TaskTracker, Project Directory/Procurement export).
      const drawLetterhead = () => {
        if (logoDataUrl) { try { doc.addImage(logoDataUrl, 'JPEG', pageW - 40, 8, 28, 28) } catch (e) {} }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(45, 45, 45)
        doc.text('City Construction Group', 15, 16)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90)
        doc.text('One Canada Square, Canary Wharf, London E14 5AA', 15, 22)
        doc.text('T: 0203 948 1930   E: info@cltd.co.uk   W: www.cltd.co.uk', 15, 26)
        doc.setDrawColor(207, 207, 207); doc.setLineWidth(0.2)
        doc.line(15, 40, pageW - 15, 40)
      }

      // ─ PAGE 1: Cover page (centered logo + title + project address) ─
      // Get project address details for cover
      const { data: projData } = await supabase.from('projects').select('project_name, project_ref, address, postcode, town').eq('id', report.project_id).maybeSingle()

      if (logoDataUrl) {
        try { doc.addImage(logoDataUrl, 'JPEG', pageW / 2 - 40, 60, 80, 80) } catch (e) {}
      }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(45, 45, 45)
      doc.text("MAIN CONTRACTOR'S PROGRESS REPORT", pageW / 2, 175, { align: 'center' })
      doc.setFont('helvetica', 'normal'); doc.setFontSize(13); doc.setTextColor(80, 80, 80)
      const addressLines = [
        projData?.project_name || projectName || 'Project',
        projData?.address || '',
        projData?.town || '',
        projData?.postcode || '',
      ].filter(Boolean)
      let addrY = 200
      for (const line of addressLines) {
        doc.text(line, pageW / 2, addrY, { align: 'center' })
        addrY += 8
      }
      // Report number small at bottom
      doc.setFontSize(10); doc.setTextColor(150, 150, 150)
      doc.text(report.report_number, pageW / 2, pageH - 20, { align: 'center' })

      // ─ PAGE 2: Project info + programme summary + % tables ─
      doc.addPage()
      drawLetterhead()

      let y = 46

      // Section 1
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(45, 45, 45)
      doc.text('1. Project Overview', 15, y); y += 6
      doc.setFontSize(11)
      doc.text('1.1 Project Information', 15, y); y += 4

      // Project info table
      doc.autoTable({
        startY: y,
        body: [
          ['Job No', report.job_no || ''],
          ['Employer', report.employer || ''],
          ['Project Manager', report.client_pm || ''],
          ['Contract Administrator', report.contract_administrator || ''],
          ['Surveyor', report.surveyor || ''],
          ['Main Contractor', report.main_contractor || ''],
          ['Project Manager (MC)', report.mc_pm || ''],
          ['Site Manager', report.site_manager || ''],
        ],
        theme: 'plain',
        styles: { fontSize: 9, cellPadding: 2.5, lineWidth: 0.1, lineColor: [200, 200, 200] },
        columnStyles: { 0: { cellWidth: 55, fontStyle: 'bold', fillColor: [232, 245, 231], textColor: [60, 100, 60] }, 1: { cellWidth: 'auto' } },
        margin: { left: 15, right: 15 },
      })
      y = doc.lastAutoTable.finalY + 6

      // 1.2 Programme Summary
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(45, 45, 45)
      doc.text('1.2 Programme Summary', 15, y); y += 4

      doc.autoTable({
        startY: y,
        body: [
          ['Start on Site', fmtDateUK(report.start_on_site), 'Contract Completion', fmtDateUK(report.contract_completion)],
          ['Phase', report.current_phase || '', 'Target Completion', fmtDateUK(report.target_completion)],
          ['Overall Progress', report.overall_progress || '', 'Estimated Completion', fmtDateUK(report.estimated_completion)],
          ['Delays since last visit', report.delays_text || '', 'Reason', report.delays_reason || ''],
        ],
        theme: 'plain',
        styles: { fontSize: 9, cellPadding: 2.5, lineWidth: 0.1, lineColor: [200, 200, 200], valign: 'top' },
        columnStyles: {
          0: { cellWidth: 48, fontStyle: 'bold', fillColor: [232, 245, 231], textColor: [60, 100, 60] },
          1: { cellWidth: 48 },
          2: { cellWidth: 48, fontStyle: 'bold', fillColor: [232, 245, 231], textColor: [60, 100, 60] },
          3: { cellWidth: 'auto' },
        },
        margin: { left: 15, right: 15 },
      })
      y = doc.lastAutoTable.finalY + 6

      // 1.3 Programme Summary tables
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
      doc.text('1.3 Programme Summary', 15, y); y += 4

      // Two columns of group tables
      const groups = report.programme_groups || []
      const colW = (pageW - 30 - 4) / 2  // 4mm gap between cols
      const leftX = 15, rightX = 15 + colW + 4
      let leftY = y, rightY = y

      for (let i = 0; i < groups.length; i++) {
        const g = groups[i]
        const targetX = i % 2 === 0 ? leftX : rightX
        let targetY = i % 2 === 0 ? leftY : rightY

        // If table would overflow page, start a new page
        const estH = 8 + g.items.length * 5
        if (targetY + estH > pageH - 20) {
          doc.addPage(); drawLetterhead()
          leftY = rightY = 46
          targetY = 46
        }

        doc.autoTable({
          startY: targetY,
          head: [['Items', 'Progress %']],
          body: g.items.map(it => [it.label, (it.percent || 0) + '%']),
          theme: 'plain',
          styles: { fontSize: 8, cellPadding: 1.8, lineWidth: 0.1, lineColor: [200, 200, 200] },
          headStyles: { fillColor: [180, 220, 175], textColor: [45, 70, 45], fontStyle: 'bold', fontSize: 8.5, halign: 'center' },
          columnStyles: { 0: { cellWidth: colW - 22 }, 1: { cellWidth: 22, halign: 'center' } },
          margin: { left: targetX, right: pageW - targetX - colW },
          // Title above each table
          didDrawPage: () => {},
        })
        // Draw group title above
        const titleY = (doc.lastAutoTable.finalY - g.items.length * (1.8 * 2 + 8 * 0.35) - 10)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(60, 100, 60)
        doc.text(g.name, targetX, targetY - 1)

        const finalY = doc.lastAutoTable.finalY + 4
        if (i % 2 === 0) leftY = finalY
        else rightY = finalY
      }

      y = Math.max(leftY, rightY)

      // ─ PM Statement page ─
      doc.addPage(); drawLetterhead(); y = 46

      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(45, 45, 45)
      doc.text("1.4 Project Manager's Statement", 15, y); y += 5

      // Light green background block
      const stmt = report.pm_statement || ''
      const stmtLines = doc.splitTextToSize(stmt, pageW - 34)
      const stmtH = stmtLines.length * 4 + 8
      doc.setFillColor(232, 245, 231)
      doc.rect(15, y, pageW - 30, stmtH, 'F')
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(45, 45, 45)
      doc.text(stmtLines, 19, y + 5)
      y += stmtH + 8

      // 2. Health & Safety
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(45, 45, 45)
      doc.text('2. Health & Safety Matters', 15, y); y += 5
      const hsLines = doc.splitTextToSize(report.hs_text || '', pageW - 34)
      const hsH = hsLines.length * 4 + 8
      doc.setFillColor(232, 245, 231)
      doc.rect(15, y, pageW - 30, hsH, 'F')
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(45, 45, 45)
      doc.text(hsLines, 19, y + 5)
      y += hsH + 8

      // ─ Commercial page ─
      if (y + 60 > pageH - 20) { doc.addPage(); drawLetterhead(); y = 46 }

      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(45, 45, 45)
      doc.text('3. Commercial Management', 15, y); y += 6

      doc.setFontSize(11)
      doc.text('3.1 Valuations', 15, y); y += 3
      doc.autoTable({
        startY: y,
        head: [['Valuation No.', 'Date Submitted', 'Amount Claimed (Net)', 'Amount Agreed (Net)']],
        body: (report.valuations?.length ? report.valuations : [{}, {}, {}, {}]).map(v => [
          v.no || '',
          v.date_submitted ? fmtDateUK(v.date_submitted) : '',
          v.amount_claimed ? '£' + v.amount_claimed : '£',
          v.amount_agreed ? '£' + v.amount_agreed : '£',
        ]),
        theme: 'plain',
        styles: { fontSize: 9, cellPadding: 3, lineWidth: 0.1, lineColor: [200, 200, 200] },
        headStyles: { fillColor: [180, 220, 175], textColor: [45, 70, 45], fontStyle: 'bold', fontSize: 9 },
        margin: { left: 15, right: 15 },
      })
      y = doc.lastAutoTable.finalY + 6

      // 3.2 Variations
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
      doc.text('3.2 Variations', 15, y); y += 3
      doc.autoTable({
        startY: y,
        head: [['Inst. No.', 'SI Ref.', 'Issue Date', 'Details', 'Scope', 'Cost', 'Time', 'Agreed', 'Instructed']],
        body: (report.variations?.length ? report.variations : [{ instruction_no: 'VO1' }]).map(v => [
          v.instruction_no || '',
          v.si_ref || '',
          v.issue_date ? fmtDateUK(v.issue_date) : '',
          v.instruction_details || '',
          v.scope_impact || '',
          v.cost_impact || '',
          v.time_impact || '',
          v.agreed_cost || '',
          v.instructed || '',
        ]),
        theme: 'plain',
        styles: { fontSize: 7.5, cellPadding: 2, lineWidth: 0.1, lineColor: [200, 200, 200] },
        headStyles: { fillColor: [180, 220, 175], textColor: [45, 70, 45], fontStyle: 'bold', fontSize: 8 },
        margin: { left: 15, right: 15 },
      })
      y = doc.lastAutoTable.finalY + 6

      // 4. Risks
      if (y + 40 > pageH - 20) { doc.addPage(); drawLetterhead(); y = 46 }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(45, 45, 45)
      doc.text('4. Project Risks', 15, y); y += 5

      doc.autoTable({
        startY: y,
        head: [['#', 'Description', 'Consequence', 'Risk', 'Mitigation']],
        body: (report.risks || []).map((r, i) => [String(i + 1), r.description || '', r.consequence || '', '', r.mitigation || '']),
        theme: 'plain',
        styles: { fontSize: 8.5, cellPadding: 2.5, lineWidth: 0.1, lineColor: [200, 200, 200], valign: 'top' },
        headStyles: { fillColor: [180, 220, 175], textColor: [45, 70, 45], fontStyle: 'bold', fontSize: 8.5 },
        columnStyles: { 0: { cellWidth: 8 }, 3: { cellWidth: 14 } },
        // Colour the RAG cell
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 3) {
            const r = report.risks[data.row.index]
            if (r?.risk_rag === 'red') data.cell.styles.fillColor = [255, 200, 200]
            else if (r?.risk_rag === 'amber') data.cell.styles.fillColor = [255, 230, 180]
            else if (r?.risk_rag === 'green') data.cell.styles.fillColor = [200, 235, 200]
          }
        },
        margin: { left: 15, right: 15 },
      })
      y = doc.lastAutoTable.finalY + 6

      // 5. RFIs
      if (y + 40 > pageH - 20) { doc.addPage(); drawLetterhead(); y = 46 }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(45, 45, 45)
      doc.text("5. Requests For Information (RFI's)", 15, y); y += 5

      doc.autoTable({
        startY: y,
        head: [['RFI No.', 'Description', 'Open/Closed']],
        body: (report.rfis?.length ? report.rfis : [{}, {}, {}]).map(r => [r.rfi_no || '', r.description || '', r.status === 'closed' ? 'Closed' : (r.status === 'open' ? 'Open' : '')]),
        theme: 'plain',
        styles: { fontSize: 9, cellPadding: 2.5, lineWidth: 0.1, lineColor: [200, 200, 200] },
        headStyles: { fillColor: [180, 220, 175], textColor: [45, 70, 45], fontStyle: 'bold', fontSize: 9 },
        columnStyles: { 0: { cellWidth: 25 }, 2: { cellWidth: 30, halign: 'center' } },
        margin: { left: 15, right: 15 },
      })
      y = doc.lastAutoTable.finalY + 6

      // 6. AOB
      if (y + 30 > pageH - 20) { doc.addPage(); drawLetterhead(); y = 46 }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(45, 45, 45)
      doc.text('6. Any Other Business', 15, y); y += 5

      if (report.aob?.trim()) {
        const aobLines = doc.splitTextToSize(report.aob, pageW - 34)
        const aobH = aobLines.length * 4 + 6
        doc.setFillColor(248, 248, 248)
        doc.rect(15, y, pageW - 30, aobH, 'F')
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(45, 45, 45)
        doc.text(aobLines, 19, y + 4)
        y += aobH + 6
      }

      // ─ Photo pages (3-column grid, auto-flowing) ─
      if (photoDataUrls.length > 0) {
        doc.addPage(); drawLetterhead(); y = 46
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(45, 45, 45)
        doc.text('7. Progress Photos', 15, y); y += 8

        const cols = 3
        const gap = 4
        const photoW = (pageW - 30 - (cols - 1) * gap) / cols
        const photoH = photoW  // square cells

        let col = 0
        let curY = y

        for (const ph of photoDataUrls) {
          if (curY + photoH > pageH - 20) {
            doc.addPage(); drawLetterhead()
            curY = 46
            col = 0
          }
          const x = 15 + col * (photoW + gap)
          try {
            doc.addImage(ph.dataUrl, ph.mime.includes('png') ? 'PNG' : 'JPEG', x, curY, photoW, photoH, undefined, 'FAST')
          } catch (e) { console.warn('addImage failed', e) }
          col++
          if (col >= cols) {
            col = 0
            curY += photoH + gap
          }
        }
      }

      // Footer + page numbers
      const pageCount = doc.internal.getNumberOfPages()
      for (let i = 2; i <= pageCount; i++) {
        doc.setPage(i)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(160, 160, 160)
        doc.text(report.report_number, 15, pageH - 8)
        doc.text(`Page ${i} of ${pageCount}`, pageW - 15, pageH - 8, { align: 'right' })
      }

      const projName = (projData?.project_name || projectName || 'Project').replace(/[/\\]/g, '-')
      doc.save(`${projName} - ${report.report_number}.pdf`)
    } catch (err) {
      console.error('[exportPDF]', err)
      alert('PDF export failed: ' + (err?.message || err))
    }
  }
