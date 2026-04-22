import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { DOCUMENT_TYPES, formatDate, daysUntilExpiry, docStatusInfo, exportToCSV } from '../lib/utils'
import { Avatar, Pill, Spinner, EmptyState } from '../components/ui'

export default function Documents() {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('documents_with_status')
      .select('*, subcontractors(id, company_name, trade)')
      .order('expiry_date', { nullsFirst: false })
    if (error) console.error('[Documents] load error:', error)
    setDocs(data || [])
    setLoading(false)
  }

  function filtered() {
    let list = docs
    if (filter !== 'all') list = list.filter(d => d.status === filter)
    if (typeFilter !== 'all') list = list.filter(d => d.document_type === typeFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(d =>
        d.subcontractors?.company_name?.toLowerCase().includes(q) ||
        d.document_name?.toLowerCase().includes(q) ||
        DOCUMENT_TYPES[d.document_type]?.toLowerCase().includes(q)
      )
    }
    return list
  }

  function doExport() {
    const list = filtered()
    const rows = list.map(d => ({
      Contractor: d.subcontractors?.company_name || '',
      Trade: d.subcontractors?.trade || '',
      'Document Type': DOCUMENT_TYPES[d.document_type] || d.document_type,
      'Document Name': d.document_name,
      Reference: d.reference_number || '',
      'Issue Date': formatDate(d.issue_date),
      'Expiry Date': formatDate(d.expiry_date),
      Status: d.status || '',
      Notes: d.notes || '',
    }))
    exportToCSV(rows, 'compliance-documents.csv')
  }

  const counts = {
    all: docs.length,
    expired: docs.filter(d => d.status === 'expired').length,
    expiring_soon: docs.filter(d => d.status === 'expiring_soon').length,
    valid: docs.filter(d => d.status === 'valid').length,
    no_expiry: docs.filter(d => d.status === 'no_expiry').length,
  }

  // Get unique document types present
  const docTypesPresent = [...new Set(docs.map(d => d.document_type))].sort()

  const list = filtered()

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Compliance</h2>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 2 }}>Track all subcontractor paperwork and expiry dates</p>
        </div>
        <button className="btn btn-sm" onClick={doExport}>↓ Export CSV</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 20 }}>
        <div className="stat-card"><div className="stat-label">Total Documents</div><div className="stat-value">{counts.all}</div></div>
        <div className="stat-card"><div className="stat-label">Expired</div><div className={`stat-value ${counts.expired > 0 ? 'red' : ''}`}>{counts.expired}</div></div>
        <div className="stat-card"><div className="stat-label">Expiring Soon</div><div className={`stat-value ${counts.expiring_soon > 0 ? 'amber' : ''}`}>{counts.expiring_soon}</div></div>
        <div className="stat-card"><div className="stat-label">Valid</div><div className="stat-value green">{counts.valid}</div></div>
      </div>

      {/* Search */}
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search documents or contractors..." style={{ marginBottom: 12 }} />

      {/* Status filter */}
      <div className="filter-tabs">
        {[['all','All'], ['expired',`Expired (${counts.expired})`], ['expiring_soon',`Expiring Soon (${counts.expiring_soon})`], ['valid',`Valid (${counts.valid})`], ['no_expiry','No Expiry']].map(([k,v]) => (
          <div key={k} className={`filter-tab ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>
            {k === 'all'
              ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              : <span style={{ width: 8, height: 8, borderRadius: '50%', background: k === 'valid' ? '#448a40' : k === 'expiring_soon' ? '#BA7517' : '#E24B4A', display: 'inline-block', flexShrink: 0 }} />
            }
            {v}
          </div>
        ))}
      </div>

      {/* Document type filter */}
      <div className="filter-tabs">
        <div className={`filter-tab ${typeFilter === 'all' ? 'active' : ''}`} onClick={() => setTypeFilter('all')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          All Types
        </div>
        {docTypesPresent.map(t => (
          <div key={t} className={`filter-tab ${typeFilter === t ? 'active' : ''}`} onClick={() => setTypeFilter(t)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            {DOCUMENT_TYPES[t] || t}
          </div>
        ))}
      </div>

      {loading ? <Spinner /> : list.length === 0 ? (
        <EmptyState icon="📄" title="No documents found" message="Add documents to subcontractor profiles to track compliance." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Contractor</th><th>Document</th><th>Reference</th><th>Expiry</th><th>Status</th></tr>
            </thead>
            <tbody>
              {list.map(doc => {
                const info = docStatusInfo(doc.expiry_date)
                const days = daysUntilExpiry(doc.expiry_date)
                return (
                  <tr key={doc.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/subcontractors/${doc.subcontractors?.id}`)}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Avatar name={doc.subcontractors?.company_name} size="sm" />
                        <div>
                          <div style={{ fontWeight: 500 }}>{doc.subcontractors?.company_name}</div>
                          <div className="td-muted">{doc.subcontractors?.trade}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{DOCUMENT_TYPES[doc.document_type] || doc.document_name}</div>
                      <div className="td-muted">{doc.document_name}</div>
                    </td>
                    <td className="td-muted">{doc.reference_number || '—'}</td>
                    <td>
                      <div style={{ fontWeight: doc.status !== 'valid' ? 500 : 400 }}>{formatDate(doc.expiry_date)}</div>
                      {days !== null && doc.status !== 'valid' && doc.status !== 'no_expiry' && (
                        <div style={{ fontSize: 11, color: days < 0 ? 'var(--red)' : 'var(--amber)' }}>
                          {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d remaining`}
                        </div>
                      )}
                    </td>
                    <td><Pill cls={info?.cls || 'pill-gray'}>{info?.label}</Pill></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
