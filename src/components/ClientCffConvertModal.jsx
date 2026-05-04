import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Modal, Spinner } from './ui'
import { extractClientCff } from '../lib/clientCffExtractor'
import { generateCffFromClient } from '../lib/clientCffAdapter'

// ─────────────────────────────────────────────────────────────────────────────
// ClientCffConvertModal
//
// Lets the user supply a client-CFF spreadsheet (Merton-style format), parse
// it, preview what will be generated, then render a CFF in our template
// using the client's per-line monthly distribution and save it to the
// project's chosen cff subfolder.
//
// Source modes:
//   • upload — user picks a file from disk via <input type="file">
//   • pick   — user picks an existing xlsx file from the project's cff
//              subfolders (cff and any cff-sub-* per-building subfolders)
//
// Retention / release rates default to Merton's terms (8% deducted, 6.5%
// released at PC, leaving 1.5% retained for defects). User can edit either
// before generating. Generator falls back to the historical 3% / 1.5% if
// they're left blank.
//
// Multi-building destination: dropdown lists cff-sub-* subfolders.
// ─────────────────────────────────────────────────────────────────────────────

const PRIMARY_FOLDER = '00-project-information'
const DEFAULT_CFF_SUBFOLDER = 'cff'
const ARCHIVE_SUBFOLDER = 'cff-archive'

// Defaults — Merton's payment terms. User can override per conversion.
const DEFAULT_RETENTION_PCT = 8.0
const DEFAULT_RELEASE_PCT = 6.5

