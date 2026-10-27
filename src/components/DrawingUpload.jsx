import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Modal } from './ui'

// Add drawings to the Design portal without leaving the CRM.
//
//   1. Pick the Design folder (defaults to the one you're looking at).
//   2. The Design portal checks each file against what's already filed there,
//      with its own revision rules: new drawing · newer revision (the old one
//      is kept as superseded) · same / older revision (not uploaded).
//   3. Upload: each file goes straight to Design storage on a one-time link,
//      then Design files it under your own Design account.
// Add-only — nothing in the Design portal is changed or deleted.

const PLAN = {
  new: { label: 'New drawing', cls: 'new' },
  revision: { label: 'New revision', cls: 'rev' },
  ask: { label: 'Same name', cls: 'ask' },
  duplicate: { label: 'Already there — skipped', cls: 'skip' },
  older: { label: 'Older revision — skipped', cls: 'skip' },
  error: { label: 'Can’t upload', cls: 'skip' },
}

async function putSigned(url, file, contentType) {
  // Same request supabase-js makes for a signed upload
  const body = new FormData()
  body.append('cacheControl', '3600')
  body.append('', new Blob([file], { type: contentType || file.type || 'application/octet-stream' }), file.name)
  const res = await fetch(url, { method: 'PUT', body, headers: { 'x-upsert': 'false' } })
  if (!res.ok) { let m = `Upload failed (${res.status})`; try { const j = await res.json(); m = j.message || j.error || m } catch { /* keep */ } throw new Error(m) }
}

