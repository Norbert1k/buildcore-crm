import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fmtMoney } from '../lib/escalation'

// ── Priced Jobs History ──────────────────────────────────────────────────────
// Lists every saved pricing exercise from priced_jobs, newest first. Stage 2
// shows the list + a detail drawer; full "reopen into the workspace" editing
// comes with later stages.

export default function PricedJobsHistory() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)   // expanded job id

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError('')
    const { data, error: e } = await supabase
      .from('priced_jobs')
      .select('id, job_name, client_name, build_date, total_base, total_escalated, status, lines, created_at')
      .order('created_at', { ascending: false })
    if (e) { setError('Could not load history: ' + e.message); setLoading(false); return }
    setJobs(data || [])
    setLoading(false)
  }

  async function remove(id) {
    if (!confirm('Delete this priced job? This cannot be undone.')) return
    const { error: e } = await supabase.from('priced_jobs').delete().eq('id', id)
    if (e) { setError('Delete failed: ' + e.message); return }
    load()
  }

  if (loading) return <div style={{ fontSize: 13, color: 'var(--text3)', padding: 20 }}>Loading history…</div>
  if (error) return <div style={{ padding: '9px 12px', borderRadius: 'var(--radius)', background: '#FAECE7', color: '#993C1D', fontSize: 12 }}>{error}</div>
  if (jobs.length === 0) return (
    <div style={{ fontSize: 13, color: 'var(--text3)', padding: 30, textAlign: 'center', border: '0.5px dashed var(--border)', borderRadius: 'var(--radius)' }}>
      No priced jobs saved yet. Price a job and click "Save to history".
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {jobs.map(j => {
        const isOpen = open === j.id
        return (
          <div key={j.id} style={{ border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            <div onClick={() => setOpen(isOpen ? null : j.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{j.job_name}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                  {[j.client_name, j.build_date ? `build ${j.build_date.slice(0, 7)}` : null,
                    new Date(j.created_at).toLocaleDateString('en-GB')].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#185FA5' }}>{fmtMoney(j.total_escalated)}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>base {fmtMoney(j.total_base)}</div>
              </div>
            </div>
            {isOpen && (
              <div style={{ borderTop: '0.5px solid var(--border)', padding: '10px 12px', background: 'var(--surface2)' }}>
                {(j.lines || []).length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>No line detail stored.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {(j.lines || []).map((l, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11 }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.description || '(no description)'}</span>
                        <span style={{ color: 'var(--text3)' }}>{l.category}</span>
                        <span style={{ width: 80, textAlign: 'right' }}>{fmtMoney(l.escalated)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={() => remove(j.id)}>Delete</button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
