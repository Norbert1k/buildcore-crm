import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Modal, Spinner } from './ui'
import { extractClientCff } from '../lib/clientCffExtractor'
import { generateCffFromClient } from '../lib/clientCffAdapter'

// ─────────────────────────────────────────────────────────────────────────────
// ClientCffConvertModal
//
// Lets the user upload a client-supplied CFF (Merton-style format), parses
// it, previews what will be generated, then renders a CFF in our template
// using the client's per-line monthly distribution and saves it to the
// project's chosen cff subfolder.
//
// Flow:
//   Step 1: pick file (file input) + pick destination cff subfolder
//   Step 2: show parsed summary (line count, contract sum, num months,
//           reconciliation status), Generate button
//   Step 3: generating spinner
//
// Multi-building: if the project has per-building cff-sub-* folders, they
// appear in the destination dropdown. Otherwise the global 'cff' subfolder
// is the only option (matches existing CFF Generator behaviour).
// ─────────────────────────────────────────────────────────────────────────────

const PRIMARY_FOLDER = '00-project-information'
const DEFAULT_CFF_SUBFOLDER = 'cff'
const ARCHIVE_SUBFOLDER = 'cff-archive'

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

  // Step 1 inputs
  const [file, setFile] = useState(null)
  const [destSubfolder, setDestSubfolder] = useState(DEFAULT_CFF_SUBFOLDER)
  const [cffSubfolders, setCffSubfolders] = useState([])

  // Project dates — passed in OR fetched here. Falls back to null which
  // makes the generator produce "Month N" labels instead of date ranges.
  const [startDate, setStartDate] = useState(projectStartDate || null)
  const [endDate, setEndDate] = useState(projectEndDate || null)

  // Step 2 state — parsed result
  const [parsed, setParsed] = useState(null)

  // Load available cff subfolders + project dates if not passed in.
  useEffect(() => {
    let cancelled = false
    async function loadInitial() {
      try {
        const [subRes, projRes] = await Promise.all([
          supabase
            .from('project_doc_folders')
            .select('folder_key, label, parent_key')
            .eq('project_id', projectId)
            .eq('parent_key', 'cff'),
          (projectStartDate && projectEndDate)
            ? Promise.resolve({ data: null })  // already have dates
            : supabase
                .from('projects')
                .select('start_date, end_date')
                .eq('id', projectId)
                .maybeSingle(),
        ])
        if (cancelled) return
        if (subRes.error) throw subRes.error
        setCffSubfolders(subRes.data || [])
        if (projRes.data) {
          if (projRes.data.start_date) setStartDate(projRes.data.start_date)
          if (projRes.data.end_date) setEndDate(projRes.data.end_date)
        }
      } catch (err) {
        console.warn('[ClientCffConvert] init load failed:', err)
      }
    }
    loadInitial()
    return () => { cancelled = true }
  }, [projectId, projectStartDate, projectEndDate])

  // Step 1 → Step 2: parse the uploaded file
  async function handleParse() {
    if (!file) {
      setError('Pick a client CFF file first')
      return
    }
    setError('')
    setBusy(true)
    try {
      const result = await extractClientCff(file)
      if (!result.line_items || result.line_items.length === 0) {
        throw new Error('No line items found in the uploaded file. Is this the correct format?')
      }
      setParsed(result)
      setStep(2)
    } catch (err) {
      console.warn('[ClientCffConvert] parse failed:', err)
      setError(err.message || 'Could not parse the uploaded file')
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
      const result = await generateCffFromClient(parsed, {
        project_name: projectName,
        start_date: startDate,
        end_date: endDate,
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

        // Insert new row first
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

        // Delete old archive
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
            .update({ subfolder_key: ARCHIVE_SUBFOLDER })
            .in('id', previousCurrent.map(r => r.id))
        }
      } else {
        // Per-building subfolder: just insert, no archive flow. The user
        // can manually delete old versions if they want.
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
        <button className="btn btn-primary" onClick={handleParse} disabled={busy || !file}>
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
          file={file} setFile={setFile}
          destSubfolder={destSubfolder} setDestSubfolder={setDestSubfolder}
          cffSubfolders={cffSubfolders}
        />
      )}
      {step === 2 && parsed && (
        <Step2Preview
          parsed={parsed}
          file={file}
          destSubfolder={destSubfolder}
          cffSubfolders={cffSubfolders}
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

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — file picker + destination subfolder selector
// ─────────────────────────────────────────────────────────────────────────────
function Step1Pick({ file, setFile, destSubfolder, setDestSubfolder, cffSubfolders }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
        Upload the client's CFF spreadsheet. We'll parse the line items and
        per-month distribution, then render a fresh CFF in BuildCore's
        template with the same numbers.
      </div>

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
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — parsed preview
// ─────────────────────────────────────────────────────────────────────────────
function Step2Preview({ parsed, file, destSubfolder, cffSubfolders }) {
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
        <strong>{file?.name}</strong> — {parsed.line_items.length} line items, {parsed.num_months} months, {fmt(parsed.contract_sum)}
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
        Will save to: <strong>{destLabel}</strong> · The new CFF replaces the current one in this subfolder; the previous version is archived.
      </div>
    </div>
  )
}
