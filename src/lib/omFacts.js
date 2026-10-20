// ─────────────────────────────────────────────────────────────────────────────
// O&M builder — what's on the job, what's missing, what disagrees.
//
// Every handover file gets an `ai` reading (written by the handover-ai edge
// function when the file arrives, or when the job is scanned):
//   { doc_type, title, issuer, reference, system, dates{issued,completion,
//     start,expiry,revision}, parties{owner,owner_address,main_contractor,
//     installer}, contacts[], products[], maintenance[], flags[],
//     suggested_folder, client_facing, confidence }
// This module only reads those — it never changes a file.
// ─────────────────────────────────────────────────────────────────────────────

export const DOC_TYPES = {
  guarantee:    { label: 'Guarantee',        tone: 'green' },
  warranty:     { label: 'Warranty',         tone: 'green' },
  drawing:      { label: 'Drawing',          tone: 'blue' },
  calculation:  { label: 'Calculation',      tone: 'blue' },
  product_data: { label: 'Product data',     tone: 'gray' },
  sds:          { label: 'Safety data',      tone: 'amber' },
  certificate:  { label: 'Certificate',      tone: 'green' },
  test_report:  { label: 'Test report',      tone: 'green' },
  manual:       { label: 'O&M / manual',     tone: 'purple' },
  fire_strategy:{ label: 'Fire strategy',    tone: 'red' },
  unit_schedule:{ label: 'Unit schedule',    tone: 'purple' },
  invoice:      { label: 'Supply record',    tone: 'gray' },
  quotation:    { label: 'Quotation',        tone: 'gray' },
  photo:        { label: 'Photo',            tone: 'gray' },
  other:        { label: 'Other',            tone: 'gray' },
}

// What each pack needs. `need` is matched against doc types found on the job.
const REQUIREMENTS = {
  package: [
    { key: 'project',  label: 'Project, owner and contacts', test: f => !!(f.project?.address || f.project?.site_address) && f.owners.length > 0 },
    { key: 'systems',  label: 'Systems installed (scope)',  need: ['guarantee', 'product_data'], min: 1 },
    { key: 'guar',     label: 'Manufacturer guarantees',     need: ['guarantee'], min: 1 },
    { key: 'draw',     label: 'Drawings / layouts',          need: ['drawing'], min: 1 },
    { key: 'calc',     label: 'Design calculations',         need: ['calculation'], min: 0 },
    { key: 'data',     label: 'Product data sheets',         need: ['product_data'], min: 1 },
    { key: 'sds',      label: 'Safety data sheets (COSHH)',  need: ['sds'], min: 1 },
    { key: 'maint',    label: 'Maintenance requirements',    test: f => f.maintenance.length > 0, detail: f => `${f.maintenance.length} tasks found in the manufacturers' documents` },
    { key: 'compl',    label: 'Completion date (starts the guarantees)', test: f => !!f.completion || f.guaranteed.every(s => s.completion),
      detail: f => {
        if (f.completion) return `Practical completion ${f.completion}${f.guaranteed.some(s => s.completion) ? ' · own dates used where a guarantee states one' : ''}`
        const no = f.guaranteed.filter(s => !s.completion)
        if (!no.length) return `${f.guaranteed.length} guaranteed system${f.guaranteed.length === 1 ? '' : 's'} dated`
        return `${no.length} guaranteed system${no.length === 1 ? '' : 's'} with no date (${no.slice(0, 3).map(s => s.name).join(', ')}${no.length > 3 ? ` +${no.length - 3} more` : ''}) — add the PC certificate at the top of the project, or set the date here`
      }, action: 'completion' },
  ],
  building: [
    { key: 'project',  label: 'Project, client and contacts', test: f => !!(f.project?.address || f.project?.site_address) },
    { key: 'asbuilt',  label: 'As-built drawings',            need: ['drawing'], min: 1 },
    { key: 'manuals',  label: 'System O&M manuals',            need: ['manual'], min: 1 },
    { key: 'certs',    label: 'Certificates (EIC, fire alarm, emergency lighting…)', need: ['certificate', 'test_report'], min: 1 },
    { key: 'guar',     label: 'Guarantees and warranties',    need: ['guarantee', 'warranty'], min: 1 },
    { key: 'sds',      label: 'Safety data sheets (COSHH)',   need: ['sds'], min: 0 },
    { key: 'maint',    label: 'Maintenance requirements',     test: f => f.maintenance.length > 0, detail: f => `${f.maintenance.length} tasks found` },
  ],
  tenant: [
    { key: 'units',    label: 'Unit schedule (flats, types, appliances)', need: ['unit_schedule'], min: 1 },
    { key: 'fire',     label: 'Fire strategy (evacuation approach)', need: ['fire_strategy'], min: 1 },
    { key: 'apps',     label: 'Appliance manuals',             need: ['manual'], min: 1 },
  ],
  gt: [
    { key: 'gtfire',   label: 'Fire strategy',                 need: ['fire_strategy'], min: 1 },
    { key: 'gtcerts',  label: 'Life-safety commissioning certificates', need: ['certificate', 'test_report'], min: 1 },
    { key: 'gtdraw',   label: 'As-built drawings',             need: ['drawing'], min: 1 },
    { key: 'gtbsr',    label: 'BSR registration and completion application', test: f => !!f.options?.building?.bsr_ref, detail: () => 'Add the BSR registration reference' },
  ],
}

