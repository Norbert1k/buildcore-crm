import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { SUB_STATUSES, TRADES, subDocSummary, initials, avatarColor } from '../lib/utils'
import { Avatar, Pill, Spinner, EmptyState, IconPlus, IconSearch, IconEye, IconEdit } from '../components/ui'
import { RatingBadge } from '../components/PerformanceTab'
import { useAuth } from '../lib/auth'
import SubcontractorModal from '../components/SubcontractorModal'

export default function Subcontractors() {
  const [subs, setSubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const navigate = useNavigate()
  const { can } = useAuth()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('subcontractors')
      .select('*, documents_with_status(id, expiry_date, status), performance_ratings(id, rating_type)')
      .order('company_name')
    setSubs(data || [])
    setLoading(false)
  }

  function filtered() {
    let list = subs
    if (filter !== 'all') list = list.filter(s => s.status === filter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.company_name.toLowerCase().includes(q) ||
        s.contact_name.toLowerCase().includes(q) ||
        s.trade.toLowerCase().includes(q) ||
        s.city?.toLowerCase().includes(q)
      )
    }
    return list
  }

  const counts = {
    all: subs.length,
    active: subs.filter(s => s.status === 'active').length,
    approved: subs.filter(s => s.status === 'approved').length,
    on_hold: subs.filter(s => s.status === 'on_hold').length,
    inactive: subs.filter(s => s.status === 'inactive').length,
  }

  const list = filtered()

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Subcontractors</h2>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 2 }}>{subs.length} registered contractors</p>
        </div>
        {can('manage_subcontractors') && (
          <button className="btn btn-primary" onClick={() => { setEditing(null); setShowModal(true) }}>
            <IconPlus size={14} /> Add Subcontractor
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="search-wrap" style={{ position: 'relative' }}>
          <span className="search-icon" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}><IconSearch size={13} /></span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, trade, city…" style={{ paddingLeft: 32, width: 260 }} />
        </div>
        <div className="filter-tabs" style={{ marginBottom: 0 }}>
          {Object.entries({ all: 'All', active: 'Active', approved: 'Approved', on_hold: 'On Hold', inactive: 'Inactive' }).map(([k, v]) => (
            <div key={k} className={`filter-tab ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>
              {v} ({counts[k]})
            </div>
          ))}
        </div>
      </div>

      {loading ? <Spinner /> : list.length === 0 ? (
        <EmptyState icon="👷" title="No subcontractors found" message={search ? 'Try adjusting your search.' : 'Add your first subcontractor to get started.'} action={can('manage_subcontractors') && <button className="btn btn-primary" onClick={() => setShowModal(true)}><IconPlus size={14}/> Add Subcontractor</button>} />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Trade</th>
                <th>Contact</th>
                <th>Location</th>
                <th>Status</th>
                <th>Documents</th>
                <th>Rating</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map(s => {
                const { expired, expiring, valid, total } = subDocSummary(s.documents_with_status)
                const docPill = expired > 0
                  ? <Pill cls="pill-red">{expired} expired</Pill>
                  : expiring > 0
                  ? <Pill cls="pill-amber">{expiring} expiring</Pill>
                  : total > 0
                  ? <Pill cls="pill-green">All valid</Pill>
                  : <Pill cls="pill-gray">No docs</Pill>
                return (
                  <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/subcontractors/${s.id}`)}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Avatar name={s.company_name} />
                        <div>
                          <div style={{ fontWeight: 500 }}>{s.company_name}</div>
                          <div className="td-muted">{s.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><Pill cls="pill-blue">{s.trade}</Pill></td>
                    <td>
                      <div>{s.contact_name}</div>
                      <div className="td-muted">{s.phone}</div>
                    </td>
                    <td>{s.city || '—'}</td>
                    <td><Pill cls={SUB_STATUSES[s.status]?.cls || 'pill-gray'}>{SUB_STATUSES[s.status]?.label || s.status}</Pill></td>
                    <td>{docPill}</td>
                    <td><RatingBadge ratings={s.performance_ratings} /></td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                        <button className="btn btn-sm" onClick={() => navigate(`/subcontractors/${s.id}`)}><IconEye size={13} /></button>
                        {can('manage_subcontractors') && (
                          <button className="btn btn-sm" onClick={() => { setEditing(s); setShowModal(true) }}><IconEdit size={13} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <SubcontractorModal
          sub={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load() }}
        />
      )}
    </div>
  )
}
