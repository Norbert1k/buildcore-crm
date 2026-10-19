// O&M builder — server calls.
//   handover-ai (Supabase edge function, Claude):
//     read    — reads one file, returns the `ai` reading and stores it on the row
//     compose — writes the manual's sections from everything read on the job
//   /api/om-render (Vercel function, headless Chromium):
//     prints the house-style HTML, adds header/footer/page numbers/bookmarks,
//     binds the appendix documents in, saves the PDF to the job's Handover.
import { supabase } from './supabase'

// folders: { key: 'Section 8 › 8.4 Catalogue › 03. Roof', … } — Claude picks one
export async function readDocument(file, table, folders) {
  const { data, error } = await supabase.functions.invoke('handover-ai', { body: { action: 'read', table, file_id: file.id, folders, hint: file.hint || '' } })
  if (error) throw error
  return data?.ai || null
}

export async function composePack(projectId, options, overrides) {
  const { data, error } = await supabase.functions.invoke('handover-ai', { body: { action: 'compose', project_id: projectId, options, overrides } })
  if (error) throw error
  return data   // { status: 'ok', packs: { om, tenant? } } | { status: 'insufficient', missing: [] }
}

// Stamp the issue onto each pack and hand it to the print service, which uses
// the same renderer as the on-screen preview (omRenderCore.js).
export async function renderPack(projectId, packs, { approvedBy }) {
  const today = new Date()
  const stamp = p => p && ({
    ...p,
    doc: { ...p.doc, status: null, status_short: null,
      date_short: today.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '.'),
      date_long: today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      approved_by: approvedBy },
  })
  const stamped = Object.fromEntries(Object.entries(packs).filter(([, p]) => p).map(([k, p]) => [k, stamp(p)]))
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/api/om-render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify({ project_id: projectId, packs: stamped }),
  })
  let out = null
  try { out = await res.json() } catch {}
  if (!res.ok) throw new Error(out?.error || `Render failed (${res.status})`)
  return out   // { issue_no, file_id, file_name, pages, folder_key, files: [...] } — the server numbers the issue
}
