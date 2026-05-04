import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Modal, Field, Spinner } from './ui'
import { extractCsa, groupKeyFor } from '../lib/csaExtractor'
import { generateCff } from '../lib/cffGenerator'
import { fetchAllProjectPas } from '../lib/paGroupExtractor'
import { resolveBuildings, findBuildingByCsaSubfolder } from '../lib/buildings'
import { extractClientCff } from '../lib/clientCffExtractor'
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
export default function CffGeneratorModal({
  projectId,
  projectName,
  onClose,
  onGenerated,
}) {
  const [step, setStep] = useState(1) // 1 = source & dates, 2 = curves & preview, 3 = generating
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Source mode — 'csa' (curves-based, original Generate CFF flow) or
  // 'client' (parse a client-supplied CFF and use its per-line monthly
  // distribution as the forecast). The shape of `csaExtract` is the same
  // either way (groups[] with values + group_keys), so most of the modal's
  // downstream logic doesn't care.
  const [sourceMode, setSourceMode] = useState('csa')

  // CSA source state (used when sourceMode = 'csa')
  const [csaFiles, setCsaFiles] = useState([])      // available CSA files in csa subfolder
  const [loadingCsaList, setLoadingCsaList] = useState(true)
  const [selectedCsaPath, setSelectedCsaPath] = useState('')
  const [uploadedCsaFile, setUploadedCsaFile] = useState(null)
  const [csaExtract, setCsaExtract] = useState(null)
  const [csaParseError, setCsaParseError] = useState('')

  // Client CFF source state (used when sourceMode = 'client'). Mirrors the
  // (now-deleted) ClientCffConvertModal — supports upload-from-disk and
  // pick-from-existing-project-files.
  const [clientCffSourceMode, setClientCffSourceMode] = useState('upload')  // 'upload' | 'pick'
  const [clientCffFile, setClientCffFile] = useState(null)
  const [clientCffExistingFiles, setClientCffExistingFiles] = useState([])
  const [clientCffSelectedPath, setClientCffSelectedPath] = useState('')
  // Holds the raw parsed client CFF (line items + monthly_pct + section).
  // Once parsed we transform it into the same csaExtract shape so the rest
  // of the flow (preview, PA overlay, generate) is identical to CSA mode.
  const [clientCffParsed, setClientCffParsed] = useState(null)

  // Retention / release rates — entered as percentages (e.g. 8 not 0.08).
  // Defaults match Merton (most common case for client-CFF conversions).
  // For pure CSA-mode regenerates of older Bishops-style projects the user
  // can manually enter 3 / 1.5 to preserve historical defaults.
  const [retentionPctInput, setRetentionPctInput] = useState('8')
  const [releasePctInput, setReleasePctInput] = useState('6.5')

  // Multi-building state — derived from project_doc_folders. Empty array
  // means single-building (Bishops-style) → all behaviour falls back to
  // the existing global cff/csa flow. Non-empty means we offer per-building
  // CSA picking + per-building CFF output.
  const [buildings, setBuildings] = useState([])

  // The currently selected building, derived from the selected CSA file.
  // null = global CSA was picked (or upload mode) → save to global cff,
  //        use root-level PAs.
  // Building obj = per-building CSA picked → save to building.subfolders.cff,
  //        scope PAs to building.subfolders.pa.
  const selectedBuilding = useMemo(() => {
    if (sourceMode === 'csa') {
      // CSA mode — derive from selected CSA file's subfolder
      if (uploadedCsaFile) return null   // uploads always go to global cff
      if (!selectedCsaPath) return null
      const file = csaFiles.find(f => f.storage_path === selectedCsaPath)
      if (!file) return null
      const sub = file.subfolder_key
      if (!sub || sub === CSA_SUBFOLDER) return null  // global CSA
      return findBuildingByCsaSubfolder(buildings, sub)
    } else {
      // Client mode — derive from picked client CFF's subfolder. Uploads
      // (clientCffSourceMode='upload') always go to global cff because we
      // have no folder context for an uploaded file.
      if (clientCffSourceMode !== 'pick') return null
      if (!clientCffSelectedPath) return null
      const file = clientCffExistingFiles.find(f => f.storage_path === clientCffSelectedPath)
      if (!file) return null
      const sub = file.subfolder_key
      if (!sub || sub === CFF_SUBFOLDER) return null  // global CFF
      // Match by CFF subfolder. We use findBuildingByCsaSubfolder for CSA
      // mode but here we need a building whose .subfolders.cff matches.
      return buildings.find(b => b.subfolders.cff === sub) || null
    }
  }, [
    sourceMode,
    uploadedCsaFile, selectedCsaPath, csaFiles,
    clientCffSourceMode, clientCffSelectedPath, clientCffExistingFiles,
    buildings,
  ])

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
        // Resolve buildings first (returns [] for single-building projects).
        // We need this before the CSA query so we know which csa-sub-*
        // subfolders exist for this project.
        const resolvedBuildings = await resolveBuildings(supabase, projectId).catch(err => {
          console.warn('[CffGen] resolveBuildings failed:', err)
          return []
        })
        if (cancelled) return
        setBuildings(resolvedBuildings)

        // Build the list of subfolder keys to query for CSA files. Always
        // include the global 'csa' key. For multi-building projects, also
        // include each building's csa-sub-* key.
        const csaSubfolderKeys = [CSA_SUBFOLDER]
        for (const b of resolvedBuildings) {
          if (b.subfolders.csa && b.subfolders.csa !== CSA_SUBFOLDER) {
            csaSubfolderKeys.push(b.subfolders.csa)
          }
        }

        // Same idea for CFF subfolders — used by the client-CFF "pick
        // existing" picker. Includes global 'cff', cff-archive, and every
        // per-building cff-sub-*.
        const cffSubfolderKeys = [CFF_SUBFOLDER, CFF_ARCHIVE_SUBFOLDER]
        for (const b of resolvedBuildings) {
          if (b.subfolders.cff && b.subfolders.cff !== CFF_SUBFOLDER) {
            cffSubfolderKeys.push(b.subfolders.cff)
          }
        }

        const [csaRes, projectRes, cffFilesRes] = await Promise.all([
          supabase
            .from('project_doc_files')
            .select('id, file_name, storage_path, subfolder_key, created_at')
            .eq('project_id', projectId)
            .eq('folder_key', PRIMARY_FOLDER)
            .in('subfolder_key', csaSubfolderKeys)
            .order('created_at', { ascending: false }),
          supabase
            .from('projects')
            .select('start_date, end_date')
            .eq('id', projectId)
            .maybeSingle(),
          supabase
            .from('project_doc_files')
            .select('id, file_name, storage_path, subfolder_key, created_at')
            .eq('project_id', projectId)
            .eq('folder_key', PRIMARY_FOLDER)
            .in('subfolder_key', cffSubfolderKeys)
            .order('created_at', { ascending: false }),
        ])

        if (cancelled) return

        if (csaRes.error) console.warn('CSA list query error:', csaRes.error)
        const xlsxFiles = (csaRes.data || []).filter(f =>
          /\.xlsx$/i.test(f.file_name)
        )
        setCsaFiles(xlsxFiles)
        // Default selection: prefer first xlsx in global 'csa' subfolder so
        // single-building projects (Bishops) behave exactly as before.
        // If no global CSA exists but per-building CSAs do, fall back to the
        // first per-building one.
        if (xlsxFiles.length > 0) {
          const firstGlobal = xlsxFiles.find(f => f.subfolder_key === CSA_SUBFOLDER)
          setSelectedCsaPath((firstGlobal || xlsxFiles[0]).storage_path)
        }

        // Same xlsx filter for the client-CFF picker.
        if (cffFilesRes.error) console.warn('CFF list query error:', cffFilesRes.error)
        const cffXlsx = (cffFilesRes.data || []).filter(f =>
          /\.xlsx$/i.test(f.file_name)
        )
        setClientCffExistingFiles(cffXlsx)

        if (projectRes.data) {
          if (projectRes.data.start_date) setStartDate(prev => prev || projectRes.data.start_date)
          if (projectRes.data.end_date) setEndDate(prev => prev || projectRes.data.end_date)
        }

        // PA-aware regenerate: PA fetch is now scoped to the selected
        // building (or root-level if global CSA picked). Because the
        // selectedBuilding depends on csaFiles + selectedCsaPath state we
        // can't compute it here yet — we kick off the PA fetch in a separate
        // effect that re-runs whenever the selected building changes. See
        // below.
      } catch (err) {
        if (!cancelled) {
          console.warn('Failed to load modal initial data', err)
          setPaLoadError(err.message || 'Could not load project data')
        }
      } finally {
        if (!cancelled) setLoadingCsaList(false)
      }
    }
    loadInitialData()
    return () => {
      cancelled = true
    }
  }, [projectId])

  // PA fetch — re-runs whenever the selected building changes. For the
  // global-CSA case (selectedBuilding == null), fetches root-level PAs
  // (existing Bishops behaviour). For a per-building CSA, fetches PAs
  // scoped to that building's PA subfolder so cumulatives line up with the
  // building's CSA values.
  useEffect(() => {
    let cancelled = false
    async function loadPas() {
      try {
        const paSubKey = selectedBuilding ? selectedBuilding.subfolders.pa : null
        const paResult = await fetchAllProjectPas(supabase, projectId, paSubKey).catch(err => {
          console.warn('PA fetch failed:', err)
          return []
        })
        if (cancelled) return
        // Map PA list into the shape the generator expects.
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
        // If switching buildings revealed PA data, default to 'pa' mode.
        // If no PAs found, leave actualsMode alone (the user may have
        // already entered manual data).
        if (flatPaList.length > 0 && actualsMode === 'none') {
          setActualsMode('pa')
        } else if (flatPaList.length === 0 && actualsMode === 'pa') {
          // Building switch made the previously-found PAs disappear —
          // switch back to 'none' so the preview doesn't show stale data.
          setActualsMode('none')
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('PA pre-fetch failed:', err)
          setPaLoadError(err.message || 'Could not load payment applications')
        }
      }
    }
    // Only run after the buildings query has resolved AND we have a default
    // selection (or the user hasn't picked one yet but the project has no
    // CSAs). The empty-projectId guard prevents an early run during mount.
    if (projectId) loadPas()
    return () => { cancelled = true }
    // selectedBuilding is the trigger — it updates when selectedCsaPath
    // changes. actualsMode is intentionally NOT in deps to avoid loops
    // (we set it inside this effect).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, selectedBuilding])

  // ─── Parse source when user advances from Step 1 ───────────────────────
  // Despite the name, this handles BOTH source modes — sourceMode='csa'
  // parses a CSA file via extractCsa, sourceMode='client' parses a client
  // CFF via extractClientCff and adapts to the same shape. The downstream
  // Step 2 preview + handleGenerate flow doesn't care which path produced
  // csaExtract / manualOverrides — it's the same shape.
  async function loadAndParseCsa() {
    setCsaParseError('')
    setCsaExtract(null)
    setClientCffParsed(null)
    setManualOverrides({})
    setBusy(true)

    try {
      if (sourceMode === 'csa') {
        // ─ CSA path (existing) ─
        let file
        if (uploadedCsaFile) {
          file = uploadedCsaFile
        } else if (selectedCsaPath) {
          const { data, error } = await supabase
            .storage
            .from('project-docs')
            .download(selectedCsaPath)
          if (error) throw error
          file = data
        } else {
          throw new Error('No CSA selected')
        }

        const extract = await extractCsa(file)
        if (!extract.groups || extract.groups.length === 0) {
          throw new Error('No line items found in this CSA')
        }
        setCsaExtract(extract)
        const initial = {}
        for (const g of extract.groups) initial[g.id] = defaultCurve
        setRowCurves(initial)
      } else {
        // ─ Client CFF path ─
        // Parse the client CFF to get line items + per-month percentages.
        // Then transform to a csaExtract-shaped object so the rest of the
        // modal works unchanged. EVERY row gets a manual override (its
        // monthly amounts), so curves aren't engaged for client-CFF rows.
        let parseInput
        if (clientCffSourceMode === 'upload') {
          if (!clientCffFile) throw new Error('No client CFF file uploaded')
          parseInput = clientCffFile
        } else {
          if (!clientCffSelectedPath) throw new Error('No client CFF picked')
          // Download from storage as ArrayBuffer
          const picked = clientCffExistingFiles.find(f => f.storage_path === clientCffSelectedPath)
          if (!picked) throw new Error('Picked file not found')
          const { data: signed, error: sErr } = await supabase
            .storage.from('project-docs').createSignedUrl(picked.storage_path, 600)
          if (sErr || !signed?.signedUrl) throw new Error('Could not get download URL')
          const res = await fetch(signed.signedUrl)
          if (!res.ok) throw new Error(`Download failed (${res.status})`)
          parseInput = await res.arrayBuffer()
        }

        const parsed = await extractClientCff(parseInput)
        if (!parsed.line_items || parsed.line_items.length === 0) {
          throw new Error('No line items found in the client CFF')
        }
        setClientCffParsed(parsed)

        // Build csaExtract-shaped object from parsed line items. group_key
        // uses the section + description so rows stay distinct. (PA overlay
        // for client mode happens via Path B at the totals level — it does
        // NOT need group_keys to match PA groups.)
        const numMonthsForClient = parsed.num_months || 1
        const groups = parsed.line_items.map((item, idx) => ({
          id: `g${idx + 1}`,
          group_key: groupKeyFor(item.section, item.description || item.ref),
          label: item.description || item.ref || 'Item',
          value: item.value,
          section: item.section,
          group: null,
          item_count: 1,
          source_refs: [item.ref].filter(Boolean),
        }))
        const bodyTotal = groups.reduce((s, g) => s + g.value, 0)
        const synthExtract = {
          project_name: projectName || 'Project',
          contract_sum: parsed.contract_sum || bodyTotal,
          body_total: bodyTotal,
          groups,
        }
        setCsaExtract(synthExtract)

        // Build per-row manual overrides from the line items' monthly_pcts.
        // Normalise so each row's monthly amounts sum exactly to its value.
        // (Same logic as clientCffAdapter — duplicated here so we don't
        // need the adapter for the merged flow.)
        const overrides = {}
        for (let i = 0; i < parsed.line_items.length; i++) {
          const item = parsed.line_items[i]
          const truncated = item.monthly_pct.slice(0, numMonthsForClient)
          while (truncated.length < numMonthsForClient) truncated.push(0)
          const pctSum = truncated.reduce((s, p) => s + p, 0)
          let monthly
          if (pctSum > 0) {
            monthly = truncated.map(p => Math.round((item.value * p / pctSum) * 100) / 100)
            const sumAfter = monthly.reduce((s, v) => s + v, 0)
            const residual = Math.round((item.value - sumAfter) * 100) / 100
            if (Math.abs(residual) > 0.001) {
              for (let m = monthly.length - 1; m >= 0; m--) {
                if (monthly[m] > 0) { monthly[m] = Math.round((monthly[m] + residual) * 100) / 100; break }
              }
            }
          } else {
            // Fallback — even spread across start..finish
            const start = item.start_month && item.start_month >= 1 ? item.start_month : 1
            const finish = item.finish_month && item.finish_month >= start ? item.finish_month : numMonthsForClient
            const span = Math.min(finish, numMonthsForClient) - start + 1
            const per = span > 0 ? item.value / span : 0
            monthly = Array.from({ length: numMonthsForClient }, (_, m) =>
              m + 1 >= start && m + 1 <= finish ? Math.round(per * 100) / 100 : 0
            )
          }
          overrides[`g${i + 1}`] = monthly
        }
        setManualOverrides(overrides)

        // Curves don't apply to client-CFF rows (every row is manual), but
        // initialise the dict so per-row UI elements that key off rowCurves
        // don't crash.
        const initialCurves = {}
        for (const g of groups) initialCurves[g.id] = 'even'
        setRowCurves(initialCurves)

        // Auto-set num_months from the parsed file if user hasn't manually
        // overridden it. Client CFFs typically dictate the project length.
        if (!numMonthsOverride) {
          setNumMonthsOverride(String(numMonthsForClient))
        }
      }
    } catch (err) {
      console.warn('Source parse failed', err)
      setCsaParseError(err.message || 'Failed to parse source file')
    } finally {
      setBusy(false)
    }
  }

  // ─── Step 1 → Step 2: validate and parse ────────────────────────────────
  async function handleNextFromStep1() {
    setError('')
    // Validate source — either CSA or Client CFF must be picked.
    if (sourceMode === 'csa') {
      if (!selectedCsaPath && !uploadedCsaFile) {
        setError('Select a CSA file from the list, or upload one.')
        return
      }
    } else {
      if (clientCffSourceMode === 'upload' && !clientCffFile) {
        setError('Upload a client CFF file, or switch to "Pick existing".')
        return
      }
      if (clientCffSourceMode === 'pick' && !clientCffSelectedPath) {
        setError('Pick a client CFF file from the list, or switch to "Upload new".')
        return
      }
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
    // Validate retention/release. Empty falls back to defaults inside
    // generateCff. Non-numeric or out of range → reject.
    const r1 = parsePctInput(retentionPctInput)
    const r2 = parsePctInput(releasePctInput)
    if (r1 === 'invalid' || r2 === 'invalid') {
      setError('Retention and release must be numbers between 0 and 100.')
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

      // ─── Client-CFF Path B PA overlay ────────────────────────────────────
      // The generator's pa_actuals path matches PAs to rows by group_key. In
      // CSA mode group_keys line up. In Client mode they don't (client
      // sections are like "4.1.1 Facilitating Works" which never match the
      // PA's MAIN WORKS / PRELIMINARIES groupings). So for client mode we
      // bypass the generator's per-row PA path and apply the overlay AT
      // THE TOTAL LEVEL here, by mutating manualOverrides. The generator
      // then sees forecast-only with manual overrides — but those overrides
      // already encode the past-month actuals.
      //
      // Algorithm (Path B):
      //   1. Take the PA's monthly deltas (PA01.cum, PA02.cum-PA01.cum, ...)
      //   2. For each past month m:
      //        S = sum across rows of overrides[row.id][m]   (forecast)
      //        T = PA's actual monthly total for month m
      //        scale = T / S    (or proportional to row.value if S = 0)
      //        for each row: overrides[row.id][m] *= scale
      //   3. Future months left untouched (forecast continues).
      //
      // Edge case — the PA actuals replace forecast values for past months
      // but the row TOTAL changes as a result: row monthly sum no longer
      // equals row's contract value. That's the CORRECT semantic for
      // PA-aware: the row is partially complete + has future work, and we
      // don't try to redistribute remaining value. (CSA-mode does
      // redistribute future months — but that's because CSA-mode has a
      // curve to redistribute over. Client-mode doesn't have a curve, so
      // future months stay at their forecast values.)
      let effectiveManualOverrides = manualOverrides
      if (sourceMode === 'client' && paActuals && paActuals.paList && paActuals.paList.length > 0) {
        const paMonthly = []
        let prevCum = 0
        for (const pa of paActuals.paList) {
          paMonthly.push(Math.max(0, (pa.total_cumulative || 0) - prevCum))
          prevCum = pa.total_cumulative || 0
        }
        const pastMonthCount = Math.min(paMonthly.length, numMonths)
        if (pastMonthCount > 0) {
          // Clone overrides — never mutate state directly.
          const adjusted = {}
          for (const [id, arr] of Object.entries(manualOverrides)) {
            adjusted[id] = Array.isArray(arr) ? arr.slice() : []
          }
          for (let m = 0; m < pastMonthCount; m++) {
            // Sum forecast for this month across all rows
            let forecastSum = 0
            for (const g of csaExtract.groups) {
              const arr = adjusted[g.id]
              if (Array.isArray(arr) && Number.isFinite(arr[m])) forecastSum += arr[m]
            }
            const target = paMonthly[m]
            if (forecastSum > 0.01) {
              // Scale each row's month-m proportionally to match target
              const scale = target / forecastSum
              for (const g of csaExtract.groups) {
                const arr = adjusted[g.id]
                if (Array.isArray(arr) && Number.isFinite(arr[m])) {
                  arr[m] = Math.round(arr[m] * scale * 100) / 100
                }
              }
            } else {
              // Edge case — forecast for this month is 0 for every row.
              // Distribute target proportionally to row contract values.
              const totalContract = csaExtract.groups.reduce((s, g) => s + g.value, 0) || 1
              for (const g of csaExtract.groups) {
                const arr = adjusted[g.id]
                if (Array.isArray(arr)) {
                  arr[m] = Math.round(target * (g.value / totalContract) * 100) / 100
                }
              }
            }
          }
          effectiveManualOverrides = adjusted
        }
        // For client mode, generator should NOT see pa_actuals — overlay is
        // already baked into manualOverrides. Setting to null prevents the
        // generator's own (per-group, no-match) overlay from clobbering.
        paActuals = null
      }

      // Resolve retention/release (already validated in Step 1).
      const retentionPct = parsePctInput(retentionPctInput)
      const releasePct = parsePctInput(releasePctInput)

      const result = await generateCff(csaExtract, {
        project_name: projectName || csaExtract.project_name,
        start_date: startDate,
        end_date: endDate,
        num_months: numMonths,
        csa_no: csaExtract.csa_no,
        row_curves: rowCurves,
        default_curve: defaultCurve,
        row_manual: effectiveManualOverrides,
        pa_actuals: paActuals,
        retention_pct: retentionPct,
        release_pct: releasePct,
      })

      // Upload to project-docs bucket — match the CRM upload convention:
      //   projects/<projectId>/<folderKey>/<subfolderKey>/<ts>-<filename>
      //
      // Multi-building: if a per-building CSA was picked, save to that
      // building's CFF subfolder (cff-sub-*). Otherwise (global CSA or
      // upload), save to the global 'cff' subfolder.
      //
      // Archive flow: only the global cff subfolder uses the demote-to-
      // archive pattern (so the portal can show "what changed" diffs for
      // the project-level CFF). For per-building CFFs we skip archiving —
      // matches the manual-upload behaviour for those subfolders and avoids
      // accumulating stale archives for every building.
      const targetCffSubfolder = selectedBuilding
        ? selectedBuilding.subfolders.cff
        : CFF_SUBFOLDER

      if (!targetCffSubfolder) {
        // Defensive: a building was selected but has no CFF subfolder set.
        // This shouldn't happen because resolveBuildings only matches by
        // ordinal, but if a project's CFF subfolder was deleted manually
        // we'd hit this. Surface a clear error rather than silently writing
        // to global cff.
        throw new Error(
          `Building "${selectedBuilding.name}" has no matching CFF subfolder. ` +
          `Create a CFF subfolder for this building before regenerating.`
        )
      }

      const ts = Date.now()
      const storagePath = `projects/${projectId}/${PRIMARY_FOLDER}/${targetCffSubfolder}/${ts}-${result.filename}`
      const { error: uploadErr } = await supabase
        .storage
        .from('project-docs')
        .upload(storagePath, result.blob, {
          upsert: false, // never overwrite — timestamp guarantees uniqueness
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
      if (uploadErr) throw uploadErr

      if (selectedBuilding) {
        // Per-building: just insert the new row, no archive flow.
        const { error: insertErr } = await supabase
          .from('project_doc_files')
          .insert({
            project_id: projectId,
            folder_key: PRIMARY_FOLDER,
            subfolder_key: targetCffSubfolder,
            file_name: result.filename,
            file_size: result.blob.size,
            storage_path: storagePath,
          })
        if (insertErr) throw insertErr
      } else {
        // Global cff: archive previous current, delete previous archive,
        // insert the new row. (Original Bishops-style behaviour.)
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
    <Modal open={true} onClose={onClose} title={title} size="xl" footer={footer}>
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
          sourceMode={sourceMode}
          setSourceMode={(m) => {
            setSourceMode(m)
            // Switching source mode wipes any parsed extract so user goes
            // through validation again. Otherwise stale state from the
            // OTHER mode could leak through.
            setCsaExtract(null)
            setClientCffParsed(null)
            setManualOverrides({})
            setCsaParseError('')
          }}
          csaFiles={csaFiles}
          loadingCsaList={loadingCsaList}
          selectedCsaPath={selectedCsaPath}
          setSelectedCsaPath={(p) => { setSelectedCsaPath(p); setUploadedCsaFile(null); setCsaExtract(null); setCsaParseError('') }}
          uploadedCsaFile={uploadedCsaFile}
          setUploadedCsaFile={(f) => { setUploadedCsaFile(f); setSelectedCsaPath(''); setCsaExtract(null); setCsaParseError('') }}
          clientCffSourceMode={clientCffSourceMode}
          setClientCffSourceMode={(m) => { setClientCffSourceMode(m); setCsaExtract(null); setCsaParseError('') }}
          clientCffFile={clientCffFile}
          setClientCffFile={(f) => { setClientCffFile(f); setClientCffSelectedPath(''); setCsaExtract(null); setCsaParseError('') }}
          clientCffExistingFiles={clientCffExistingFiles}
          clientCffSelectedPath={clientCffSelectedPath}
          setClientCffSelectedPath={(p) => { setClientCffSelectedPath(p); setClientCffFile(null); setCsaExtract(null); setCsaParseError('') }}
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
          buildings={buildings}
          selectedBuilding={selectedBuilding}
          retentionPctInput={retentionPctInput}
          setRetentionPctInput={setRetentionPctInput}
          releasePctInput={releasePctInput}
          setReleasePctInput={setReleasePctInput}
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

// ─── Helper: parse a percentage input ─────────────────────────────────────
// Used by retention / release inputs. Accepts "" (empty → undefined, lets
// generator use defaults), valid 0–100 number → returns decimal (0.08),
// anything else → 'invalid'. Caller surfaces the validation error.
function parsePctInput(input) {
  const trimmed = String(input).trim()
  if (trimmed === '') return undefined
  const n = parseFloat(trimmed)
  if (!Number.isFinite(n) || n < 0 || n > 100) return 'invalid'
  return n / 100
}

// ─── Step 1: Source + programme ────────────────────────────────────────────
function Step1SourceAndProgramme({
  sourceMode, setSourceMode,
  csaFiles, loadingCsaList,
  selectedCsaPath, setSelectedCsaPath,
  uploadedCsaFile, setUploadedCsaFile,
  clientCffSourceMode, setClientCffSourceMode,
  clientCffFile, setClientCffFile,
  clientCffExistingFiles,
  clientCffSelectedPath, setClientCffSelectedPath,
  startDate, setStartDate,
  endDate, setEndDate,
  numMonthsOverride, setNumMonthsOverride,
  numMonths,
  defaultCurve, setDefaultCurve,
  csaParseError,
  paList, paLoadError,
  actualsMode, setActualsMode,
  manualActuals, setManualActuals,
  buildings, selectedBuilding,
  retentionPctInput, setRetentionPctInput,
  releasePctInput, setReleasePctInput,
}) {
  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (file) setUploadedCsaFile(file)
  }
  function handleClientFileChange(e) {
    const file = e.target.files?.[0]
    if (file) setClientCffFile(file)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Source mode toggle — pick CSA + curves OR a client CFF file */}
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 6, color: 'var(--text2)' }}>
          Generate from
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={() => setSourceMode('csa')}
            style={{
              padding: '6px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
              border: '0.5px solid var(--border)',
              background: sourceMode === 'csa' ? 'var(--accent-soft)' : 'var(--surface2)',
              color: sourceMode === 'csa' ? 'var(--accent)' : 'var(--text2)',
              fontWeight: sourceMode === 'csa' ? 500 : 400,
            }}
          >
            CSA + curves
          </button>
          <button
            type="button"
            onClick={() => setSourceMode('client')}
            style={{
              padding: '6px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
              border: '0.5px solid var(--border)',
              background: sourceMode === 'client' ? 'var(--accent-soft)' : 'var(--surface2)',
              color: sourceMode === 'client' ? 'var(--accent)' : 'var(--text2)',
              fontWeight: sourceMode === 'client' ? 500 : 400,
            }}
          >
            Client CFF file
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
          {sourceMode === 'csa'
            ? 'Build forecast from the project CSA using a distribution curve. PA-aware regenerate replaces past months with PA actuals per row.'
            : 'Use a client-supplied CFF spreadsheet as the forecast. PA actuals (if present) overlay at the totals level — past month totals match the PAs, future months use the client distribution.'}
        </div>
      </div>

      {/* CSA source — visible when sourceMode = 'csa' */}
      {sourceMode === 'csa' && (
      <div>
        <Field label="Source CSA file">
          {loadingCsaList ? (
            <div style={{ fontSize: 13, color: 'var(--text3)', padding: '8px 0' }}>
              Loading available CSA files…
            </div>
          ) : csaFiles.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text3)', padding: '8px 0' }}>
              No CSA files found in <code>{PRIMARY_FOLDER} / {CSA_SUBFOLDER}</code>{buildings.length > 0 ? ' or any per-building subfolder' : ''}.
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
              {/* Group files by their subfolder. Global 'csa' first (the
                  Bishops-style default), then each building in ordinal
                  order. For single-building projects only the global group
                  shows — looks identical to the previous flat list. */}
              {(() => {
                const globalFiles = csaFiles.filter(f => f.subfolder_key === CSA_SUBFOLDER)
                const groups = []
                if (globalFiles.length > 0) {
                  groups.push({ label: 'Project CSA', files: globalFiles })
                }
                for (const b of buildings) {
                  const bFiles = csaFiles.filter(f => f.subfolder_key === b.subfolders.csa)
                  if (bFiles.length > 0) {
                    groups.push({ label: b.name || `Building ${b.ordinal}`, files: bFiles })
                  }
                }
                return groups.map(g => (
                  <optgroup key={g.label} label={g.label}>
                    {g.files.map(f => (
                      <option key={f.id} value={f.storage_path}>
                        {f.file_name}
                      </option>
                    ))}
                  </optgroup>
                ))
              })()}
              {uploadedCsaFile && (
                <option value="__uploaded__">
                  Just uploaded: {uploadedCsaFile.name}
                </option>
              )}
            </select>
          )}
        </Field>

        {/* When a per-building CSA is selected, show what'll happen. This
            is the only multi-building UI element on Step 1 — keeps the
            change minimal for single-building projects. */}
        {selectedBuilding && !uploadedCsaFile && (
          <div style={{
            marginTop: 6,
            padding: 8,
            background: 'rgba(80, 102, 188, 0.08)',
            border: '0.5px solid rgba(80, 102, 188, 0.3)',
            borderRadius: 4,
            fontSize: 12,
            color: 'var(--text2)',
            lineHeight: 1.5,
          }}>
            <strong style={{ color: '#5066BC' }}>Building scope: {selectedBuilding.name}</strong> · PAs filtered to this building's payment-application subfolder · CFF will be saved to this building's <code>cff</code> subfolder (no archive).
          </div>
        )}

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
      )}

      {/* Client CFF source — visible when sourceMode = 'client' */}
      {sourceMode === 'client' && (
      <div>
        <Field label="Client CFF file (.xlsx)">
          {/* Sub-toggle: upload-from-disk vs pick-existing */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button
              type="button"
              onClick={() => setClientCffSourceMode('upload')}
              style={{
                padding: '4px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                border: '0.5px solid var(--border)',
                background: clientCffSourceMode === 'upload' ? 'var(--accent-soft)' : 'var(--surface2)',
                color: clientCffSourceMode === 'upload' ? 'var(--accent)' : 'var(--text2)',
                fontWeight: clientCffSourceMode === 'upload' ? 500 : 400,
              }}
            >
              Upload new file
            </button>
            <button
              type="button"
              onClick={() => setClientCffSourceMode('pick')}
              style={{
                padding: '4px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                border: '0.5px solid var(--border)',
                background: clientCffSourceMode === 'pick' ? 'var(--accent-soft)' : 'var(--surface2)',
                color: clientCffSourceMode === 'pick' ? 'var(--accent)' : 'var(--text2)',
                fontWeight: clientCffSourceMode === 'pick' ? 500 : 400,
              }}
            >
              Pick from project files ({clientCffExistingFiles.length})
            </button>
          </div>

          {clientCffSourceMode === 'upload' ? (
            <>
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleClientFileChange}
                style={{ fontSize: 13 }}
              />
              {clientCffFile && (
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                  Selected: {clientCffFile.name} ({Math.round(clientCffFile.size / 1024)} KB)
                </div>
              )}
            </>
          ) : (
            clientCffExistingFiles.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text3)', padding: 8, border: '0.5px solid var(--border)', borderRadius: 4 }}>
                No xlsx files found in this project's cff subfolders. Upload one instead.
              </div>
            ) : (
              <select
                value={clientCffSelectedPath}
                onChange={e => setClientCffSelectedPath(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="">— select a file —</option>
                {(() => {
                  // Group: global cff first, archive next, then per-building.
                  const groups = []
                  const globalFiles = clientCffExistingFiles.filter(f => f.subfolder_key === CFF_SUBFOLDER)
                  if (globalFiles.length > 0) groups.push({ label: 'Project CFF', files: globalFiles })
                  const archiveFiles = clientCffExistingFiles.filter(f => f.subfolder_key === CFF_ARCHIVE_SUBFOLDER)
                  if (archiveFiles.length > 0) groups.push({ label: 'Archive', files: archiveFiles })
                  for (const b of buildings) {
                    const bFiles = clientCffExistingFiles.filter(f => f.subfolder_key === b.subfolders.cff)
                    if (bFiles.length > 0) groups.push({ label: b.name || `Building ${b.ordinal}`, files: bFiles })
                  }
                  return groups.map(g => (
                    <optgroup key={g.label} label={g.label}>
                      {g.files.map(f => (
                        <option key={f.id} value={f.storage_path}>{f.file_name}</option>
                      ))}
                    </optgroup>
                  ))
                })()}
              </select>
            )
          )}
        </Field>

        {/* Building scope banner — same blue note as CSA mode */}
        {selectedBuilding && (
          <div style={{
            marginTop: 6,
            padding: 8,
            background: 'rgba(80, 102, 188, 0.08)',
            border: '0.5px solid rgba(80, 102, 188, 0.3)',
            borderRadius: 4,
            fontSize: 12,
            color: 'var(--text2)',
            lineHeight: 1.5,
          }}>
            <strong style={{ color: '#5066BC' }}>Building scope: {selectedBuilding.name}</strong> · PAs filtered to this building's payment-application subfolder · CFF will be saved to this building's <code>cff</code> subfolder (no archive).
          </div>
        )}

        {csaParseError && (
          <div style={{ marginTop: 8, fontSize: 13, color: '#dc2626' }}>
            Parse error: {csaParseError}
          </div>
        )}
      </div>
      )}

      {/* Retention / release — apply in both modes */}
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="Retention %">
            <input
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={retentionPctInput}
              onChange={e => setRetentionPctInput(e.target.value)}
              style={{ width: '100%' }}
            />
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              Deducted from each PA. Default 8% (Merton); use 3% for Bishops-style projects.
            </div>
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Release at PC %">
            <input
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={releasePctInput}
              onChange={e => setReleasePctInput(e.target.value)}
              style={{ width: '100%' }}
            />
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              Released at Practical Completion. Default 6.5% (Merton); use 1.5% for Bishops-style.
            </div>
          </Field>
        </div>
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

      {/* Table viewport — bounded height so the horizontal scrollbar at the
          BOTTOM of this div stays visible while the user scrolls vertically
          within the table. Without maxHeight, the scrollbar sits at the very
          bottom of the entire modal scroll, hidden until you reach the
          footer. The viewport's vertical scroll is independent from the
          modal's outer scroll, so the surrounding banners + footer remain
          accessible regardless of where the user is in the table. */}
      <div style={{
        overflow: 'auto',
        maxHeight: '60vh',
        border: '1px solid var(--border)',
        borderRadius: 6,
      }}>
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
                  // Past-month tint — opaque so sticky-scroll doesn't bleed
                  // table content through. Layered: surface2 + tint
                  // approximates the original 0.15 blue overlay look.
                  ...(i < paMonthCount ? { background: 'linear-gradient(rgba(80,102,188,0.2), rgba(80,102,188,0.2)), var(--surface2)' } : {}),
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
  // Sticky header — stays visible at the top of the table's scroll
  // viewport (the bounded-height div around the table). Background
  // matches the row to mask scrolled content underneath. zIndex keeps
  // it above the body cells during overlap.
  position: 'sticky',
  top: 0,
  background: 'var(--surface2)',
  zIndex: 2,
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
