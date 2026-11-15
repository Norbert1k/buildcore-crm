import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { DOCUMENT_TYPES } from '../lib/utils'
import { Spinner } from '../components/ui'

// Inbox — files your email automation saved to Google Drive, filed into the
// CRM by the `intake` function (every 5 minutes). Confident ones are filed
// automatically; the rest wait here with Claude's best guess, one tap to file.
// Google Drive itself is only ever read.

const FILERS = ['admin', 'project_manager', 'operations_manager', 'project_director', 'document_controller']
const SETTINGS_ROLES = ['admin', 'operations_manager', 'project_director']

const FOLDERS = [
  { v: '00-project-information|drawings', label: '01. Drawings', types: ['drawing'] },
  { v: '00-project-information|reports', label: '02. Surveys & Reports', types: ['survey_report'] },
  { v: '00-project-information|hs', label: '06. Health & Safety', types: ['rams'] },
  { v: '00-project-information|planning', label: '09. Planning', types: ['planning'] },
  { v: '00-project-information|meetings', label: '11. Meetings', types: ['meeting_minutes'] },
  { v: '00-project-information|csa', label: '03. CSA', types: [] },
  { v: '00-project-information|utilities', label: '10. Utilities', types: [] },
  { v: '02-payment-application|', label: '02. Payment Application', types: ['our_payment_application'] },
  { v: '03-payment-notice|', label: '03. Payment Notice (Client)', types: ['client_payment_notice'] },
  { v: '04-variations|', label: '04. Variations', types: ['variation'] },
  { v: '06-project-programme|', label: '06. Project Programme', types: ['programme'] },
]
const TYPE_LABEL = {
  drawing: 'Drawing', survey_report: 'Survey / report', rams: 'RAMS', planning: 'Planning', meeting_minutes: 'Minutes',
  our_payment_application: 'Our PA', client_payment_notice: 'Payment notice', variation: 'Variation', programme: 'Programme',
  subcontractor_quote: 'Subcontractor quote', supplier_quote: 'Supplier quote', insurance: 'Insurance',
  certificate: 'Certificate', accreditation: 'Accreditation', invoice: 'Invoice', other: 'Other',
}
const targetForType = t => (t === 'subcontractor_quote' || t === 'supplier_quote') ? 'quote'
  : (t === 'insurance' || t === 'certificate' || t === 'accreditation') ? 'compliance' : 'project_doc'