export const isHRB = b => !!b && (Number(b.height_m) >= 18 || Number(b.storeys) >= 7) && Number(b.units) >= 2

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

// ── Owner / address clean-up ─────────────────────────────────────────────────
// On housing jobs every plot certificate carries its own address (4 Mulberry
// Close, 6 Mulberry Close…). Those are the homes, not the building owner's
// address, so they are kept as "units" and never raised as a conflict. Our own
// name/address and CCG staff named on a document are never the owner either.
const CCG = /city\s*construction|canada\s*square|e14\s*5aa/i
const postcodeOf = s => {
  const m = String(s || '').toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d)([A-Z]{2})\b/)
  return m ? { full: `${m[1]} ${m[2]}${m[3]}`, sector: `${m[1]} ${m[2]}` } : null
}
const streetOf = s => String(s || '').toLowerCase().split(',')[0].replace(/\(.*?\)/g, '').replace(/^\s*(plot\s*)?\d+[a-z]?\s*/, '').replace(/[^a-z ]/g, '').trim()
const coName = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(ltd|limited|plc|llp|co|company|the|uk)\b/g, ' ').replace(/\s+/g, ' ').trim()

function splitAddresses(owners, project) {
  const site = postcodeOf([project?.postcode, project?.address, project?.site_address].filter(Boolean).join(' '))
  const town = String(project?.town || '').trim().toLowerCase()
  const all = owners.filter(o => o.address && !CCG.test(o.address))
  const streetCount = {}
  all.forEach(o => { const k = streetOf(o.address); if (k) streetCount[k] = (streetCount[k] || 0) + 1 })
  const units = [], office = []
  for (const o of all) {
    const pc = postcodeOf(o.address)
    const unit = (site && pc && pc.sector === site.sector) || (town && o.address.toLowerCase().includes(town)) || (streetCount[streetOf(o.address)] || 0) >= 3
    ;(unit ? units : office).push(o)
  }
  return { units, office }
}

