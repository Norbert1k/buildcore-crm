import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Project › Drawings — a plain link to this job in the Design portal.
// Drawings live in Design; the CRM just opens the right project there
// (signed in, through the existing secure hand-off) and shows which Design
// project the job is linked to, so a wrong link is obvious and easy to fix.
// Nothing in the Design portal is read in bulk or changed from here.
export default function DesignLink({ projectId, canManage, onOpenDocuments }) {
  const [proj, setProj] = useState(null)
  const [link, setLink] = useState(null)          // null = checking | { linked, project } | { ambiguous, projects } | { error }
  const [edit, setEdit] = useState(null)          // code being typed
  const [opening, setOpening] = useState(false)

  useEffect(() => { load() }, [projectId])
  async function load() {
    setLink(null)
    const [{ data: p }, res] = await Promise.all([
      supabase.from('projects').select('id, project_name, project_ref, design_code').eq('id', projectId).maybeSingle(),
      supabase.functions.invoke('design-link', { body: { project_id: projectId, action: 'resolve' } }),
    ])
    setProj(p || null)
    const d = res.data
    if (res.error || !d) setLink({ error: true })
    else if (d.status === 'ambiguous') setLink({ ambiguous: true, projects: d.projects || [], code: d.code })
    else setLink({ linked: !!d.linked, project: d.project || null, code: d.code })
  }

  async function open() {
    const w = window.open('', '_blank')            // before the await so pop-up blockers allow it
    if (w) w.opener = null
    setOpening(true)
    const { data } = await supabase.functions.invoke('design-link', { body: { project_id: projectId, action: 'handoff', embed: false } })
    setOpening(false)
    if (data?.status === 'ok' && w) { w.location.href = data.url; return }
    w?.close()
    alert(data?.status === 'no_access' ? 'Your Design portal account isn’t a member of this project. Ask a CCG admin to add you there.'
      : data?.status === 'no_account' ? 'You don’t have a Design portal account yet — ask a CCG admin to invite you.'
      : data?.status === 'ambiguous' ? 'Two Design projects use this job’s code — set this job’s own code with “Change link”.'
      : 'Couldn’t open the Design portal — try again.')
  }

  async function save() {
    const v = (edit || '').trim() || null
    const { data, error } = await supabase.from('projects').update({ design_code: v }).eq('id', projectId).select('id')
    if (error || !data?.length) { alert('Couldn’t change the link' + (error ? ': ' + error.message : ' — you don’t have permission.')); return }
    setEdit(null); load()
  }

  // A link to a differently named Design project is almost always a mistake
  const words = t => new Set(String(t || '').toLowerCase().replace(/\(.*?\)/g, ' ').split(/[^a-z0-9]+/)
    .filter(w => w.length >= 4 && !['road', 'street', 'lane', 'house', 'court', 'phase', 'block', 'building', 'project', 'sample', 'development', 'site'].includes(w)))
  const mismatch = link?.linked && proj?.project_name && link.project?.name
    && (() => { const a = words(proj.project_name), b = words(link.project.name); return a.size > 0 && b.size > 0 && ![...a].some(w => b.has(w)) })()

  return (
    <div className="dl card">
      <div className="dl-icon" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
      </div>
      <div className="dl-body">
        <div className="dl-t">Drawings are kept in the Design portal</div>
        {link === null && <div className="dl-s">Checking the link…</div>}
        {link?.error && <div className="dl-s">The Design portal can’t be reached right now.</div>}
        {link?.linked && (
          <div className="dl-s">Linked to <b>{link.project?.name}</b>{link.project?.code ? <span className="dl-code"> · {link.project.code}</span> : null}</div>
        )}
        {link && !link.error && !link.linked && !link.ambiguous && (
          <div className="dl-s">This job isn’t linked to a Design project yet{link.code ? <> (looked for code “{link.code}”)</> : null}.</div>
        )}
        {link?.ambiguous && (
          <div className="dl-warn">Two Design projects use code “{link.code}”: {link.projects.map(p => p.name).join(' · ')}. Set this job’s own code below.</div>
        )}
        {mismatch && (
          <div className="dl-warn">This job is “{proj.project_name}” but it’s linked to “{link.project.name}”. If that’s wrong, change the link.</div>
        )}

        {edit != null ? (
          <div className="dl-edit">
            <input value={edit} onChange={e => setEdit(e.target.value)} placeholder={proj?.project_ref || 'Design code, e.g. 2026-006'} autoFocus
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEdit(null) }} />
            <button className="btn btn-sm btn-primary" onClick={save}>Save</button>
            <button className="btn btn-sm" onClick={() => setEdit(null)}>Cancel</button>
            <span className="dl-hint">The project’s code in the Design portal. Blank = use this job’s REF ({proj?.project_ref || '—'}).</span>
          </div>
        ) : (
          <div className="dl-actions">
            {link?.linked
              ? <button className="btn btn-primary" onClick={open} disabled={opening}>{opening ? 'Opening…' : 'Open drawings in Design ↗'}</button>
              : <a className="btn" href="https://design.cltd.co.uk" target="_blank" rel="noopener noreferrer">Open the Design portal ↗</a>}
            {canManage && link && !link.error && <button className="btn" onClick={() => setEdit(proj?.design_code || '')}>Change link</button>}
            {onOpenDocuments && <button className="dl-link" onClick={onOpenDocuments}>Older CRM drawings are in Documents › 01. Drawings</button>}
          </div>
        )}
      </div>
    </div>
  )
}
