import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { SUB_STATUSES, TRADES, subDocSummary, initials, avatarColor } from '../lib/utils'
import { Avatar, Pill, Spinner, EmptyState, IconPlus, IconSearch, IconEdit, IconTrash, ConfirmDialog } from '../components/ui'
import { RatingBadge } from '../components/PerformanceTab'
import { useAuth } from '../lib/auth'
import SubcontractorModal from '../components/SubcontractorModal'

export default function Subcontractors() {
  const [subs, setSubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [editing, setEditing] = useState(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { can } = useAuth()

  useEffect(() => { load() }, [location.key])

  async function deleteSub(id) {
    await supabase.from('subcontractors').delete().eq('id', id)
    setConfirmDelete(null)
    load()
  }

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
              {k === 'all'
                ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{flexShrink:0}}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                : <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: k === 'active' ? '#448a40' : k === 'approved' ? '#378ADD' : k === 'on_hold' ? '#BA7517' : '#888780', display: 'inline-block' }} />
              }
              {v}<span className="tab-badge">{k === 'all' ? subs.length : counts[k] || 0}</span>
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
                    <td>
                      <Pill cls={SUB_STATUSES[s.status]?.cls || 'pill-gray'}>{SUB_STATUSES[s.status]?.label || s.status}</Pill>
                      <div style={{ marginTop: 4 }}>
                        {s.approved ? (
                          <span style={{ fontSize: 10, background: 'var(--green-bg)', color: 'var(--green)', border: '1px solid var(--green-border)', borderRadius: 10, padding: '2px 8px', fontWeight: 700, whiteSpace: 'nowrap' }}>✓ Approved for Payment</span>
                        ) : (
                          <span style={{ fontSize: 10, background: 'var(--amber-bg)', color: 'var(--amber)', border: '1px solid var(--amber-border)', borderRadius: 10, padding: '2px 8px', fontWeight: 700, whiteSpace: 'nowrap' }}>⏳ Pending Approval</span>
                        )}
                      </div>
                    </td>
                    <td>{docPill}</td>
                    <td><RatingBadge ratings={s.performance_ratings} /></td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
{can('manage_subcontractors') && (
                          <button className="btn btn-sm" onClick={() => { setEditing(s); setShowModal(true) }}><IconEdit size={13} /></button>
                        )}
                        {can('delete') && (
                          <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(s)}><IconTrash size={13} /></button>
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

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => deleteSub(confirmDelete?.id)}
        title="Delete subcontractor"
        message={`Are you sure you want to permanently delete ${confirmDelete?.company_name}? All their documents, contacts and ratings will also be deleted. This cannot be undone.`}
        danger
      />
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
