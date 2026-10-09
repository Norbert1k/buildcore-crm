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
    <div style={{ width: size, height: size, borderRadius: 'var(--radius)', background: showLogo ? '#fff' : color.bg, border: showLogo ? '0.5px solid var(--border)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.3, fontWeight: 700, color: color.color, flexShrink: 0, overflow: 'hidden' }}>
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
  const { can, profile, division } = useAuth()
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [toDelete, setToDelete] = useState(null)   // client row being deleted

  const isAdmin = profile?.role === 'admin'

  useEffect(() => { load() }, [division])

  async function load() {
    setLoading(true)
    const { data: clientData } = await supabase
      .from('clients')
      .select('*')
      .eq('division', division)
      .order('name')

    const { data: projectData } = await supabase
      .from('projects')
      .select('id, client_id, status, value')
      .eq('division', division)
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
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 'var(--radius)', fontWeight: 600, background: 'var(--green-bg)', color: 'var(--green)' }}>
                      {c.activeCount} active
                    </span>
                  )}
                  {c.projects.length - c.activeCount > 0 && (
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 'var(--radius)', fontWeight: 600, background: 'var(--surface2)', color: 'var(--text3)' }}>
                      {c.projects.length - c.activeCount} complete
                    </span>
                  )}
                  {c.projects.length === 0 && (
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 'var(--radius)', fontWeight: 600, background: 'var(--surface2)', color: 'var(--text3)' }}>
                      no projects
                    </span>
                  )}
                </div>
                {isAdmin && (
                  <button title={c.projects.length ? 'Has projects — cannot be deleted' : 'Delete client'}
                    onClick={e => { e.stopPropagation(); setToDelete(c) }}
                    style={{ flexShrink: 0, padding: '4px 8px', fontSize: 11, border: '0.5px solid var(--red-border)', borderRadius: 'var(--radius)', background: 'transparent', color: 'var(--red)', cursor: 'pointer', opacity: c.projects.length ? 0.35 : 1 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                  </button>
                )}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" style={{ flexShrink: 0 }}>
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
            )
          })}
        </div>
      )}

      {showAdd && <AddClientModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load() }} />}
      {toDelete && <DeleteClientModal client={toDelete} onClose={() => setToDelete(null)} onDeleted={() => { setToDelete(null); load() }} />}
    </div>
  )
}

// Delete a client that's no longer used. Safety rules:
//  • refused while ANY project (either division) still points at the client
//  • removes the client's contacts and portal logins first, then the client
//  • the name must be typed to confirm — this can't be undone
function DeleteClientModal({ client, onClose, onDeleted }) {
  const [info, setInfo] = useState(null)      // { projects: [...], contacts: n, portal: n }
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      const [{ data: projs }, { count: contacts }, { count: portal }] = await Promise.all([
        supabase.from('projects').select('id, project_name, project_ref').eq('client_id', client.id),
        supabase.from('client_contacts').select('id', { count: 'exact', head: true }).eq('client_id', client.id),
        supabase.from('client_users').select('id', { count: 'exact', head: true }).eq('client_id', client.id),
      ])
      setInfo({ projects: projs || [], contacts: contacts || 0, portal: portal || 0 })
    })()
  }, [client.id])

  async function doDelete() {
    setBusy(true); setError('')
    // Re-check at the moment of deletion.
    const { count: still } = await supabase.from('projects').select('id', { count: 'exact', head: true }).eq('client_id', client.id)
    if (still) { setError('This client still has projects linked — reassign or delete them first.'); setBusy(false); return }
    const steps = [
      ['contacts', supabase.from('client_contacts').delete().eq('client_id', client.id)],
      ['portal logins', supabase.from('client_users').delete().eq('client_id', client.id)],
    ]
    for (const [label, q] of steps) {
      const { error: e } = await q
      if (e) { setError(`Couldn't remove the client's ${label}: ${e.message}`); setBusy(false); return }
    }
    const { error: e } = await supabase.from('clients').delete().eq('id', client.id)
    if (e) { setError(`Couldn't delete the client: ${e.message}`); setBusy(false); return }
    onDeleted()
  }

  const blocked = info && info.projects.length > 0
  const ok = typed.trim().toLowerCase() === String(client.name || '').trim().toLowerCase()

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => !busy && onClose()}>
      <div className="card" style={{ width: '100%', maxWidth: 440, padding: 20 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Delete client</div>
        {!info ? (
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>Checking…</div>
        ) : blocked ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 8px' }}><b>{client.name}</b> can't be deleted — it still has {info.projects.length} project{info.projects.length === 1 ? '' : 's'}:</p>
            <ul style={{ fontSize: 12, color: 'var(--text2)', margin: '0 0 12px 18px' }}>
              {info.projects.slice(0, 8).map(p => <li key={p.id}>{p.project_ref ? `${p.project_ref} · ` : ''}{p.project_name}</li>)}
              {info.projects.length > 8 && <li>…and {info.projects.length - 8} more</li>}
            </ul>
            <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>Reassign those projects to another client (or delete them) first.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}><button className="btn" onClick={onClose}>Close</button></div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 10px' }}>
              This permanently removes <b>{client.name}</b>{info.contacts || info.portal ? <>, along with {[info.contacts && `${info.contacts} contact${info.contacts === 1 ? '' : 's'}`, info.portal && `${info.portal} client-portal login${info.portal === 1 ? '' : 's'}`].filter(Boolean).join(' and ')}</> : ''}. It can't be undone.
            </p>
            <label style={{ fontSize: 12, color: 'var(--text3)' }}>Type the client name to confirm</label>
            <input value={typed} onChange={e => setTyped(e.target.value)} placeholder={client.name} autoFocus
              style={{ width: '100%', marginTop: 4, padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 13 }} />
            {error && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 8 }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn btn-danger" onClick={doDelete} disabled={!ok || busy}>{busy ? 'Deleting…' : 'Delete client'}</button>
            </div>
          </>
        )}
      </div>
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
    const { error: err } = await supabase.from('clients').insert({ ...form, name: cleanName, slug: slugify(cleanName), division })
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
