// ─────────────────────────────────────────────────────────────────────────────
// projectVariations.js
//
// Variations (VOs) per job for the Projects list, read from the VARIATIONS
// section of each job's latest PA (one per building, archived PAs ignored).
// Only VOs with a figure count — empty placeholder rows don't.
//
// Each job's result is cached in this browser until a PA is added or
// replaced on that job (the cache key is the PA files' upload times).
// ─────────────────────────────────────────────────────────────────────────────

import { fetchAllProjectPas } from './paExtractor'

const PREFIX = 'buildcore:vos:v3:'   // v3: formulas saved without results are now worked out

function cacheGet(id, sig) {
  try {
    const raw = localStorage.getItem(PREFIX + id)
    if (!raw) return null
    const c = JSON.parse(raw)
    return c.sig === sig ? c.data : null
  } catch { return null }
}
function cacheSet(id, sig, data) {
  try { localStorage.setItem(PREFIX + id, JSON.stringify({ sig, data })) } catch { /* full or blocked */ }
}

async function parseProject(supabase, projectId) {
  const pas = await fetchAllProjectPas(supabase, projectId)
  const items = []
  let original = 0
  for (const pa of pas) {
    if (pa?.extract?.totals?.total) original += pa.extract.totals.total
    for (const v of (pa?.extract?.variations || [])) {
      const n = parseFloat(v.cost_impact)
      if (!Number.isFinite(n) || n === 0) continue
      items.push({
        no: v.instruction_no != null ? String(v.instruction_no) : '',
        details: v.instruction_details || '',
        amount: n,
        building: pa.subfolder_label || null,
        pa: pa.file_name || null,
      })
    }
  }
  return {
    total: items.reduce((s, v) => s + v.amount, 0),
    count: items.length,
    items,
    pa_original: original,
    has_pa: pas.length > 0,
  }
}

// → { [projectId]: { total, count, items, pa_original, has_pa } }
// onUpdate(partial) is called as each job finishes, so the list fills in.
export async function loadProjectVariations(supabase, projectIds, onUpdate) {
  const out = {}
  if (!projectIds.length) return out
  const { data: files } = await supabase
    .from('project_doc_files')
    .select('project_id, file_name, created_at, subfolder_key')
    .in('project_id', projectIds)
    .eq('folder_key', '02-payment-application')
  const sigOf = id => (files || [])
    .filter(f => f.project_id === id && /\.xlsx$/i.test(f.file_name) && f.subfolder_key !== 'superseded')
    .map(f => `${f.subfolder_key || ''}:${f.created_at}`).sort().join('|')

  const todo = []
  for (const id of projectIds) {
    const sig = sigOf(id)
    if (!sig) { out[id] = { total: 0, count: 0, items: [], pa_original: 0, has_pa: false }; continue }
    const hit = cacheGet(id, sig)
    if (hit) out[id] = hit
    else todo.push([id, sig])
  }
  onUpdate?.({ ...out })

  // A few jobs at a time — each PA is a spreadsheet download
  let i = 0
  async function worker() {
    while (i < todo.length) {
      const [id, sig] = todo[i++]
      try {
        const data = await parseProject(supabase, id)
        out[id] = data
        cacheSet(id, sig, data)
      } catch (e) {
        console.warn('[projectVariations]', id, e)
        out[id] = { total: 0, count: 0, items: [], pa_original: 0, has_pa: false, error: true }
      }
      onUpdate?.({ ...out })
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return out
}
