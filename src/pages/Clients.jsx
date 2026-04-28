import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { sortBy } from '../lib/utils'
import { useAuth } from '../lib/auth'
import { Avatar } from '../components/ui'

function initials(name) {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 3)
}

// Convert a client name to a URL-safe slug. Examples: 'PMP Ltd' → 'pmp-ltd', 'D.F.L Developers' → 'd-f-l-developers'.
// If the input is empty, returns 'client' as a fallback so the NOT NULL DB constraint is satisfied.
function slugify(name) {
  const s = String(name || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return s || 'client'
}

function getDomain(website) {
  if (!website) return null
  try {
    const url = website.startsWith('http') ? website : 'https://' + website
    return new URL(url).hostname.replace(/^www\./, '')
  } catch { return null }
}

function ClientAvatar({ name, website, color, size = 40 }) {
  const [failed, setFailed] = React.useState(false)
  const [timedOut, setTimedOut] = React.useState(false)
  const domain = getDomain(website)
  const logoUrl = domain ? `https://logo.clearbit.com/${domain}` : null

  React.useEffect(() => {
    if (!logoUrl) return
    const t = setTimeout(() => setTimedOut(true), 2500)
    return () => clearTimeout(t)
  }, [logoUrl])

  const showLogo = logoUrl && !failed && !timedOut
  return (
    <div style={{ width: size, height: size, borderRadius: 10, background: showLogo ? '#fff' : color.bg, border: showLogo ? '0.5px solid var(--border)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.3, fontWeight: 700, color: color.color, flexShrink: 0, overflow: 'hidden' }}>
      {showLogo
        ? <img src={logoUrl} alt={name} onError={() => setFailed(true)}
            style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 6 }} />
        : initials(name)
      }
    </div>
  )
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

export default function Clients() {
  const { can, profile } = useAuth()
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  const isAdmin = profile?.role === 'admin'

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data: clientData } = await supabase
      .from('clients')
      .select('*')
      .order('name')

    const { data: projectData } = await supabase
      .from('projects')
      .select('id, client_id, status, value')
      .not('client_id', 'is', null)

    const enriched = (clientData || []).map(c => {
      const projs = (projectData || []).filter(p => p.client_id === c.id)
      const totalValue = projs.reduce((s, p) => s + (p.value || 0), 0)
      const activeCount = projs.filter(p => ['active', 'tender'].includes(p.status)).length
      return { ...c, projects: projs, totalValue, activeCount }
    })
    setClients(sortBy(enriched, 'name'))
    setLoading(false)
  }

  const filtered = clients.filter(c =>
    !search || c.name?.toLowerCase().includes(search.toLowerCase())
  )

  const totalValue = clients.reduce((s, c) => s + c.totalValue, 0)
  const activeClients = clients.filter(c => c.activeCount > 0).length

  function fmt(n) {
    if (!n) return '—'
    if (n >= 1000000) return `£${(n / 1000000).toFixed(1)}m`
    if (n >= 1000) return `£${(n / 1000).toFixed(0)}k`
    return `£${n.toLocaleString()}`
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Clients</h2>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 2 }}>
            {clients.length} client{clients.length !== 1 ? 's' : ''} · {activeClients} active
          </p>
        </div>
        {isAdmin && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Add Client</button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Total clients', value: clients.length },
          { label: 'Combined value', value: fmt(totalValue) },
          { label: 'Active now', value: activeClients, green: true },
        ].map(s => (
          <div key={s.label} className="card card-pad" style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.green ? 'var(--green)' : 'var(--text)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search clients..."
        style={{ width: '100%', marginBottom: 14, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 13 }} />

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text3)', fontSize: 13 }}>No clients found</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(c => {
            const col = clientColor(c.id)
            return (
              <div key={c.id} onClick={() => navigate(`/clients/${c.id}`)}
                className="card"
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}>
                <ClientAvatar name={c.name} website={c.website} color={col} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                    {c.projects.length} project{c.projects.length !== 1 ? 's' : ''}
                    {c.website ? ` · ${c.website.replace(/https?:\/\/(www\.)?/, '')}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>{fmt(c.totalValue)}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)' }}>total value</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end', flexShrink: 0 }}>
                  {c.activeCount > 0 && (
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 8, fontWeight: 600, background: 'var(--green-bg)', color: 'var(--green)' }}>
                      {c.activeCount} active
                    </span>
                  )}
                  {c.projects.length - c.activeCount > 0 && (
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 8, fontWeight: 600, background: 'var(--surface2)', color: 'var(--text3)' }}>
                      {c.projects.length - c.activeCount} complete
                    </span>
                  )}
                  {c.projects.length === 0 && (
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 8, fontWeight: 600, background: 'var(--surface2)', color: 'var(--text3)' }}>
                      no projects
                    </span>
                  )}
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" style={{ flexShrink: 0 }}>
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
            )
          })}
        </div>
      )}

      {showAdd && <AddClientModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load() }} />}
    </div>
  )
}

function AddClientModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', website: '', phone: '', email: '', address: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    if (!form.name.trim()) { setError('Client name is required'); return }
    setSaving(true)
    const cleanName = form.name.trim()
    const { error: err } = await supabase.from('clients').insert({ ...form, name: cleanName, slug: slugify(cleanName) })
    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 480, padding: 24 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 18 }}>Add New Client</div>
        {error && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { k: 'name', label: 'Company Name *', placeholder: 'e.g. DFL Developers' },
            { k: 'website', label: 'Website', placeholder: 'https://example.com' },
            { k: 'phone', label: 'Phone', placeholder: '020 0000 0000' },
            { k: 'email', label: 'Email', placeholder: 'info@example.com' },
            { k: 'address', label: 'Address', placeholder: '123 High Street, London' },
          ].map(f => (
            <div key={f.k}>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>{f.label}</div>
              <input value={form[f.k]} onChange={e => set(f.k, e.target.value)}
                placeholder={f.placeholder}
                style={{ width: '100%', padding: '8px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 13 }} />
            </div>
          ))}
          <div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>Notes</div>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
              placeholder="Any additional notes..."
              style={{ width: '100%', padding: '8px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 13, minHeight: 70, resize: 'vertical' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Add Client'}</button>
        </div>
      </div>
    </div>
  )
}
