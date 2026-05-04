import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Modal, Field, Spinner } from './ui'
import { extractCsa } from '../lib/csaExtractor'
import { generateCff } from '../lib/cffGenerator'
import { fetchAllProjectPas, extractRetentionFromPa } from '../lib/paGroupExtractor'
import {
  CURVE_TYPES,
  CURVE_LABELS,
  CURVE_DESCRIPTIONS,
  distributeGroups,
  distributeValue,
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
// Props:
//   projectId         — required, the project to generate against
//   projectName       — display name (used in title)
//   onClose           — modal close callback
//   onGenerated       — fired after successful upload + project_doc_files row write
//   scopedToBuilding  — optional Building object (from src/lib/buildings.js).
//                       When set, the modal is scoped to ONE sub-building of a
//                       multi-building project (Merton-style). Effects:
//                         1. CSA picker only lists files inside that building's
//                            CSA subfolder, not the master CSA folder
//                         2. PA actuals + retention auto-detect read from that
//                            building's PA subfolder, not project-wide
//                         3. Generated CFF uploads to that building's CFF
//                            subfolder, not the master 'cff' subfolder
//                         4. Modal title shows the building name
//                       When null (default), behaves as the existing single-
//                       building modal — picks from master csa/, uploads to
//                       master cff/, reads project-wide PAs.
export default function CffGeneratorModal({
  projectId,
  projectName,
  onClose,
  onGenerated,
  scopedToBuilding = null,
}) {
  // ─── Effective scope (multi-building support) ──────────────────────────
  // When scopedToBuilding is set, all reads/writes route through that
  // building's per-building subfolders instead of the project-wide csa/cff
  // template subfolders. We compute these once at the top so every query
  // below uses the same scope without re-checking everywhere.
  //
  // Single-building (scopedToBuilding=null):
  //   csaFolderKey = '00-project-information', csaSubfolderKey = 'csa'
  //   cffFolderKey = '00-project-information', cffSubfolderKey = 'cff'
  //   paFolderKey  = '02-payment-application', paSubfolderKey  = null (root)
  //
  // Multi-building (e.g. Merton's Sports Hall):
  //   csaSubfolderKey = '<building's csa subfolder key>'
  //   cffSubfolderKey = '<building's cff subfolder key>'
  //   paSubfolderKey  = '<building's pa subfolder key>'
  //   (folderKey stays the same — scoping happens at subfolder level)
  const csaSubfolderKey = scopedToBuilding?.subfolders?.csa || CSA_SUBFOLDER
  const cffSubfolderKey = scopedToBuilding?.subfolders?.cff || CFF_SUBFOLDER
  const paSubfolderKey = scopedToBuilding?.subfolders?.pa || null

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
  // Retention configuration. Drives the "Less Retention R%" / "Plus Retention
  // Release (R-1.5)% (at PC)" rows in the generated CFF. Auto-detected from
  // the latest PA's footer when one exists; defaults to 3 otherwise. Always
  // user-editable — surveyor may know the contract retention before any PA
  // has been issued, and may override even when auto-detect succeeds.
  const [retentionPct, setRetentionPct] = useState(3)
  // 'default'    = no PA / not yet determined, sitting on the 3% default
  // 'pa'         = pulled cleanly from latest PA's footer
  // 'pa-failed'  = latest PA had a "retention" row but the % couldn't be parsed
  // 'user'       = user has typed in this field, ignore further auto-detect
  const [retentionSource, setRetentionSource] = useState('default')
  const [retentionRawLabel, setRetentionRawLabel] = useState('')   // for the "Detected from PA03" hint
  const [rowCurves, setRowCurves] = useState({})       // { [groupId]: 'even' | 'front' | ... }
  // Manual per-row overrides — when present, replaces the curve-derived
  // distribution for that row. Editing a cell switches the row into manual
  // mode; "Reset to curve" clears it back to auto. Persists across step
  // navigation so user doesn't lose edits when going back to Step 1.
  const [manualOverrides, setManualOverrides] = useState({})  // { [groupId]: number[] }

  // Past-month actuals — three modes, mutually exclusive:
  //   'none'   = no actuals overlay (pure curve forecast)
  //   'pa'     = use parsed PA files (per-row precise)
  //   'manual' = use user-typed monthly amounts (proportional per-row split)
  // The user picks the mode in Step 1. Manual entries persist across step
  // navigation. Switching modes preserves any data entered in the other
  // mode so the user can flip-flop without losing work.
  const [paList, setPaList] = useState([])              // result of fetchAllProjectPas
  const [paLoadError, setPaLoadError] = useState('')
  const [actualsMode, setActualsMode] = useState('none') // 'none' | 'pa' | 'manual'
  // Manual entries: array of { label, amount } in chronological order.
  // Each entry corresponds to one past month.
  const [manualActuals, setManualActuals] = useState([]) // [{ label: 'PA01', amount: 345216.59 }, ...]

  // Computed: number of months
  const numMonths = useMemo(() => {
    if (numMonthsOverride && /^\d+$/.test(numMonthsOverride)) {
      const n = parseInt(numMonthsOverride, 10)
      if (n >= 1 && n <= 60) return n
    }
    return monthsBetween(startDate, endDate)
  }, [startDate, endDate, numMonthsOverride])

  // Live distribution preview. For each row we either use the curve-derived
  // distribution OR PA-derived values for past months OR user manual override.
  // Precedence: manual override > PA-aware > pure curve.
  const preview = useMemo(() => {
    if (!csaExtract || !numMonths) return null
    const groupsWithCurves = csaExtract.groups.map(g => ({
      ...g,
      curve: rowCurves[g.id] || defaultCurve,
    }))
    const auto = distributeGroups(groupsWithCurves, numMonths, defaultCurve)

    // Past-month overlay — three modes (mutually exclusive):
    //   • 'pa'     → use PA file actuals, per-row precise
    //   • 'manual' → use user-typed monthly amounts, proportional per-row split
    //   • 'none'   → no overlay, pure curve forecast
    let actualsMonthCount = 0
    let actualsRows = auto.rows

    if (actualsMode === 'pa' && paList.length > 0) {
      actualsMonthCount = Math.min(paList.length, numMonths)
      actualsRows = auto.rows.map(r => {
        if (actualsMonthCount === 0) return r
        const csaGroup = csaExtract.groups.find(g => g.id === r.id)
        if (!csaGroup || !csaGroup.group_key) return r
        const cumulatives = paList.slice(0, actualsMonthCount).map(p =>
          (p.cumulative_by_group && p.cumulative_by_group[csaGroup.group_key]) || 0
        )
        const pastMonthly = []
        let prev = 0
        for (const cum of cumulatives) {
          pastMonthly.push(Math.max(0, cum - prev))
          prev = cum
        }
        const remaining = Math.max(0, csaGroup.value - prev)
        const futureMonths = numMonths - actualsMonthCount
        const futureMonthly = futureMonths > 0
          ? distributeValue(remaining, futureMonths, r.curve)
          : []
        return { ...r, monthly: [...pastMonthly, ...futureMonthly], pa_aware: true }
      })
    } else if (actualsMode === 'manual' && manualActuals.length > 0) {
      // Filter out blank/invalid entries
      const validEntries = manualActuals.filter(e =>
        Number.isFinite(e.amount) && e.amount > 0
      )
      actualsMonthCount = Math.min(validEntries.length, numMonths)
      if (actualsMonthCount > 0) {
        const totalContract = csaExtract.body_total || csaExtract.contract_sum || 0
        actualsRows = auto.rows.map(r => {
          const csaGroup = csaExtract.groups.find(g => g.id === r.id)
          if (!csaGroup || totalContract === 0) return r
          // Proportional past months: each month's amount × (g.value / totalContract)
          const ratio = csaGroup.value / totalContract
          const pastMonthly = validEntries.slice(0, actualsMonthCount).map(e =>
            Math.round(e.amount * ratio * 100) / 100
          )
          const pastSum = pastMonthly.reduce((s, v) => s + v, 0)
          const remaining = Math.max(0, csaGroup.value - pastSum)
          const futureMonths = numMonths - actualsMonthCount
          const futureMonthly = futureMonths > 0
            ? distributeValue(remaining, futureMonths, r.curve)
            : []
          return { ...r, monthly: [...pastMonthly, ...futureMonthly], pa_aware: true }
        })
      }
    }

    // Per-cell manual overrides (Phase 3a) win over EVERYTHING above
    const rows = actualsRows.map(r => {
      const manual = manualOverrides[r.id]
      if (Array.isArray(manual) && manual.length === numMonths) {
        return { ...r, monthly: manual.slice(), is_manual: true, pa_aware: false }
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
    return { rows, totals, cumulative, paMonthCount: actualsMonthCount, actualsMode }
  }, [csaExtract, numMonths, rowCurves, defaultCurve, manualOverrides, paList, actualsMode, manualActuals])

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
        const [csaRes, projectRes, paResult, latestPaForRetention] = await Promise.all([
          // CSA file list — scoped to the building's CSA subfolder when in
          // building-scope mode, master csa subfolder otherwise. csaSubfolderKey
          // is computed at component mount (top of function).
          supabase
            .from('project_doc_files')
            .select('id, file_name, storage_path, created_at')
            .eq('project_id', projectId)
            .eq('folder_key', PRIMARY_FOLDER)
            .eq('subfolder_key', csaSubfolderKey)
            .order('created_at', { ascending: false }),
          supabase
            .from('projects')
            .select('start_date, end_date')
            .eq('id', projectId)
            .maybeSingle(),
          // PA-aware regenerate: fetch + parse the PAs at this scope. For
          // single-building projects that's root-level PAs (paSubfolderKey =
          // null). For per-building modal scope it's the building's own PA
          // subfolder. If parsing any one PA fails, that PA is dropped from
          // the list and a warning is shown — the rest still apply.
          fetchAllProjectPas(supabase, projectId, paSubfolderKey).catch(err => {
            console.warn('PA pre-fetch failed:', err)
            return []
          }),
          // Retention auto-detect: download the latest PA at this scope and
          // parse its "Less Retention N%" footer row. Single-building reads
          // root-level PAs; building-scoped reads that building's PAs.
          //
          // Multi-building fallback: if the building has no PAs of its own
          // yet (e.g. user is generating Changing Rooms CFF before issuing
          // PA01 for Changing Rooms), fall back to ANY PA in the project.
          // Retention is a project-level decision in practice, so reading
          // it from a sibling building's PA is correct.
          (async () => {
            try {
              // Helper: try one query, return latest row or null
              async function tryFetchLatest(scopeFilter) {
                let q = supabase
                  .from('project_doc_files')
                  .select('storage_path, file_name')
                  .eq('project_id', projectId)
                  .eq('folder_key', '02-payment-application')
                  .like('file_name', '%.xlsx')
                  .order('created_at', { ascending: false })
                  .limit(1)
                q = scopeFilter(q)
                const { data, error } = await q.maybeSingle()
                if (error) return null
                return data
              }
              // 1st preference: this scope's own PAs.
              let latest = paSubfolderKey == null
                ? await tryFetchLatest(q => q.is('subfolder_key', null))
                : await tryFetchLatest(q => q.eq('subfolder_key', paSubfolderKey))
              // Fallback (building-scoped only): any PA in the project.
              // Skip the fallback for single-building case — there's no
              // sibling scope to fall back to.
              if (!latest && paSubfolderKey != null) {
                latest = await tryFetchLatest(q => q)   // no scope filter at all
              }
              if (!latest) return null
              const { data: signed } = await supabase
                .storage
                .from('project-docs')
                .createSignedUrl(latest.storage_path, 600)
              if (!signed?.signedUrl) return null
              const res = await fetch(signed.signedUrl)
              if (!res.ok) return null
              const blob = await res.blob()
              const ret = await extractRetentionFromPa(blob)
              return { ...ret, file_name: latest.file_name }
            } catch (err) {
              console.warn('Retention pre-fetch failed:', err)
              return null
            }
          })(),
        ])

        if (cancelled) return

        if (csaRes.error) console.warn('CSA list query error:', csaRes.error)
        const xlsxFiles = (csaRes.data || []).filter(f =>
          /\.xlsx$/i.test(f.file_name)
        )
        setCsaFiles(xlsxFiles)
        if (xlsxFiles.length > 0) {
          setSelectedCsaPath(xlsxFiles[0].storage_path)
        }

        if (projectRes.data) {
          if (projectRes.data.start_date) setStartDate(prev => prev || projectRes.data.start_date)
          if (projectRes.data.end_date) setEndDate(prev => prev || projectRes.data.end_date)
        }

        // Map PA list into the shape the generator expects.
        // Each PA's groups dict goes from { [key]: { cumulative, ... } }
        // to a flat { [key]: number } for the generator + preview.
        const flatPaList = (paResult || []).map(p => ({
          pa_label: p.pa_label,
          file_name: p.file_name,
          created_at: p.created_at,
          total_cumulative: p.total_cumulative,
          cumulative_by_group: Object.fromEntries(
            Object.entries(p.groups || {}).map(([k, v]) => [k, v.cumulative])
          ),
        }))
        setPaList(flatPaList)
        // Default mode: if PA files are found and parsed cleanly, default
        // to 'pa' mode. Otherwise stay 'none' (pure forecast). User can
        // flip to 'manual' at any time in Step 1.
        if (flatPaList.length > 0) {
          setActualsMode('pa')
        }

        // Apply retention auto-detect from latest PA, but only if the user
        // hasn't already typed in the field. setRetentionSource is read via
        // its current state in the setter to avoid a stale closure on the
        // initial 'default' value.
        setRetentionSource(prevSource => {
          if (prevSource === 'user') return prevSource
          if (!latestPaForRetention) return 'default'
          if (latestPaForRetention.status === 'ok' &&
              Number.isFinite(latestPaForRetention.retention_pct)) {
            setRetentionPct(latestPaForRetention.retention_pct)
            setRetentionRawLabel(latestPaForRetention.file_name || '')
            return 'pa'
          }
          if (latestPaForRetention.status === 'unparseable') {
            setRetentionRawLabel(latestPaForRetention.raw_label || '')
            return 'pa-failed'
          }
          // status: 'not_found' — file existed but no retention row visible.
          // Stay on default; no warning.
          return 'default'
        })
      } catch (err) {
        if (!cancelled) {
          console.warn('Failed to load modal initial data', err)
          setPaLoadError(err.message || 'Could not load payment applications')
        }
      } finally {
        if (!cancelled) setLoadingCsaList(false)
      }
    }
    loadInitialData()
    return () => {
      cancelled = true
    }
    // csaSubfolderKey + paSubfolderKey are derived from scopedToBuilding so
    // they implicitly capture that prop. Listing them explicitly keeps
    // exhaustive-deps lint happy without forcing the consumer to memoise.
  }, [projectId, csaSubfolderKey, paSubfolderKey])

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
      // Build the paList shape that generateCff expects, depending on the
      // active actualsMode. For 'manual' we synthesize a paList where each
      // entry's cumulative_by_group is the running sum of proportional
      // splits — this lets the generator's existing PA-aware logic handle
      // both modes uniformly.
      let paActuals = null
      if (actualsMode === 'pa' && paList.length > 0) {
        paActuals = { paList }
      } else if (actualsMode === 'manual' && manualActuals.length > 0) {
        const validEntries = manualActuals.filter(e =>
          Number.isFinite(e.amount) && e.amount > 0
        )
        if (validEntries.length > 0) {
          const totalContract = csaExtract.body_total || csaExtract.contract_sum || 0
          // Build per-PA cumulative_by_group dicts: each "PA" sees a running
          // total split proportionally by row contract. So for entry index i,
          // cumulative for group K = sum(entry[0..i].amount) × (K.value / total)
          let runningTotal = 0
          const synthList = validEntries.map(entry => {
            runningTotal += entry.amount
            const cumulative_by_group = {}
            for (const g of csaExtract.groups) {
              if (!g.group_key || totalContract === 0) continue
              cumulative_by_group[g.group_key] = runningTotal * (g.value / totalContract)
            }
            return {
              pa_label: entry.label || 'Manual',
              total_cumulative: runningTotal,
              cumulative_by_group,
            }
          })
          paActuals = { paList: synthList }
        }
      }

      const result = await generateCff(csaExtract, {
        project_name: projectName || csaExtract.project_name,
        start_date: startDate,
        end_date: endDate,
        num_months: numMonths,
        csa_no: csaExtract.csa_no,
        row_curves: rowCurves,
        default_curve: defaultCurve,
        row_manual: manualOverrides,
        pa_actuals: paActuals,
        retention_pct: retentionPct,
      })

      // Upload to project-docs bucket — match the CRM upload convention:
      //   projects/<projectId>/<folderKey>/<subfolderKey>/<ts>-<filename>
      // The timestamp prefix means a re-generate creates a new file rather
      // than overwriting the previous one in storage. We delete any existing
      // CFF rows for this subfolder afterwards so the file list shows only
      // the latest one (matches the publish-PR-to-folder flow used elsewhere).
      //
      // Archive subfolder key: for the master CFF folder we use the global
      // CFF_ARCHIVE_SUBFOLDER ('cff-archive'). For per-building CFFs we
      // synthesise a per-building archive key by suffixing the building's
      // CFF subfolder key. Both are synthetic — no folder definition exists
      // in project_doc_folders for either — so they never appear in the file
      // browser, only the portal's diff query reads them.
      const archiveSubfolderKey = cffSubfolderKey === CFF_SUBFOLDER
        ? CFF_ARCHIVE_SUBFOLDER
        : `${cffSubfolderKey}-archive`

      const ts = Date.now()
      const storagePath = `projects/${projectId}/${PRIMARY_FOLDER}/${cffSubfolderKey}/${ts}-${result.filename}`
      const { error: uploadErr } = await supabase
        .storage
        .from('project-docs')
        .upload(storagePath, result.blob, {
          upsert: false, // never overwrite — timestamp guarantees uniqueness
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
      if (uploadErr) throw uploadErr

      // Find existing CFF rows (current + any pre-existing archive) — scoped
      // to this building's subfolder pair, NOT the master cff/cff-archive.
      // Cross-building "current" CFFs from siblings are left alone.
      const { data: existing } = await supabase
        .from('project_doc_files')
        .select('id, storage_path, subfolder_key')
        .eq('project_id', projectId)
        .eq('folder_key', PRIMARY_FOLDER)
        .in('subfolder_key', [cffSubfolderKey, archiveSubfolderKey])

      // Insert the new row using the standard column set (matches every
      // other place in the codebase that writes to project_doc_files).
      const { error: insertErr } = await supabase
        .from('project_doc_files')
        .insert({
          project_id: projectId,
          folder_key: PRIMARY_FOLDER,
          subfolder_key: cffSubfolderKey,
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
        r.subfolder_key === cffSubfolderKey && r.storage_path !== storagePath
      )
      const previousArchive = (existing || []).filter(r =>
        r.subfolder_key === archiveSubfolderKey
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
          .update({ subfolder_key: archiveSubfolderKey })
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
  // Building suffix appears on every step's title when the modal is scoped
  // to a specific sub-building (Merton-style multi-building project).
  const buildingSuffix = scopedToBuilding?.name ? ` — ${scopedToBuilding.name}` : ''
  const title =
    step === 1
      ? `Generate Cashflow Forecast${buildingSuffix} — Source & Programme`
      : step === 2
      ? `Generate Cashflow Forecast${buildingSuffix} — Curves & Preview`
      : `Generating Cashflow Forecast${buildingSuffix}…`

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
          paList={paList}
          paLoadError={paLoadError}
          actualsMode={actualsMode}
          setActualsMode={setActualsMode}
          manualActuals={manualActuals}
          setManualActuals={setManualActuals}
          retentionPct={retentionPct}
          setRetentionPct={setRetentionPct}
          retentionSource={retentionSource}
          setRetentionSource={setRetentionSource}
          retentionRawLabel={retentionRawLabel}
          csaSubfolderKey={csaSubfolderKey}
          scopedToBuilding={scopedToBuilding}
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
          paList={paList}
          actualsMode={actualsMode}
          manualActuals={manualActuals}
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
  paList, paLoadError,
  actualsMode, setActualsMode,
  manualActuals, setManualActuals,
  retentionPct, setRetentionPct,
  retentionSource, setRetentionSource,
  retentionRawLabel,
  csaSubfolderKey,         // 'csa' for master, building's csa key when scoped
  scopedToBuilding,        // null for master, Building object when scoped
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
              {scopedToBuilding ? (
                <>No CSA files found in <code>{scopedToBuilding.label}</code>.
                Upload one below to continue.</>
              ) : (
                <>No CSA files found in <code>{PRIMARY_FOLDER} / {csaSubfolderKey}</code>.
                Upload one below to continue.</>
              )}
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

      {/* Retention. Auto-detected from latest PA when one exists; defaults to
          3% otherwise. Always editable — surveyor may override even when the
          PA value is correct (e.g. they're regenerating before issuing PA01
          on a renegotiated contract). The release at PC is always (R-1.5)%
          so we surface that as a calculated hint underneath. */}
      <Field label="Retention %">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="number"
            min="0"
            max="20"
            step="0.5"
            value={retentionPct}
            onChange={e => {
              const v = e.target.value
              // Allow blank while typing; clamp on commit.
              if (v === '') { setRetentionPct(0); setRetentionSource('user'); return }
              const n = parseFloat(v)
              if (Number.isFinite(n)) {
                setRetentionPct(Math.max(0, Math.min(20, n)))
                setRetentionSource('user')
              }
            }}
            style={{ width: 110 }}
          />
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            Release at PC: <strong>{Math.max(0, retentionPct - 1.5).toFixed(1).replace(/\.0$/, '')}%</strong>
            &nbsp;· Held through defects: <strong>1.5%</strong>
          </div>
        </div>
        <div style={{ fontSize: 11, marginTop: 4, color: retentionSource === 'pa-failed' ? '#b87a00' : 'var(--text3)' }}>
          {retentionSource === 'pa' && (
            <>Detected from latest PA{retentionRawLabel ? ` (${retentionRawLabel})` : ''}. Edit if your contract differs.</>
          )}
          {retentionSource === 'pa-failed' && (
            <>⚠ Couldn't read retention % from the latest PA — please confirm the value above before generating.</>
          )}
          {retentionSource === 'default' && (
            <>Default 3%. Edit if your contract specifies a different rate.</>
          )}
          {retentionSource === 'user' && (
            <>Set manually.</>
          )}
        </div>
      </Field>

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

      {/* Past-month actuals — three modes, mutually exclusive.
          Inline radio rows: radio + label + (optional right-aligned metadata).
          Simple list pattern, no flex tricks needed for layout. */}
      <Field label="Past-month actuals (optional)">
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>
          Override past-month forecasts with real claimed amounts. Future months redistribute remaining contract via the curve below.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <ActualsRadioRow
            mode="none"
            currentMode={actualsMode}
            setMode={setActualsMode}
            label="Forecast only"
          />
          <ActualsRadioRow
            mode="pa"
            currentMode={actualsMode}
            setMode={setActualsMode}
            label={
              paList.length > 0
                ? `From uploaded PAs (${paList.length} found)`
                : 'From uploaded PAs (none found)'
            }
            metadata={paList.length > 0
              ? paList.map(p => `${p.pa_label} £${Math.round(p.total_cumulative).toLocaleString()}`).join(' · ')
              : null}
            disabled={paList.length === 0}
          />
          <ActualsRadioRow
            mode="manual"
            currentMode={actualsMode}
            setMode={setActualsMode}
            label="Enter applied amounts manually"
          />
        </div>

        {/* Manual entry editor — only when mode === 'manual' */}
        {actualsMode === 'manual' && (
          <ManualActualsEditor
            entries={manualActuals}
            setEntries={setManualActuals}
            maxMonths={numMonths}
          />
        )}
      </Field>
      {paLoadError && (
        <div style={{ fontSize: 12, color: '#dc2626' }}>
          Could not load payment applications: {paLoadError}
        </div>
      )}

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
                style={{
                  // Override CRM's global input{width:100%;padding;border} rule
                  // — radios should render as small circles, not full-width pills.
                  appearance: 'auto',
                  width: 'auto',
                  padding: 0,
                  margin: 0,
                  marginRight: 6,
                  border: 'none',
                  background: 'transparent',
                }}
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
  paList, actualsMode, manualActuals,
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
  const paMonthCount = preview.paMonthCount || 0

  // Label for a past-actuals month — handles both PA mode (PA01/PA02 from
  // file labels) and manual mode (user-typed labels).
  function labelForPastMonth(i) {
    if (actualsMode === 'pa') return paList[i]?.pa_label || ''
    if (actualsMode === 'manual') return manualActuals[i]?.label || ''
    return ''
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 13, color: 'var(--text2)' }}>
        <strong>{csaExtract.project_name || 'Project'}</strong>{' '}
        — Contract sum {fmtMoney(csaExtract.contract_sum)} —{' '}
        {csaExtract.groups.length} CFF row{csaExtract.groups.length === 1 ? '' : 's'} × {numMonths} month{numMonths === 1 ? '' : 's'}
        {totalManual > 0 && (
          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text3)' }}>
            · {totalManual} row{totalManual === 1 ? '' : 's'} manually edited
          </span>
        )}
      </div>

      {/* Past-actuals banner — different copy depending on mode */}
      {paMonthCount > 0 && actualsMode === 'pa' && (
        <div style={{
          padding: 10,
          background: 'rgba(80, 102, 188, 0.08)',
          border: '0.5px solid rgba(80, 102, 188, 0.3)',
          borderRadius: 6,
          fontSize: 12,
        }}>
          <strong>Months 1{paMonthCount > 1 ? `–${paMonthCount}` : ''}</strong> use cumulative figures from{' '}
          {paList.slice(0, paMonthCount).map(p => p.pa_label).join(', ')}.
          Remaining months redistribute leftover contract value via the chosen curve.
        </div>
      )}
      {paMonthCount > 0 && actualsMode === 'manual' && (
        <div style={{
          padding: 10,
          background: 'rgba(80, 102, 188, 0.08)',
          border: '0.5px solid rgba(80, 102, 188, 0.3)',
          borderRadius: 6,
          fontSize: 12,
        }}>
          <strong>Months 1{paMonthCount > 1 ? `–${paMonthCount}` : ''}</strong> use manually-entered amounts:{' '}
          {manualActuals.slice(0, paMonthCount).map((e, i) =>
            `${e.label || 'Manual'}: £${Math.round(e.amount).toLocaleString()}`
          ).join(' · ')}.
          Per-row split is proportional by contract value (indicative — not actual progress).
          Remaining months redistribute leftover via the chosen curve.
        </div>
      )}

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
              {monthLabelsArr.map((lbl, i) => (
                <th key={lbl} style={{
                  ...th('right', 90),
                  background: i < paMonthCount ? 'rgba(80, 102, 188, 0.15)' : undefined,
                }}>
                  {lbl}
                  {i < paMonthCount && <div style={{ fontSize: 9, fontWeight: 400, color: 'var(--text3)' }}>{labelForPastMonth(i)}</div>}
                </th>
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
                  {distRow.monthly.map((v, i) => {
                    const isPaCell = i < paMonthCount && distRow.pa_aware
                    return (
                      <td key={i} style={{
                        ...td('right'),
                        padding: '2px 4px',
                        background: isPaCell ? 'rgba(80, 102, 188, 0.06)' : undefined,
                      }}>
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
                          title={isPaCell ? `From ${labelForPastMonth(i)} — edit to override` : undefined}
                        />
                      </td>
                    )
                  })}
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

      {(() => {
        const gap = cumulativeAtFinal - csaExtract.contract_sum
        const variationsSum = csaExtract.variations_sum || 0
        const expectedGap = -variationsSum   // body total = contract − variations
        // Tolerance: 1p
        const explainedByVariations = variationsSum > 0 && Math.abs(gap - expectedGap) <= 1
        const hasUnexplainedGap = Math.abs(gap) > 1 && !explainedByVariations
        return (
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>
            Total forecast: <strong>{fmtMoney(cumulativeAtFinal)}</strong>{' '}
            of contract {fmtMoney(csaExtract.contract_sum)}
            {explainedByVariations && (
              <span style={{ color: 'var(--text3)' }}>
                {' '}(excludes {fmtMoney(variationsSum)} in variations — these are not distributed in the CFF body)
              </span>
            )}
            {hasUnexplainedGap && (
              <span style={{ color: '#dc2626' }}>
                {' '}— mismatch of {fmtMoney(Math.abs(gap))}{gap > 0 ? ' over' : ' under'} contract.
                Generation will proceed but the CFF total will differ.
              </span>
            )}
          </div>
        )
      })()}
    </div>
  )
}

// ─── Step 1 helper: single-line radio row ────────────────────────────────
// Plain horizontal row: radio + label + (optional right-aligned metadata).
// No flex grow on the label — long metadata wraps below the label rather
// than stealing space. Avoids the layout problems the earlier card
// approach had.
function ActualsRadioRow({ mode, currentMode, setMode, label, metadata, disabled }) {
  const selected = currentMode === mode
  return (
    <label style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 8px',
      borderRadius: 4,
      background: selected ? 'rgba(80, 102, 188, 0.10)' : 'transparent',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.55 : 1,
      flexWrap: 'wrap',
    }}>
      <input
        type="radio"
        name="actualsMode"
        checked={selected}
        disabled={disabled}
        onChange={() => !disabled && setMode(mode)}
        style={{
          // The CRM has a global `input { width: 100%; padding: 10px 12px; ... }`
          // rule that doesn't filter by type. Without these overrides the radio
          // would render as a wide pill, not a small circle. Restore native
          // radio rendering.
          appearance: 'auto',
          width: 'auto',
          padding: 0,
          margin: 0,
          border: 'none',
          background: 'transparent',
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 13 }}>{label}</span>
      {metadata && (
        <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 'auto' }}>
          {metadata}
        </span>
      )}
    </label>
  )
}

