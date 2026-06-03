import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { escalateLine, fmtMoney, fmtYears } from '../lib/escalation'

// ── Price a Job ──────────────────────────────────────────────────────────────
// The estimating workspace. Two drop zones:
//   • Tender docs  — the job to price (BoQ, spec, drawings). Stage 2 uploads
//                    and stores them; Stage 3 will parse them into line items.
//   • Price uploads— quotes / supplier price lists fed into the price library
//                    (re-uses the existing parse-price-list flow conceptually;
//                    Stage 2 stores the files, Stage 3 wires parsing).
//
// Escalation controls read the saved per-category rates (escalation_rates,
// Stage 1) and allow a per-job build date + per-category override. Any priced
// lines (manual for now; auto from tender parsing in Stage 3) are escalated
// from each line's price date to the build date.
//
// "Save to history" persists the whole exercise to priced_jobs.

const CATEGORIES = ['PRELIMINARIES', 'MAIN WORKS', 'EXTERNAL WORKS', 'PROVISIONAL SUMS', 'DEFAULT']

export default function PriceJobTab() {
  const [jobName, setJobName] = useState('')
  const [clientName, setClientName] = useState('')
  const [buildDate, setBuildDate] = useState(() => {
    // default build date = 6 months out, first of that month
    const d = new Date()
    d.setMonth(d.getMonth() + 6)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })

  const [rates, setRates] = useState({})        // { CATEGORY: pct } defaults from DB
  const [overrides, setOverrides] = useState({}) // { CATEGORY: pct } per-job overrides
  const [ratesLoading, setRatesLoading] = useState(true)

  const [tenderFiles, setTenderFiles] = useState([]) // [{ name, storage_path, size }]
  const [priceFiles, setPriceFiles] = useState([])
  const [lines, setLines] = useState([])         // priced line items
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { loadRates() }, [])

  async function loadRates() {
    setRatesLoading(true)
    const { data, error: e } = await supabase
      .from('escalation_rates')
      .select('category, annual_pct')
    if (e) { setError('Could not load escalation rates: ' + e.message); setRatesLoading(false); return }
    const map = {}
    for (const r of (data || [])) map[r.category] = Number(r.annual_pct)
    setRates(map)
    setRatesLoading(false)
  }

  // Effective rate for a category = override if set, else saved default.
  function effRate(cat) {
    if (overrides[cat] != null && overrides[cat] !== '') return Number(overrides[cat])
    return rates[cat] != null ? rates[cat] : (rates.DEFAULT ?? 0)
  }

  // Re-escalate all lines whenever build date / rates / overrides change.
  const pricedLines = lines.map(ln => {
    const res = escalateLine(
      { base: ln.base, priceDate: ln.price_date, category: ln.category },
      buildDate, rates, overrides
    )
    return { ...ln, ...res }
  })

  const totalBase = pricedLines.reduce((s, l) => s + (Number(l.base) || 0), 0)
  const totalEsc = pricedLines.reduce((s, l) => s + (Number(l.escalated) || 0), 0)

  async function uploadFiles(fileList, bucket, setList) {
    setError('')
    const uploaded = []
    for (const file of Array.from(fileList)) {
      const safeName = file.name.replace(/[^\w.\-]/g, '_')
      const path = `${Date.now()}_${safeName}`
      const { error: e } = await supabase.storage.from(bucket).upload(path, file)
      if (e) { setError(`Upload failed for ${file.name}: ${e.message}`); continue }
      uploaded.push({ name: file.name, storage_path: path, size: file.size })
    }
    setList(prev => [...prev, ...uploaded])
  }

  function addManualLine() {
    setLines(prev => [...prev, {
      description: '', category: 'MAIN WORKS', base: '',
      price_date: new Date().toISOString().slice(0, 10), source: 'manual',
    }])
  }

  function updateLine(idx, field, value) {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l))
  }

  function removeLine(idx) {
    setLines(prev => prev.filter((_, i) => i !== idx))
  }

  async function saveJob() {
    if (!jobName.trim()) { setError('Give the job a name first.'); return }
    setSaving(true); setError(''); setSavedNote('')
    const { error: e } = await supabase.from('priced_jobs').insert({
      job_name: jobName.trim(),
      client_name: clientName.trim() || null,
      build_date: buildDate ? `${buildDate}-01` : null,
      escalation_overrides: overrides,
      lines: pricedLines.map(l => ({
        description: l.description, category: l.category, base: Number(l.base) || 0,
        price_date: l.price_date, escalated: Number(l.escalated) || 0,
        applied_pct: l.appliedPct, source: l.source,
      })),
      tender_files: tenderFiles,
      total_base: Math.round(totalBase * 100) / 100,
      total_escalated: Math.round(totalEsc * 100) / 100,
      status: 'draft',
    })
    if (e) { setError('Save failed: ' + e.message); setSaving(false); return }
    setSavedNote('Saved to history.')
    setSaving(false)
    setTimeout(() => setSavedNote(''), 3000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && <div style={{ padding: '9px 12px', borderRadius: 6, background: '#FAECE7', color: '#993C1D', fontSize: 12 }}>{error}</div>}

      {/* Job meta */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label style={lbl}>Job name</label>
          <input value={jobName} onChange={e => setJobName(e.target.value)} placeholder="e.g. Maple Court — new build" />
        </div>
        <div>
          <label style={lbl}>Client</label>
          <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. Bloom Building Consultancy" />
        </div>
      </div>

      {/* Drop zones */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <DropZone
          title="Drop tender docs"
          subtitle="BoQ, spec, drawings — the job to price"
          accent="#185FA5"
          files={tenderFiles}
          onFiles={fl => uploadFiles(fl, 'tender-docs', setTenderFiles)}
          onRemove={i => setTenderFiles(prev => prev.filter((_, x) => x !== i))}
        />
        <DropZone
          title="Upload prices"
          subtitle="quotes & supplier price lists → library"
          accent="#3B6D11"
          files={priceFiles}
          onFiles={fl => uploadFiles(fl, 'tender-docs', setPriceFiles)}
          onRemove={i => setPriceFiles(prev => prev.filter((_, x) => x !== i))}
        />
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)' }}>
        Tender parsing (auto line extraction) and price-file ingestion arrive in the next stage.
        For now you can upload files and price lines manually below.
      </div>

      {/* Escalation controls */}
      <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Price escalation</span>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>ages each price to the build date</span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>Build date</span>
            <input type="month" value={buildDate} onChange={e => setBuildDate(e.target.value)} style={{ width: 140 }} />
          </span>
        </div>
        {ratesLoading ? (
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>Loading rates…</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            {CATEGORIES.map(cat => (
              <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text2)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cat === 'DEFAULT' ? 'Default' : titleCase(cat)}
                </span>
                <input type="number" step="0.1" min="0" max="50"
                  value={overrides[cat] ?? ''}
                  placeholder={String(rates[cat] ?? rates.DEFAULT ?? 0)}
                  onChange={e => setOverrides(prev => ({ ...prev, [cat]: e.target.value }))}
                  style={{ width: 60, textAlign: 'right', fontSize: 12 }} />
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>%</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>
          Blank = use the saved default (shown as placeholder). Set a value to override for this job only.
        </div>
      </div>

      {/* Priced lines */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Priced lines</span>
          <button className="btn btn-sm" onClick={addManualLine}>+ Add line</button>
        </div>
        {pricedLines.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text3)', padding: 16, textAlign: 'center', border: '0.5px dashed var(--border)', borderRadius: 8 }}>
            No lines yet. Add manually, or drop a tender doc once parsing is enabled.
          </div>
        ) : (
          <div style={{ border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 0.9fr 1fr 0.9fr 0.9fr 28px', gap: 6, padding: '8px 10px', background: 'var(--surface2)', fontSize: 10, color: 'var(--text3)' }}>
              <span>DESCRIPTION</span><span>CATEGORY</span><span>PRICE DATE</span><span style={{ textAlign: 'right' }}>BASE £</span><span style={{ textAlign: 'right' }}>AGE</span><span style={{ textAlign: 'right' }}>ESCALATED £</span><span></span>
            </div>
            {pricedLines.map((l, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 0.9fr 1fr 0.9fr 0.9fr 28px', gap: 6, padding: '6px 10px', borderTop: '0.5px solid var(--border)', alignItems: 'center' }}>
                <input value={l.description} onChange={e => updateLine(i, 'description', e.target.value)} placeholder="item" style={{ fontSize: 12 }} />
                <select value={l.category} onChange={e => updateLine(i, 'category', e.target.value)} style={{ fontSize: 12 }}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c === 'DEFAULT' ? 'Default' : titleCase(c)}</option>)}
                </select>
                <input type="date" value={l.price_date} onChange={e => updateLine(i, 'price_date', e.target.value)} style={{ fontSize: 11 }} />
                <input type="number" value={l.base} onChange={e => updateLine(i, 'base', e.target.value)} placeholder="0" style={{ fontSize: 12, textAlign: 'right' }} />
                <span style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'right' }}>{fmtYears(l.years)}</span>
                <span style={{ fontSize: 12, fontWeight: 500, textAlign: 'right' }}>{fmtMoney(l.escalated)}</span>
                <button onClick={() => removeLine(i)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 14 }}>✕</button>
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 0.9fr 1fr 0.9fr 0.9fr 28px', gap: 6, padding: '8px 10px', borderTop: '0.5px solid var(--border2, var(--border))', background: 'var(--surface2)', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 600 }}>TOTAL</span><span></span><span></span>
              <span style={{ fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{fmtMoney(totalBase)}</span>
              <span></span>
              <span style={{ fontSize: 12, fontWeight: 600, textAlign: 'right', color: '#185FA5' }}>{fmtMoney(totalEsc)}</span>
              <span></span>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
        {savedNote && <span style={{ fontSize: 12, color: 'var(--green)' }}>{savedNote}</span>}
        <button className="btn" onClick={saveJob} disabled={saving}>{saving ? 'Saving…' : 'Save to history'}</button>
      </div>
    </div>
  )
}

function DropZone({ title, subtitle, accent, files, onFiles, onRemove }) {
  const inputRef = useRef(null)
  const [over, setOver] = useState(false)
  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files) }}
        style={{
          border: `0.5px dashed ${over ? accent : 'var(--border)'}`,
          background: over ? 'var(--surface2)' : 'var(--surface)',
          borderRadius: 10, padding: 18, textAlign: 'center', cursor: 'pointer',
        }}>
        <div style={{ fontSize: 22, color: accent }}>⬆</div>
        <div style={{ fontSize: 13, fontWeight: 500, marginTop: 4 }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{subtitle}</div>
        <input ref={inputRef} type="file" multiple style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = '' }} />
      </div>
      {files.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {files.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text2)' }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              <button onClick={() => onRemove(i)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer' }}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const lbl = { display: 'block', fontSize: 11, color: 'var(--text3)', marginBottom: 4 }
function titleCase(s) { return String(s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) }
