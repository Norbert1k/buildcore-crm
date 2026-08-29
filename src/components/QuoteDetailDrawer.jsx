import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { resolveBuildings } from '../lib/buildings'
import { Pill, Spinner } from './ui'
import FileLightbox from './FileLightbox'

// ─────────────────────────────────────────────────────────────────────────────
// QuoteDetailDrawer
//
// Slide-in panel showing a task's quotes + key documents. Read-only —
// for actual editing the user clicks "Open task" which navigates to
// TaskDetail where the full quote modal flow lives.
//
// Props:
//   taskId  — drives the data fetch
//   onClose — caller closes the drawer
//
// Documents shown: Quote PDFs + Drawings + Emails (skip Photos + Other).
// Documents preview inline via FileLightbox.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  pending:  'Pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
  expired:  'Expired',
}
const STATUS_PILL = {
  pending:  'pill-gray',
  accepted: 'pill-green',
  rejected: 'pill-red',
  expired:  'pill-gray',
}
const KIND_LABEL = {
  supplier:      'Supplier',
  subcontractor: 'Subcontractor',
  design_team:   'Design Team',
  freetext:      'Other',
}

// Documents we show in this context. The drawer is about supporting
// the procurement decision, so:
//   quote   = the quote PDFs
//   drawing = the basis for the quote
//   email   = related correspondence (revised scope, clarifications)
// We hide photo + other to keep the focus tight.
const VISIBLE_CATEGORIES = [
  { value: 'quote',   label: 'Quotes',    icon: '💷' },
  { value: 'drawing', label: 'Drawings',  icon: '📐' },
  { value: 'email',   label: 'Emails',    icon: '✉️' },
]

