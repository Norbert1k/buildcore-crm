import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { formatDate } from '../lib/utils'
import { ConfirmDialog } from '../components/ui'

function initials(name) {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 3)
}

const AVATAR_COLORS = [
  { bg: '#448a4025', color: '#6dc468' },
  { bg: '#378ADD25', color: '#378ADD' },
  { bg: '#534AB725', color: '#AFA9EC' },
  { bg: '#BA751725', color: '#EF9F27' },
  { bg: '#993C1D25', color: '#F0997B' },
  { bg: '#0F6E5625', color: '#5DCAA5' },
]

function clientColor(id) {
  const idx = id ? parseInt(id.replace(/-/g, '').slice(0, 4), 16) % AVATAR_COLORS.length : 0
  return AVATAR_COLORS[idx]
}

const STATUS_COLORS = {
  active:    { bg: 'var(--green-bg)', color: 'var(--green)' },
  tender:    { bg: '#378ADD20', color: '#378ADD' },
  on_hold:   { bg: '#BA751720', color: '#BA7517' },
  completed: { bg: 'var(--surface2)', color: 'var(--text3)' },
  cancelled: { bg: '#E24B4A20', color: '#E24B4A' },
}

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isPMOrAdmin = ['admin', 'project_manager'].includes(profile?.role)

  const [client, setClient] = useState(null)
  const [projects, setProjects] = useState([])
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem(`tab:/clients/${id}`) || 'projects')

  const [showEditClient, setShowEditClient] = useState(false)
  const [showAddContact, setShowAddContact] = useState(false)
  const [confirmDeleteContact, setConfirmDeleteContact] = useState(null)

  function setTab(t) { setActiveTab(t); localStorage.setItem(`tab:/clients/${id}`, t) }

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    const [{ data: c }, { data: p }, { data: co }] = await Promise.all([
      supabase.from('clients').select('*').eq('id', id).single(),
      supabase.from('projects').select('id, project_name, project_ref, status, value, start_date, end_date').eq('client_id', id).order('start_date', { ascending: false }),
      supabase.from('client_contacts').select('*').eq('client_id', id).order('is_pm', { ascending: false }),
    ])
    setClient(c)
    setProjects(p || [])
    setContacts(co || [])
    setLoading(false)
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Loading...</div>
  if (!client) return <div style={{ padding: 40, color: 'var(--text3)' }}>Client not found.</div>

  const col = clientColor(client.id)
  const totalValue = projects.reduce((s, p) => s + (p.value || 0), 0)
  const activeProjects = projects.filter(p => ['active', 'tender'].includes(p.status))
  const doneProjects = projects.filter(p => !['active', 'tender'].includes(p.status))

  function fmt(n) {
    if (!n) return '—'
    if (n >= 1000000) return `£${(n / 1000000).toFixed(2)}m`
    if (n >= 1000) return `£${(n / 1000).toFixed(0)}k`
    return `£${n.toLocaleString()}`
  }

  return (
    <div>
      {/* Back */}
      <button className="btn btn-sm" style={{ marginBottom: 14 }} onClick={() => navigate('/clients')}>← Back to Clients</button>

      {/* Header card */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ width: 50, height: 50, borderRadius: 12, background: col.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: col.color, flexShrink: 0 }}>
            {initials(client.name)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{client.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
              {client.website && <><a href={client.website} target="_blank" rel="noreferrer" style={{ color: 'var(--green)' }}>{client.website.replace(/https?:\/\/(www\.)?/, '')}</a> · </>}
              {client.phone && <>{client.phone} · </>}
              {client.email && <>{client.email}</>}
            </div>
            {client.address && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{client.address}</div>}
          </div>
          {isPMOrAdmin && (
            <button className="btn btn-sm" onClick={() => setShowEditClient(true)}>Edit</button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Total value', value: fmt(totalValue) },
          { label: 'Projects', value: projects.length },
          { label: 'Active', value: activeProjects.length, green: activeProjects.length > 0 },
        ].map(s => (
          <div key={s.label} className="card card-pad" style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.green ? 'var(--green)' : 'var(--text)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="filter-tabs" style={{ marginBottom: 16 }}>
        {[
          { key: 'projects', label: 'Projects', count: projects.length },
          { key: 'contacts', label: 'Contacts', count: contacts.length + eaContacts.length },
        ].map(t => (
          <div key={t.key} className={`filter-tab ${activeTab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}>
            {t.label}<span className="tab-badge">{t.count}</span>
          </div>
        ))}
      </div>

      {/* Projects tab */}
      {activeTab === 'projects' && (
        <div>
          {projects.length === 0 ? (
            <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No projects linked to this client yet.</div>
          ) : (
            <>
              {activeProjects.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Active</div>
                  <ProjectList projects={activeProjects} fmt={fmt} navigate={navigate} />
                </div>
              )}
              {doneProjects.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Completed / Other</div>
                  <ProjectList projects={doneProjects} fmt={fmt} navigate={navigate} faded />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Contacts tab */}
      {activeTab === 'contacts' && (
        <div>
          {/* EA section */}
          {/* Client contacts */}
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Client Contacts</div>
          {contacts.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 8 }}>No client contacts yet.</div>
          ) : (
            contacts.map(c => (
              <ContactCard key={c.id} contact={c}
                badge={c.is_pm ? 'Client PM' : null} badgeColor="#AFA9EC" badgeBg="#534AB725"
                canDelete={isPMOrAdmin} onDelete={() => setConfirmDeleteContact(c)} />
            ))
          )}
          {isPMOrAdmin && (
            <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => setShowAddContact(true)}>+ Add Client Contact</button>
          )}
        </div>
      )}

      {/* Modals */}
      {showEditClient && (
        <EditClientModal client={client} onClose={() => setShowEditClient(false)} onSaved={() => { setShowEditClient(false); load() }} />
      )}
      {showAddContact && (
        <AddContactModal clientId={id} table="client_contacts" onClose={() => setShowAddContact(false)} onSaved={() => { setShowAddContact(false); load() }} />
      )}
      <ConfirmDialog open={!!confirmDeleteContact} onClose={() => setConfirmDeleteContact(null)}
        onConfirm={async () => { await supabase.from('client_contacts').delete().eq('id', confirmDeleteContact.id); setConfirmDeleteContact(null); load() }}
        title="Delete contact" message={`Remove "${confirmDeleteContact?.name}" from this client?`} danger />
    </div>
  )
}

function ProjectList({ projects, fmt, navigate, faded }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {projects.map(p => {
        const sc = STATUS_COLORS[p.status] || STATUS_COLORS.active
        return (
          <div key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
            className="card"
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer', opacity: faded ? 0.6 : 1 }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: sc.color, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.project_name}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                {p.project_ref}{p.project_ref && p.start_date ? ' · ' : ''}{p.start_date ? formatDate(p.start_date) : ''}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{fmt(p.value)}</div>
              <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 8, fontWeight: 600, background: sc.bg, color: sc.color }}>
                {p.status.charAt(0).toUpperCase() + p.status.slice(1).replace('_', ' ')}
              </span>
            </div>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" style={{ flexShrink: 0 }}>
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>
        )
      })}
    </div>
  )
}

function ContactCard({ contact, badge, badgeColor, badgeBg, accentColor, accentBg, canDelete, onDelete }) {
  const col = accentColor || '#378ADD'
  const bg = accentBg || '#378ADD25'
  return (
    <div style={{ background: 'var(--surface2)', border: `0.5px solid ${accentColor ? accentColor + '30' : 'var(--border)'}`, borderRadius: 'var(--radius)', padding: '10px 12px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 34, height: 34, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: col, flexShrink: 0 }}>
        {initials(contact.name)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{contact.name}</span>
          {badge && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: badgeBg, color: badgeColor, fontWeight: 600 }}>{badge}</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
          {contact.job_title}{contact.job_title && (contact.email || contact.phone) ? ' · ' : ''}
          {contact.email}{contact.email && contact.phone ? ' · ' : ''}
          {contact.phone}
        </div>
      </div>
      {canDelete && (
        <button onClick={onDelete} style={{ fontSize: 10, padding: '3px 8px', border: '0.5px solid var(--red-border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--red)', flexShrink: 0 }}>✕</button>
      )}
    </div>
  )
}

function EditClientModal({ client, onClose, onSaved }) {
  const [form, setForm] = useState({ name: client.name || '', website: client.website || '', phone: client.phone || '', email: client.email || '', address: client.address || '', notes: client.notes || '' })
  const [saving, setSaving] = useState(false)
  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }
  async function save() {
    setSaving(true)
    await supabase.from('clients').update(form).eq('id', client.id)
    setSaving(false)
    onSaved()
  }
  return (
    <ModalWrap title="Edit Client" onClose={onClose} onSave={save} saving={saving}>
      {[
        { k: 'name', label: 'Company Name *' },
        { k: 'website', label: 'Website' },
        { k: 'phone', label: 'Phone' },
        { k: 'email', label: 'Email' },
        { k: 'address', label: 'Address' },
      ].map(f => (
        <ModalField key={f.k} label={f.label}>
          <input value={form[f.k]} onChange={e => set(f.k, e.target.value)} />
        </ModalField>
      ))}
      <ModalField label="Notes">
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)} style={{ minHeight: 60, resize: 'vertical', width: '100%' }} />
      </ModalField>
    </ModalWrap>
  )
}

function AddContactModal({ clientId, eaId, table, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', job_title: '', email: '', phone: '', is_pm: false })
  const [saving, setSaving] = useState(false)
  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }
  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    const payload = { ...form, client_id: clientId }
    if (eaId) payload.ea_id = eaId
    await supabase.from(table).insert(payload)
    setSaving(false)
    onSaved()
  }
  const isPM = table === 'ea_contacts' ? 'EA Project Manager' : 'Client PM'
  return (
    <ModalWrap title={eaId ? 'Add EA Contact' : 'Add Client Contact'} onClose={onClose} onSave={save} saving={saving}>
      {[
        { k: 'name', label: 'Full Name *' },
        { k: 'job_title', label: 'Job Title' },
        { k: 'email', label: 'Email' },
        { k: 'phone', label: 'Phone' },
      ].map(f => (
        <ModalField key={f.k} label={f.label}>
          <input value={form[f.k]} onChange={e => set(f.k, e.target.value)} />
        </ModalField>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <input type="checkbox" id="is_pm" checked={form.is_pm} onChange={e => set('is_pm', e.target.checked)} />
        <label htmlFor="is_pm" style={{ fontSize: 13 }}>Mark as {isPM} (valuation contact)</label>
      </div>
    </ModalWrap>
  )
}

function AddEAModal({ clientId, onClose, onSaved }) {
  const [search, setSearch] = useState('')
  const [existing, setExisting] = useState([])
  const [mode, setMode] = useState('search')
  const [newName, setNewName] = useState('')
  const [newWebsite, setNewWebsite] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('employer_agents').select('*').order('name')
      .then(({ data }) => setExisting(data || []))
  }, [])

  async function linkExisting(eaId) {
    setSaving(true)
    await supabase.from('client_employer_agents').insert({ client_id: clientId, employer_agent_id: eaId })
    setSaving(false)
    onSaved()
  }

  async function createAndLink() {
    if (!newName.trim()) return
    setSaving(true)
    const { data } = await supabase.from('employer_agents').insert({ name: newName.trim(), website: newWebsite.trim() }).select().single()
    if (data) await supabase.from('client_employer_agents').insert({ client_id: clientId, employer_agent_id: data.id })
    setSaving(false)
    onSaved()
  }

  const filtered = existing.filter(e => !search || e.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 460, padding: 24 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 16 }}>Add Employer's Agent</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className={`btn btn-sm ${mode === 'search' ? 'btn-primary' : ''}`} onClick={() => setMode('search')}>Existing EA</button>
          <button className={`btn btn-sm ${mode === 'new' ? 'btn-primary' : ''}`} onClick={() => setMode('new')}>New EA</button>
        </div>
        {mode === 'search' ? (
          <div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employer's agents..."
              style={{ width: '100%', padding: '8px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 13, marginBottom: 10 }} />
            <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {filtered.map(e => (
                <div key={e.id} onClick={() => !saving && linkExisting(e.id)}
                  style={{ padding: '10px 12px', background: 'var(--surface2)', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}
                  onMouseEnter={ev => ev.currentTarget.style.background = 'var(--green-bg)'}
                  onMouseLeave={ev => ev.currentTarget.style.background = 'var(--surface2)'}>
                  {e.name}
                  {e.website && <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>{e.website.replace(/https?:\/\/(www\.)?/, '')}</span>}
                </div>
              ))}
              {filtered.length === 0 && <div style={{ fontSize: 13, color: 'var(--text3)', padding: 8 }}>No matching EAs — create a new one.</div>}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ModalField label="EA Company Name *">
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Arcadis LLP" />
            </ModalField>
            <ModalField label="Website">
              <input value={newWebsite} onChange={e => setNewWebsite(e.target.value)} placeholder="https://arcadis.com" />
            </ModalField>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          {mode === 'new' && (
            <button className="btn btn-primary" onClick={createAndLink} disabled={saving || !newName.trim()}>
              {saving ? 'Saving...' : 'Create & Link'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ModalWrap({ title, onClose, onSave, saving, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 460, padding: 24 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 18 }}>{title}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

function ModalField({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}