// ─── Step 1 helper: manual past-month amounts editor ──────────────────────
// Lets the user add/remove rows of { label, amount }. The label defaults to
// PA01, PA02, ... but is editable. The amount is the project-total for that
// month — proportionally split across rows in the generator.
function ManualActualsEditor({ entries, setEntries, maxMonths }) {
  function addEntry() {
    if (entries.length >= maxMonths) return    // can't have more entries than CFF months
    const nextLabel = `PA${String(entries.length + 1).padStart(2, '0')}`
    setEntries(prev => [...prev, { label: nextLabel, amount: 0 }])
  }
  function removeEntry(idx) {
    setEntries(prev => prev.filter((_, i) => i !== idx))
  }
  function updateEntry(idx, field, value) {
    setEntries(prev => prev.map((e, i) =>
      i === idx ? { ...e, [field]: value } : e
    ))
  }
  function parseAmount(rawValue) {
    const cleaned = String(rawValue).replace(/[£,\s]/g, '')
    const v = cleaned === '' ? 0 : Number(cleaned)
    return Number.isFinite(v) ? v : 0
  }

  return (
    <div style={{
      marginTop: 10,
      padding: 10,
      border: '0.5px solid var(--border)',
      borderRadius: 6,
      background: 'var(--surface2)',
    }}>
      {entries.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
          No entries yet. Each entry will fill one past month in order.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {entries.map((entry, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text3)', width: 28, textAlign: 'right' }}>
                M{idx + 1}
              </span>
              <input
                type="text"
                value={entry.label}
                onChange={e => updateEntry(idx, 'label', e.target.value)}
                placeholder="PA01"
                style={{
                  width: 80,
                  padding: '4px 8px',
                  fontSize: 12,
                  border: '0.5px solid var(--border)',
                  borderRadius: 4,
                  background: 'var(--surface)',
                }}
              />
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>£</span>
              <input
                type="text"
                inputMode="numeric"
                value={entry.amount === 0 ? '' : entry.amount.toLocaleString()}
                onChange={e => updateEntry(idx, 'amount', parseAmount(e.target.value))}
                placeholder="0.00"
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  fontSize: 12,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  border: '0.5px solid var(--border)',
                  borderRadius: 4,
                  background: 'var(--surface)',
                }}
              />
              <button
                onClick={() => removeEntry(idx)}
                style={{
                  padding: '4px 8px',
                  fontSize: 11,
                  border: '0.5px solid var(--border)',
                  borderRadius: 4,
                  background: 'transparent',
                  cursor: 'pointer',
                  color: 'var(--text3)',
                }}
                title="Remove this entry"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={addEntry}
        disabled={entries.length >= maxMonths}
        style={{
          padding: '6px 10px',
          fontSize: 12,
          border: '0.5px solid var(--border)',
          borderRadius: 4,
          background: 'transparent',
          cursor: entries.length >= maxMonths ? 'not-allowed' : 'pointer',
          opacity: entries.length >= maxMonths ? 0.5 : 1,
        }}
      >
        + Add applied amount
      </button>
      {entries.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>
          Total applied: £{entries.reduce((s, e) => s + (Number.isFinite(e.amount) ? e.amount : 0), 0).toLocaleString()}
        </div>
      )}
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
