import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Modal, Field, Spinner } from './ui'
import { extractCsa } from '../lib/csaExtractor'
import { generateCff } from '../lib/cffGenerator'
import {
  CURVE_TYPES,
  CURVE_LABELS,
  CURVE_DESCRIPTIONS,
  distributeGroups,
  monthsBetween,
} from '../lib/cffCurves'

// Storage paths within the project's docs bucket
const CSA_SUBFOLDER = 'csa'
const CFF_SUBFOLDER = 'cff'
// Previous CFFs are demoted to this synthetic subfolder so they don't show
// up in the regular file browser (no folder definition in project_doc_folders
// = invisible). The portal queries this explicitly when computing the
// "what changed since last version" diff.
const CFF_ARCHIVE_SUBFOLDER = 'cff-archive'
const PRIMARY_FOLDER = '00-project-information'

// ─── Main modal component ──────────────────────────────────────────────────
export default function CffGeneratorModal({
  projectId,
  projectName,
  onClose,
  onGenerated,
}) {
  const [step, setStep] = useState(1) // 1 = source & dates, 2 = curves & preview, 3 = generating
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // CSA source state
  const [csaFiles, setCsaFiles] = useState([])      // available CSA files in csa subfolder
  const [loadingCsaList, setLoadingCsaList] = useState(true)
  const [selectedCsaPath, setSelectedCsaPath] = useState('')
  const [uploadedCsaFile, setUploadedCsaFile] = useState(null)
  const [csaExtract, setCsaExtract] = useState(null)
  const [csaParseError, setCsaParseError] = useState('')

  // Settings state
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [numMonthsOverride, setNumMonthsOverride] = useState('')
  const [defaultCurve, setDefaultCurve] = useState('even')
  const [rowCurves, setRowCurves] = useState({})       // { [groupId]: 'even' | 'front' | ... }
  // Manual per-row overrides — when present, replaces the curve-derived
  // distribution for that row. Editing a cell switches the row into manual
  // mode; "Reset to curve" clears it back to auto. Persists across step
  // navigation so user doesn't lose edits when going back to Step 1.
  const [manualOverrides, setManualOverrides] = useState({})  // { [groupId]: number[] }

  // Computed: number of months
  const numMonths = useMemo(() => {
    if (numMonthsOverride && /^\d+$/.test(numMonthsOverride)) {
      const n = parseInt(numMonthsOverride, 10)
      if (n >= 1 && n <= 60) return n
    }
    return monthsBetween(startDate, endDate)
  }, [startDate, endDate, numMonthsOverride])

  // Live distribution preview. For each row we either use the curve-derived
  // distribution OR the user's manual override array. Totals + cumulative
  // are computed from the resolved monthly values either way.
  const preview = useMemo(() => {
    if (!csaExtract || !numMonths) return null
    const groupsWithCurves = csaExtract.groups.map(g => ({
      ...g,
      curve: rowCurves[g.id] || defaultCurve,
    }))
    const auto = distributeGroups(groupsWithCurves, numMonths, defaultCurve)
    // Overlay manual overrides
    const rows = auto.rows.map(r => {
      const manual = manualOverrides[r.id]
      // Manual array must match numMonths exactly to be applied; otherwise
      // we silently fall back to the curve-derived distribution (this happens
      // e.g. if the user set a 4-month manual then changed numMonths to 6).
      if (Array.isArray(manual) && manual.length === numMonths) {
        return { ...r, monthly: manual.slice(), is_manual: true }
      }
      return { ...r, is_manual: false }
    })
    const totals = Array.from({ length: numMonths }, (_, i) =>
      Math.round(rows.reduce((s, r) => s + (r.monthly[i] || 0), 0) * 100) / 100
    )
    const cumulative = []
    let running = 0
    for (const t of totals) {
      running = Math.round((running + t) * 100) / 100
      cumulative.push(running)
    }
    return { rows, totals, cumulative }
  }, [csaExtract, numMonths, rowCurves, defaultCurve, manualOverrides])

  // Reset manual overrides whenever numMonths changes — old arrays would be
  // wrong length anyway. Done as effect so we don't silently keep stale data.
  useEffect(() => {
    setManualOverrides(prev => {
      const out = {}
      for (const [id, arr] of Object.entries(prev)) {
        if (Array.isArray(arr) && arr.length === numMonths) out[id] = arr
      }
      return out
    })
  }, [numMonths])

  // ─── On mount: load CSA file list AND seed dates from project record ───
  // We fetch the project's start_date / end_date so the modal opens
  // pre-populated — user can override but won't have to re-type what they
  // already entered when creating the project. Done in parallel with the
  // CSA list query for one round-trip.
  useEffect(() => {
    let cancelled = false
    async function loadInitialData() {
      setLoadingCsaList(true)
      try {
        const [csaRes, projectRes] = await Promise.all([
          supabase
            .from('project_doc_files')
            .select('id, file_name, storage_path, created_at')
            .eq('project_id', projectId)
            .eq('folder_key', PRIMARY_FOLDER)
            .eq('subfolder_key', CSA_SUBFOLDER)
            .order('created_at', { ascending: false }),
          supabase
            .from('projects')
            .select('start_date, end_date')
            .eq('id', projectId)
            .maybeSingle(),
        ])

        if (cancelled) return

        // CSA list — accept any error gracefully so the modal still opens
        if (csaRes.error) console.warn('CSA list query error:', csaRes.error)
        const xlsxFiles = (csaRes.data || []).filter(f =>
          /\.xlsx$/i.test(f.file_name)
        )
        setCsaFiles(xlsxFiles)
        if (xlsxFiles.length > 0) {
          setSelectedCsaPath(xlsxFiles[0].storage_path)
        }

        // Project dates — only seed if user hasn't typed anything yet
        if (projectRes.data) {
          if (projectRes.data.start_date) setStartDate(prev => prev || projectRes.data.start_date)
          if (projectRes.data.end_date) setEndDate(prev => prev || projectRes.data.end_date)
        }
      } catch (err) {
        if (!cancelled) console.warn('Failed to load modal initial data', err)
      } finally {
        if (!cancelled) setLoadingCsaList(false)
      }
    }
    loadInitialData()
    return () => {
      cancelled = true
    }
  }, [projectId])

  // ─── Parse CSA when source changes ──────────────────────────────────────
  async function loadAndParseCsa() {
    setCsaParseError('')
    setCsaExtract(null)
    setBusy(true)

    try {
      let file
      if (uploadedCsaFile) {
        file = uploadedCsaFile
      } else if (selectedCsaPath) {
        // Download from Supabase storage
        const { data, error } = await supabase
          .storage
          .from('project-docs')
          .download(selectedCsaPath)
        if (error) throw error
        file = data // Blob
      } else {
        throw new Error('No CSA selected')
      }

      const extract = await extractCsa(file)
      if (!extract.groups || extract.groups.length === 0) {
        throw new Error('No line items found in this CSA')
      }
      setCsaExtract(extract)
      // Initialise per-row curves to default
      const initial = {}
      for (const g of extract.groups) initial[g.id] = defaultCurve
      setRowCurves(initial)
    } catch (err) {
      console.warn('CSA parse failed', err)
      setCsaParseError(err.message || 'Failed to parse CSA')
    } finally {
      setBusy(false)
    }
  }

  // ─── Step 1 → Step 2: validate and parse ────────────────────────────────
  async function handleNextFromStep1() {
    setError('')
    if (!selectedCsaPath && !uploadedCsaFile) {
      setError('Select a CSA file from the list, or upload one.')
      return
    }
    if (!startDate) {
      setError('Project start date is required.')
      return
    }
    if (!endDate && !numMonthsOverride) {
      setError('Either project end date or a manual months value is required.')
      return
    }
    if (numMonths < 1 || numMonths > 60) {
      setError('Number of months must be between 1 and 60.')
      return
    }
    if (!csaExtract) {
      await loadAndParseCsa()
    }
    if (!csaParseError) {
      setStep(2)
    }
  }

  // ─── Step 2 → generate ──────────────────────────────────────────────────
  async function handleGenerate() {
    setError('')
    setBusy(true)
    setStep(3)

    try {
      const result = await generateCff(csaExtract, {
        project_name: projectName || csaExtract.project_name,
        start_date: startDate,
        end_date: endDate,
        num_months: numMonths,
        csa_no: csaExtract.csa_no,
        row_curves: rowCurves,
        default_curve: defaultCurve,
        row_manual: manualOverrides,
      })

      // Upload to project-docs bucket — match the CRM upload convention:
      //   projects/<projectId>/<folderKey>/<subfolderKey>/<ts>-<filename>
      // The timestamp prefix means a re-generate creates a new file rather
      // than overwriting the previous one in storage. We delete any existing
      // CFF rows for this subfolder afterwards so the file list shows only
      // the latest one (matches the publish-PR-to-folder flow used elsewhere).
      const ts = Date.now()
      const storagePath = `projects/${projectId}/${PRIMARY_FOLDER}/${CFF_SUBFOLDER}/${ts}-${result.filename}`
      const { error: uploadErr } = await supabase
        .storage
        .from('project-docs')
        .upload(storagePath, result.blob, {
          upsert: false, // never overwrite — timestamp guarantees uniqueness
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
      if (uploadErr) throw uploadErr

      // Find existing CFF rows (current + any pre-existing archive). On
      // regenerate, we KEEP the previous CURRENT version as an archive so
      // the portal can show "what changed" diffs. We only ever keep one
      // archive — older archives are deleted to prevent unbounded growth.
      const { data: existing } = await supabase
        .from('project_doc_files')
        .select('id, storage_path, subfolder_key')
        .eq('project_id', projectId)
        .eq('folder_key', PRIMARY_FOLDER)
        .in('subfolder_key', [CFF_SUBFOLDER, CFF_ARCHIVE_SUBFOLDER])

      // Insert the new row using the standard column set (matches every
      // other place in the codebase that writes to project_doc_files).
      const { error: insertErr } = await supabase
        .from('project_doc_files')
        .insert({
          project_id: projectId,
          folder_key: PRIMARY_FOLDER,
          subfolder_key: CFF_SUBFOLDER,
          file_name: result.filename,
          file_size: result.blob.size,
          storage_path: storagePath,
        })
      if (insertErr) throw insertErr

      // Reconcile existing rows:
      //   • Skip the just-inserted row (matched by storage_path)
      //   • Pre-existing archive rows → delete (storage + DB)
      //   • Pre-existing current rows → demote to archive (DB only; storage
      //     stays put under its original path — only the logical folder
      //     changes)
      const previousCurrent = (existing || []).filter(r =>
        r.subfolder_key === CFF_SUBFOLDER && r.storage_path !== storagePath
      )
      const previousArchive = (existing || []).filter(r =>
        r.subfolder_key === CFF_ARCHIVE_SUBFOLDER
      )

      // Delete old archive (DB + storage)
      if (previousArchive.length > 0) {
        const oldPaths = previousArchive.map(r => r.storage_path).filter(Boolean)
        if (oldPaths.length) {
          await supabase.storage.from('project-docs').remove(oldPaths)
        }
        await supabase
          .from('project_doc_files')
          .delete()
          .in('id', previousArchive.map(r => r.id))
      }

      // Demote previous current → archive
      if (previousCurrent.length > 0) {
        await supabase
          .from('project_doc_files')
          .update({ subfolder_key: CFF_ARCHIVE_SUBFOLDER })
          .in('id', previousCurrent.map(r => r.id))
      }

      if (onGenerated) onGenerated(result.filename)
      onClose()
    } catch (err) {
      console.warn('CFF generation failed', err)
      setError(err.message || 'CFF generation failed')
      setStep(2) // back to settings step so the user can retry
    } finally {
      setBusy(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  const title =
    step === 1
      ? 'Generate Cashflow Forecast — Source & Programme'
      : step === 2
      ? 'Generate Cashflow Forecast — Curves & Preview'
      : 'Generating Cashflow Forecast…'

  const footer = (
    <>
      {step === 1 && (
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={handleNextFromStep1} disabled={busy}>
            {busy ? <Spinner size={14} /> : 'Next →'}
          </button>
        </>
      )}
      {step === 2 && (
        <>
          <button className="btn" onClick={() => setStep(1)} disabled={busy}>← Back</button>
          <button className="btn btn-primary" onClick={handleGenerate} disabled={busy || !preview}>
            Generate &amp; Upload
          </button>
        </>
      )}
      {step === 3 && (
        <button className="btn" disabled>Generating…</button>
      )}
    </>
  )

  return (
    <Modal open={true} onClose={onClose} title={title} size="lg" footer={footer}>
      {error && (
        <div style={{
          background: 'rgba(220, 38, 38, 0.08)',
          border: '1px solid rgba(220, 38, 38, 0.3)',
          color: '#dc2626',
          borderRadius: 6,
          padding: 10,
          fontSize: 13,
          marginBottom: 14,
        }}>
          {error}
        </div>
      )}

      {step === 1 && (
        <Step1SourceAndProgramme
          csaFiles={csaFiles}
          loadingCsaList={loadingCsaList}
          selectedCsaPath={selectedCsaPath}
          setSelectedCsaPath={(p) => { setSelectedCsaPath(p); setUploadedCsaFile(null); setCsaExtract(null); setCsaParseError('') }}
          uploadedCsaFile={uploadedCsaFile}
          setUploadedCsaFile={(f) => { setUploadedCsaFile(f); setSelectedCsaPath(''); setCsaExtract(null); setCsaParseError('') }}
          startDate={startDate}
          setStartDate={setStartDate}
          endDate={endDate}
          setEndDate={setEndDate}
          numMonthsOverride={numMonthsOverride}
          setNumMonthsOverride={setNumMonthsOverride}
          numMonths={numMonths}
          defaultCurve={defaultCurve}
          setDefaultCurve={setDefaultCurve}
          csaParseError={csaParseError}
        />
      )}

      {step === 2 && csaExtract && preview && (
        <Step2CurvesAndPreview
          csaExtract={csaExtract}
          numMonths={numMonths}
          rowCurves={rowCurves}
          setRowCurves={setRowCurves}
          defaultCurve={defaultCurve}
          preview={preview}
          manualOverrides={manualOverrides}
          setManualOverrides={setManualOverrides}
        />
      )}

      {step === 3 && (
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <Spinner size={36} />
          <div style={{ marginTop: 16, fontSize: 14, color: 'var(--text2)' }}>
            Building xlsx and uploading to the cff subfolder…
          </div>
        </div>
      )}
    </Modal>
  )
}

// ─── Step 1: Source + programme ────────────────────────────────────────────
function Step1SourceAndProgramme({
  csaFiles, loadingCsaList,
  selectedCsaPath, setSelectedCsaPath,
  uploadedCsaFile, setUploadedCsaFile,
  startDate, setStartDate,
  endDate, setEndDate,
  numMonthsOverride, setNumMonthsOverride,
  numMonths,
  defaultCurve, setDefaultCurve,
  csaParseError,
}) {
  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (file) setUploadedCsaFile(file)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* CSA source */}
      <div>
        <Field label="Source CSA file">
          {loadingCsaList ? (
            <div style={{ fontSize: 13, color: 'var(--text3)', padding: '8px 0' }}>
              Loading available CSA files…
            </div>
          ) : csaFiles.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text3)', padding: '8px 0' }}>
              No CSA files found in <code>{PRIMARY_FOLDER} / {CSA_SUBFOLDER}</code>.
              Upload one below to continue.
            </div>
          ) : (
            <select
              value={uploadedCsaFile ? '__uploaded__' : selectedCsaPath}
              onChange={(e) => {
                if (e.target.value === '__uploaded__') return
                setSelectedCsaPath(e.target.value)
              }}
              style={{ width: '100%' }}
            >
              {csaFiles.map(f => (
                <option key={f.id} value={f.storage_path}>
                  {f.file_name}
                </option>
              ))}
              {uploadedCsaFile && (
                <option value="__uploaded__">
                  Just uploaded: {uploadedCsaFile.name}
                </option>
              )}
            </select>
          )}
        </Field>

        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
          Or upload a CSA xlsx directly:&nbsp;
          <input type="file" accept=".xlsx" onChange={handleFileChange} style={{ fontSize: 12 }} />
        </div>

        {csaParseError && (
          <div style={{ marginTop: 8, fontSize: 13, color: '#dc2626' }}>
            CSA parse error: {csaParseError}
          </div>
        )}
      </div>

      {/* Programme dates */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Project start date">
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            style={{ width: '100%' }}
          />
        </Field>
        <Field label="Project end date">
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            style={{ width: '100%' }}
          />
        </Field>
      </div>

      <Field label={`Number of months (${numMonths || '—'} computed from dates)`}>
        <input
          type="number"
          placeholder="Override (optional, 1–60)"
          min="1"
          max="60"
          value={numMonthsOverride}
          onChange={e => setNumMonthsOverride(e.target.value)}
          style={{ width: 200 }}
        />
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
          Leave blank to derive from start &amp; end dates. Override if you want a specific count.
        </div>
      </Field>

      {/* Default curve */}
      <Field label="Default distribution curve">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {CURVE_TYPES.map(c => (
            <label
              key={c}
              style={{
                cursor: 'pointer',
                padding: '8px 10px',
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: defaultCurve === c ? 'var(--surface2)' : 'transparent',
                fontSize: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <input
                type="radio"
                name="defaultCurve"
                checked={defaultCurve === c}
                onChange={() => setDefaultCurve(c)}
                style={{ marginRight: 6 }}
              />
              <strong>{CURVE_LABELS[c]}</strong>
              <span style={{ color: 'var(--text3)', fontSize: 11 }}>
                {CURVE_DESCRIPTIONS[c]}
              </span>
            </label>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
          Applied to every row by default. You can override per-row in the next step.
        </div>
      </Field>
    </div>
  )
}

// ─── Step 2: Per-row curves + editable monthly preview ────────────────────
// Each row's monthly cells can be edited directly. Editing puts the row into
// "manual" mode — the curve dropdown becomes "Reset to curve". A row in
// manual mode shows a drift badge if its monthly values don't sum to its
// contract value. Drift is allowed (not blocking), shown for transparency.
function Step2CurvesAndPreview({
  csaExtract, numMonths, rowCurves, setRowCurves, defaultCurve, preview,
  manualOverrides, setManualOverrides,
}) {
  function setRowCurve(groupId, curve) {
    setRowCurves(prev => ({ ...prev, [groupId]: curve }))
    // Switching curve clears any manual override for that row
    setManualOverrides(prev => {
      if (!(groupId in prev)) return prev
      const out = { ...prev }
      delete out[groupId]
      return out
    })
  }

  function setRowCellValue(groupId, monthIdx, rawValue) {
    // Parse user input. Allow blank → 0. Strip £ and commas.
    const cleaned = String(rawValue).replace(/[£,\s]/g, '')
    const v = cleaned === '' ? 0 : Number(cleaned)
    if (!Number.isFinite(v)) return  // ignore non-numeric input

    setManualOverrides(prev => {
      const existing = prev[groupId]
      // Initialise from current curve-derived values if not manual yet
      const previewRow = preview.rows.find(r => r.id === groupId)
      const baseline = (Array.isArray(existing) && existing.length === numMonths)
        ? existing.slice()
        : (previewRow ? previewRow.monthly.slice() : Array(numMonths).fill(0))
      baseline[monthIdx] = Math.round(v * 100) / 100
      return { ...prev, [groupId]: baseline }
    })
  }

  function resetRowToCurve(groupId) {
    setManualOverrides(prev => {
      if (!(groupId in prev)) return prev
      const out = { ...prev }
      delete out[groupId]
      return out
    })
  }

  function fmtMoney(v) {
    return '£' + Math.round(v).toLocaleString()
  }
  function fmtMoneyShort(v) {
    return Math.round(v).toLocaleString()
  }

  const monthLabelsArr = Array.from({ length: numMonths }, (_, i) => `M${i + 1}`)
  const cumulativeAtFinal = preview.cumulative[numMonths - 1] || 0
  const totalManual = Object.keys(manualOverrides).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 13, color: 'var(--text2)' }}>
        <strong>{csaExtract.project_name || 'Project'}</strong>{' '}
        — Contract sum {fmtMoney(csaExtract.contract_sum)} —{' '}
        {csaExtract.groups.length} CFF rows × {numMonths} months
        {totalManual > 0 && (
          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text3)' }}>
            · {totalManual} row{totalManual === 1 ? '' : 's'} manually edited
          </span>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--text3)' }}>
        Tip: click any monthly cell to edit. The row's curve switches to manual mode.
        Use <strong>Reset</strong> to restore the curve-based distribution.
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--surface2)' }}>
              <th style={th('left', 60)}>Section</th>
              <th style={th('left', null)}>Description</th>
              <th style={th('right', 100)}>Value</th>
              <th style={th('center', 140)}>Curve</th>
              {monthLabelsArr.map(lbl => (
                <th key={lbl} style={th('right', 90)}>{lbl}</th>
              ))}
              <th style={th('right', 90)}>Row Σ</th>
            </tr>
          </thead>
          <tbody>
            {csaExtract.groups.map(g => {
              const distRow = preview.rows.find(r => r.id === g.id)
              if (!distRow) return null
              const isManual = !!distRow.is_manual
              const rowSum = distRow.monthly.reduce((s, v) => s + v, 0)
              const drift = rowSum - g.value
              const hasDrift = Math.abs(drift) > 0.5
              return (
                <tr key={g.id} style={{
                  borderTop: '1px solid var(--border)',
                  background: isManual ? 'rgba(80, 102, 188, 0.05)' : undefined,
                }}>
                  <td style={td('left')}>
                    <span style={{
                      fontSize: 10,
                      padding: '2px 6px',
                      background: 'var(--surface2)',
                      borderRadius: 3,
                      whiteSpace: 'nowrap',
                    }}>
                      {sectionShort(g.section)}
                    </span>
                  </td>
                  <td style={td('left')}>{g.label}</td>
                  <td style={td('right')}>{fmtMoney(g.value)}</td>
                  <td style={td('center')}>
                    {isManual ? (
                      <button
                        onClick={() => resetRowToCurve(g.id)}
                        style={{
                          fontSize: 10, padding: '2px 8px',
                          background: 'var(--surface2)',
                          border: '0.5px solid var(--border)',
                          borderRadius: 3,
                          cursor: 'pointer',
                          width: '100%',
                        }}
                        title="Discard manual edits and recompute from the curve"
                      >
                        Reset to curve
                      </button>
                    ) : (
                      <select
                        value={rowCurves[g.id] || defaultCurve}
                        onChange={e => setRowCurve(g.id, e.target.value)}
                        style={{ fontSize: 11, padding: '2px 4px', width: '100%' }}
                      >
                        {CURVE_TYPES.map(c => (
                          <option key={c} value={c}>{CURVE_LABELS[c]}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  {distRow.monthly.map((v, i) => (
                    <td key={i} style={{ ...td('right'), padding: '2px 4px' }}>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={fmtMoneyShort(v)}
                        onChange={e => setRowCellValue(g.id, i, e.target.value)}
                        style={{
                          width: '100%',
                          padding: '4px 6px',
                          fontSize: 12,
                          textAlign: 'right',
                          background: 'transparent',
                          border: '0.5px solid transparent',
                          borderRadius: 3,
                          fontVariantNumeric: 'tabular-nums',
                          color: isManual ? 'var(--text)' : 'var(--text2)',
                        }}
                        onFocus={e => { e.target.select(); e.target.style.border = '0.5px solid var(--border)' }}
                        onBlur={e => { e.target.style.border = '0.5px solid transparent' }}
                      />
                    </td>
                  ))}
                  <td style={{ ...td('right'), color: hasDrift ? '#dc2626' : 'var(--text3)', fontSize: 11 }}>
                    {fmtMoney(rowSum)}
                    {hasDrift && (
                      <div style={{ fontSize: 10 }}>
                        {drift > 0 ? '+' : ''}{fmtMoney(drift)}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
            <tr style={{
              background: 'var(--surface2)',
              fontWeight: 600,
              borderTop: '2px solid var(--border)',
            }}>
              <td style={td('left')} colSpan={3}>Monthly Gross Valuation</td>
              <td style={td('center')}>—</td>
              {preview.totals.map((v, i) => (
                <td key={i} style={td('right')}>{fmtMoney(v)}</td>
              ))}
              <td style={td('right')}>{fmtMoney(preview.totals.reduce((s, v) => s + v, 0))}</td>
            </tr>
            <tr style={{ fontWeight: 600 }}>
              <td style={td('left')} colSpan={3}>Cumulative</td>
              <td style={td('center')}>—</td>
              {preview.cumulative.map((v, i) => (
                <td key={i} style={td('right')}>{fmtMoney(v)}</td>
              ))}
              <td style={td('right')}>—</td>
            </tr>
            <tr style={{ color: 'var(--text3)' }}>
              <td style={td('left')} colSpan={3}>% Programme</td>
              <td style={td('center')}>—</td>
              {preview.cumulative.map((v, i) => (
                <td key={i} style={td('right')}>
                  {csaExtract.contract_sum
                    ? ((v / csaExtract.contract_sum) * 100).toFixed(0) + '%'
                    : '—'}
                </td>
              ))}
              <td style={td('right')}>—</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text3)' }}>
        Total forecast: <strong>{fmtMoney(cumulativeAtFinal)}</strong>{' '}
        {Math.abs(cumulativeAtFinal - csaExtract.contract_sum) > 1 && (
          <span style={{ color: '#dc2626' }}>
            (mismatch with contract {fmtMoney(csaExtract.contract_sum)} —
            generation will proceed but the CFF total will differ from the contract)
          </span>
        )}
      </div>
    </div>
  )
}

// Helpers
const th = (align, width) => ({
  textAlign: align,
  padding: '6px 8px',
  fontSize: 11,
  fontWeight: 600,
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
  width: width != null ? width : 'auto',
})
const td = (align) => ({
  textAlign: align,
  padding: '6px 8px',
  whiteSpace: 'nowrap',
})

function sectionShort(section) {
  if (!section) return ''
  const map = {
    'PRELIMINARIES': 'PRELIMS',
    'MAIN WORKS': 'MAIN',
    'EXTERNAL WORKS': 'EXT',
    'PROVISIONAL SUMS': 'PROV',
  }
  return map[section] || section
}
