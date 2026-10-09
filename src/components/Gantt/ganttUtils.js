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

// ─── AI parser → Gantt task format ──────────────────────────
// Converts the JSON Claude returns ([{ name, start_date, end_date, parent_name, ... }])
// into the editor's task structure (with proper IDs and parent_id pointers).
export function tasksFromAiResponse(aiTasks) {
  if (!Array.isArray(aiTasks)) return []
  // First pass: create tasks with new UUIDs
  const out = aiTasks.map((t, i) => ({
    id: crypto.randomUUID(),
    name: t.name || `Task ${i + 1}`,
    start_date: t.start_date || fmtDate(new Date()),
    end_date: t.end_date || fmtDate(addDays(new Date(), 6)),
    parent_id: null,            // resolved in pass 2
    _parent_name: t.parent_name, // temporary lookup helper
    depends_on: [],
    color: t.color || '#448a40',
    progress: 0,
    notes: t.is_milestone ? 'Milestone' : '',
    collapsed: false,
  }))
  // Second pass: resolve parent_id by matching parent_name to a task in the list
  const byName = new Map()
  for (const t of out) byName.set(t.name, t.id)
  for (const t of out) {
    if (t._parent_name && byName.has(t._parent_name)) {
      t.parent_id = byName.get(t._parent_name)
    }
    delete t._parent_name
  }
  // Tag stages at creation so new programmes come out in the CCG colour
  // scheme straight away (groups — rows with children — carry no stage).
  const parents = new Set(out.map(t => t.parent_id).filter(Boolean))
  aiTasks.forEach((src, i) => {
    const t = out[i]
    if (parents.has(t.id)) return
    const st = (src.stage && STAGE_MAP.has(String(src.stage).toUpperCase()) ? String(src.stage).toUpperCase() : null)
      || (src.is_milestone ? 'MILESTONE' : inferStage(t.name))
    if (st) { t.stage = st; t.color = stageColor(st) || t.color }
    if (st === 'MILESTONE') t.end_date = t.start_date
  })
  return out
}

// ─── Programme stages (CCG programme house style) ──────────
// Each task can carry a `stage`; the stage drives the bar colour, the STAGE
// column and the key on exported programmes. Tasks without a stage get one
// inferred from their name (falling back to their own colour).
export const STAGES = [
  { key: 'PRE-CONTRACT',   color: '#999999' },
  { key: 'DESIGN',         color: '#E69138' },
  { key: 'SURVEY',         color: '#B4A7D6' },
  { key: 'APPROVAL',       color: '#8E7CC3' },
  { key: 'PROCUREMENT',    color: '#E06666' },
  { key: 'SET-UP',         color: '#6FA8DC' },
  { key: 'ENABLING',       color: '#9FC5E8' },
  { key: 'STRIP-OUT',      color: '#3D85C6' },
  { key: 'STRUCTURE',      color: '#76A5AF' },
  { key: 'TEMP WORKS',     color: '#C27BA0' },
  { key: 'ENVELOPE',       color: '#45818E' },
  { key: 'INSULATION',     color: '#A2C4C9' },
  { key: 'FLOOR BUILD-UP', color: '#B6D7A8' },
  { key: 'PARTITIONS',     color: '#93C47D' },
  { key: 'M&E 1ST FIX',    color: '#F1C232' },
  { key: 'FIRE / QA',      color: '#A61C00' },
  { key: 'CEILINGS',       color: '#6AA84F' },
  { key: 'PLASTER',        color: '#D5A6BD' },
  { key: 'TILING',         color: '#B45F06' },
  { key: 'KITCHENS',       color: '#A64D79' },
  { key: '2ND FIX',        color: '#BF9000' },
  { key: 'DECORATION',     color: '#E6B8AF' },
  { key: 'FLOORING',       color: '#274E13' },
  { key: 'EXTERNALS',      color: '#7F6000' },
  { key: 'UTILITIES',      color: '#674EA7' },
  { key: 'COMMISSIONING',  color: '#0B5394' },
  { key: 'HANDOVER',       color: '#2C2C2A' },
  { key: 'MILESTONE',      color: '#CC0000' },
]
const STAGE_MAP = new Map(STAGES.map(s => [s.key, s]))
export function stageColor(stage) { return STAGE_MAP.get(stage)?.color || null }

