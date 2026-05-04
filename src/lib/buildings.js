// ─────────────────────────────────────────────────────────────────────────────
// buildings.js — multi-building project structure resolution
//
// Some projects (e.g. Merton) are physically structured as one CRM project
// containing several distinct sub-buildings — Residential Block, Sports
// Hall, Changing Rooms. Each sub-building has its own PA, Progress Reports,
// CFF, Drawings, and CSA, organised as subfolders inside the relevant
// template folder.
//
// There's no formal `building_id` linking these subfolders together. The
// link is by leading ordinal in the folder label:
//
//   "01. CCG PB - Residential"            ← ordinal 1, in 02-payment-application
//   "01. CSA - Residential Block"         ← ordinal 1, in 00-project-information/csa
//   "01. CFF - Residential Block"         ← ordinal 1, in 00-project-information/cff
//   "01. CCG PB - Residential"            ← ordinal 1, in 05-progress-report
//
// All four subfolders together represent "Building 1." This file does the
// matching.
//
// ─── Why this file is encapsulated ───────────────────────────────────────────
// The label-matching approach is brittle by design (Path 2 in the multi-
// building plan). If labels go out of order or someone uses different
// numbering conventions, matches break. By keeping ALL the matching logic
// in this one file, callers only see a clean `Building[]` shape — and we
// can swap the implementation later (e.g. to read a `project_buildings`
// table, Path 3) without touching any callers.
//
// ─── Public API ──────────────────────────────────────────────────────────────
//   resolveBuildings(supabase, projectId) → Promise<Building[]>
//   findBuildingByCsaSubfolder(buildings, csaSubfolderKey) → Building | null
//   findBuildingByPaSubfolder(buildings, paSubfolderKey)   → Building | null
//   buildingDisplayName(building) → string
//
// Returns [] for single-building projects (no PA subfolders). Caller uses
// .length === 0 as the "this is a single-building project" signal.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Building
 * @property {number} ordinal           — the leading number from the label (1, 2, 3, …)
 * @property {string} label             — the full CSA label (or PA label fallback)
 * @property {string} name              — the short display name ("Residential Block")
 * @property {Object} subfolders        — folder keys for this building, by type
 * @property {string|null} subfolders.pa
 * @property {string|null} subfolders.csa
 * @property {string|null} subfolders.cff
 * @property {string|null} subfolders.progress_reports
 * @property {string|null} subfolders.drawings
 * @property {boolean} hasMissing       — true if any of pa/csa/cff is null (incomplete)
 */

// Parent template folder keys we care about for multi-building grouping.
// These are template subfolders or top-level folders that house per-building
// subfolders. Keys match what's stored in project_doc_folders.parent_key.
const BUILDING_PARENT_KEYS = {
  pa: '02-payment-application',
  csa: 'csa',
  cff: 'cff',
  progress_reports: '05-progress-report',
  drawings: 'drawings',
}

// Extract the leading ordinal number from a label like "01. CSA - Residential
// Block" → 1.  Tolerates "1.", "01.", "1 -", "01 -", and a single digit alone.
// Returns null if no ordinal is detected.
function extractOrdinal(label) {
  if (typeof label !== 'string') return null
  // Anchored match at start: optional whitespace, 1-3 digits, optional . or -
  const m = label.trim().match(/^(\d{1,3})\s*[.\-)]/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n < 1 || n > 99) return null
  return n
}

// Strip the type prefix from a label to get the bare building name.
//   "01. CSA - Residential Block"          → "Residential Block"
//   "01. CFF - Residential Block"          → "Residential Block"
//   "01. CCG PB - Residential"             → "Residential"
//   "01. Drawings (Main Building)"         → "Main Building"
//   "01. PPR 01"                           → "PPR 01"   (no clean strip — leave as-is)
//
// We intentionally don't normalise across folder types — the user picked
// these names, we respect them. The display layer uses the CSA-derived
// name (most user-meaningful) when available, else PA, else raw label.
function stripTypePrefix(label) {
  if (typeof label !== 'string') return ''
  let s = label.trim()
  // Drop leading "01. " / "1. " / "01 - " etc.
  s = s.replace(/^\d{1,3}\s*[.\-)]\s*/, '')
  // Drop "CSA - " / "CFF - " / "CCG PB - " / "Drawings (...)" type prefixes
  s = s.replace(/^(CSA|CFF|CCG\s+\S+|Drawings)\s*[-(–]\s*/i, '')
  // Drop trailing parenthesised qualifier if it was a separator: "Drawings (Main Building)"
  // Already handled above for "Drawings ("; close paren gets trimmed below.
  s = s.replace(/[)\s]+$/, '')
  return s.trim()
}