export default function DrawingUpload({ projectId, folders, defaultFolder, initialFiles, designName, onClose, onDone }) {
  const lastKey = `dr:upfolder:${projectId}`
  const options = useMemo(() => {
    const byId = new Map(folders.map(f => [f.id, f]))
    const pathOf = id => { const parts = []; let f = byId.get(id); while (f) { parts.unshift(f.name); f = byId.get(f.parent_id) } return parts.join(' › ') }
    // Files live in Design's real folders — the leaves of the tree (stages,
    // disciplines and buildings above them are only groupings)
    return folders.filter(f => !folders.some(x => x.parent_id === f.id)).map(f => ({ id: f.id, label: pathOf(f.id) })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
  }, [folders])
  const [folder, setFolder] = useState(() => {
    if (options.some(o => o.id === defaultFolder)) return defaultFolder
    try { const k = localStorage.getItem(lastKey); if (options.some(o => o.id === k)) return k } catch { /* ignore */ }
    return ''
  })
  const [files, setFiles] = useState(initialFiles || [])
  const [plan, setPlan] = useState(null)            // { items, project, folder } | { error }
  const [choice, setChoice] = useState({})          // ask rows: 'revision' | 'separate' | 'skip'
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(null)            // { done, total }
  const [result, setResult] = useState(null)
  const [over, setOver] = useState(false)
  const inputRef = useRef(null)
  const seq = useRef(0)

  // Ask Design what each file is, whenever the folder or the files change
  useEffect(() => {
    if (!folder || !files.length) { ++seq.current; setChecking(false); setPlan(null); return }
    const n = ++seq.current
    setChecking(true)
    ;(async () => {
      const { data, error } = await supabase.functions.invoke('design-link', { body: { project_id: projectId, action: 'upload_prepare', folder_id: folder, files: files.map(f => ({ name: f.name, size: f.size })) } })
      if (n !== seq.current) return
      setChecking(false)
      if (error || !data) return setPlan({ error: 'Couldn’t reach the Design portal — try again.' })
      if (data.status === 'no_account') return setPlan({ error: 'You don’t have a Design portal account — ask a CCG admin to invite you.' })
      if (data.status === 'no_access') return setPlan({ error: data.message || 'Your Design portal role can’t add drawings to this folder.' })
      if (data.status === 'ambiguous') return setPlan({ error: `Two Design projects use this job's code (${(data.projects || []).map(p => p.name).join(', ')}). Fix the link first.` })
      if (data.status !== 'ok') return setPlan({ error: data.message || 'The Design portal couldn’t take these files.' })
      setPlan(data)
      setChoice({})
    })()
  }, [folder, files, projectId])

  function addFiles(list) {
    const arr = Array.from(list || []).filter(f => f.size && !/^\./.test(f.name))
    if (!arr.length) return
    setResult(null)
    setFiles(prev => { const names = new Set(prev.map(f => f.name.toLowerCase())); return [...prev, ...arr.filter(f => !names.has(f.name.toLowerCase()))] })
  }
  const pickFolder = id => { setFolder(id); setResult(null); try { localStorage.setItem(lastKey, id) } catch { /* ignore */ } }

  const items = plan?.items || []
  const fileOf = name => files.find(f => f.name === name)
  const toSend = items.map(it => {
    if (it.plan === 'new' || it.plan === 'revision') return it
    if (it.plan === 'ask') {
      const c = choice[it.name]
      if (!c || c === 'skip') return null
      if (c === 'separate') return it.alt ? { ...it, ...it.alt, plan: 'new' } : null
      return { ...it, plan: 'revision' }
    }
    return null
  }).filter(Boolean)

  // Design always asks for these — so does this: nothing is superseded by default
  const undecided = items.filter(it => it.plan === 'ask' && !choice[it.name]).length
  async function upload() {
    if (!toSend.length || undecided) return
    setBusy({ done: 0, total: toSend.length })
    const arrived = [], failed = []
    for (const it of toSend) {
      const f = fileOf(it.name)
      try { if (!f) throw new Error('File missing'); await putSigned(it.upload_url, f, it.content_type); arrived.push({ name: it.name, size: f.size, file_id: it.file_id, version_no: it.version_no, path: it.path }) }
      catch (e) { failed.push({ name: it.name, message: e.message }) }
      setBusy(b => ({ ...b, done: b.done + 1 }))
    }
    let done = []
    if (arrived.length) {
      const { data, error } = await supabase.functions.invoke('design-link', { body: { project_id: projectId, action: 'upload_commit', folder_id: folder, items: arrived } })
      if (error || data?.status !== 'ok') failed.push(...arrived.map(a => ({ name: a.name, message: 'Uploaded but not filed — try again' })))
      else { done = data.done || []; failed.push(...(data.failed || [])) }
    }
    setBusy(null)
    setResult({ done, failed, skipped: items.length - toSend.length })
    if (done.length) { setFiles(fs => fs.filter(f => !done.some(d => d.name === f.name))); onDone?.() }
  }

  const where = options.find(o => o.id === folder)?.label
  return (
    <Modal open onClose={busy ? () => {} : onClose} title="Add drawings" size="md"
      footer={<>
        <button className="btn" onClick={onClose} disabled={!!busy}>{result?.done?.length ? 'Done' : 'Cancel'}</button>
        <button className="btn btn-primary" onClick={upload} disabled={!!busy || checking || !toSend.length || !!undecided || !!plan?.error}>
          {busy ? `Uploading ${busy.done}/${busy.total}…` : undecided ? `Choose for ${undecided} file${undecided === 1 ? '' : 's'}` : `Upload ${toSend.length || ''} to Design`}
        </button>
      </>}>
      <div className="du">
        <div className="du-to">
          <span className="du-l">Design project</span>
          <b>{plan?.project?.name || designName || '—'}</b>{plan?.project?.code && <span className="du-code">{plan.project.code}</span>}
        </div>
        <label className="du-folder">
          <span className="du-l">Folder</span>
          <select value={folder} disabled={!!busy} onChange={e => pickFolder(e.target.value)}>
            <option value="">Choose a folder…</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>

        {!busy && <div className={`du-drop${over ? ' over' : ''}`} onClick={() => inputRef.current?.click()} role="button" tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); e.stopPropagation(); setOver(false); addFiles(e.dataTransfer.files) }}>
          <b>{files.length ? 'Add more files' : 'Drop drawings here'}</b><span>PDF, DWG, images… or click to choose</span>
          <input ref={inputRef} type="file" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
        </div>}

        {files.length > 0 && !folder && <div className="du-note">Choose the folder in Design these go into.</div>}
        {checking && <div className="du-note">Checking against the drawings already in Design…</div>}
        {plan?.error && <div className="du-err">{plan.error}</div>}

        {items.length > 0 && !checking && (
          <div className="du-list">
            {items.map(it => {
              const p = PLAN[it.plan] || PLAN.error
              return (
                <div key={it.name} className={`du-row ${p.cls}`}>
                  <div className="du-n">
                    <div className="du-name">{it.name}</div>
                    <div className="du-sub">
                      {it.plan === 'revision' && it.existing && <>Supersedes {it.existing.name}{it.existing.rev ? ` (Rev ${it.existing.rev} → ${it.rev || '?'})` : ''}{it.existing.folder && it.existing.folder !== plan?.folder?.name ? ` · in ${it.existing.folder}` : ''}</>}
                      {(it.plan === 'duplicate' || it.plan === 'older') && it.existing && <>{it.note || `Design has ${it.existing.name}`}</>}
                      {it.plan === 'ask' && <>Design already has a drawing called this{it.existing?.folder ? ` in ${it.existing.folder}` : ''}</>}
                      {it.plan === 'error' && it.note}
                    </div>
                  </div>
                  {it.plan === 'ask'
                    ? <select className={`du-choice${choice[it.name] ? '' : ' need'}`} value={choice[it.name] || ''} disabled={!!busy} onChange={e => setChoice(c => ({ ...c, [it.name]: e.target.value }))}>
                        <option value="" disabled>Choose…</option>
                        <option value="revision">Replace as new revision (old kept)</option>
                        {it.alt && <option value="separate">Separate drawing</option>}
                        <option value="skip">Skip</option>
                      </select>
                    : <span className={`du-tag ${p.cls}`}>{p.label}</span>}
                  {!busy && <button type="button" className="du-x" aria-label={`Remove ${it.name}`} onClick={() => setFiles(fs => fs.filter(f => f.name !== it.name))}>✕</button>}
                </div>
              )
            })}
          </div>
        )}

        {result && (
          <div className={result.failed.length ? 'du-err' : 'du-ok'}>
            {result.done.length > 0 && <>✓ {result.done.length} filed in Design{where ? ` › ${where}` : ''}. </>}
            {result.skipped > 0 && <>{result.skipped} skipped. </>}
            {result.failed.map(f => <div key={f.name}>{f.name}: {f.message}</div>)}
          </div>
        )}
      </div>
    </Modal>
  )
}
