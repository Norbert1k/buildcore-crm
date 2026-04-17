import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatCurrency, avatarColor, initials } from '../lib/utils'
import { Avatar, Pill, Spinner, EmptyState, IconPlus, IconEdit, Modal, Field, ConfirmDialog } from '../components/ui'
import { useAuth } from '../lib/auth'

const CATEGORIES = [
  'Builders Merchant', 'Timber & Sheet', 'Electrical Supplies', 'Plumbing & Heating',
  'Plant & Tool Hire', 'Scaffolding', 'Roofing Supplies', 'Roofing Materials', 'Fixings & Fasteners',
  'Groundworks', 'Aggregates & Concrete', 'Insulation', 'Ironmongery',
  'Kitchens', 'Wardrobes', 'Safety & PPE', 'Drainage', 'Landscaping', 'General'
]

const PAYMENT_TERMS = ['7 days', '14 days', '30 days', '60 days', '90 days', 'Proforma', 'Credit card', 'Cash on delivery']

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [showPasswords, setShowPasswords] = useState({})
  const { can } = useAuth()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('suppliers').select('*').order('company_name')
    setSuppliers(data || [])
    setLoading(false)
  }

  function filtered() {
    let list = suppliers
    if (filter !== 'all') list = list.filter(s => s.status === filter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.company_name.toLowerCase().includes(q) ||
        s.category?.toLowerCase().includes(q) ||
        s.contact_name?.toLowerCase().includes(q) ||
        s.account_number?.toLowerCase().includes(q)
      )
    }
    return list
  }

  const list = filtered()
  const active = suppliers.filter(s => s.status === 'active').length
  const totalCredit = suppliers.reduce((sum, s) => sum + (s.credit_limit || 0), 0)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Suppliers</h2>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 2 }}>{suppliers.length} suppliers — account details & credit limits</p>
        </div>
        {can('manage_subcontractors') && (
          <button className="btn btn-primary" onClick={() => { setEditing(null); setShowModal(true) }}>
            <IconPlus size={14} /> Add Supplier
          </button>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 24 }}>
        <div className="stat-card"><div className="stat-label">Total Suppliers</div><div className="stat-value">{suppliers.length}</div><div className="stat-sub">{active} active</div></div>
        <div className="stat-card"><div className="stat-label">Total Credit Available</div><div className="stat-value" style={{ fontSize: 18 }}>{formatCurrency(totalCredit)}</div><div className="stat-sub">Combined credit limits</div></div>
        <div className="stat-card"><div className="stat-label">Categories</div><div className="stat-value">{new Set(suppliers.map(s => s.category)).size}</div><div className="stat-sub">Different supply types</div></div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', fontSize: 13 }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search suppliers..." style={{ paddingLeft: 30, width: 240 }} />
        </div>
        <div className="filter-tabs" style={{ marginBottom: 0 }}>
          <div className={`filter-tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            All<span className="tab-badge">{suppliers.length}</span>
          </div>
          <div className={`filter-tab ${filter === 'active' ? 'active' : ''}`} onClick={() => setFilter('active')}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#448a40', display: 'inline-block' }} />
            Active<span className="tab-badge">{active}</span>
          </div>
          <div className={`filter-tab ${filter === 'inactive' ? 'active' : ''}`} onClick={() => setFilter('inactive')}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#888780', display: 'inline-block' }} />
            Inactive<span className="tab-badge">{suppliers.length - active}</span>
          </div>
        </div>
      </div>

      {loading ? <Spinner /> : list.length === 0 ? (
        <EmptyState icon="🏪" title="No suppliers yet" message="Add your suppliers to track account numbers, credit limits and login details."
          action={can('manage_subcontractors') && <button className="btn btn-primary" onClick={() => setShowModal(true)}><IconPlus size={14}/> Add Supplier</button>} />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Category</th>
                <th>Contact</th>
                <th>Account No.</th>
                <th>Credit Limit</th>
                <th>Payment Terms</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map(s => (
                <tr key={s.id} style={{ cursor: can('view_supplier_detail') ? 'pointer' : 'default' }} onClick={() => can('view_supplier_detail') && setViewing(s)}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar name={s.company_name} />
                      <div>
                        <div style={{ fontWeight: 500 }}>{s.company_name}</div>
                        {s.website && <div style={{ fontSize: 11, color: 'var(--blue)' }}>{s.website.replace('https://','').replace('http://','')}</div>}
                      </div>
                    </div>
                  </td>
                  <td><Pill cls="pill-blue">{s.category}</Pill></td>
                  <td>
                    <div>{s.contact_name || '—'}</div>
                    <div className="td-muted">{s.phone || ''}</div>
                  </td>
                  <td>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--surface2)', padding: '2px 8px', borderRadius: 4, display: 'inline-block' }}>
                      {s.account_number || '—'}
                    </div>
                  </td>
                  <td style={{ fontWeight: 500, color: s.credit_limit ? 'var(--green)' : 'var(--text3)' }}>
                    {s.credit_limit ? formatCurrency(s.credit_limit) : '—'}
                  </td>
                  <td className="td-muted">{s.payment_terms || '—'}</td>
                  <td><Pill cls={s.status === 'active' ? 'pill-green' : 'pill-gray'}>{s.status === 'active' ? 'Active' : 'Inactive'}</Pill></td>
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {can('manage_subcontractors') && (
                        <button className="btn btn-sm" onClick={() => { setEditing(s); setShowModal(true) }}><IconEdit size={13}/></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Panel */}
      {viewing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setViewing(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar name={viewing.company_name} size="lg" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{viewing.company_name}</div>
                <div style={{ color: 'var(--text2)', fontSize: 13 }}>{viewing.category}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {can('manage_subcontractors') && (
                  <button className="btn btn-sm" onClick={() => { setEditing(viewing); setViewing(null); setShowModal(true) }}><IconEdit size={13}/> Edit</button>
                )}
                <button className="btn btn-sm" onClick={() => setViewing(null)}>Close</button>
              </div>
            </div>
            <div style={{ padding: '20px 24px' }}>
              {/* Contact */}
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>Contact Details</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px', fontSize: 13, marginBottom: 20 }}>
                {[['Contact', viewing.contact_name], ['Phone', viewing.phone], ['Email', viewing.email], ['Website', viewing.website], ['Address', [viewing.address, viewing.city, viewing.postcode].filter(Boolean).join(', ')]].filter(([,v]) => v).map(([k,v]) => (
                  <div key={k}><span style={{ color: 'var(--text3)', marginRight: 6 }}>{k}:</span><span style={{ color: k === 'Email' || k === 'Website' ? 'var(--blue)' : 'inherit' }}>{v}</span></div>
                ))}
              </div>

              {/* Account Details */}
              <div style={{ height: 1, background: 'var(--border)', margin: '0 0 16px' }} />
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>Account Details</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px', fontSize: 13, marginBottom: 20 }}>
                {[['Account No.', viewing.account_number], ['Credit Limit', viewing.credit_limit ? formatCurrency(viewing.credit_limit) : null], ['Payment Terms', viewing.payment_terms]].filter(([,v]) => v).map(([k,v]) => (
                  <div key={k}><span style={{ color: 'var(--text3)', marginRight: 6 }}>{k}:</span><strong>{v}</strong></div>
                ))}
              </div>

              {/* Portal / Login */}
              {(viewing.portal_url || viewing.portal_username || (viewing.portal_password && can('view_supplier_passwords'))) && (
                <>
                  <div style={{ height: 1, background: 'var(--border)', margin: '0 0 16px' }} />
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>Portal / Login</div>
                  <div style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '12px 14px', fontSize: 13 }}>
                    {viewing.portal_url && <div style={{ marginBottom: 6 }}><span style={{ color: 'var(--text3)', marginRight: 6 }}>URL:</span><span style={{ color: 'var(--blue)' }}>{viewing.portal_url}</span></div>}
                    {viewing.portal_username && <div style={{ marginBottom: 6 }}><span style={{ color: 'var(--text3)', marginRight: 6 }}>Username:</span><span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{viewing.portal_username}</span></div>}
                    {viewing.portal_password && can('view_supplier_passwords') && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: 'var(--text3)', marginRight: 6 }}>Password:</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                          {showPasswords[viewing.id] ? viewing.portal_password : '••••••••••'}
                        </span>
                        <button className="btn btn-sm" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setShowPasswords(p => ({ ...p, [viewing.id]: !p[viewing.id] }))}>
                          {showPasswords[viewing.id] ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Notes */}
              {viewing.notes && (
                <>
                  <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>Notes</div>
                  <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>{viewing.notes}</div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <SupplierModal
          supplier={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load() }}
        />
      )}
    </div>
  )
}

function SupplierModal({ supplier, onClose, onSaved }) {
  const { profile } = useAuth()
  const editing = !!supplier
  const [form, setForm] = useState({
    company_name: supplier?.company_name || '',
    contact_name: supplier?.contact_name || '',
    category: supplier?.category || 'Builders Merchant',
    email: supplier?.email || '',
    phone: supplier?.phone || '',
    website: supplier?.website || '',
    address: supplier?.address || '',
    city: supplier?.city || '',
    postcode: supplier?.postcode || '',
    account_number: supplier?.account_number || '',
    credit_limit: supplier?.credit_limit || '',
    payment_terms: supplier?.payment_terms || '30 days',
    portal_url: supplier?.portal_url || '',
    portal_username: supplier?.portal_username || '',
    portal_password: supplier?.portal_password || '',
    notes: supplier?.notes || '',
    status: supplier?.status || 'active',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showPass, setShowPass] = useState(false)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    if (!form.company_name.trim()) { setError('Company name is required'); return }
    setSaving(true)
    const payload = { ...form, credit_limit: form.credit_limit ? parseFloat(form.credit_limit) : null }
    let result
    if (editing) {
      result = await supabase.from('suppliers').update(payload).eq('id', supplier.id)
    } else {
      payload.created_by = profile?.id
      result = await supabase.from('suppliers').insert(payload)
    }
    setSaving(false)
    if (result.error) { setError(result.error.message); return }
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={editing ? `Edit: ${supplier.company_name}` : 'Add New Supplier'} size="lg"
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Supplier'}</button></>}>
      {error && <div style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red-border)', borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 13, marginBottom: 14 }}>{error}</div>}
      <div className="form-grid">
        <div className="form-section">Company Details</div>
        <div className="full"><Field label="Company Name *"><input value={form.company_name} onChange={e => set('company_name', e.target.value)} placeholder="e.g. Travis Perkins" autoFocus /></Field></div>
        <Field label="Category"><select value={form.category} onChange={e => set('category', e.target.value)}>{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></Field>
        <Field label="Status"><select value={form.status} onChange={e => set('status', e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
        <Field label="Contact Name"><input value={form.contact_name} onChange={e => set('contact_name', e.target.value)} placeholder="Account manager name" /></Field>
        <Field label="Phone"><input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+44 ..." /></Field>
        <Field label="Email"><input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="accounts@supplier.com" /></Field>
        <Field label="Website"><input value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://www.supplier.com" /></Field>

        <div className="form-section">Address</div>
        <div className="full"><Field label="Street Address"><input value={form.address} onChange={e => set('address', e.target.value)} placeholder="Branch / depot address" /></Field></div>
        <Field label="City"><input value={form.city} onChange={e => set('city', e.target.value)} placeholder="London" /></Field>
        <Field label="Postcode"><input value={form.postcode} onChange={e => set('postcode', e.target.value)} placeholder="SW1A 1AA" /></Field>

        <div className="form-section">Account & Credit</div>
        <Field label="Account Number"><input value={form.account_number} onChange={e => set('account_number', e.target.value)} placeholder="e.g. CCG-00123" /></Field>
        <Field label="Credit Limit (£)"><input type="number" value={form.credit_limit} onChange={e => set('credit_limit', e.target.value)} placeholder="0" min="0" /></Field>
        <Field label="Payment Terms"><select value={form.payment_terms} onChange={e => set('payment_terms', e.target.value)}>{PAYMENT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}</select></Field>

        <div className="form-section">Portal / Online Login</div>
        <div className="full"><Field label="Portal URL"><input value={form.portal_url} onChange={e => set('portal_url', e.target.value)} placeholder="https://portal.supplier.com" /></Field></div>
        <Field label="Username / Email"><input value={form.portal_username} onChange={e => set('portal_username', e.target.value)} placeholder="Login username" /></Field>
        <Field label="Password">
          <div style={{ position: 'relative' }}>
            <input type={showPass ? 'text' : 'password'} value={form.portal_password} onChange={e => set('portal_password', e.target.value)} placeholder="Portal password" style={{ paddingRight: 60 }} />
            <button type="button" onClick={() => setShowPass(p => !p)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', fontSize: 11, color: 'var(--text3)', cursor: 'pointer', fontFamily: 'inherit' }}>{showPass ? 'Hide' : 'Show'}</button>
          </div>
        </Field>

        <div className="form-section">Notes</div>
        <div className="full"><Field label="Internal Notes"><textarea value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any notes about this supplier, special terms, contacts, etc." /></Field></div>
      </div>
    </Modal>
  )
}