// Keyword inference for tasks that predate stages (first match wins).
const STAGE_RULES = [
  ['MILESTONE',      /\b(milestone|practical completion|contract award|letter of intent|tender return|start on site|possession date|sectional completion)/i],
  ['PRE-CONTRACT',   /\b(tender|pre-?contract|contract negotiation|clarification)/i],
  ['PROCUREMENT',    /\b(procure|order|lead[- ]?time|manufactur|procurement|tender package)/i],
  ['FLOOR BUILD-UP', /\b(floor build[- ]?up|screed|ufh|underfloor|acoustic layer)/i],
  ['HANDOVER',       /\b(handover|hand-over|snag|o&m|h&s file|builder'?s clean|clean)/i],
  ['COMMISSIONING',  /\b(commission|testing|air test|sound test|epc|witness)/i],
  ['2ND FIX',        /\b(2nd fix|second fix|sanitaryware)/i],
  ['STRIP-OUT',      /\b(strip[- ]?out|demolition|soft strip)/i],
  ['PARTITIONS',     /\b(partition|stud|drylin|shaft wall|metal stud)/i],
  ['SURVEY',         /\b(survey|r&d|intrusive|investigation)/i],
  ['APPROVAL',       /\b(approval|building control|planning|discharge|condition|consent|licen[cs]e)/i],
  ['DESIGN',         /\b(design|drawings?|stage \d|technical)/i],
  ['SET-UP',         /\b(set[- ]?up|mobilis|hoarding|welfare|site establishment|compound|possession)/i],
  ['ENABLING',       /\b(enabling|asbestos|service isolation|isolations?|diversion)/i],
  ['TEMP WORKS',     /\b(scaffold|temporary works|temp works|propping)/i],
  ['STRUCTURE',      /\b(structur|frame|steel|concrete|slab|foundation|piling|groundworks|blockwork|brickwork|sfs|superstructure|substructure|roof structure|truss)/i],
  ['ENVELOPE',       /\b(envelope|window|glazing|cladding|facade|façade|roof(ing)?|render|elevation|curtain wall)/i],
  ['INSULATION',     /\b(insulation)/i],
  ['M&E 1ST FIX',    /\b(1st fix|first fix|m&e|mep|mechanical|electrical|plumbing|sprinkler|mvhr|ventilation|containment)/i],
  ['FIRE / QA',      /\b(fire[- ]?stop|fire strategy|golden thread|qa|close[- ]?up|inspection)/i],
  ['CEILINGS',       /\b(ceiling)/i],
  ['PLASTER',        /\b(plaster|skim|tape and joint|taping)/i],
  ['TILING',         /\b(tiling|tiles?)/i],
  ['KITCHENS',       /\b(kitchen|appliance)/i],
  ['2ND FIX',        /\b(2nd fix|second fix|sanitaryware|ironmongery|joinery|doors?)/i],
  ['DECORATION',     /\b(decorat|paint)/i],
  ['FLOORING',       /\b(flooring|carpet|lvt|vinyl|floor finish)/i],
  ['EXTERNALS',      /\b(external|landscap|paving|garden|decking|fenc|drainage|highway|s278|s38|s50|parking|ev charg)/i],
  ['UTILITIES',      /\b(utilit|ssen|ukpn|water main|meter|incoming services|bt\b|openreach|gas connection)/i],
]
export function inferStage(name) {
  const n = String(name || '')
  for (const [stage, re] of STAGE_RULES) if (re.test(n)) return stage
  return null
}
export function isMilestoneTask(t, hasChildren = false) {
  if (hasChildren) return false
  if (t.stage === 'MILESTONE') return true
  if (t.notes === 'Milestone') return true
  return !!t.start_date && t.start_date === t.end_date && (!t.stage || t.stage === 'MILESTONE') && /milestone|completion|award|return|start on site|possession|letter of intent/i.test(t.name || '')
}
export function effectiveStage(t, hasChildren = false) {
  if (hasChildren) return null
  if (isMilestoneTask(t, false)) return 'MILESTONE'
  return t.stage || inferStage(t.name)
}

// ─── UK working-day calendar ────────────────────────────────
// England & Wales bank holidays (with substitute days) + a Christmas
// shutdown: from the Monday of the week containing 24 Dec to the Sunday of
// the week containing 1 Jan. DAYS on exported programmes = working days.
function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(y, month - 1, day))
}
const _bhCache = new Map()
export function bankHolidays(y) {
  if (_bhCache.has(y)) return _bhCache.get(y)
  const set = new Set()
  const D = (m, d) => new Date(Date.UTC(y, m, d))
  const firstMon = (m) => { const d = D(m, 1); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); return d }
  const lastMon = (m) => { const d = D(m + 1, 0); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() - 1); return d }
  const sub = (d) => { const x = new Date(d); while ([0, 6].includes(x.getUTCDay()) || set.has(fmtDate(x))) x.setUTCDate(x.getUTCDate() + 1); return x }
  set.add(fmtDate(sub(D(0, 1))))
  const es = easterSunday(y)
  set.add(fmtDate(addDays(es, -2))); set.add(fmtDate(addDays(es, 1)))
  set.add(fmtDate(firstMon(4))); set.add(fmtDate(lastMon(4))); set.add(fmtDate(lastMon(7)))
  set.add(fmtDate(sub(D(11, 25)))); set.add(fmtDate(sub(D(11, 26))))
  _bhCache.set(y, set)
  return set
}
export function shutdownRange(y) {
  // Monday of the week containing 24 Dec (year y) → Sunday of the week containing 1 Jan (y+1)
  const xmas = new Date(Date.UTC(y, 11, 24))
  const start = addDays(xmas, -((xmas.getUTCDay() + 6) % 7))
  const ny = new Date(Date.UTC(y + 1, 0, 1))
  const end = addDays(ny, 6 - ((ny.getUTCDay() + 6) % 7))
  return { start, end }
}
export function isShutdown(d) {
  const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear()
  const r = shutdownRange(y)
  return d >= r.start && d <= r.end
}
export function isWorkingDay(d, { shutdown = true } = {}) {
  const dow = d.getUTCDay()
  if (dow === 0 || dow === 6) return false
  if (bankHolidays(d.getUTCFullYear()).has(fmtDate(d))) return false
  if (shutdown && isShutdown(d)) return false
  return true
}
export function workingDaysBetween(start, end, opts) {
  const s = (start instanceof Date) ? start : parseDate(start)
  const e = (end instanceof Date) ? end : parseDate(end)
  if (!s || !e || e < s) return 0
  let n = 0
  for (let d = new Date(s); d <= e; d = addDays(d, 1)) if (isWorkingDay(d, opts)) n++
  return n
}