const fmtWhen = iso => {
  if (!iso) return ''
  const d = new Date(iso), mins = (Date.now() - d.getTime()) / 60000
  if (mins < 1) return 'just now'
  if (mins < 60) return `${Math.round(mins)} min ago`
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
const driveFolderId = s => {
  const m = String(s || '').match(/folders\/([\w-]{10,})/) || String(s || '').match(/[?&]id=([\w-]{10,})/)
  return m ? m[1] : String(s || '').trim()
}

async function call(body) {
  const { data, error } = await supabase.functions.invoke('intake', { body })
  if (error) {
    let msg = error.message
    try { msg = (await error.context?.json())?.error || msg } catch { /* keep */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export default function Inbox() {
  const { profile } = useAuth()
  const canFile = FILERS.includes(profile?.role)
  const canSet = SETTINGS_ROLES.includes(profile?.role)
  const [tab, setTab] = useState('check')
  const [items, setItems] = useState(null)
  const [settings, setSettings] = useState(null)
  const [missing, setMissing] = useState(false)
  const [lists, setLists] = useState({ projects: [], subs: [], sups: [], reqs: [] })
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState('')

  async function load() {
    const [it, st] = await Promise.all([
      supabase.from('intake_items').select('*').order('created_at', { ascending: false }).limit(400),
      supabase.from('intake_settings').select('*').eq('id', 1).maybeSingle(),
    ])
    if (it.error && /intake_items/.test(it.error.message)) { setMissing(true); setItems([]); return }
    setItems(it.data || [])
    setSettings(st.data || null)
  }
  useEffect(() => {
    load()
    Promise.all([
      supabase.from('projects').select('id, project_ref, project_name, status').neq('status', 'cancelled'),
      supabase.from('subcontractors').select('id, company_name, trade').order('company_name'),
      supabase.from('suppliers').select('id, company_name').order('company_name'),
      supabase.from('tasks').select('id, project_id, title, status').eq('is_quote', true).neq('status', 'closed'),
    ]).then(([p, s, u, r]) => setLists({
      projects: (p.data || []).sort((a, b) => String(b.project_ref || '').localeCompare(String(a.project_ref || ''))),
      subs: s.data || [], sups: u.data || [], reqs: r.data || [],
    }))
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])

  const groups = useMemo(() => {
    const g = { check: [], filed: [], other: [], pending: [] }
    for (const i of items || []) {
      if (i.status === 'to_check') g.check.push(i)
      else if (i.status === 'filed') g.filed.push(i)
      else if (i.status === 'pending' || i.status === 'error') g.pending.push(i)
      else g.other.push(i)
    }
    return g
  }, [items])

  async function runNow() {
    setRunning(true); setMsg('')
    try { const r = await call({ action: 'run' }); setMsg(r.note || 'Checked') } catch (e) { setMsg(e.message) }
    setRunning(false); load()
  }

  if (missing) return (
    <div className="ib">
      <h1 className="ib-h">Inbox</h1>
      <div className="ib-empty">The Inbox isn't set up yet — run <b>supabase-sql/040_intake.sql</b> and deploy the <b>intake</b> function (see docs/INBOX_SETUP.md).</div>
    </div>
  )

  const mode = !settings?.drive_folder_id ? { t: 'Not connected', c: 'ib-chip-grey' }
    : !settings.enabled ? { t: 'Off', c: 'ib-chip-grey' }
    : settings.trial ? { t: 'Trial — suggests only', c: 'ib-chip-amber' }
    : { t: 'On — filing automatically', c: 'ib-chip-green' }

  return (
    <div className="ib">
      <div className="ib-top">
        <div>
          <h1 className="ib-h">Inbox</h1>
          <div className="ib-sub">Files from your email folder in Google Drive. Sure ones are filed for you; the rest wait here.</div>
        </div>
        <div className="ib-top-r">
          <span className={'ib-chip ' + mode.c}>{mode.t}</span>
          {canFile && settings?.drive_folder_id && <button className="btn btn-sm" onClick={runNow} disabled={running}>{running ? 'Checking…' : 'Check now'}</button>}
        </div>
      </div>
      {(msg || settings?.last_run_at) && (
        <div className="ib-run">{msg || <>Last check {fmtWhen(settings.last_run_at)} · {settings.last_run_note}</>}</div>
      )}

      <div className="ib-tabs" role="tablist">
        {[['check', 'To check', groups.check.length], ['filed', 'Filed', groups.filed.length],
          ['other', 'Ignored & duplicates', groups.other.length], ['pending', 'Waiting', groups.pending.length],
          ...(canSet ? [['settings', 'Settings', null]] : [])].map(([k, l, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={'ib-tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>
            {l}{n ? <span className="ib-n">{n}</span> : null}
          </button>
        ))}
      </div>

      {items === null ? <div className="tab-loading"><Spinner /></div> : (
        <>
          {tab === 'check' && (groups.check.length
            ? groups.check.map(i => <CheckCard key={i.id} item={i} lists={lists} canFile={canFile} onDone={load} />)
            : <div className="ib-empty">Nothing to check.</div>)}
          {tab === 'filed' && (groups.filed.length
            ? <div className="ib-list">{groups.filed.slice(0, 150).map(i => <FiledRow key={i.id} item={i} />)}</div>
            : <div className="ib-empty">Nothing filed yet.</div>)}
          {tab === 'other' && (groups.other.length
            ? <div className="ib-list">{groups.other.slice(0, 150).map(i => <OtherRow key={i.id} item={i} canFile={canFile} onDone={load} />)}</div>
            : <div className="ib-empty">Nothing here.</div>)}
          {tab === 'pending' && (groups.pending.length
            ? <div className="ib-list">{groups.pending.map(i => (
                <div key={i.id} className="ib-row"><div className="ib-row-main"><div className="ib-fn">{i.file_name}</div>
                  <div className="ib-meta">{i.status === 'error' ? `Retrying — ${i.last_error || ''}` : 'Waiting to be read'} · {fmtWhen(i.created_at)}</div></div></div>))}</div>
            : <div className="ib-empty">Nothing waiting.</div>)}
          {tab === 'settings' && canSet && <Settings settings={settings} onSaved={load} projects={lists.projects} />}
        </>
      )}
    </div>
  )
}

function useOpen(item) {
  return async () => {
    const w = window.open('', '_blank')
    try { const { url } = await call({ action: 'url', item_id: item.id }); if (w && url) w.location.href = url; else w?.close() }
    catch (e) { w?.close(); alert(e.message) }
  }
}

function CheckCard({ item, lists, canFile, onDone }) {
  const g = item.guess || {}
  const plan = g._plan || null
  const open = useOpen(item)
  const [target, setTarget] = useState(plan?.target || targetForType(g.doc_type))
  const [projectId, setProjectId] = useState(plan?.project_id || g.project_id || '')
  const firstFolder = FOLDERS.find(f => f.types.includes(g.doc_type))?.v || FOLDERS[0].v
  const planBase = plan && FOLDERS.find(f => f.v.startsWith(plan.folder_key + '|') && f.types.includes(g.doc_type))?.v
  const [folder, setFolder] = useState(plan ? (FOLDERS.some(f => f.v === `${plan.folder_key}|${plan.subfolder_key || ''}`) ? `${plan.folder_key}|${plan.subfolder_key || ''}` : (planBase || firstFolder)) : firstFolder)
  const [building, setBuilding] = useState('')
  const [buildings, setBuildings] = useState([])
  // Sub-folders inside the chosen section (e.g. 01. Drawings › 14. CIAO …)
  const [subTree, setSubTree] = useState([])
  const [subPick, setSubPick] = useState(plan?.new_folder ? 'new' : (plan?.subfolder_key || ''))
  const [newSub, setNewSub] = useState(plan?.new_folder?.name || '')
  const [newSubParent] = useState(plan?.new_folder?.parent_key || null)
  const [subId, setSubId] = useState(plan?.subcontractor_id || (g.vendor?.kind === 'subcontractor' ? g.vendor.id : '') || '')
  const [vendor, setVendor] = useState(
    plan?.subcontractor_id ? 's:' + plan.subcontractor_id : plan?.supplier_id ? 'u:' + plan.supplier_id
      : g.vendor?.id ? (g.vendor.kind === 'supplier' ? 'u:' : 's:') + g.vendor.id : '')
  const [docType, setDocType] = useState(plan?.document_type || g.compliance?.document_type || 'public_liability')
  const [expiry, setExpiry] = useState(g.compliance?.expiry_date || '')
  const [reqId, setReqId] = useState(plan?.task_id || g.quote?.request_id || '')
  const [newTitle, setNewTitle] = useState(g.quote?.trade || '')
  const [amount, setAmount] = useState(g.quote?.amount != null ? String(g.quote.amount) : '')
  const [busy, setBusy] = useState(false)

  // Jobs with a folder per building (PAs / notices)
  const [fk] = folder.split('|')
  useEffect(() => {
    setBuildings([]); setBuilding('')
    if (target !== 'project_doc' || !projectId || !['02-payment-application', '03-payment-notice'].includes(fk)) return
    supabase.from('project_doc_folders').select('folder_key, label').eq('project_id', projectId).eq('parent_key', fk)
      .then(({ data }) => setBuildings(data || []))
  }, [target, projectId, fk])

  // Load the section's sub-folders for this job
  const [, baseSub] = folder.split('|')
  useEffect(() => {
    setSubTree([])
    if (target !== 'project_doc' || !projectId || !baseSub) return
    supabase.from('project_doc_folders').select('folder_key, parent_key, label').eq('project_id', projectId).then(({ data }) => {
      const out = []
      const walk = (parent, prefix, depth) => {
        if (depth > 4) return
        ;(data || []).filter(f => f.parent_key === parent)
          .sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }))
          .forEach(f => { out.push({ key: f.folder_key, path: prefix ? prefix + ' / ' + f.label : f.label, depth }); walk(f.folder_key, prefix ? prefix + ' / ' + f.label : f.label, depth + 1) })
      }
      walk(baseSub, '', 0)
      setSubTree(out)
    })
  }, [target, projectId, baseSub])

  const reqs = lists.reqs.filter(r => r.project_id === projectId)
  const project = lists.projects.find(p => p.id === projectId)

  async function file() {
    let decision
    if (target === 'project_doc') {
      const [folder_key, sub] = folder.split('|')
      decision = { target, project_id: projectId, folder_key, subfolder_key: building || (subPick && subPick !== 'new' ? subPick : sub) || null }
      if (subPick === 'new' && newSub.trim()) {
        const parentOk = newSubParent && (newSubParent === sub || subTree.some(t => t.key === newSubParent))
        decision.new_folder = { parent_key: parentOk ? newSubParent : sub, name: newSub.trim() }
      }
    } else if (target === 'compliance') {
      decision = { target, subcontractor_id: subId, document_type: docType, expiry_date: expiry || null }
    } else {
      const [k, id] = vendor.split(':')
      decision = { target, project_id: projectId, task_id: reqId && reqId !== 'new' ? reqId : null,
        new_request_title: reqId === 'new' ? newTitle : null,
        subcontractor_id: k === 's' ? id : null, supplier_id: k === 'u' ? id : null,
        vendor_name: g.vendor?.name || null, amount: amount === '' ? null : Number(String(amount).replace(/[£,\s]/g, '')) }
    }
    setBusy(true)
    try { await call({ action: 'file', item_id: item.id, decision }); onDone() }
    catch (e) { alert('Couldn’t file: ' + e.message) }
    setBusy(false)
  }
  async function act(action) {
    setBusy(true)
    try { await call({ action, item_id: item.id }); onDone() } catch (e) { alert(e.message) }
    setBusy(false)
  }

  const ready = target === 'project_doc' ? !!projectId && (!buildings.length || !!building)
    : target === 'compliance' ? !!subId && !!docType
    : !!projectId && !!vendor && (reqId === 'new' ? !!newTitle.trim() : !!reqId)

  return (
    <div className="ib-card">
      <div className="ib-card-h">
        <button className="ib-fn ib-link" onClick={open} disabled={!item.staged_path} title="Open the file">{item.file_name}</button>
        {g.doc_type && <span className="ib-chip ib-chip-grey">{TYPE_LABEL[g.doc_type] || g.doc_type}</span>}
      </div>
      {item.summary && <div className="ib-sum">{item.summary}</div>}
      {plan?.path_label && <div className="ib-meta">Suggested: <b>{plan.path_label}</b></div>}
      <div className="ib-meta">
        <span className={item.reason?.startsWith('Trial') ? 'ib-ok' : 'ib-why'}>{item.reason}</span>
        {item.source_path ? <> · {item.source_path}</> : null} · {fmtWhen(item.source_created_at || item.created_at)}
      </div>

      {canFile && (
        <div className="ib-form">
          <select value={target} onChange={e => setTarget(e.target.value)} aria-label="Where it goes">
            <option value="project_doc">Job documents</option>
            <option value="quote">Quote for a job</option>
            <option value="compliance">Subcontractor compliance</option>
          </select>

          {target !== 'compliance' && (
            <select value={projectId} onChange={e => { setProjectId(e.target.value); setReqId('') }} aria-label="Job">
              <option value="">Job…</option>
              {lists.projects.map(p => <option key={p.id} value={p.id}>{p.project_ref ? p.project_ref + ' · ' : ''}{p.project_name}</option>)}
            </select>
          )}

          {target === 'project_doc' && (
            <>
              <select value={folder} onChange={e => setFolder(e.target.value)} aria-label="Folder">
                {FOLDERS.map(f => <option key={f.v} value={f.v}>{f.label}</option>)}
              </select>
              {subTree.length > 0 || subPick === 'new' ? (
                <select value={subPick} onChange={e => setSubPick(e.target.value)} aria-label="Sub-folder">
                  <option value="">(main folder)</option>
                  {subTree.map(t => <option key={t.key} value={t.key}>{'\u00a0\u00a0'.repeat(t.depth)}{t.path.split(' / ').pop()}</option>)}
                  <option value="new">+ New sub-folder…</option>
                </select>
              ) : baseSub ? (
                <select value={subPick} onChange={e => setSubPick(e.target.value)} aria-label="Sub-folder">
                  <option value="">(main folder)</option>
                  <option value="new">+ New sub-folder…</option>
                </select>
              ) : null}
              {subPick === 'new' && <input value={newSub} onChange={e => setNewSub(e.target.value)} placeholder="e.g. KSA – Structural (number added for you)" />}
              {buildings.length > 0 && (
                <select value={building} onChange={e => setBuilding(e.target.value)} aria-label="Building">
                  <option value="">Building…</option>
                  {buildings.map(b => <option key={b.folder_key} value={b.folder_key}>{b.label}</option>)}
                </select>
              )}
            </>
          )}

          {target === 'compliance' && (
            <>
              <select value={subId} onChange={e => setSubId(e.target.value)} aria-label="Subcontractor">
                <option value="">Subcontractor…</option>
                {lists.subs.map(s => <option key={s.id} value={s.id}>{s.company_name}</option>)}
              </select>
              <select value={docType} onChange={e => setDocType(e.target.value)} aria-label="Document type">
                {Object.entries(DOCUMENT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <label className="ib-inl">Expires <input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} /></label>
            </>
          )}

          {target === 'quote' && (
            <>
              <select value={reqId} onChange={e => setReqId(e.target.value)} aria-label="Quote request" disabled={!projectId}>
                <option value="">Quote request…</option>
                {reqs.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                <option value="new">+ New request…</option>
              </select>
              {reqId === 'new' && <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="What's being priced, e.g. Groundworks" />}
              <select value={vendor} onChange={e => setVendor(e.target.value)} aria-label="From">
                <option value="">From…</option>
                <optgroup label="Subcontractors">{lists.subs.map(s => <option key={s.id} value={'s:' + s.id}>{s.company_name}</option>)}</optgroup>
                <optgroup label="Suppliers">{lists.sups.map(s => <option key={s.id} value={'u:' + s.id}>{s.company_name}</option>)}</optgroup>
              </select>
              <label className="ib-inl">£ net <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 110 }} /></label>
            </>
          )}

          <div className="ib-actions">
            <button className="btn btn-sm btn-primary" disabled={!ready || busy} onClick={file}>
              {busy ? 'Filing…' : target === 'project_doc' && project ? `File to ${project.project_name}` : 'File'}
            </button>
            <button className="btn btn-sm" disabled={busy} onClick={() => act('ignore')}>Ignore</button>
            {(item.last_error || !item.staged_path) && <button className="btn btn-sm" disabled={busy} onClick={() => act('retry')}>Read again</button>}
          </div>
          {g.vendor?.name && !vendor && target !== 'project_doc' && (
            <div className="ib-meta">Sender on the file: “{g.vendor.name}” — add them in Subcontractors / Suppliers first if they're new.</div>
          )}
        </div>
      )}
    </div>
  )
}

function linkFor(f) {
  if (!f) return null
  if (f.task_id) return `/tasks/${f.task_id}`
  if (f.target === 'compliance' && f.subcontractor_id) return `/subcontractors/${f.subcontractor_id}`
  if (f.project_id) return `/projects/${f.project_id}?tab=documents`
  return null
}

function FiledRow({ item }) {
  const f = item.filed_to || {}
  const to = linkFor(f)
  return (
    <div className="ib-row">
      <div className="ib-row-main">
        <div className="ib-fn">{item.file_name}</div>
        <div className="ib-meta">→ {to ? <Link to={to}>{f.label || 'Open'}</Link> : (f.label || '—')} · {item.filed_by ? 'by hand' : 'automatically'} · {fmtWhen(item.filed_at)}</div>
      </div>
      {item.doc_type && <span className="ib-chip ib-chip-grey">{TYPE_LABEL[item.doc_type] || item.doc_type}</span>}
    </div>
  )
}

function OtherRow({ item, canFile, onDone }) {
  const [busy, setBusy] = useState(false)
  async function back() {
    setBusy(true)
    try { await call({ action: 'retry', item_id: item.id }); onDone() } catch (e) { alert(e.message) }
    setBusy(false)
  }
  const to = linkFor(item.filed_to)
  return (
    <div className="ib-row">
      <div className="ib-row-main">
        <div className="ib-fn">{item.file_name}</div>
        <div className="ib-meta">{item.status === 'duplicate' ? 'Duplicate' : 'Ignored'} — {item.reason}
          {to && <> · <Link to={to}>{item.filed_to.label || 'see original'}</Link></>} · {fmtWhen(item.updated_at)}</div>
      </div>
      {canFile && item.status !== 'duplicate' && <button className="btn btn-sm" disabled={busy} onClick={back}>Read again</button>}
    </div>
  )
}

function Settings({ settings, onSaved, projects = [] }) {
  const [map, setMap] = useState(() => ({ ...(settings?.folder_map || {}) }))
  const [driveFolders, setDriveFolders] = useState(null)
  const [loadingFolders, setLoadingFolders] = useState(false)
  async function loadFolders() {
    setLoadingFolders(true)
    try {
      const { folders } = await call({ action: 'folders' })
      setDriveFolders(folders)
      setMap(m => { const n = { ...m }; for (const f of folders) if (!(f.name in n) && f.suggestion) n[f.name] = f.suggestion; return n })
    } catch (e) { alert(e.message) }
    setLoadingFolders(false)
  }
  const [f, setF] = useState(() => ({
    folder: settings?.drive_folder_id || '', enabled: !!settings?.enabled, trial: settings?.trial !== false,
    threshold: Math.round((Number(settings?.auto_threshold) || 0.85) * 100),
    start: (settings?.start_from || new Date().toISOString()).slice(0, 10),
  }))
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  async function save() {
    setSaving(true)
    const { data, error } = await supabase.from('intake_settings').update({
      drive_folder_id: driveFolderId(f.folder) || null, enabled: f.enabled, trial: f.trial,
      auto_threshold: Math.min(0.99, Math.max(0.5, Number(f.threshold) / 100 || 0.85)),
      start_from: new Date(f.start + 'T00:00:00Z').toISOString(), updated_at: new Date().toISOString(),
      folder_map: Object.fromEntries(Object.entries(map).filter(([, v]) => v)),
    }).eq('id', 1).select('id')
    setSaving(false)
    if (error || !data?.length) { alert('Couldn’t save' + (error ? ': ' + error.message : ' — you don’t have permission.')); return }
    onSaved()
  }
  return (
    <div className="ib-card ib-settings">
      <label>Google Drive folder (link or ID)
        <input value={f.folder} onChange={e => set('folder', e.target.value)} placeholder="https://drive.google.com/drive/folders/…" />
      </label>
      <div className="ib-hint">The folder your email automation saves attachments into. Share it (Viewer) with the service-account email from setup — the CRM can only read it.</div>
      <label className="ib-check"><input type="checkbox" checked={f.enabled} onChange={e => set('enabled', e.target.checked)} /> Check the folder every 5 minutes</label>
      <label className="ib-check"><input type="checkbox" checked={f.trial} onChange={e => set('trial', e.target.checked)} /> Trial — suggest only; nothing is filed until someone presses File</label>
      <label>Only files saved on or after
        <input type="date" value={f.start} onChange={e => set('start', e.target.value)} />
      </label>
      <label>File automatically when Claude is at least … sure
        <span className="ib-inl"><input type="number" min="50" max="99" value={f.threshold} onChange={e => set('threshold', e.target.value)} style={{ width: 70 }} /> %</span>
      </label>
      <div className="ib-hint">Lower = more filed automatically, more mistakes. 85% is a good start.</div>
      <div className="ib-maph">
        <b>Drive job folders → CRM jobs</b>
        <button className="btn btn-sm" onClick={loadFolders} disabled={loadingFolders || !settings?.drive_folder_id}>{loadingFolders ? 'Loading…' : driveFolders ? 'Reload' : 'Load from Drive'}</button>
      </div>
      <div className="ib-hint">The job a file's Drive folder belongs to is the strongest clue. Anything the file itself contradicts (another job's address or ref) waits in To check. "Skip" = never file from that folder.</div>
      {(driveFolders || Object.keys(map).map(name => ({ name }))).map(df => (
        <div key={df.name} className="ib-maprow">
          <span className="ib-mapname">{df.name}</span>
          <select value={map[df.name] || ''} onChange={e => setMap(m => ({ ...m, [df.name]: e.target.value }))}>
            <option value="">Let Claude decide</option>
            <option value="skip">Skip — not a job</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.project_ref ? p.project_ref + ' · ' : ''}{p.project_name}</option>)}
          </select>
        </div>
      ))}
      <div><button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
    </div>
  )
}
