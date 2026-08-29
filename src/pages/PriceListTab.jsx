import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ── Price List tab ───────────────────────────────────────────────────────────
// Lives inside the Web Search page. Lets the team build a price list:
//   • Upload a supplier price-list / quote PDF → parse-price-list edge
//     function extracts the rows → review screen → save to price_list_items.
//   • Add a price manually.
//   • Browse / search / edit / delete recorded prices.
//
// Every saved price is its own dated row — history is kept (for trend
// tracking later). AI-extracted rows are ALWAYS reviewed before saving.

const UNITS = ['per sheet', 'per m²', 'each', 'per pack', 'per metre', 'per roll', 'per tonne', 'per litre']

const money = (n) => n == null || n === '' ? '—'
  : '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? '—'
    : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Empty row shape for manual add / review editing.
const emptyRow = () => ({
  product_name: '', product_code: '', supplier: '', price: '',
  unit: 'per sheet', pack_size: '', vat_basis: '', notes: '',
  price_date: new Date().toISOString().slice(0, 10),
})

export default function PriceListTab() {
  const { profile } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  // Manual add / edit form
  const [editing, setEditing] = useState(null)   // row being edited, or null
  const [form, setForm] = useState(emptyRow())
  const [saving, setSaving] = useState(false)

  // PDF upload + AI review
  const [uploading, setUploading] = useState(false)
  const [reviewRows, setReviewRows] = useState(null)  // null = no review open
  const [reviewSource, setReviewSource] = useState('')
  const [reviewNotes, setReviewNotes] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error: e } = await supabase
      .from('price_list_items')
      .select('*')
      .order('created_at', { ascending: false })
    if (e) setError('Could not load the price list: ' + e.message)
    setItems(data || [])
    setLoading(false)
  }

  const filtered = items.filter(it => {
    if (!search) return true
    const q = search.toLowerCase()
    return (it.product_name || '').toLowerCase().includes(q)
      || (it.supplier || '').toLowerCase().includes(q)
      || (it.product_code || '').toLowerCase().includes(q)
  })

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function startAdd() { setForm(emptyRow()); setEditing('new') }
  function startEdit(it) {
    setForm({
      product_name: it.product_name || '', product_code: it.product_code || '',
      supplier: it.supplier || '', price: it.price ?? '', unit: it.unit || 'per sheet',
      pack_size: it.pack_size || '', vat_basis: it.vat_basis || '', notes: it.notes || '',
      price_date: it.price_date || new Date().toISOString().slice(0, 10),
    })
    setEditing(it.id)
  }

  async function saveRow() {
    if (!form.product_name.trim()) { setError('Product name is required.'); return }
    setSaving(true); setError('')
    const payload = {
      product_name: form.product_name.trim(),
      product_code: form.product_code.trim() || null,
      supplier: form.supplier.trim() || null,
      price: form.price === '' ? null : Number(form.price),
      unit: form.unit || null,
      pack_size: form.pack_size.trim() || null,
      vat_basis: form.vat_basis || null,
      notes: form.notes.trim() || null,
      price_date: form.price_date || null,
    }
    try {
      if (editing === 'new') {
        const { error: e } = await supabase.from('price_list_items')
          .insert({ ...payload, source: 'manual', created_by: profile?.id || null })
        if (e) throw e
      } else {
        const { error: e } = await supabase.from('price_list_items')
          .update(payload).eq('id', editing)
        if (e) throw e
      }
      setEditing(null)
      load()
    } catch (err) {
      setError('Could not save: ' + err.message)
    }
    setSaving(false)
  }

  async function deleteRow(id) {
    if (!window.confirm('Delete this price entry? This cannot be undone.')) return
    const { error: e } = await supabase.from('price_list_items').delete().eq('id', id)
    if (e) { setError('Could not delete: ' + e.message); return }
    load()
  }

  // ── PDF upload → AI extract ────────────────────────────────────────────────
  async function onUploadPdf(file) {
    if (!file) return
    if (file.type !== 'application/pdf') {
      setError('Please upload a PDF file.')
      return
    }
    setUploading(true); setError('')
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result).split(',')[1])
        r.onerror = () => rej(new Error('Could not read the file'))
        r.readAsDataURL(file)
      })
      const { data, error: e } = await supabase.functions.invoke('parse-price-list', {
        body: { pdf_base64: base64 },
      })
      if (e) throw e
      if (!data?.ok) throw new Error(data?.error || 'The PDF could not be read.')
      const rows = (data.items || []).map(it => ({
        product_name: it.product_name || '', product_code: it.product_code || '',
        supplier: it.supplier || '', price: it.price ?? '', unit: it.unit || '',
        pack_size: it.pack_size || '', vat_basis: it.vat_basis || '', notes: '',
        price_date: new Date().toISOString().slice(0, 10),
        _keep: true,
      }))
      if (rows.length === 0) {
        setError('No product rows were found in that PDF. ' + (data.notes || ''))
      } else {
        setReviewRows(rows)
        setReviewSource(file.name)
        setReviewNotes(data.notes || '')
      }
    } catch (err) {
      setError('Could not read the PDF: ' + err.message)
    }
    setUploading(false)
  }

  function setReviewCell(i, k, v) {
    setReviewRows(rows => rows.map((r, idx) => idx === i ? { ...r, [k]: v } : r))
  }

  async function saveReview() {
    const keep = reviewRows.filter(r => r._keep && r.product_name.trim())
    if (keep.length === 0) { setError('No rows ticked to save.'); return }
    setSaving(true); setError('')
    try {
      const payload = keep.map(r => ({
        product_name: r.product_name.trim(),
        product_code: (r.product_code || '').trim() || null,
        supplier: (r.supplier || '').trim() || null,
        price: r.price === '' || r.price == null ? null : Number(r.price),
        unit: r.unit || null,
        pack_size: (r.pack_size || '').trim() || null,
        vat_basis: r.vat_basis || null,
        notes: (r.notes || '').trim() || null,
        price_date: r.price_date || null,
        source: reviewSource || 'PDF upload',
        created_by: profile?.id || null,
      }))
      const { error: e } = await supabase.from('price_list_items').insert(payload)
      if (e) throw e
      setReviewRows(null); setReviewSource(''); setReviewNotes('')
      load()
    } catch (err) {
      setError('Could not save the reviewed rows: ' + err.message)
    }
    setSaving(false)
  }

  // ── Styles ─────────────────────────────────────────────────────────────────
  const cell = { padding: '6px 8px', fontSize: 12, borderBottom: '0.5px solid var(--border)' }
  const th = { ...cell, color: 'var(--text3)', textAlign: 'left', fontWeight: 600 }
  const btnPrimary = { background: '#185FA5', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '7px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 500 }
  const btnPlain = { background: 'var(--surface2)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', padding: '7px 14px', cursor: 'pointer', fontSize: 13 }
  const lbl = { fontSize: 11, color: 'var(--text3)', marginBottom: 3, display: 'block' }

  return (
    <div>
      {/* Action bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search price list — product, supplier or code"
          style={{ flex: 1, minWidth: 200 }} />
        <label style={{ ...btnPlain, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {uploading ? 'Reading PDF…' : '⬆ Upload supplier PDF'}
          <input type="file" accept="application/pdf" style={{ display: 'none' }}
            disabled={uploading}
            onChange={e => { onUploadPdf(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        <button style={btnPrimary} onClick={startAdd}>+ Add price</button>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
        Upload a supplier price list or quote — the system reads the rows for you to review before saving. Every price is dated, so the list keeps a history.
      </div>

      {error && (
        <div style={{ padding: '9px 12px', borderRadius: 'var(--radius)', background: '#FAECE7', color: '#993C1D', fontSize: 12, marginBottom: 12 }}>{error}</div>
      )}

      {/* ── PDF REVIEW SCREEN ──────────────────────────────────────────────── */}
      {reviewRows && (
        <div style={{ border: '2px solid #185FA5', borderRadius: 'var(--radius)', padding: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
            Review extracted prices — {reviewSource}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>
            Read from the PDF by AI. Check every row, untick anything wrong, edit as needed, then save. {reviewNotes}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={th}>Keep</th>
                  <th style={th}>Product</th>
                  <th style={th}>Code</th>
                  <th style={th}>Supplier</th>
                  <th style={th}>Price</th>
                  <th style={th}>Unit</th>
                  <th style={th}>Pack size</th>
                  <th style={th}>VAT</th>
                </tr>
              </thead>
              <tbody>
                {reviewRows.map((r, i) => (
                  <tr key={i}>
                    <td style={cell}>
                      <input type="checkbox" checked={r._keep}
                        onChange={e => setReviewCell(i, '_keep', e.target.checked)} />
                    </td>
                    <td style={cell}><input value={r.product_name} onChange={e => setReviewCell(i, 'product_name', e.target.value)} style={{ width: 180 }} /></td>
                    <td style={cell}><input value={r.product_code} onChange={e => setReviewCell(i, 'product_code', e.target.value)} style={{ width: 90 }} /></td>
                    <td style={cell}><input value={r.supplier} onChange={e => setReviewCell(i, 'supplier', e.target.value)} style={{ width: 120 }} /></td>
                    <td style={cell}><input value={r.price} onChange={e => setReviewCell(i, 'price', e.target.value)} style={{ width: 70 }} /></td>
                    <td style={cell}>
                      <select value={r.unit} onChange={e => setReviewCell(i, 'unit', e.target.value)} style={{ width: 100 }}>
                        <option value="">—</option>
                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </td>
                    <td style={cell}><input value={r.pack_size} onChange={e => setReviewCell(i, 'pack_size', e.target.value)} style={{ width: 110 }} /></td>
                    <td style={cell}>
                      <select value={r.vat_basis} onChange={e => setReviewCell(i, 'vat_basis', e.target.value)} style={{ width: 70 }}>
                        <option value="">—</option>
                        <option value="excl">excl</option>
                        <option value="incl">incl</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button style={btnPlain} onClick={() => { setReviewRows(null); setError('') }}>Discard</button>
            <button style={btnPrimary} onClick={saveReview} disabled={saving}>
              {saving ? 'Saving…' : 'Save ticked rows'}
            </button>
          </div>
        </div>
      )}

      {/* ── MANUAL ADD / EDIT FORM ─────────────────────────────────────────── */}
      {editing && (
        <div style={{ border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, marginBottom: 16, background: 'var(--surface2)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>
            {editing === 'new' ? 'Add a price' : 'Edit price'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div><span style={lbl}>Product name *</span><input value={form.product_name} onChange={e => set('product_name', e.target.value)} style={{ width: '100%' }} /></div>
            <div><span style={lbl}>Product code / SKU</span><input value={form.product_code} onChange={e => set('product_code', e.target.value)} style={{ width: '100%' }} /></div>
            <div><span style={lbl}>Supplier</span><input value={form.supplier} onChange={e => set('supplier', e.target.value)} style={{ width: '100%' }} /></div>
            <div><span style={lbl}>Price (£)</span><input type="number" value={form.price} onChange={e => set('price', e.target.value)} style={{ width: '100%' }} /></div>
            <div><span style={lbl}>Unit</span>
              <select value={form.unit} onChange={e => set('unit', e.target.value)} style={{ width: '100%' }}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div><span style={lbl}>Pack / quantity size</span><input value={form.pack_size} onChange={e => set('pack_size', e.target.value)} style={{ width: '100%' }} /></div>
            <div><span style={lbl}>VAT basis</span>
              <select value={form.vat_basis} onChange={e => set('vat_basis', e.target.value)} style={{ width: '100%' }}>
                <option value="">—</option>
                <option value="excl">Excl VAT</option>
                <option value="incl">Inc VAT</option>
              </select>
            </div>
            <div><span style={lbl}>Price date</span><input type="date" value={form.price_date} onChange={e => set('price_date', e.target.value)} style={{ width: '100%' }} /></div>
            <div><span style={lbl}>Notes</span><input value={form.notes} onChange={e => set('notes', e.target.value)} style={{ width: '100%' }} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button style={btnPlain} onClick={() => { setEditing(null); setError('') }}>Cancel</button>
            <button style={btnPrimary} onClick={saveRow} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* ── THE LIST ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 40, fontSize: 13 }}>Loading price list…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 40, fontSize: 13 }}>
          {items.length === 0
            ? 'No prices yet. Upload a supplier PDF or add a price to get started.'
            : 'No entries match your search.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={th}>Product</th>
                <th style={th}>Code</th>
                <th style={th}>Supplier</th>
                <th style={th}>Price</th>
                <th style={th}>Unit</th>
                <th style={th}>Pack size</th>
                <th style={th}>VAT</th>
                <th style={th}>Date</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(it => (
                <tr key={it.id}>
                  <td style={cell}>{it.product_name}</td>
                  <td style={cell}>{it.product_code || '—'}</td>
                  <td style={cell}>{it.supplier || '—'}</td>
                  <td style={{ ...cell, fontWeight: 500 }}>{money(it.price)}</td>
                  <td style={cell}>{it.unit || '—'}</td>
                  <td style={cell}>{it.pack_size || '—'}</td>
                  <td style={cell}>{it.vat_basis ? (it.vat_basis === 'excl' ? 'Excl' : 'Inc') : '—'}</td>
                  <td style={cell}>{fmtDate(it.price_date)}</td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                    <button onClick={() => startEdit(it)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#185FA5', fontSize: 12, marginRight: 8 }}>Edit</button>
                    <button onClick={() => deleteRow(it.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#993C1D', fontSize: 12 }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
