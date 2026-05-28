import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ── Generate PO modal ────────────────────────────────────────────────────────
// Stage 1 of the Generate PO feature. Collects everything needed for a
// Sub-Contractor Purchase Order, auto-filling from the project, the
// subcontractor, the project_subcontractors link and the accepted quote.
// Saves a row to `purchase_orders`. The .docx generation is Stage 2.
//
// Revision model:
//   • New PO            → draft, revision ''.
//   • Editing a draft   → same row, still revision ''.
//   • Editing an issued → creates a new row: next revision letter, revision_of
//     points at the original, original becomes 'superseded'.

// The 24-row General & Specific Attendance table — defaults from the CCG
// template (true = CCG provides, false = Sub-Contractor provides).
const ATTENDANCE_DEFAULTS = [
  { item: 'Mechanical Plant', ccg: false },
  { item: 'Power Tools and Cables', ccg: false },
  { item: 'General Scaffolding', ccg: true },
  { item: 'Special Scaffolding', ccg: true },
  { item: 'Unloading', ccg: false },
  { item: 'Distribution of Materials', ccg: false },
  { item: 'Hoist / Telehandler / Crane (first 7 weeks)', ccg: true },
  { item: 'Storage', ccg: false },
  { item: 'Water Supply', ccg: true },
  { item: 'Power (110v during construction)', ccg: true },
  { item: 'Temporary Lighting', ccg: true },
  { item: 'Task Lighting', ccg: false },
  { item: 'Clear Rubbish to Designated Point', ccg: false },
  { item: 'Provision of Skips', ccg: true },
  { item: 'Protection of Work', ccg: false },
  { item: 'Screws, Bolts, Fixings etc.', ccg: false },
  { item: 'Holes and Chases', ccg: false },
  { item: 'Making Good', ccg: false },
  { item: 'Welfare Facilities', ccg: true },
  { item: 'Security', ccg: true },
  { item: 'Personal Protective Equipment', ccg: false },
  { item: 'Setting Out', ccg: true },
  { item: 'Levels and Datums', ccg: true },
  { item: 'Risk Assessments and Method Statements', ccg: false },
]

const NEXT_REVISION = (rev) => {
  // '' -> 'A' -> 'B' -> … (rev is the CURRENT highest revision)
  if (!rev) return 'A'
  return String.fromCharCode(rev.charCodeAt(0) + 1)
}

// Build the 6 monthly valuation dates from a commencement date.
// Rule (CCG template clause 10.1): valuation date = end of each month;
// application deadline = 14 days before that valuation date.
function buildValuationDates(commencementDate) {
  if (!commencementDate) return []
  const start = new Date(commencementDate)
  if (Number.isNaN(start.getTime())) return []
  const rows = []
  // First valuation = end of the commencement month; then monthly.
  let y = start.getFullYear()
  let m = start.getMonth()  // 0-indexed
  for (let i = 0; i < 6; i++) {
    const valDate = new Date(y, m + 1, 0)            // last day of month (m)
    const appDeadline = new Date(valDate)
    appDeadline.setDate(appDeadline.getDate() - 14)  // 14 days prior
    rows.push({
      val_date: valDate.toISOString().slice(0, 10),
      app_deadline: appDeadline.toISOString().slice(0, 10),
    })
    m += 1
    if (m > 11) { m = 0; y += 1 }
  }
  return rows
}

