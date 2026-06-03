import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { fmtMoney } from '../lib/escalation'

// ── Rate Library ─────────────────────────────────────────────────────────────
// Shows the rates harvested from past CSAs (by the harvest-csa-rates edge
// function). Searchable. Lets you fill in the material/labour split per row —
// Option A: the split is captured here going forward, and the pricing engine
// uses it once set.
//
// Read-only on the harvested figures (rate/qty/unit come from the source CSA);
// editable only on material_rate / labour_rate.

export default function RateLibraryTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [unitFilter, setUnitFilter] = useState('all')
  const [lastRun, setLastRun] = useState(null)
  const [savingId, setSavingId] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError('')
    const [{ data, error: e }, { data: log }] = await Promise.all([
      supabase.from('rate_library')
        .select('id, section, description, qty, unit, unit_norm, rate, total, material_rate, labour_rate, project_name, source_file, csa_date')
        .order('section').order('description'),
      supabase.from('rate_library_harvest_log').select('run_at, files_seen, rows_upserted').order('run_at', { ascending: false }).limit(1),
    ])
    if (e) { setError('Could not load rate library: ' + e.message); setLoading(false); return }
    setRows(data || [])
    setLastRun(log?.[0] || null)
    setLoading(false)
  }

  async function saveSplit(id, material_rate, labour_rate) {
    setSavingId(id)
    const { error: e } = await supabase.from('rate_library')
      .update({
        material_rate: material_rate === '' ? null : Number(material_rate),
        labour_rate: labour_rate === '' ? null : Number(labour_rate),
        split_source: 'manual',
      })
      .eq('id', id)
    setSavingId(null)
    if (e) { setError('Save failed: ' + e.message); return }
    setRows(rs => rs.map(r => r.id === id
      ? { ...r, material_rate: material_rate === '' ? null : Number(material_rate), labour_rate: labour_rate === '' ? null : Number(labour_rate) }
      : r))
  }

  const units = useMemo(() => ['all', ...Array.from(new Set(rows.map(r => r.unit_norm || r.unit).filter(Boolean)))], [rows])

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim()
    return rows.filter(r => {
      if (unitFilter !== 'all' && (r.unit_norm || r.unit) !== unitFilter) return false
      if (!needle) return true
      return (r.description || '').toLowerCase().includes(needle) ||
             (r.section || '').toLowerCase().includes(needle) ||
             (r.project_name || '').toLowerCase().includes(needle) ||
             (r.source_file || '').toLowerCase().includes(needle)
    })
  }, [rows, q, unitFilter])

  if (loading) return <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13 }}>Loading rate library…</div>

  return (
    <div>
      {error && <div style={{ padding: '9px 12px', borderRadius: 6, background: '#FAECE7', color: '#993C1D', fontSize: 12, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search description, section, project…" style={{ flex: 1, minWidth: 180, fontSize: 13 }} />
        <select value={unitFilter} onChange={e => setUnitFilter(e.target.value)} style={{ width: 120, fontSize: 13 }}>
          {units.map(u => <option key={u} value={u}>{u === 'all' ? 'All units' : u}</option>)}
        </select>
        <span style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
          {filtered.length} of {rows.length}
        </span>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', border: '0.5px dashed var(--border)', borderRadius: 8, color: 'var(--text3)', fontSize: 13 }}>
          No rates harvested yet. The nightly harvest collects rates from every CSA in the system —
          or trigger it manually (see deploy notes). Once it runs, your historical rates appear here.
        </div>
      ) : (
        <div style={{ border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: RGRID, gap: 6, padding: '8px 10px', background: 'var(--surface2)', fontSize: 10, color: 'var(--text3)' }}>
            <span>DESCRIPTION</span><span>SECTION</span><span style={{ textAlign: 'right' }}>UNIT</span>
            <span style={{ textAlign: 'right' }}>RATE</span><span style={{ textAlign: 'right' }}>MATERIAL</span>
            <span style={{ textAlign: 'right' }}>LABOUR</span><span>SOURCE</span>
          </div>
          {filtered.map(r => (
            <RateRow key={r.id} r={r} onSave={saveSplit} saving={savingId === r.id} />
          ))}
        </div>
      )}

      {lastRun && (
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10 }}>
          Last harvest: {new Date(lastRun.run_at).toLocaleString('en-GB')} · {lastRun.files_seen} files · {lastRun.rows_upserted} rates.
        </div>
      )}
    </div>
  )
}

function RateRow({ r, onSave, saving }) {
  const [mat, setMat] = useState(r.material_rate ?? '')
  const [lab, setLab] = useState(r.labour_rate ?? '')
  const dirty = String(mat) !== String(r.material_rate ?? '') || String(lab) !== String(r.labour_rate ?? '')
  const unit = r.unit_norm || r.unit || ''
  return (
    <div style={{ display: 'grid', gridTemplateColumns: RGRID, gap: 6, padding: '6px 10px', borderTop: '0.5px solid var(--border)', alignItems: 'center', fontSize: 12 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description}>{r.description}</span>
      <span style={{ fontSize: 10, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.section}>{r.section}</span>
      <span style={{ textAlign: 'right', color: 'var(--text3)' }}>{unit}</span>
      <span style={{ textAlign: 'right', fontWeight: 500 }}>{r.rate != null ? fmtMoney(r.rate) : '—'}</span>
      <input type="number" value={mat} onChange={e => setMat(e.target.value)} placeholder="—" style={{ fontSize: 11, textAlign: 'right', padding: '4px 6px' }} />
      <input type="number" value={lab} onChange={e => setLab(e.target.value)} placeholder="—" style={{ fontSize: 11, textAlign: 'right', padding: '4px 6px' }} />
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 10, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${r.project_name || r.source_file || ''} ${r.csa_date || ''}`}>
          {r.project_name || r.source_file || '—'}
        </span>
        {dirty && <button className="btn btn-sm" disabled={saving} onClick={() => onSave(r.id, mat, lab)} style={{ flexShrink: 0, fontSize: 10, padding: '2px 8px' }}>{saving ? '…' : 'Save'}</button>}
      </span>
    </div>
  )
}

const RGRID = '2fr 1.1fr 0.5fr 0.8fr 0.9fr 0.9fr 1.2fr'
