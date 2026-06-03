import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import PriceListTab from './PriceListTab'
import PriceJobTab from './PriceJobTab'
import PricedJobsHistory from './PricedJobsHistory'

// ── Web Search ───────────────────────────────────────────────────────────────
// Two research tools backed by the `web-search` edge function:
//   • Products  — find materials on the web; price, VAT, size, coverage,
//                 per-sheet & per-m² figures, image, datasheet link.
//   • Suppliers — find local suppliers by trade + postcode.
//
// Honest by design: anything the web doesn't provide is shown as "not shown"
// or "—", never invented. Prices/availability always need verifying.

const VAT_RATE = 0.20

// Apply the VAT toggle to a price given its known basis.
// Returns { value, label } — label notes when the basis was unclear.
function priceForView(price, vatBasis, viewIncVat) {
  if (price == null) return { value: null, note: null }
  // vatBasis: 'excl' | 'incl' | null
  if (vatBasis === 'excl') {
    return viewIncVat
      ? { value: price * (1 + VAT_RATE), note: null }
      : { value: price, note: null }
  }
  if (vatBasis === 'incl') {
    return viewIncVat
      ? { value: price, note: null }
      : { value: price / (1 + VAT_RATE), note: null }
  }
  // Basis unclear — show the figure as-is, flag it honestly.
  return { value: price, note: 'VAT basis unclear' }
}

const money = (n) => n == null ? null
  : '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function WebSearch() {
  const [tab, setTab] = useState('pricejob')
  const [subTab, setSubTab] = useState('products')

  // Products tab state
  const [pQuery, setPQuery] = useState('')
  const [pLoading, setPLoading] = useState(false)
  const [pResults, setPResults] = useState(null)   // null = not searched yet
  const [pError, setPError] = useState('')
  const [pNotes, setPNotes] = useState('')
  const [incVat, setIncVat] = useState(false)

  // Suppliers tab state
  const [sQuery, setSQuery] = useState('')
  const [sPostcode, setSPostcode] = useState('')
  const [sLoading, setSLoading] = useState(false)
  const [sResults, setSResults] = useState(null)
  const [sError, setSError] = useState('')
  const [sNotes, setSNotes] = useState('')

  async function searchProducts() {
    if (!pQuery.trim()) return
    setPLoading(true); setPError(''); setPResults(null); setPNotes('')
    try {
      const { data, error } = await supabase.functions.invoke('web-search', {
        body: { mode: 'products', query: pQuery.trim() },
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error || 'Search failed — please try again.')
      setPResults(rankProducts(data.results || []))
      setPNotes(data.notes || '')
    } catch (err) {
      setPError(err.message || 'Search failed.')
    }
    setPLoading(false)
  }

  async function searchSuppliers() {
    if (!sQuery.trim() || !sPostcode.trim()) return
    setSLoading(true); setSError(''); setSResults(null); setSNotes('')
    try {
      const { data, error } = await supabase.functions.invoke('web-search', {
        body: { mode: 'suppliers', query: sQuery.trim(), postcode: sPostcode.trim() },
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error || 'Search failed — please try again.')
      setSResults((data.results || []).slice(0, 5))
      setSNotes(data.notes || '')
    } catch (err) {
      setSError(err.message || 'Search failed.')
    }
    setSLoading(false)
  }

  // Rank products by price-per-m² ascending; results with no per-m² sort last.
  function rankProducts(list) {
    const withPpm2 = list.map(r => {
      const ppm2 = (r.price != null && r.coverage_m2)
        ? r.price / r.coverage_m2 : null
      return { ...r, _ppm2: ppm2 }
    })
    return withPpm2.sort((a, b) => {
      if (a._ppm2 == null && b._ppm2 == null) return 0
      if (a._ppm2 == null) return 1
      if (b._ppm2 == null) return -1
      return a._ppm2 - b._ppm2
    }).slice(0, 5)   // top 5 only
  }

  // ── Styles ─────────────────────────────────────────────────────────────────
  const card = {
    background: 'var(--surface)', border: '0.5px solid var(--border)',
    borderRadius: 12, padding: '12px 14px',
  }
  const cardBest = { ...card, border: '2px solid #185FA5' }
  const priceBox = {
    flex: 1, background: 'var(--surface2)', borderRadius: 8, padding: '6px 10px',
  }
  const caveat = {
    fontSize: 12, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 6,
  }

  return (
    <div style={{ padding: '20px 24px', maxWidth: 920, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 2 }}>Price Jobs</h1>
      <p style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 16 }}>
        Price tenders from your quotes, price lists and past jobs — with escalation applied.
      </p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '0.5px solid var(--border)', marginBottom: 16, flexWrap: 'wrap' }}>
        {[['pricejob', 'Price a job'], ['pricelist', 'Price library'], ['research', 'Research'], ['history', 'History']].map(([k, lbl]) => (
          <div key={k} onClick={() => setTab(k)}
            style={{
              padding: '8px 14px', fontSize: 14, cursor: 'pointer',
              fontWeight: tab === k ? 600 : 400,
              color: tab === k ? 'var(--text)' : 'var(--text3)',
              borderBottom: tab === k ? '2px solid #185FA5' : '2px solid transparent',
            }}>
            {lbl}
          </div>
        ))}
      </div>

      {/* ── PRICE A JOB ────────────────────────────────────────────────────── */}
      {tab === 'pricejob' && <PriceJobTab />}

      {/* ── HISTORY ────────────────────────────────────────────────────────── */}
      {tab === 'history' && <PricedJobsHistory />}

      {/* ── RESEARCH (Products + Suppliers) ────────────────────────────────── */}
      {tab === 'research' && (
        <div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
            {[['products', 'Products'], ['suppliers', 'Suppliers']].map(([k, lbl]) => (
              <div key={k} onClick={() => setSubTab(k)}
                style={{
                  padding: '6px 12px', fontSize: 13, cursor: 'pointer', borderRadius: 6,
                  fontWeight: subTab === k ? 600 : 400,
                  color: subTab === k ? 'var(--text)' : 'var(--text3)',
                  background: subTab === k ? 'var(--surface2)' : 'transparent',
                }}>
                {lbl}
              </div>
            ))}
          </div>
          <ResearchTools
            subTab={subTab}
            pQuery={pQuery} setPQuery={setPQuery} searchProducts={searchProducts}
            pLoading={pLoading} pResults={pResults} pError={pError} pNotes={pNotes}
            incVat={incVat} setIncVat={setIncVat} priceForView={priceForView} money={money}
            card={card} cardBest={cardBest} priceBox={priceBox} caveat={caveat}
            sQuery={sQuery} setSQuery={setSQuery} sPostcode={sPostcode} setSPostcode={setSPostcode}
            searchSuppliers={searchSuppliers} sLoading={sLoading} sResults={sResults}
            sError={sError} sNotes={sNotes}
          />
        </div>
      )}

      {/* ── PRICE LIBRARY ──────────────────────────────────────────────────── */}
      {tab === 'pricelist' && <PriceListTab />}
    </div>
  )
}