const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? '—'
    : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function GeneratePOModal({ projectId, projectSubId, existingPO, onClose, onSaved }) {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Auto-filled context (read-only in the form)
  const [ctx, setCtx] = useState({
    subName: '', subAddress: '', subContact: '', subContactTel: '', subTrade: '',
    siteName: '', siteAddress: '',
    pmName: '', pmEmail: '',
    directorName: '',
    contractValue: '', quoteReference: '', quoteDate: '',
  })

  // Project Manager — list of selectable PMs (role = project_manager).
  // The PO auto-fills the project's PM but the PM is overridable per-PO.
  const [pmOptions, setPmOptions] = useState([])
  const [selectedPmId, setSelectedPmId] = useState('')

  // Programme — files available in the project's "06. Project Programme"
  // folder; the PM picks one to reference in the PO.
  const [programmeFiles, setProgrammeFiles] = useState([])
  const [selectedProgrammeId, setSelectedProgrammeId] = useState('')

  // Order number — generated once on open for a new PO so it can be shown
  // locked. Existing POs use their stored number.
  const [orderNumber, setOrderNumber] = useState('')

  // Editable form state
  const [form, setForm] = useState({
    order_date: new Date().toISOString().slice(0, 10),
    commencement_date: '',
    site_manager_name: '',
    site_manager_tel: '',
    pm_tel: '',                     // typed — profiles has no phone column
    director_name: '',              // typed — auto-fills from project's assigned director
    scope_of_works: '',
    brief_description: '',
    design_responsibility: '',
    practical_completion_items: '',
    quality_control_requirements: '',
    statutory_compliance_requirements: '',
    contact2_name: '',
    contact2_tel: '',
  })
  const [attendance, setAttendance] = useState(ATTENDANCE_DEFAULTS)

  const valuationDates = buildValuationDates(form.commencement_date)

  useEffect(() => { loadContext() }, [])

  async function loadContext() {
    setLoading(true)
    try {
      // The project_subcontractors link carries contract value + the FK ids.
      const { data: link } = await supabase
        .from('project_subcontractors')
        .select('*, projects(*), subcontractors(*)')
        .eq('id', projectSubId)
        .single()

      const project = link?.projects || {}
      const sub = link?.subcontractors || {}

      // Project Manager — the assigned PM (projects.project_manager_id).
      let pmName = '', pmEmail = ''
      if (project.project_manager_id) {
        const { data: pm } = await supabase
          .from('profiles')
          .select('full_name, email')
          .eq('id', project.project_manager_id)
          .single()
        pmName = pm?.full_name || ''
        pmEmail = pm?.email || ''
      }
      // Project Director — the person the project is "Assigned To"
      // (projects.project_director_id). Defensive: the column may not yet
      // exist in live (migration 013 still pending) — if it's undefined we
      // simply leave the field blank for the user to type.
      let directorName = ''
      if (project.project_director_id) {
        const { data: dir } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', project.project_director_id)
          .single()
        directorName = dir?.full_name || ''
      }

      // Accepted quote for this subcontractor on this project, if any —
      // gives the quote reference + date for the contract-documents clause.
      let quoteReference = '', quoteDate = ''
      const { data: quotes } = await supabase
        .from('task_quotes')
        .select('quote_reference, received_date, status, subcontractor_id, tasks!inner(project_id)')
        .eq('subcontractor_id', link?.subcontractor_id)
        .eq('status', 'accepted')
        .eq('tasks.project_id', projectId)
        .limit(1)
      if (quotes && quotes.length) {
        quoteReference = quotes[0].quote_reference || ''
        quoteDate = quotes[0].received_date || ''
      }

      const subAddress = [sub.address, sub.city, sub.postcode].filter(Boolean).join(', ')
      const siteAddress = [project.site_address, project.city, project.postcode].filter(Boolean).join(', ')

      setCtx({
        subName: sub.company_name || '',
        subAddress,
        subContact: sub.contact_name || '',
        subContactTel: sub.phone || '',
        subTrade: link?.trade_on_project || sub.trade || '',
        siteName: project.project_name || '',
        siteAddress,
        pmName, pmEmail,
        directorName,
        contractValue: link?.contract_value != null ? String(link.contract_value) : '',
        quoteReference, quoteDate,
      })

      // Project Manager options — all profiles with the project_manager role.
      const { data: pms } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('role', 'project_manager')
        .order('full_name')
      setPmOptions(pms || [])

      // Programme files — from the project's "06. Project Programme" folder.
      const { data: progFiles } = await supabase
        .from('project_doc_files')
        .select('id, file_name, storage_path, created_at')
        .eq('project_id', projectId)
        .eq('folder_key', '06-project-programme')
        .order('created_at', { ascending: false })
      setProgrammeFiles(progFiles || [])

      // Order number. Existing PO → its stored number. New PO → generate now
      // so it can be shown locked in the form.
      if (existingPO) {
        setOrderNumber(existingPO.order_number || '')
      } else {
        setOrderNumber(await nextOrderNumber())
      }

      // Editing an existing PO — seed the form from it.
      if (existingPO) {
        setForm(f => ({
          ...f,
          order_date: existingPO.order_date || f.order_date,
          commencement_date: existingPO.commencement_date || '',
          site_manager_name: existingPO.site_manager_name || '',
          site_manager_tel: existingPO.site_manager_tel || '',
          pm_tel: existingPO.pm_tel || '',
          // Director name — prefer the value saved on this PO, else fall back
          // to the project's currently assigned director (handles older POs
          // saved before this field existed).
          director_name: existingPO.director_name || directorName || '',
          scope_of_works: existingPO.scope_of_works || '',
          brief_description: existingPO.brief_description || '',
          design_responsibility: existingPO.design_responsibility || '',
          practical_completion_items: existingPO.practical_completion_items || '',
          quality_control_requirements: existingPO.quality_control_requirements || '',
          statutory_compliance_requirements: existingPO.statutory_compliance_requirements || '',
          contact2_name: existingPO.contact2_name || '',
          contact2_tel: existingPO.contact2_tel || '',
        }))
        if (Array.isArray(existingPO.attendance) && existingPO.attendance.length) {
          setAttendance(existingPO.attendance)
        }
        setSelectedPmId(existingPO.pm_id || project.project_manager_id || '')
        setSelectedProgrammeId(existingPO.programme_file_id || '')
      } else {
        // New PO — default the PM and Director to the project's assigned ones
        // (both overridable: PM via dropdown, Director by typing).
        setSelectedPmId(project.project_manager_id || '')
        setForm(f => ({ ...f, director_name: directorName || '' }))
      }
    } catch (err) {
      setError('Could not load project / subcontractor details: ' + err.message)
    }
    setLoading(false)
  }

  function set(key, value) { setForm(f => ({ ...f, [key]: value })) }

  function toggleAttendance(i) {
    setAttendance(prev => prev.map((row, idx) => idx === i ? { ...row, ccg: !row.ccg } : row))
  }

  // AI fill — generates trade-specific draft text for one of the three
  // clause sections via the generate-po-clause edge function. Result is a
  // DRAFT that drops into the textarea for the PM to review and edit.
  const [aiBusy, setAiBusy] = useState('')   // which section is generating
  const [aiError, setAiError] = useState('')

  // Maps the form field key → the edge-function section identifier.
  const AI_SECTION = {
    practical_completion_items: 'practical_completion',
    quality_control_requirements: 'quality_control',
    statutory_compliance_requirements: 'statutory_compliance',
  }

  async function aiFill(fieldKey) {
    setAiError('')
    const section = AI_SECTION[fieldKey]
    if (!section) return
    if (!ctx.subTrade) {
      setAiError('This subcontractor has no trade set, so AI fill cannot tailor the text. Set a trade on the subcontractor first.')
      return
    }
    setAiBusy(fieldKey)
    try {
      const { data, error: e } = await supabase.functions.invoke('generate-po-clause', {
        body: { section, trade: ctx.subTrade, sub_name: ctx.subName },
      })
      if (e) throw e
      if (!data?.ok || !data?.text) {
        throw new Error(data?.error || 'The AI did not return any text. Try again.')
      }
      set(fieldKey, data.text)
    } catch (err) {
      setAiError('AI fill failed: ' + (err.message || 'unknown error'))
    }
    setAiBusy('')
  }

  // Generate the order number: CCG-PO-<year>-<4-digit sequence>.
  // Uses a count of existing distinct order numbers as the sequence basis;
  // the DB sequence (purchase_order_seq) is the authoritative collision guard
  // but a simple count keeps Stage 1 self-contained without an RPC.
  async function nextOrderNumber() {
    const year = new Date().getFullYear()
    const { count } = await supabase
      .from('purchase_orders')
      .select('id', { count: 'exact', head: true })
      .eq('revision', '')   // count originals only, not revisions
    const seq = String((count || 0) + 1).padStart(4, '0')
    return `CCG-PO-${year}-${seq}`
  }

  async function save(issue) {
    setError('')
    // Minimal validation — scope and commencement date are the essentials.
    if (!form.scope_of_works.trim()) {
      setError('Scope of works is required.')
      return
    }
    if (issue && !form.commencement_date) {
      setError('Commencement date is required to issue the order (it generates the valuation dates).')
      return
    }
    setSaving(true)
    try {
      const basePayload = {
        project_id: projectId,
        project_sub_id: projectSubId,
        order_date: form.order_date || null,
        commencement_date: form.commencement_date || null,
        site_manager_name: form.site_manager_name.trim() || null,
        site_manager_tel: form.site_manager_tel.trim() || null,
        contract_value: ctx.contractValue ? Number(ctx.contractValue) : null,
        quote_reference: ctx.quoteReference || null,
        quote_date: ctx.quoteDate || null,
        scope_of_works: form.scope_of_works.trim() || null,
        brief_description: form.brief_description.trim() || null,
        design_responsibility: form.design_responsibility.trim() || null,
        practical_completion_items: form.practical_completion_items.trim() || null,
        quality_control_requirements: form.quality_control_requirements.trim() || null,
        statutory_compliance_requirements: form.statutory_compliance_requirements.trim() || null,
        contact2_name: form.contact2_name.trim() || null,
        contact2_tel: form.contact2_tel.trim() || null,
        // Project Manager — overridable per-PO; snapshot id + name/email.
        pm_id: selectedPmId || null,
        pm_name: (pmOptions.find(p => p.id === selectedPmId)?.full_name) || ctx.pmName || null,
        pm_email: (pmOptions.find(p => p.id === selectedPmId)?.email) || ctx.pmEmail || null,
        pm_tel: form.pm_tel.trim() || null,
        director_name: form.director_name.trim() || null,
        // Programme — the chosen file from the project's 06. Project Programme
        // folder. Stores the id + name so the PO references a real document.
        programme_file_id: selectedProgrammeId || null,
        programme_file_name: (programmeFiles.find(f => f.id === selectedProgrammeId)?.file_name) || null,
        attendance,
        valuation_dates: valuationDates,
        status: issue ? 'issued' : 'draft',
      }

      let savedRow = null

      if (existingPO && existingPO.status === 'draft') {
        // Editing a draft — update the same row in place.
        const { data, error: e } = await supabase
          .from('purchase_orders')
          .update(basePayload)
          .eq('id', existingPO.id)
          .select()
        if (e) throw e
        if (!data || data.length === 0) {
          // RLS or a missing row meant nothing was actually written. Do NOT
          // close — keep the user's data on screen and tell them.
          throw new Error('the update did not affect any row. You may not have permission to edit this purchase order.')
        }
        savedRow = data[0]
        onSaved?.(savedRow)
      } else if (existingPO && existingPO.status === 'issued') {
        // Editing an issued PO — create the next revision, supersede the old.
        const newRow = {
          ...basePayload,
          subcontractor_id: existingPO.subcontractor_id,
          created_by: profile?.id || null,
          order_number: existingPO.order_number,            // same number
          revision: NEXT_REVISION(existingPO.revision),     // next letter
          revision_of: existingPO.id,
        }
        const { data, error: e } = await supabase
          .from('purchase_orders')
          .insert(newRow)
          .select()
        if (e) throw e
        if (!data || data.length === 0) {
          throw new Error('the revision was not created (no row returned). You may not have permission to create purchase orders.')
        }
        savedRow = data[0]
        // Mark the prior revision superseded.
        await supabase.from('purchase_orders')
          .update({ status: 'superseded' })
          .eq('id', existingPO.id)
        onSaved?.(savedRow)
      } else {
        // Brand-new PO.
        const { data: link, error: linkErr } = await supabase
          .from('project_subcontractors')
          .select('subcontractor_id')
          .eq('id', projectSubId)
          .single()
        if (linkErr) throw linkErr
        if (!link?.subcontractor_id) {
          throw new Error('could not resolve the sub-contractor for this PO. Please reopen the modal and try again.')
        }
        const newRow = {
          ...basePayload,
          subcontractor_id: link.subcontractor_id,
          created_by: profile?.id || null,
          order_number: orderNumber || await nextOrderNumber(),
          revision: '',
        }
        const { data, error: e } = await supabase
          .from('purchase_orders')
          .insert(newRow)
          .select()
        if (e) throw e
        if (!data || data.length === 0) {
          throw new Error('the purchase order was not saved (no row returned). You may not have permission to create purchase orders.')
        }
        savedRow = data[0]
        onSaved?.(savedRow)
      }

      // Only reached if a row was genuinely written and returned. Closing
      // here — and ONLY here — guarantees the modal never disappears while
      // losing the user's data.
      onClose?.()
    } catch (err) {
      setError('Could not save the purchase order: ' + err.message)
    }
    setSaving(false)
  }

  // ── Styling helpers ────────────────────────────────────────────────────────
  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
  }
  const panel = {
    background: 'var(--surface)', borderRadius: 12, width: 'min(820px, 100%)',
    maxHeight: '90vh', overflow: 'auto', border: '0.5px solid var(--border)',
  }
  const sectionTitle = {
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
    color: 'var(--text3)', margin: '20px 0 8px',
  }
  const roBox = {
    background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: 6,
    padding: '8px 11px', fontSize: 13, color: 'var(--text2)',
  }
  const label = { fontSize: 11, color: 'var(--text3)', marginBottom: 4, display: 'block' }

  const issuedRevision = existingPO && existingPO.status === 'issued'
  const heading = !existingPO ? 'Generate Purchase Order'
    : existingPO.status === 'issued'
      ? `Revise PO — ${existingPO.order_number} (creating Rev ${NEXT_REVISION(existingPO.revision)})`
      : `Edit PO — ${existingPO.order_number}${existingPO.revision ? ' Rev ' + existingPO.revision : ''}`

  // Backdrop does NOT close the modal — closing only via ✕ or Cancel.
  // This avoids losing all typed data on an accidental outside click
  // (or a click-and-drag selection that releases over the overlay).
  return (
    <div style={overlay}>
      <div style={panel}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '0.5px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{heading}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text3)' }}>✕</button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Loading project details…</div>
        ) : (
          <div style={{ padding: '4px 20px 20px' }}>

            {issuedRevision && (
              <div style={{ marginTop: 14, padding: '9px 12px', borderRadius: 6, background: '#FAEEDA', color: '#854F0B', fontSize: 12 }}>
                This order has already been issued. Saving changes will create <strong>Rev {NEXT_REVISION(existingPO.revision)}</strong> — the current version is kept on record.
              </div>
            )}

            {/* Auto-filled context */}
            <div style={sectionTitle}>Auto-filled — from project &amp; subcontractor</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <span style={label}>Order Number — auto-generated, locked</span>
                <div style={{ ...roBox, fontWeight: 600, color: 'var(--text)', letterSpacing: '0.02em' }}>
                  {orderNumber || '—'}{existingPO?.revision ? ' Rev ' + existingPO.revision : ''}
                </div>
              </div>
              <div>
                <span style={label}>Project Director (Assigned To) — auto-filled, can edit</span>
                <input value={form.director_name} onChange={e => set('director_name', e.target.value)} placeholder="Type director name" style={{ width: '100%' }} />
              </div>
              <div><span style={label}>Sub-Contractor</span><div style={roBox}>{ctx.subName || '—'}</div></div>
              <div><span style={label}>Sub-Contractor Address</span><div style={roBox}>{ctx.subAddress || '—'}</div></div>
              <div><span style={label}>Site / Project</span><div style={roBox}>{ctx.siteName || '—'}</div></div>
              <div><span style={label}>Site / Delivery Address</span><div style={roBox}>{ctx.siteAddress || '—'}</div></div>
              <div><span style={label}>Contract Value (excl. VAT)</span><div style={roBox}>{ctx.contractValue ? '£' + Number(ctx.contractValue).toLocaleString('en-GB') : '—'}</div></div>
              <div><span style={label}>Quote Reference / Date</span><div style={roBox}>{ctx.quoteReference || '—'}{ctx.quoteDate ? ' · ' + fmtDate(ctx.quoteDate) : ''}</div></div>
              <div>
                <span style={label}>Project Manager — auto-filled, can override</span>
                <select value={selectedPmId} onChange={e => setSelectedPmId(e.target.value)} style={{ width: '100%' }}>
                  <option value="">— Select Project Manager —</option>
                  {pmOptions.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </div>
            </div>

            {/* Dates */}
            <div style={sectionTitle}>Order details</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <span style={label}>Order Date</span>
                <input type="date" value={form.order_date} onChange={e => set('order_date', e.target.value)} style={{ width: '100%' }} />
              </div>
              <div>
                <span style={label}>Commencement Date — generates the valuation dates</span>
                <input type="date" value={form.commencement_date} onChange={e => set('commencement_date', e.target.value)} style={{ width: '100%' }} />
              </div>
              <div>
                <span style={label}>Site Manager — Name</span>
                <input value={form.site_manager_name} onChange={e => set('site_manager_name', e.target.value)} placeholder="Site Manager name" style={{ width: '100%' }} />
              </div>
              <div>
                <span style={label}>Site Manager — Tel</span>
                <input value={form.site_manager_tel} onChange={e => set('site_manager_tel', e.target.value)} placeholder="Site Manager tel" style={{ width: '100%' }} />
              </div>
              <div>
                <span style={label}>PM Phone — for the PO (not stored on profile)</span>
                <input value={form.pm_tel} onChange={e => set('pm_tel', e.target.value)} placeholder="Project Manager phone" style={{ width: '100%' }} />
              </div>
            </div>

            {/* Generated valuation dates */}
            <div style={sectionTitle}>Valuation dates — auto-generated from commencement date</div>
            {valuationDates.length === 0 ? (
              <div style={{ ...roBox, color: 'var(--text3)' }}>Enter a commencement date above to generate the 6 monthly valuation dates.</div>
            ) : (
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--text3)', textAlign: 'left' }}>
                    <th style={{ padding: '4px 8px' }}>CCG Valuation Date</th>
                    <th style={{ padding: '4px 8px' }}>Application Deadline</th>
                  </tr>
                </thead>
                <tbody>
                  {valuationDates.map((v, i) => (
                    <tr key={i} style={{ borderTop: '0.5px solid var(--border)' }}>
                      <td style={{ padding: '5px 8px' }}>{fmtDate(v.val_date)}</td>
                      <td style={{ padding: '5px 8px' }}>{fmtDate(v.app_deadline)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* PM free-text */}
            <div style={sectionTitle}>Works description — to complete</div>
            {[
              ['scope_of_works', 'Scope of Works *', 4],
              ['brief_description', 'Brief Description of Works', 3],
              ['design_responsibility', 'Design Responsibility (if applicable)', 3],
              ['practical_completion_items', 'Practical Completion Items', 3],
              ['quality_control_requirements', 'Quality Control Requirements', 2],
              ['statutory_compliance_requirements', 'Statutory Compliance Requirements', 2],
            ].map(([key, lbl, rows]) => {
              const aiEligible = !!AI_SECTION[key]
              return (
                <div key={key} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={label}>{lbl}</span>
                    {aiEligible && (
                      <button type="button" onClick={() => aiFill(key)} disabled={!!aiBusy}
                        title={`Generate a trade-specific draft for ${ctx.subTrade || 'this trade'}`}
                        style={{
                          fontSize: 11, padding: '2px 9px', borderRadius: 5, cursor: aiBusy ? 'default' : 'pointer',
                          border: '0.5px solid #448a40', background: aiBusy === key ? '#E1F5EE' : 'transparent',
                          color: '#448a40', fontWeight: 600, marginBottom: 4,
                        }}>
                        {aiBusy === key ? 'Generating…' : '✨ AI fill'}
                      </button>
                    )}
                  </div>
                  <textarea value={form[key]} onChange={e => set(key, e.target.value)} rows={rows}
                    style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }} />
                  {aiEligible && (
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                      AI fill produces a draft based on the trade — review and edit before issuing.
                    </div>
                  )}
                </div>
              )
            })}
            {aiError && (
              <div style={{ marginTop: 4, padding: '8px 11px', borderRadius: 6, background: '#FAECE7', color: '#993C1D', fontSize: 12 }}>{aiError}</div>
            )}

            {/* 2nd director */}
            <div style={sectionTitle}>Sub-Contractor — 2nd Director (optional)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <span style={label}>Name</span>
                <input value={form.contact2_name} onChange={e => set('contact2_name', e.target.value)} style={{ width: '100%' }} />
              </div>
              <div>
                <span style={label}>Tel</span>
                <input value={form.contact2_tel} onChange={e => set('contact2_tel', e.target.value)} style={{ width: '100%' }} />
              </div>
            </div>

            {/* Programme — pick a file from the project's 06. Project Programme folder */}
            <div style={sectionTitle}>Programme — select from project documents</div>
            {programmeFiles.length === 0 ? (
              <div style={{ ...roBox, color: 'var(--text3)' }}>
                No files found in the project’s “06. Project Programme” folder. Upload the programme there first, then it will appear here to attach to the PO.
              </div>
            ) : (
              <select value={selectedProgrammeId} onChange={e => setSelectedProgrammeId(e.target.value)} style={{ width: '100%' }}>
                <option value="">— No programme attached —</option>
                {programmeFiles.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.file_name}{f.created_at ? '  ·  ' + fmtDate(f.created_at) : ''}
                  </option>
                ))}
              </select>
            )}

            {/* Attendance table */}
            <div style={sectionTitle}>General &amp; Specific Attendance — tap to toggle CCG / Sub-Con</div>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--text3)', textAlign: 'left' }}>
                  <th style={{ padding: '4px 8px' }}>Item</th>
                  <th style={{ padding: '4px 8px', width: 80, textAlign: 'center' }}>CCG</th>
                  <th style={{ padding: '4px 8px', width: 80, textAlign: 'center' }}>Sub-Con</th>
                </tr>
              </thead>
              <tbody>
                {attendance.map((row, i) => (
                  <tr key={i} style={{ borderTop: '0.5px solid var(--border)', cursor: 'pointer' }} onClick={() => toggleAttendance(i)}>
                    <td style={{ padding: '5px 8px' }}>{row.item}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'center', color: '#448a40', fontWeight: 700 }}>{row.ccg ? '✓' : ''}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'center', color: '#854F0B', fontWeight: 700 }}>{!row.ccg ? '✓' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {error && (
              <div style={{ marginTop: 14, padding: '9px 12px', borderRadius: 6, background: '#FAECE7', color: '#993C1D', fontSize: 12 }}>{error}</div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '0.5px solid var(--border)' }}>
              <button onClick={onClose} disabled={saving}
                style={{ padding: '8px 16px', borderRadius: 6, border: '0.5px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>
                Cancel
              </button>
              <button onClick={() => save(false)} disabled={saving}
                style={{ padding: '8px 16px', borderRadius: 6, border: '0.5px solid var(--border)', background: 'var(--surface2)', cursor: 'pointer', fontSize: 13 }}>
                {saving ? 'Saving…' : 'Save draft'}
              </button>
              <button onClick={() => save(true)} disabled={saving}
                style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#448a40', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
                {saving ? 'Saving…' : (issuedRevision ? `Issue Rev ${NEXT_REVISION(existingPO.revision)}` : 'Issue PO')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