export default function QuoteDetailDrawer({ taskId, onClose }) {
  const navigate = useNavigate()
  const [task, setTask] = useState(null)
  const [project, setProject] = useState(null)
  const [assignees, setAssignees] = useState([])
  const [quotes, setQuotes] = useState([])
  const [vendors, setVendors] = useState([])
  const [files, setFiles] = useState([])
  const [buildings, setBuildings] = useState([])    // multi-building project structure ([] = single-building)
  const [loading, setLoading] = useState(true)
  // Lightbox state — list mode. previewIndex is the index into
  // previewFiles (which is recomputed in render to be all visible-category
  // files in display order). null means lightbox is closed.
  const [previewIndex, setPreviewIndex] = useState(null)

  // ESC key + body scroll lock.
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose && onClose() }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  useEffect(() => {
    if (!taskId) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  async function load() {
    setLoading(true)
    try {
      const [taskRes, asgRes, quotesRes, filesRes, suppliersRes, subsRes] = await Promise.all([
        supabase.from('tasks').select('*').eq('id', taskId).single(),
        supabase.from('task_assignees').select('user_id, profiles(id, full_name)').eq('task_id', taskId),
        supabase.from('task_quotes')
          .select('*, supplier:suppliers(id, company_name), subcontractor:subcontractors(id, company_name, category)')
          .eq('task_id', taskId)
          .order('amount', { ascending: true, nullsLast: true }),
        supabase.from('task_files').select('*').eq('task_id', taskId).order('uploaded_at', { ascending: false }),
        supabase.from('suppliers').select('id, company_name').order('company_name'),
        supabase.from('subcontractors').select('id, company_name, category').order('company_name'),
      ])
      if (taskRes.error) throw taskRes.error
      setTask(taskRes.data)
      setAssignees(asgRes.data || [])
      setQuotes(quotesRes.data || [])
      setFiles(filesRes.data || [])

      // Build the same vendor lookup as TaskDetail so we can resolve
      // design_team vs subcontractor kind on each quote row.
      const supplierList = (suppliersRes.data || []).map(s => ({ kind: 'supplier', id: s.id, name: s.company_name }))
      const subList = []
      for (const s of (subsRes.data || [])) {
        if (s.category === 'design_team') {
          subList.push({ kind: 'design_team', id: s.id, name: s.company_name })
        } else if (s.category === 'both') {
          subList.push({ kind: 'subcontractor', id: s.id, name: s.company_name })
          subList.push({ kind: 'design_team', id: s.id, name: s.company_name })
        } else {
          subList.push({ kind: 'subcontractor', id: s.id, name: s.company_name })
        }
      }
      setVendors([...supplierList, ...subList])

      // Project for the header.
      if (taskRes.data?.project_id) {
        const { data: proj } = await supabase
          .from('projects')
          .select('id, project_name, project_ref')
          .eq('id', taskRes.data.project_id)
          .single()
        setProject(proj)

        // Resolve multi-building structure. Empty array for single-building
        // projects — all multi-building UI auto-hides in that case.
        try {
          const bs = await resolveBuildings(supabase, taskRes.data.project_id)
          setBuildings(bs || [])
        } catch (e) {
          console.warn('[QuoteDetailDrawer] resolveBuildings error', e)
          setBuildings([])
        }
      }
    } catch (e) {
      console.warn('[QuoteDetailDrawer] load error', e)
    } finally {
      setLoading(false)
    }
  }

  // URL fetcher passed into FileLightbox. Memoized via useRef-style
  // approach (just an inline function is fine — re-creating on every
  // render doesn't trigger re-fetch because the lightbox keys URLs by
  // file.id in its cache).
  async function getSignedUrl(file) {
    const { data } = await supabase.storage.from('task-files').createSignedUrl(file.storage_path, 3600)
    return data?.signedUrl || null
  }

  async function downloadFile(file) {
    const { data } = await supabase.storage.from('task-files').createSignedUrl(file.storage_path, 60)
    if (!data?.signedUrl) return
    try {
      const res = await fetch(data.signedUrl)
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = file.file_name
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    } catch {
      const a = document.createElement('a')
      a.href = data.signedUrl; a.download = file.file_name; a.click()
    }
  }

  // Per-cohort comparison. Two quotes are comparable only when they
  // cover the same buildings — otherwise diff is meaningless. Group by
  // sorted-comma-joined ordinals; empty = "covers whole project".
  function cohortKeyForQuote(q) {
    const ords = Array.isArray(q.building_ordinals) ? q.building_ordinals : []
    return ords.length === 0 ? '' : [...ords].sort((a, b) => a - b).join(',')
  }
  const priced = quotes.filter(q => q.amount != null && q.amount > 0)
  const cohorts = new Map()
  for (const q of priced) {
    const k = cohortKeyForQuote(q)
    if (!cohorts.has(k)) cohorts.set(k, { priced: [] })
    cohorts.get(k).priced.push(q)
  }
  for (const c of cohorts.values()) {
    c.lowest = c.priced.reduce((a, b) => Number(a.amount) <= Number(b.amount) ? a : b)
  }

  // Group files into visible categories. Photos and Other are skipped.
  const filesByCategory = new Map()
  for (const cat of VISIBLE_CATEGORIES) filesByCategory.set(cat.value, [])
  for (const f of files) {
    if (filesByCategory.has(f.category)) filesByCategory.get(f.category).push(f)
  }

  // Flat list of all visible files in display order (Quotes → Drawings →
  // Emails). The lightbox list mode navigates through this; clicking a
  // file gives its index here.
  const visibleFiles = []
  for (const cat of VISIBLE_CATEGORIES) visibleFiles.push(...filesByCategory.get(cat.value))

  const assigneeNames = assignees.map(a => a.profiles?.full_name).filter(Boolean).join(', ')

  return (
    <>
      {/* Backdrop + centered container */}
      <div
        onClick={(e) => { if (e.target === e.currentTarget) onClose && onClose() }}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.45)',
          zIndex: 900,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
        }}>
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
            width: '100%',
            maxWidth: 720,
            maxHeight: '92vh',
            display: 'flex',
            flexDirection: 'column',
          }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          gap: 12,
          flexShrink: 0,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
              {project ? `${project.project_ref ? project.project_ref + ' · ' : ''}${project.project_name}` : ''}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {task?.title || (loading ? 'Loading…' : 'Task')}
            </div>
            {assigneeNames && (
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                Assigned to {assigneeNames}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {task && (
              <button
                className="btn btn-sm"
                onClick={() => navigate(`/tasks/${taskId}`)}
                title="Open the full task page">
                Open task ↗
              </button>
            )}
            <button
              className="btn btn-sm"
              onClick={onClose}
              aria-label="Close"
              style={{ minWidth: 28, padding: '4px 8px', fontSize: 14, lineHeight: 1 }}>
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner /></div>
          ) : (
            <>
              {/* Multi-building coverage strip — only for multi-building projects. */}
              {buildings.length > 1 && quotes.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
                    Building coverage
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
                    {buildings.map(b => {
                      const coveringCount = quotes.filter(q =>
                        !q.building_ordinals
                        || q.building_ordinals.length === 0
                        || q.building_ordinals.includes(b.ordinal)
                      ).length
                      const covered = coveringCount > 0
                      return (
                        <div key={b.ordinal}
                          style={{
                            flex: 1, minWidth: 0,
                            background: 'var(--surface2)',
                            padding: '8px 10px',
                            borderRadius: 'var(--radius)',
                            borderLeft: `3px solid ${covered ? '#3B6D11' : 'var(--border)'}`,
                          }}>
                          <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {b.name}
                          </div>
                          <div style={{ fontSize: 11, marginTop: 2, color: covered ? '#3B6D11' : 'var(--text3)' }}>
                            {covered ? `✓ ${coveringCount} quote${coveringCount === 1 ? '' : 's'}` : '— no quote yet'}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {/* Quotes section */}
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                Quotes <span style={{ color: 'var(--text3)', fontWeight: 400 }}>({quotes.length})</span>
              </div>
              {quotes.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', padding: 12, background: 'var(--surface2)', borderRadius: 'var(--radius)', marginBottom: 16 }}>
                  No quotes recorded for this task yet.
                </div>
              ) : (
                <div className="table-wrap" style={{ marginBottom: 20 }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--surface2)', color: 'var(--text3)', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                        <th style={{ padding: '8px 10px', fontWeight: 600 }}>Vendor</th>
                        <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>Amount</th>
                        <th style={{ padding: '8px 10px', fontWeight: 600 }}>Status</th>
                        <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>vs Lowest</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quotes.map(q => {
                        // Decide vendor display kind: design_team if subcontractor.category is design_team
                        const kind = q.supplier_id ? 'supplier'
                          : q.subcontractor_id ? (vendors.find(v => v.id === q.subcontractor_id && v.kind === 'design_team') ? 'design_team' : 'subcontractor')
                          : 'freetext'
                        const isLowest = (() => {
                          const c = cohorts.get(cohortKeyForQuote(q))
                          return c && c.priced.length > 1 && q.id === c.lowest.id
                        })()
                        const cohortForRow = cohorts.get(cohortKeyForQuote(q))
                        const hasComparable = cohortForRow && cohortForRow.priced.length > 1
                        const diff = (hasComparable && q.amount != null && cohortForRow.lowest.amount > 0)
                          ? Number(q.amount) - Number(cohortForRow.lowest.amount) : null
                        const diffPct = (diff != null && cohortForRow.lowest.amount > 0)
                          ? (diff / Number(cohortForRow.lowest.amount)) * 100 : null
                        return (
                          <tr key={q.id} style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={{ padding: '8px 10px' }}>
                              <div>{q.vendor_name_text}</div>
                              <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{KIND_LABEL[kind]}</div>
                              {buildings.length > 1 && q.building_ordinals && q.building_ordinals.length > 0 && (
                                <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                                  {q.building_ordinals.map(ord => {
                                    const b = buildings.find(b => b.ordinal === ord)
                                    if (!b) return null
                                    return (
                                      <span key={ord} style={{
                                        background: '#E6F1FB', color: '#0C447C',
                                        fontSize: 10, padding: '1px 6px', borderRadius: 99,
                                      }}>{b.name}</span>
                                    )
                                  })}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {q.amount != null
                                ? `${q.currency === 'GBP' ? '£' : (q.currency + ' ')}${Number(q.amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : <span style={{ color: 'var(--text3)' }}>—</span>}
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              <Pill cls={STATUS_PILL[q.status] || 'pill-gray'}>{STATUS_LABELS[q.status] || q.status}</Pill>
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {isLowest ? <span style={{ color: 'var(--text3)' }}>—</span>
                                : diff != null ? (
                                  <span style={{ color: diffPct >= 20 ? '#791F1F' : (diffPct >= 10 ? '#854F0B' : 'var(--text2)') }}>
                                    +£{diff.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                ) : <span style={{ color: 'var(--text3)' }}>—</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Documents section */}
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                Documents
              </div>
              {VISIBLE_CATEGORIES.every(cat => filesByCategory.get(cat.value).length === 0) ? (
                <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', padding: 12, background: 'var(--surface2)', borderRadius: 'var(--radius)' }}>
                  No quotes, drawings, or emails uploaded.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {VISIBLE_CATEGORIES.map(cat => {
                    const catFiles = filesByCategory.get(cat.value)
                    if (catFiles.length === 0) return null
                    return (
                      <div key={cat.value}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>
                          <span style={{ marginRight: 5, fontSize: 12 }}>{cat.icon}</span>{cat.label} ({catFiles.length})
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {catFiles.map(f => {
                            const lower = f.file_name.toLowerCase()
                            const isViewable = lower.endsWith('.pdf')
                              || /\.(jpg|jpeg|png|gif|webp|bmp|heic|heif)$/i.test(lower)
                              || /\.(docx?|xlsx?|pptx?)$/i.test(lower)
                              || lower.endsWith('.eml')
                              || (f.mime_type || '').startsWith('image/')
                              || f.mime_type === 'application/pdf'
                              || f.mime_type === 'message/rfc822'
                            return (
                              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--surface2)', borderRadius: 'var(--radius)' }}>
                                <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {f.file_name}
                                </div>
                                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                  {isViewable && (
                                    <button className="btn btn-sm" onClick={() => setPreviewIndex(visibleFiles.indexOf(f))} title="View">👁</button>
                                  )}
                                  <button className="btn btn-sm" onClick={() => downloadFile(f)} title="Download">⬇</button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
        </div>
      </div>

      {/* File preview lightbox — list mode, flick across all visible-category files */}
      {previewIndex !== null && (
        <FileLightbox
          files={visibleFiles}
          currentIndex={previewIndex}
          onIndexChange={setPreviewIndex}
          getSignedUrl={getSignedUrl}
          onClose={() => setPreviewIndex(null)}
          onDownload={(file) => downloadFile(file)}
        />
      )}
    </>
  )
}