// Fetch all the per-building subfolders for a project. Returns the raw rows
// keyed by parent → ordered by created_at, so the caller can pair them up.
async function loadProjectSubfolders(supabase, projectId) {
  const { data, error } = await supabase
    .from('project_doc_folders')
    .select('folder_key, parent_key, label, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Resolve the per-building structure for a project. The PA folder acts as
 * the anchor — every project has PAs eventually, and they're the most
 * user-managed of the building-level folders.
 *
 * Algorithm:
 *   1. Find PA subfolders (parent_key = '02-payment-application')
 *   2. For each, extract ordinal from label
 *   3. Group by ordinal — the PA for ordinal N is the canonical "Building N"
 *   4. For each other folder type (csa, cff, progress_reports, drawings),
 *      find the subfolder whose label has a matching ordinal
 *   5. Build the Building objects, sorted by ordinal
 *
 * Returns [] (no buildings) when:
 *   - the project has no PA subfolders at all (single-building project)
 *   - the project has PA subfolders but none have a parseable ordinal
 *
 * In those cases the caller should fall back to the existing single-building
 * code path. Multi-building UI elements (per-building Generate CFF buttons,
 * portal building cards, etc.) only appear when this returns at least one
 * building.
 */
export async function resolveBuildings(supabase, projectId) {
  if (!supabase || !projectId) return []
  const folders = await loadProjectSubfolders(supabase, projectId)

  // Bucket folders by parent → list. Multiple folders may share a parent
  // (one per ordinal).
  const byParent = {}
  for (const key of Object.values(BUILDING_PARENT_KEYS)) byParent[key] = []
  for (const f of folders) {
    if (f.parent_key && byParent[f.parent_key]) byParent[f.parent_key].push(f)
  }

  // Anchor: PA subfolders. If none exist or none have ordinals, this is a
  // single-building project and we return [].
  const paFolders = byParent[BUILDING_PARENT_KEYS.pa] || []
  if (paFolders.length === 0) return []

  // Map ordinal → { pa folder row }
  const ordinalToPa = new Map()
  for (const f of paFolders) {
    const ord = extractOrdinal(f.label)
    if (ord == null) continue
    if (!ordinalToPa.has(ord)) {
      ordinalToPa.set(ord, f)
    } else {
      // Two PA folders share the same ordinal — first by created_at wins.
      // Folders are sorted asc by created_at upstream, so the existing entry
      // is correct. Log so the user knows.
      // eslint-disable-next-line no-console
      console.warn(
        `[buildings] Project ${projectId}: two PA subfolders share ordinal ${ord} ` +
        `(kept "${ordinalToPa.get(ord).label}", ignored "${f.label}")`
      )
    }
  }

  if (ordinalToPa.size === 0) return []   // PA folders exist but no ordinals → single-building

  // Build per-ordinal lookup for the OTHER folder types
  function findByOrdinal(parentKey, targetOrdinal) {
    const candidates = byParent[parentKey] || []
    for (const f of candidates) {
      if (extractOrdinal(f.label) === targetOrdinal) return f
    }
    return null
  }

  const buildings = []
  for (const [ordinal, paFolder] of ordinalToPa.entries()) {
    const csa = findByOrdinal(BUILDING_PARENT_KEYS.csa, ordinal)
    const cff = findByOrdinal(BUILDING_PARENT_KEYS.cff, ordinal)
    const progressReports = findByOrdinal(BUILDING_PARENT_KEYS.progress_reports, ordinal)
    const drawings = findByOrdinal(BUILDING_PARENT_KEYS.drawings, ordinal)

    // Display name: prefer CSA label (most user-meaningful), fall back to PA
    // label, fall back to raw "Building N".
    const labelSource = csa?.label || paFolder.label
    const displayName = stripTypePrefix(labelSource) || `Building ${ordinal}`

    buildings.push({
      ordinal,
      label: labelSource,
      name: displayName,
      subfolders: {
        pa: paFolder.folder_key,
        csa: csa?.folder_key || null,
        cff: cff?.folder_key || null,
        progress_reports: progressReports?.folder_key || null,
        drawings: drawings?.folder_key || null,
      },
      hasMissing: !csa || !cff,    // pa exists by definition; csa+cff are the user-critical pair
    })
  }

  // Sort by ordinal so callers can rely on display order
  buildings.sort((a, b) => a.ordinal - b.ordinal)
  return buildings
}

/**
 * Look up the building that owns a given CSA subfolder key. Used by the
 * "Generate CFF" button — when the user clicks the button on
 * `01. CSA - Residential Block`, this is how the modal knows which building
 * is being scoped.
 *
 * Returns null if no building owns that key (shouldn't happen if buildings
 * came from resolveBuildings on the same project, but caller should handle
 * null defensively).
 */
export function findBuildingByCsaSubfolder(buildings, csaSubfolderKey) {
  if (!Array.isArray(buildings) || !csaSubfolderKey) return null
  return buildings.find(b => b.subfolders.csa === csaSubfolderKey) || null
}

/**
 * Look up the building that owns a given PA subfolder key. Used by other
 * features (per-building progress report editor, future per-building views).
 */
export function findBuildingByPaSubfolder(buildings, paSubfolderKey) {
  if (!Array.isArray(buildings) || !paSubfolderKey) return null
  return buildings.find(b => b.subfolders.pa === paSubfolderKey) || null
}

/**
 * Display name helper. Returns building.name with a defensive fallback.
 */
export function buildingDisplayName(building) {
  if (!building) return ''
  return building.name || building.label || `Building ${building.ordinal}`
}
