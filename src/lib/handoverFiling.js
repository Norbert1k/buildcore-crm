// Filing helpers for the H&S File & O&M view.
import { parseDrawing, parseRevision, compareRev } from '../components/DrawingsSurveysTab'

// Nearest "Superseded" folder above (or beside) a folder in the handover tree.
export function supersededKeyFor(structure, folderKey) {
  const parents = {}
  ;(function walk(nodes, parent) { nodes.forEach(n => { parents[n.key] = { node: n, parent }; walk(n.children || [], n) }) })(structure, null)
  let cur = parents[folderKey]?.node
  while (cur) {
    const sup = (cur.children || []).find(c => /superseded/i.test(c.label))
    if (sup) return sup.key
    cur = parents[cur.key]?.parent
  }
  return null
}

// When a drawing arrives, keep only the newest revision of each drawing number
// in the live folder; older revisions move to the nearest Superseded folder.
// Returns the moves to make — nothing is deleted.
export function revisionMoves(structure, incoming, existing) {
  if (incoming.ai?.doc_type !== 'drawing') return []
  const pn = drawingKey(incoming.file_name || '')
  if (!pn.key || !pn.rev) return []
  const isSup = k => /superseded/i.test(labelOf(structure, k) || '')
  // Only drawings in the same folder — a similar name in another package isn't the same drawing
  const same = existing.filter(f => f.id !== incoming.id && f.ai?.doc_type === 'drawing' && !isSup(f.folder_key) && f.folder_key === incoming.folder_key)
    .map(f => ({ f, p: drawingKey(f.file_name || '') }))
    .filter(x => x.p.key === pn.key && x.p.rev)
  const moves = []
  for (const { f, p } of same) {
    const c = compareRev(pn.rev, p.rev)
    if (c === 1) { const to = supersededKeyFor(structure, f.folder_key); if (to) moves.push({ file: f, to, why: `Rev ${p.rev} replaced by Rev ${pn.rev}` }) }
    if (c === -1) { const to = supersededKeyFor(structure, incoming.folder_key); if (to) moves.push({ file: incoming, to, why: `Rev ${pn.rev} is older than Rev ${p.rev}` }) }
  }
  return moves
}

// Drawing number + revision. Long numbers (AP20027-D01) come from parseDrawing;
// short ones (A-100) fall back to the name without its revision.
function drawingKey(name) {
  const p = parseDrawing(name)
  if (p.key) return p
  const { rev, base } = parseRevision(name)
  return { key: base.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || null, rev }
}

function labelOf(structure, key) {
  let found = null
  ;(function walk(nodes) { nodes.forEach(n => { if (n.key === key) found = n.label; walk(n.children || []) }) })(structure)
  return found
}

// Files and whole folders dropped from the desktop → [{ file, path }]
export async function collectDropped(dataTransfer) {
  const items = Array.from(dataTransfer?.items || [])
  const entries = items.map(i => i.webkitGetAsEntry?.()).filter(Boolean)
  if (!entries.length) return Array.from(dataTransfer?.files || []).map(file => ({ file, path: '' }))
  const out = []
  const readAll = reader => new Promise(res => {
    const all = []
    const next = () => reader.readEntries(batch => { if (!batch.length) return res(all); all.push(...batch); next() }, () => res(all))
    next()
  })
  async function walk(entry, path) {
    if (entry.isFile) {
      const file = await new Promise(res => entry.file(res, () => res(null)))
      if (file && !/^\./.test(file.name)) out.push({ file, path })
    } else if (entry.isDirectory) {
      for (const child of await readAll(entry.createReader())) await walk(child, path ? `${path}/${entry.name}` : entry.name)
    }
  }
  for (const e of entries) await walk(e, '')
  return out
}