export default function ClientCffConvertModal({
  projectId,
  projectName,
  projectStartDate,
  projectEndDate,
  onClose,
  onGenerated,
}) {
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Source mode + inputs
  const [sourceMode, setSourceMode] = useState('upload')  // 'upload' | 'pick'
  const [file, setFile] = useState(null)                   // upload mode
  const [existingFiles, setExistingFiles] = useState([])   // pick mode
  const [selectedExistingPath, setSelectedExistingPath] = useState('')

  // Destination
  const [destSubfolder, setDestSubfolder] = useState(DEFAULT_CFF_SUBFOLDER)
  const [cffSubfolders, setCffSubfolders] = useState([])

  // Retention / release inputs (entered as percentages, e.g. 8 not 0.08)
  const [retentionPctInput, setRetentionPctInput] = useState(String(DEFAULT_RETENTION_PCT))
  const [releasePctInput, setReleasePctInput] = useState(String(DEFAULT_RELEASE_PCT))

  // Project dates — passed in OR fetched here. Falls back to null which
  // makes the generator produce "Month N" labels instead of date ranges.
  const [startDate, setStartDate] = useState(projectStartDate || null)
  const [endDate, setEndDate] = useState(projectEndDate || null)

  // Step 2 state — parsed result + the source label (filename or pick name)
  const [parsed, setParsed] = useState(null)
  const [parsedSourceLabel, setParsedSourceLabel] = useState('')

  // Load destination subfolder list, project dates, and the existing-files
  // list (xlsx files in cff or cff-sub-* subfolders for this project).
  useEffect(() => {
    let cancelled = false
    async function loadInitial() {
      try {
        const [subRes, projRes, filesRes] = await Promise.all([
          supabase
            .from('project_doc_folders')
            .select('folder_key, label, parent_key')
            .eq('project_id', projectId)
            .eq('parent_key', 'cff'),
          (projectStartDate && projectEndDate)
            ? Promise.resolve({ data: null })
            : supabase
                .from('projects')
                .select('start_date, end_date')
                .eq('id', projectId)
                .maybeSingle(),
          // Existing CFF files — load EVERYTHING in the cff family so the
          // user can pick one. Includes the global 'cff' subfolder, every
          // cff-sub-* per-building subfolder, AND the cff-archive (in case
          // the user wants to re-convert from a previous archived file).
          supabase
            .from('project_doc_files')
            .select('id, file_name, storage_path, subfolder_key, created_at')
            .eq('project_id', projectId)
            .eq('folder_key', PRIMARY_FOLDER)
            .order('created_at', { ascending: false }),
        ])
        if (cancelled) return
        if (subRes.error) throw subRes.error
        setCffSubfolders(subRes.data || [])
        if (projRes.data) {
          if (projRes.data.start_date) setStartDate(projRes.data.start_date)
          if (projRes.data.end_date) setEndDate(projRes.data.end_date)
        }
        // Filter to xlsx files only, in cff-related subfolders. Build set
        // of acceptable subfolder keys: 'cff', 'cff-archive', and any
        // cff-sub-* that came back from the folder query.
        const cffSubKeys = new Set(['cff', 'cff-archive'])
        for (const sf of (subRes.data || [])) {
          if (sf.folder_key) cffSubKeys.add(sf.folder_key)
        }
        const xlsxFiles = (filesRes.data || []).filter(f =>
          f.file_name && /\.xlsx$/i.test(f.file_name) && cffSubKeys.has(f.subfolder_key)
        )
        setExistingFiles(xlsxFiles)
      } catch (err) {
        console.warn('[ClientCffConvert] init load failed:', err)
      }
    }
    loadInitial()
    return () => { cancelled = true }
  }, [projectId, projectStartDate, projectEndDate])

  // Step 1 → Step 2: parse the source (uploaded file OR picked file)
  async function handleParse() {
    setError('')
    if (sourceMode === 'upload' && !file) {
      setError('Pick a client CFF file first')
      return
    }
    if (sourceMode === 'pick' && !selectedExistingPath) {
      setError('Pick an existing CFF file first')
      return
    }
    setBusy(true)
    try {
      let parseInput
      let sourceLabel
      if (sourceMode === 'upload') {
        parseInput = file
        sourceLabel = file.name
      } else {
        // Download the picked file as ArrayBuffer
        const picked = existingFiles.find(f => f.storage_path === selectedExistingPath)
        if (!picked) {
          throw new Error('Picked file not found')
        }
        const { data: signed, error: sErr } = await supabase
          .storage
          .from('project-docs')
          .createSignedUrl(picked.storage_path, 600)
        if (sErr || !signed?.signedUrl) {
          throw new Error('Could not get download URL for the picked file')
        }
        const res = await fetch(signed.signedUrl)
        if (!res.ok) {
          throw new Error(`Download failed (${res.status})`)
        }
        parseInput = await res.arrayBuffer()
        sourceLabel = picked.file_name
      }

      const result = await extractClientCff(parseInput)
      if (!result.line_items || result.line_items.length === 0) {
        throw new Error('No line items found in the file. Is this the correct format?')
      }
      setParsed(result)
      setParsedSourceLabel(sourceLabel)
      setStep(2)
    } catch (err) {
      console.warn('[ClientCffConvert] parse failed:', err)
      setError(err.message || 'Could not parse the file')
    } finally {
      setBusy(false)
    }
  }

  // Step 2 → Step 3: generate the CFF and upload
  async function handleGenerate() {
    setError('')
    setBusy(true)
    setStep(3)
    try {
      // Validate retention / release inputs. Empty falls back to generator
      // defaults (3% / 1.5%). Non-numeric → reject. Negative or > 100 → reject.
      const retentionPct = parseRatePct(retentionPctInput)
      const releasePct = parseRatePct(releasePctInput)
      if (retentionPct === 'invalid' || releasePct === 'invalid') {
        throw new Error('Retention and release must be numbers between 0 and 100')
      }

      const result = await generateCffFromClient(parsed, {
        project_name: projectName,
        start_date: startDate,
        end_date: endDate,
        retention_pct: retentionPct,
        release_pct: releasePct,
      })

      // Upload to the chosen subfolder (matches existing CFF Generator
      // upload pattern — timestamped filename, archive previous current).
      const ts = Date.now()
      const storagePath =
        `projects/${projectId}/${PRIMARY_FOLDER}/${destSubfolder}/${ts}-${result.filename}`

      const { error: uploadErr } = await supabase
        .storage
        .from('project-docs')
        .upload(storagePath, result.blob, {
          upsert: false,
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
      if (uploadErr) throw uploadErr

      // Find existing rows to demote/clean up. Note: archive only exists
      // for the GLOBAL 'cff' subfolder pattern. For per-building subfolders
      // we just keep all historic versions (matches manual upload behaviour
      // for those subfolders).
      if (destSubfolder === DEFAULT_CFF_SUBFOLDER) {
        const { data: existing } = await supabase
          .from('project_doc_files')
          .select('id, storage_path, subfolder_key')
          .eq('project_id', projectId)
          .eq('folder_key', PRIMARY_FOLDER)
          .in('subfolder_key', [DEFAULT_CFF_SUBFOLDER, ARCHIVE_SUBFOLDER])

        const previousCurrent = (existing || []).filter(r =>
          r.subfolder_key === DEFAULT_CFF_SUBFOLDER && r.storage_path !== storagePath
        )
        const previousArchive = (existing || []).filter(r =>
          r.subfolder_key === ARCHIVE_SUBFOLDER
        )

        const { error: insertErr } = await supabase
          .from('project_doc_files')
          .insert({
            project_id: projectId,
            folder_key: PRIMARY_FOLDER,
            subfolder_key: DEFAULT_CFF_SUBFOLDER,
            file_name: result.filename,
            file_size: result.blob.size,
            storage_path: storagePath,
          })
        if (insertErr) throw insertErr

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

        if (previousCurrent.length > 0) {
          await supabase
            .from('project_doc_files')
            .update({ subfolder_key: ARCHIVE_SUBFOLDER })
            .in('id', previousCurrent.map(r => r.id))
        }
      } else {
        // Per-building subfolder: just insert, no archive flow.
        const { error: insertErr } = await supabase
          .from('project_doc_files')
          .insert({
            project_id: projectId,
            folder_key: PRIMARY_FOLDER,
            subfolder_key: destSubfolder,
            file_name: result.filename,
            file_size: result.blob.size,
            storage_path: storagePath,
          })
        if (insertErr) throw insertErr
      }

      if (onGenerated) onGenerated(result.filename)
      onClose()
    } catch (err) {
      console.warn('[ClientCffConvert] generate failed:', err)
      setError(err.message || 'Could not generate the CFF')
      setStep(2)
    } finally {
      setBusy(false)
    }
  }

  const title = 'Convert client CFF'

  let footer
  if (step === 1) {
    footer = (
      <>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={handleParse} disabled={busy}>
          {busy ? <Spinner size={14} /> : 'Parse file'}
        </button>
      </>
    )
  } else if (step === 2) {
    footer = (
      <>
        <button className="btn" onClick={() => { setStep(1); setParsed(null) }} disabled={busy}>Back</button>
        <button className="btn btn-primary" onClick={handleGenerate} disabled={busy}>
          {busy ? <Spinner size={14} /> : 'Generate & save'}
        </button>
      </>
    )
  } else {
    footer = null
  }

  return (
    <Modal open={true} onClose={onClose} title={title} size="md" footer={footer}>
      {error && (
        <div style={{
          padding: 10,
          background: 'rgba(163, 45, 45, 0.10)',
          border: '0.5px solid rgba(163, 45, 45, 0.4)',
          borderRadius: 6,
          fontSize: 12,
          color: '#A32D2D',
          marginBottom: 14,
        }}>
          {error}
        </div>
      )}

      {step === 1 && (
        <Step1Pick
          sourceMode={sourceMode} setSourceMode={setSourceMode}
          file={file} setFile={setFile}
          existingFiles={existingFiles}
          selectedExistingPath={selectedExistingPath}
          setSelectedExistingPath={setSelectedExistingPath}
          destSubfolder={destSubfolder} setDestSubfolder={setDestSubfolder}
          cffSubfolders={cffSubfolders}
          retentionPctInput={retentionPctInput} setRetentionPctInput={setRetentionPctInput}
          releasePctInput={releasePctInput} setReleasePctInput={setReleasePctInput}
        />
      )}
      {step === 2 && parsed && (
        <Step2Preview
          parsed={parsed}
          sourceLabel={parsedSourceLabel}
          destSubfolder={destSubfolder}
          cffSubfolders={cffSubfolders}
          retentionPctInput={retentionPctInput}
          releasePctInput={releasePctInput}
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

// Parse a percentage input. Accepts "" (empty → undefined, lets generator
// use defaults), valid 0–100 number → returns decimal (0.08), anything else
// → 'invalid'. Caller surfaces the validation error.
function parseRatePct(input) {
  const trimmed = String(input).trim()
  if (trimmed === '') return undefined
  const n = parseFloat(trimmed)
  if (!Number.isFinite(n) || n < 0 || n > 100) return 'invalid'
  return n / 100
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — source picker + destination + retention/release inputs
// ─────────────────────────────────────────────────────────────────────────────
function Step1Pick({
  sourceMode, setSourceMode,
  file, setFile,
  existingFiles, selectedExistingPath, setSelectedExistingPath,
  destSubfolder, setDestSubfolder, cffSubfolders,
  retentionPctInput, setRetentionPctInput,
  releasePctInput, setReleasePctInput,
}) {
  // Subfolder labels for display in the existing-files list
  const subLabelMap = {
    'cff': 'cff (default)',
    'cff-archive': 'cff-archive',
  }
  for (const sf of cffSubfolders) {
    subLabelMap[sf.folder_key] = sf.label || sf.folder_key
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
        Provide a client CFF (Merton-style format). We'll parse the line items
        and per-month distribution, then render a fresh CFF in BuildCore's
        template with the same numbers.
      </div>

      {/* Source mode toggle */}
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 6, color: 'var(--text2)' }}>
          Source
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={() => setSourceMode('upload')}
            style={{
              padding: '6px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
              border: '0.5px solid var(--border)',
              background: sourceMode === 'upload' ? 'var(--accent-soft)' : 'var(--surface2)',
              color: sourceMode === 'upload' ? 'var(--accent)' : 'var(--text2)',
              fontWeight: sourceMode === 'upload' ? 500 : 400,
            }}
          >
            Upload new file
          </button>
          <button
            type="button"
            onClick={() => setSourceMode('pick')}
            style={{
              padding: '6px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
              border: '0.5px solid var(--border)',
              background: sourceMode === 'pick' ? 'var(--accent-soft)' : 'var(--surface2)',
              color: sourceMode === 'pick' ? 'var(--accent)' : 'var(--text2)',
              fontWeight: sourceMode === 'pick' ? 500 : 400,
            }}
          >
            Pick from project files ({existingFiles.length})
          </button>
        </div>
      </div>

      {/* Source: upload */}
      {sourceMode === 'upload' && (
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 6, color: 'var(--text2)' }}>
            Client CFF file (.xlsx)
          </label>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={e => setFile(e.target.files?.[0] || null)}
            style={{ fontSize: 13 }}
          />
          {file && (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              Selected: {file.name} ({Math.round(file.size / 1024)} KB)
            </div>
          )}
        </div>
      )}

      {/* Source: pick existing */}
      {sourceMode === 'pick' && (
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 6, color: 'var(--text2)' }}>
            Existing CFF file (.xlsx)
          </label>
          {existingFiles.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text3)', padding: 8, border: '0.5px solid var(--border)', borderRadius: 4 }}>
              No xlsx files found in this project's cff subfolders. Upload one instead.
            </div>
          ) : (
            <select
              value={selectedExistingPath}
              onChange={e => setSelectedExistingPath(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', fontSize: 13, borderRadius: 4, border: '1px solid var(--border)' }}
            >
              <option value="">— select a file —</option>
              {existingFiles.map(f => (
                <option key={f.id} value={f.storage_path}>
                  {subLabelMap[f.subfolder_key] || f.subfolder_key} / {f.file_name}
                </option>
              ))}
            </select>
          )}
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            Lists xlsx files from cff, cff-archive, and any per-building cff-sub-* subfolders.
          </div>
        </div>
      )}

      {/* Destination */}
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 6, color: 'var(--text2)' }}>
          Save to subfolder
        </label>
        <select
          value={destSubfolder}
          onChange={e => setDestSubfolder(e.target.value)}
          style={{ width: '100%', padding: '6px 8px', fontSize: 13, borderRadius: 4, border: '1px solid var(--border)' }}
        >
          <option value={DEFAULT_CFF_SUBFOLDER}>cff (default)</option>
          {cffSubfolders.map(sf => (
            <option key={sf.folder_key} value={sf.folder_key}>
              {sf.label || sf.folder_key}
            </option>
          ))}
        </select>
        {cffSubfolders.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            Single-building project — saves to the project's cff subfolder.
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            Multi-building — pick which building's cff subfolder to save into.
          </div>
        )}
      </div>

      {/* Retention / release inputs */}
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 6, color: 'var(--text2)' }}>
            Retention %
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={retentionPctInput}
            onChange={e => setRetentionPctInput(e.target.value)}
            style={{ width: '100%', padding: '6px 8px', fontSize: 13, borderRadius: 4, border: '1px solid var(--border)' }}
          />
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            Deducted from each PA. Default {DEFAULT_RETENTION_PCT}% (Merton).
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 6, color: 'var(--text2)' }}>
            Release at PC %
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={releasePctInput}
            onChange={e => setReleasePctInput(e.target.value)}
            style={{ width: '100%', padding: '6px 8px', fontSize: 13, borderRadius: 4, border: '1px solid var(--border)' }}
          />
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            Released at Practical Completion. Default {DEFAULT_RELEASE_PCT}% (Merton).
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — parsed preview
// ─────────────────────────────────────────────────────────────────────────────
function Step2Preview({ parsed, sourceLabel, destSubfolder, cffSubfolders, retentionPctInput, releasePctInput }) {
  const sectionMap = {}
  for (const item of parsed.line_items) {
    if (!sectionMap[item.section]) sectionMap[item.section] = { count: 0, total: 0 }
    sectionMap[item.section].count++
    sectionMap[item.section].total += item.value
  }
  const sectionEntries = Object.entries(sectionMap).sort((a, b) => a[0].localeCompare(b[0]))

  const fmt = n => `£${Math.round(n).toLocaleString()}`

  const destLabel = destSubfolder === DEFAULT_CFF_SUBFOLDER
    ? 'cff (default)'
    : (cffSubfolders.find(s => s.folder_key === destSubfolder)?.label || destSubfolder)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 13, color: 'var(--text2)' }}>
        <strong>{sourceLabel}</strong> — {parsed.line_items.length} line items, {parsed.num_months} months, {fmt(parsed.contract_sum)}
      </div>

      {/* Reconciliation banner — sum of line items vs stated contract sum */}
      {parsed.reconciles ? (
        <div style={{
          padding: 10,
          background: 'rgba(15, 110, 86, 0.08)',
          border: '0.5px solid rgba(15, 110, 86, 0.3)',
          borderRadius: 6,
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{ color: '#0F6E56', fontSize: 14, lineHeight: 1 }}>✓</span>
          <span style={{ color: 'var(--text2)' }}>
            Line items sum to the stated contract total ({fmt(parsed.contract_sum)}).
          </span>
        </div>
      ) : (
        <div style={{
          padding: 10,
          background: 'rgba(186, 117, 23, 0.10)',
          border: '0.5px solid rgba(186, 117, 23, 0.4)',
          borderRadius: 6,
          fontSize: 12,
          color: 'var(--text2)',
        }}>
          <strong style={{ color: '#854F0B' }}>⚠ Reconciliation warning</strong> — line items sum to {fmt(parsed.line_sum)} but the file states {fmt(parsed.contract_sum)} as the total. Generated CFF will use the line item sum.
        </div>
      )}

      <div style={{ fontSize: 12, color: 'var(--text2)' }}>
        Section breakdown:
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--surface2)' }}>
              <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>Section</th>
              <th style={{ textAlign: 'right', padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>Items</th>
              <th style={{ textAlign: 'right', padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {sectionEntries.map(([section, data]) => (
              <tr key={section}>
                <td style={{ padding: '4px 10px', borderBottom: '0.5px solid var(--border)' }}>{section}</td>
                <td style={{ padding: '4px 10px', borderBottom: '0.5px solid var(--border)', textAlign: 'right' }}>{data.count}</td>
                <td style={{ padding: '4px 10px', borderBottom: '0.5px solid var(--border)', textAlign: 'right' }}>{fmt(data.total)}</td>
              </tr>
            ))}
            <tr style={{ background: 'var(--surface2)', fontWeight: 500 }}>
              <td style={{ padding: '6px 10px' }}>Total</td>
              <td style={{ padding: '6px 10px', textAlign: 'right' }}>{parsed.line_items.length}</td>
              <td style={{ padding: '6px 10px', textAlign: 'right' }}>{fmt(parsed.line_sum)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text3)' }}>
        Will save to: <strong>{destLabel}</strong> · Retention: <strong>{retentionPctInput || '3'}%</strong> · Release at PC: <strong>{releasePctInput || '1.5'}%</strong>
      </div>
    </div>
  )
}
