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
    { key: 'compl',    label: 'Completion date for every system', test: f => f.systems.every(s => s.completion), detail: f => f.systems.filter(s => !s.completion).map(s => `No completion date: ${s.name}`).join(' · ') || `${f.systems.length} systems dated` },
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

export function analyse({ project, files, options }) {
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
  const systems = [...sysMap.values()]

  // Parties stated in the documents
  const owners = []
  read.forEach(f => { const p = f.ai.parties || {}; if (p.owner) owners.push({ value: p.owner, address: p.owner_address, file: f }) })

  // Conflicts — the same fact stated differently in two documents
  const conflicts = []
  const addrs = owners.filter(o => o.address)
  const distinct = [...new Map(addrs.map(o => [norm(o.address), o])).values()]
  if (distinct.length > 1) conflicts.push({ key: 'owner_address', label: 'Building owner address', values: distinct.map(o => ({ value: o.address, source: o.file.file_name })) })
  const names = [...new Map(owners.map(o => [norm(o.value), o])).values()]
  if (names.length > 1) conflicts.push({ key: 'owner', label: 'Building owner', values: names.map(o => ({ value: o.value, source: o.file.file_name })) })

  // Warnings — things Claude flagged while reading, plus age checks
  const warnings = []
  read.forEach(f => (f.ai.flags || []).forEach(msg => warnings.push({ msg, file: f })))
  ;(byType.sds || []).forEach(f => {
    const y = Number(String(f.ai.dates?.revision || f.ai.dates?.issued || '').slice(-4))
    if (y && new Date().getFullYear() - y > 5) warnings.push({ msg: `Safety data sheet revised ${y} — ask the supplier for the current version`, file: f })
  })

  const maintenance = read.flatMap(f => (f.ai.maintenance || []).map(m => ({ ...m, file: f })))
  const facts = { project, options, systems, owners, maintenance, byType }

  const kind = options?.type === 'building' ? 'building' : 'package'
  const lists = [['O&M manual', REQUIREMENTS[kind]]]
  if (options?.tenant) lists.push(['Tenant O&M', REQUIREMENTS.tenant])
  if (options?.golden_thread) lists.push(['Golden Thread', REQUIREMENTS.gt])
  const readiness = lists.map(([group, reqs]) => ({
    group,
    items: reqs.map(r => {
      if (r.test) {
        const ok = r.test(facts)
        return { key: r.key, label: r.label, status: ok ? 'ok' : 'missing', detail: r.detail ? r.detail(facts) : (ok ? 'Found' : 'Not found yet') }
      }
      const found = r.need.flatMap(t => byType[t] || [])
      const status = found.length >= Math.max(1, r.min) ? 'ok' : r.min === 0 ? 'optional' : 'missing'
      return { key: r.key, label: r.label, status, count: found.length, detail: found.length ? `${found.length} found` : (r.min === 0 ? 'None — optional' : 'Not found yet'), files: found }
    }),
  }))

  const missing = readiness.flatMap(g => g.items).filter(i => i.status === 'missing').length
  return { systems, owners, conflicts, warnings, maintenance, byType, readiness, missing, unread: files.filter(f => !f.ai).length, read: read.length }
}