export function analyse({ project, files, options, overrides = {}, staffNames = [] }) {
  const read = files.filter(f => f.ai)
  const byType = {}
  read.forEach(f => { (byType[f.ai.doc_type] ||= []).push(f) })

  // Systems: one per guarantee / warranty system, with its completion date
  const sysMap = new Map()
  read.forEach(f => {
    const sys = f.ai.system; if (!sys) return
    const k = norm(sys)
    const cur = sysMap.get(k) || { name: sys, sources: [], completion: null }
    cur.sources.push(f)
    if (f.ai.dates?.completion && !cur.completion) cur.completion = f.ai.dates.completion
    sysMap.set(k, cur)
  })
  // Same product line read from several documents ("Garland — flat roofs",
  // "Garland Stressply Evolution — flat roofs and balconies") is one system:
  // merge by the name before the dash, minus generic trade words.
  const GENERIC = /\b(drainage|plumbing|roofing|electrical|surface|water|foul|system|systems|the)\b/g
  const brandKey = n => String(n || '').split(/\s[—–-]\s/)[0].toLowerCase().replace(GENERIC, ' ').replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/)[0] || ''
  const merged = new Map()
  for (const sys of sysMap.values()) {
    const k = brandKey(sys.name) || norm(sys.name)
    const cur = merged.get(k)
    if (!cur) merged.set(k, { ...sys, sources: [...sys.sources] })
    else { cur.sources.push(...sys.sources); if (!cur.completion && sys.completion) cur.completion = sys.completion; if (sys.name.length < cur.name.length) cur.name = sys.name }
  }
  const systems = [...merged.values()]
  // Only systems backed by a guarantee or warranty need a start (completion) date
  const guaranteed = systems.filter(s => s.sources.some(f => ['guarantee', 'warranty'].includes(f.ai.doc_type)))
  const completion = overrides?.practical_completion || null

  // Parties stated in the documents
  const owners = []
  read.forEach(f => { const p = f.ai.parties || {}; if (p.owner) owners.push({ value: p.owner, address: p.owner_address, file: f }) })

  // Conflicts — the same fact stated differently in two documents
  const conflicts = []
  const { units, office } = splitAddresses(owners, project)
  // Same postcode = same address, however it's typed
  const byPlace = new Map()
  office.forEach(o => { const k = postcodeOf(o.address)?.full || norm(o.address); (byPlace.get(k) || byPlace.set(k, []).get(k)).push(o) })
  // Show each place the way it's most often written (never the "postcode …" variant if avoidable)
  const distinct = [...byPlace.values()].map(list => {
    const score = o => list.filter(x => norm(x.address) === norm(o.address)).length * 10 - (/postcode/i.test(o.address) ? 5 : 0) + o.address.length / 1000
    return [...list].sort((a, b) => score(b) - score(a))[0]
  })
  if (distinct.length > 1) conflicts.push({ key: 'owner_address', label: 'Building owner address', values: distinct.map(o => ({ value: o.address, source: o.file.file_name })) })
  // Owner names: ignore CCG and its staff; "Chatsworth Homes Ltd" = "Chatsworth Homes Limited";
  // a longer name that starts with a shorter one ("Chatsworth Homes Garboldisham Ltd") is the same firm
  const staff = new Set(staffNames.map(coName).filter(Boolean))
  const named = owners.filter(o => !CCG.test(o.value) && !staff.has(coName(o.value)))
  const groups = []
  for (const o of [...named].sort((a, b) => coName(a.value).length - coName(b.value).length)) {
    const k = coName(o.value)
    const g = groups.find(x => k === x.key || k.startsWith(x.key + ' ') || x.key.startsWith(k + ' '))
    if (g) { g.items.push(o) } else groups.push({ key: k, items: [o] })
  }
  const pick = g => { const counts = {}; g.items.forEach(o => { counts[o.value] = (counts[o.value] || 0) + 1 }); return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0] }
  if (groups.length > 1) conflicts.push({ key: 'owner', label: 'Building owner', values: groups.map(g => ({ value: pick(g), source: g.items[0].file.file_name + (g.items.length > 1 ? ` + ${g.items.length - 1} more` : '') })) })
  const unitAddresses = [...new Map(units.map(o => [norm(o.address), o.address])).values()]

  // Warnings — things Claude flagged while reading, plus age checks
  const warnings = []
  read.forEach(f => (f.ai.flags || []).forEach(msg => { if (String(msg || '').trim()) warnings.push({ msg: String(msg).trim(), file: f }) }))
  ;(byType.sds || []).forEach(f => {
    const y = Number(String(f.ai.dates?.revision || f.ai.dates?.issued || '').slice(-4))
    if (y && new Date().getFullYear() - y > 5) warnings.push({ msg: `Safety data sheet revised ${y} — ask the supplier for the current version`, file: f })
  })

  const maintenance = read.flatMap(f => (f.ai.maintenance || []).map(m => ({ ...m, file: f })))
  const facts = { project, options, systems, guaranteed, completion, owners, maintenance, byType }

  const kind = options?.type === 'building' ? 'building' : 'package'
  const lists = [['O&M manual', REQUIREMENTS[kind]]]
  if (options?.tenant) lists.push(['Tenant O&M', REQUIREMENTS.tenant])
  if (options?.golden_thread) lists.push(['Golden Thread', REQUIREMENTS.gt])
  const readiness = lists.map(([group, reqs]) => ({
    group,
    items: reqs.map(r => {
      if (r.test) {
        const ok = r.test(facts)
        return { key: r.key, label: r.label, status: ok ? 'ok' : 'missing', detail: r.detail ? r.detail(facts) : (ok ? 'Found' : 'Not found yet'), action: r.action }
      }
      const found = r.need.flatMap(t => byType[t] || [])
      const status = found.length >= Math.max(1, r.min) ? 'ok' : r.min === 0 ? 'optional' : 'missing'
      return { key: r.key, label: r.label, status, count: found.length, detail: found.length ? `${found.length} found` : (r.min === 0 ? 'None — optional' : 'Not found yet'), files: found }
    }),
  }))

  const missing = readiness.flatMap(g => g.items).filter(i => i.status === 'missing').length
  return { systems, owners, conflicts, warnings, maintenance, byType, readiness, missing, units: unitAddresses, unread: files.filter(f => !f.ai).length, read: read.length }
}
