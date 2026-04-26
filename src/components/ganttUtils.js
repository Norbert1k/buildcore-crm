// ─── Date helpers (UTC-safe, no timezone drift) ─────────────
export const DAY_MS = 86400000

export function parseDate(s) {
  if (!s) return null
  // Accept 'YYYY-MM-DD' or ISO; build a UTC date so day index is stable
  if (typeof s === 'string') {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  }
  return new Date(s)
}

export function fmtDate(d) {
  if (!d) return ''
  const dt = (d instanceof Date) ? d : parseDate(d)
  if (!dt) return ''
  const y = dt.getUTCFullYear(), m = String(dt.getUTCMonth() + 1).padStart(2, '0'), day = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fmtDateUK(d) {
  if (!d) return ''
  const dt = (d instanceof Date) ? d : parseDate(d)
  if (!dt) return ''
  return dt.toLocaleDateString('en-GB', { timeZone: 'UTC' })
}

export function addDays(date, n) {
  const d = (date instanceof Date) ? new Date(date) : parseDate(date)
  if (!d) return null
  d.setUTCDate(d.getUTCDate() + n)
  return d
}

export function diffDays(a, b) {
  const da = (a instanceof Date) ? a : parseDate(a)
  const db = (b instanceof Date) ? b : parseDate(b)
  if (!da || !db) return 0
  return Math.round((db - da) / DAY_MS)
}

// Inclusive duration between two dates (1 May to 1 May = 1 day)
export function durationFromDates(start, end) {
  return Math.max(1, diffDays(start, end) + 1)
}

export function endFromStartAndDuration(start, durationDays) {
  if (!start) return null
  const s = (start instanceof Date) ? start : parseDate(start)
  if (!s) return null
  return addDays(s, Math.max(1, durationDays) - 1)
}

// ─── Task tree helpers ──────────────────────────────────────
export function newTask({ name = 'New task', start = null, end = null } = {}) {
  return {
    id: crypto.randomUUID(),
    name,
    start_date: start ? fmtDate(start) : fmtDate(new Date()),
    end_date: end ? fmtDate(end) : fmtDate(addDays(new Date(), 6)),
    parent_id: null,
    depends_on: [],
    color: '#448a40',
    progress: 0,
    notes: '',
    collapsed: false,
  }
}

// Returns a flat ordered list of tasks, indented per parent depth.
// Honours `collapsed` flags on parents (children of collapsed groups are hidden).
export function flattenTasks(tasks) {
  const byParent = {}
  for (const t of tasks) {
    const p = t.parent_id || '__root__'
    if (!byParent[p]) byParent[p] = []
    byParent[p].push(t)
  }
  const out = []
  function walk(parentId, depth) {
    const kids = byParent[parentId || '__root__'] || []
    for (const k of kids) {
      const hasChildren = (byParent[k.id] || []).length > 0
      out.push({ ...k, _depth: depth, _hasChildren: hasChildren })
      if (!k.collapsed) walk(k.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

// Get min/max dates across all tasks (for auto-fit timeline)
export function getDateBounds(tasks) {
  if (!tasks.length) {
    const today = new Date()
    return { min: today, max: addDays(today, 30) }
  }
  let min = null, max = null
  for (const t of tasks) {
    const s = parseDate(t.start_date), e = parseDate(t.end_date)
    if (s && (!min || s < min)) min = s
    if (e && (!max || e > max)) max = e
  }
  if (!min || !max) {
    const today = new Date()
    return { min: today, max: addDays(today, 30) }
  }
  return { min, max }
}

// Auto-roll-up of group bars: if a parent has children, its dates span all children.
export function rollupGroups(tasks) {
  const map = new Map(tasks.map(t => [t.id, { ...t }]))
  // Build child lists
  const children = {}
  for (const t of tasks) {
    if (t.parent_id) {
      if (!children[t.parent_id]) children[t.parent_id] = []
      children[t.parent_id].push(t.id)
    }
  }
  // Iteratively roll up (parents come before deeper parents in some orderings,
  // so loop until stable — bounded by depth)
  let changed = true, guard = 0
  while (changed && guard < 50) {
    changed = false; guard++
    for (const [id, t] of map) {
      const kids = (children[id] || []).map(cid => map.get(cid)).filter(Boolean)
      if (kids.length === 0) continue
      const minStart = kids.reduce((m, k) => (!m || k.start_date < m) ? k.start_date : m, null)
      const maxEnd   = kids.reduce((m, k) => (!m || k.end_date   > m) ? k.end_date   : m, null)
      if (t.start_date !== minStart || t.end_date !== maxEnd) {
        t.start_date = minStart
        t.end_date = maxEnd
        changed = true
      }
    }
  }
  return [...map.values()]
}