// ── Research tools (the original Products + Suppliers web search) ────────────
// Kept intact, just moved into its own component under the Research tab.
function ResearchTools(props) {
  const {
    subTab, pQuery, setPQuery, searchProducts, pLoading, pResults, pError, pNotes,
    incVat, setIncVat, priceForView, money, card, cardBest, priceBox, caveat,
    sQuery, setSQuery, sPostcode, setSPostcode, searchSuppliers, sLoading, sResults, sError, sNotes,
  } = props
  return (
    <>
      {/* ── PRODUCTS ───────────────────────────────────────────────────────── */}
      {subTab === 'products' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input value={pQuery} onChange={e => setPQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') searchProducts() }}
              placeholder="e.g. 100mm PIR insulation board"
              style={{ flex: 1 }} />
            <button onClick={searchProducts} disabled={pLoading}
              style={{ whiteSpace: 'nowrap', background: '#185FA5', color: '#fff', border: 'none', borderRadius: 6, padding: '0 16px', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
              {pLoading ? 'Searching…' : 'Search'}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <div style={caveat}>
              <span>ℹ</span> Prices are a guide from web search and may be out of date — always check the live price on the supplier's site before ordering or quoting.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 6, padding: 2 }}>
              {[['Excl VAT', false], ['Inc VAT', true]].map(([lbl, val]) => (
                <div key={lbl} onClick={() => setIncVat(val)}
                  style={{
                    fontSize: 12, padding: '4px 10px', borderRadius: 5, cursor: 'pointer',
                    fontWeight: incVat === val ? 600 : 400,
                    background: incVat === val ? '#E6F1FB' : 'transparent',
                    color: incVat === val ? '#185FA5' : 'var(--text3)',
                  }}>
                  {lbl}
                </div>
              ))}
            </div>
          </div>

          {pError && (
            <div style={{ padding: '9px 12px', borderRadius: 6, background: '#FAECE7', color: '#993C1D', fontSize: 12, marginBottom: 12 }}>{pError}</div>
          )}

          {pLoading && (
            <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 40, fontSize: 13 }}>
              Searching the web — this can take 15–40 seconds…
            </div>
          )}

          {!pLoading && pResults && pResults.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 40, fontSize: 13 }}>
              No matching products found. Try different wording.
            </div>
          )}

          {!pLoading && pResults && pResults.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pResults.map((r, i) => {
                const sheet = priceForView(r.price, r.vat_basis, incVat)
                const ppm2 = (sheet.value != null && r.coverage_m2)
                  ? sheet.value / r.coverage_m2 : null
                const isBest = i === 0 && r._ppm2 != null
                return (
                  <div key={i} style={isBest ? cardBest : card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                      {/* Left — product detail */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {isBest && (
                          <span style={{ background: '#E6F1FB', color: '#185FA5', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 5 }}>Lowest guide price / m²</span>
                        )}
                        <div style={{ fontSize: 15, fontWeight: 500, marginTop: isBest ? 6 : 0 }}>{r.name || 'Unnamed product'}</div>
                        <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>
                          {[r.size, r.coverage_m2 ? r.coverage_m2 + 'm² per sheet' : null].filter(Boolean).join(' · ') || 'Size not stated'}
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                          <div style={priceBox}>
                            <div style={{ fontSize: 11, color: 'var(--text2)' }}>Guide / sheet</div>
                            <div style={{ fontSize: 16, fontWeight: 500, color: sheet.value == null ? 'var(--text3)' : 'var(--text)' }}>
                              {sheet.value == null ? 'Not shown' : money(sheet.value)}
                            </div>
                          </div>
                          <div style={priceBox}>
                            <div style={{ fontSize: 11, color: 'var(--text2)' }}>Guide / m²</div>
                            <div style={{ fontSize: 16, fontWeight: 500, color: ppm2 == null ? 'var(--text3)' : 'var(--text)' }}>
                              {ppm2 == null ? '—' : money(ppm2)}
                            </div>
                          </div>
                        </div>
                        {sheet.note && (
                          <div style={{ fontSize: 11, color: '#854F0B', marginTop: 6 }}>{sheet.note} — shown as listed.</div>
                        )}
                      </div>
                      {/* Right — supplier name above action buttons */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0, minWidth: 150 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, textAlign: 'right' }}>{r.supplier || 'Unknown supplier'}</div>
                        {r.url
                          ? <a href={r.url} target="_blank" rel="noreferrer"
                              style={{ display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center', fontSize: 13, fontWeight: 500, padding: '8px 14px', borderRadius: 8, background: '#185FA5', color: '#fff', textDecoration: 'none' }}>
                              ↗ View product</a>
                          : <span style={{ display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center', fontSize: 13, padding: '8px 14px', borderRadius: 8, background: 'var(--surface2)', color: 'var(--text3)' }}>No link</span>}
                        {r.datasheet_url
                          ? <a href={r.datasheet_url} target="_blank" rel="noreferrer"
                              style={{ display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center', fontSize: 13, fontWeight: 500, padding: '8px 14px', borderRadius: 8, background: 'var(--surface)', border: '0.5px solid var(--border)', color: '#185FA5', textDecoration: 'none' }}>
                              ▤ Datasheet</a>
                          : <span style={{ display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center', fontSize: 13, padding: '8px 14px', borderRadius: 8, background: 'var(--surface2)', color: 'var(--text3)' }}>No datasheet</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
              {pNotes && <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center', padding: 4 }}>{pNotes}</div>}
            </div>
          )}
        </div>
      )}

      {/* ── SUPPLIERS ──────────────────────────────────────────────────────── */}
      {subTab === 'suppliers' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input value={sQuery} onChange={e => setSQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') searchSuppliers() }}
              placeholder="Trade — e.g. scaffolding"
              style={{ flex: 2 }} />
            <input value={sPostcode} onChange={e => setSPostcode(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') searchSuppliers() }}
              placeholder="Postcode — e.g. RH12"
              style={{ flex: 1 }} />
            <button onClick={searchSuppliers} disabled={sLoading}
              style={{ whiteSpace: 'nowrap', background: '#185FA5', color: '#fff', border: 'none', borderRadius: 6, padding: '0 16px', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
              {sLoading ? 'Searching…' : 'Search'}
            </button>
          </div>

          <div style={{ ...caveat, marginBottom: 14 }}>
            <span>ℹ</span> Local results found on the web — a starting point, not a verified directory. Confirm details before engaging.
          </div>

          {sError && (
            <div style={{ padding: '9px 12px', borderRadius: 6, background: '#FAECE7', color: '#993C1D', fontSize: 12, marginBottom: 12 }}>{sError}</div>
          )}

          {sLoading && (
            <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 40, fontSize: 13 }}>
              Searching the web — this can take 15–40 seconds…
            </div>
          )}

          {!sLoading && sResults && sResults.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 40, fontSize: 13 }}>
              No suppliers found. Try a broader trade or a nearby postcode.
            </div>
          )}

          {!sLoading && sResults && sResults.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sResults.map((r, i) => (
                <div key={i} style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 600 }}>{r.name || 'Unnamed company'}</div>
                      <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{r.location || 'Location not stated'}</div>
                      {r.summary && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{r.summary}</div>}
                      <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                        {r.phone && <span style={{ fontSize: 12, color: 'var(--text2)' }}>☎ {r.phone}</span>}
                        {r.email && <span style={{ fontSize: 12, color: 'var(--text2)' }}>✉ {r.email}</span>}
                        {!r.phone && !r.email && <span style={{ fontSize: 12, color: 'var(--text3)' }}>No contact details shown</span>}
                      </div>
                    </div>
                    {r.url
                      ? <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#185FA5', whiteSpace: 'nowrap', flexShrink: 0 }}>↗ Website</a>
                      : <span style={{ fontSize: 12, color: 'var(--text3)', flexShrink: 0 }}>No website</span>}
                  </div>
                </div>
              ))}
              {sNotes && <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center', padding: 4 }}>{sNotes}</div>}
            </div>
          )}
        </div>
      )}

    </>
  )
}
