import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useAllowedSubIds } from '../lib/access'
import { ROLE_PERMISSIONS } from '../lib/utils'

export default function GlobalSearch() {
  const { division, profile, canAccessProject } = useAuth()
  // Search only what this person can open (same rules as the menu).
  const nav = (ROLE_PERMISSIONS[profile?.role] || ROLE_PERMISSIONS.viewer).nav
  const reqId = useRef(0)
  const allowedSubs = useAllowedSubIds()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)
  const wrapRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    // Press "/" anywhere (outside a text box) to jump to search.
    function handleKey(e) {
      const t = e.target
      if (e.key === '/' && !(t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) { e.preventDefault(); inputRef.current?.focus() }
      if (e.key === 'Escape' && t === inputRef.current) { setOpen(false); inputRef.current?.blur() }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('mousedown', handleClick); document.removeEventListener('keydown', handleKey) }
  }, [])

  useEffect(() => {
    if (!query.trim()) { setResults(null); return }
    const timer = setTimeout(() => doSearch(query), 250)
    return () => clearTimeout(timer)
  }, [query])

  async function doSearch(q) {
    setLoading(true)
    // Commas, brackets and quotes would break the .or() filter syntax
    const term = `%${q.replace(/[,()"'\\%*]/g, ' ').trim()}%`
    const id = ++reqId.current
    const none = Promise.resolve({ data: [] })
    const [subsRes, projRes, suppRes, clientRes] = await Promise.all([
      nav.includes('subcontractors') ? supabase.from('subcontractors').select('id, company_name, trade, status').or(`company_name.ilike.${term},trade.ilike.${term}`).limit(5) : none,
      nav.includes('projects') ? supabase.from('projects').select('id, project_name, project_ref, status, town').eq('division', division).or(`project_name.ilike.${term},project_ref.ilike.${term},town.ilike.${term}`).limit(8) : none,
      nav.includes('suppliers') ? supabase.from('suppliers').select('id, company_name, category').ilike('company_name', term).limit(4) : none,
      nav.includes('clients') ? supabase.from('clients').select('id, name').eq('division', division).ilike('name', term).limit(4) : none,
    ])
    if (id !== reqId.current) return   // a newer search has started; drop this one
    setResults({
      // null = no restriction; undefined = still loading (show none yet); Set = allowed ids
      subs: allowedSubs === null ? (subsRes.data || []) : (subsRes.data || []).filter(s => allowedSubs && allowedSubs.has(String(s.id))),
      projects: (projRes.data || []).filter(p => canAccessProject(p.id)).slice(0, 5),
      suppliers: suppRes.data || [],
      clients: clientRes.data || [],
    })
    setLoading(false)
    setOpen(true)
  }

  function go(path) {
    navigate(path)
    setQuery('')
    setOpen(false)
    setResults(null)
  }

  const hasResults = results && (results.subs.length + results.projects.length + results.suppliers.length + results.clients.length) > 0

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
      <div style={{ position: 'relative' }}>
        <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', pointerEvents: 'none' }} width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.742 10.344a6.5 6.5 0 10-1.397 1.398l3.85 3.85a1 1 0 001.415-1.414l-3.868-3.834zm-5.24 1.4a5 5 0 110-10 5 5 0 010 10z"/>
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results && setOpen(true)}
          placeholder="Search projects, clients, subcontractors…  ( / )"
          style={{ paddingLeft: 32, paddingRight: 10, fontSize: 13, height: 36 }}
        />
        {query && (
          <button onClick={() => { setQuery(''); setOpen(false); setResults(null) }} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text3)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
        )}
      </div>

      {open && query && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 500, overflow: 'hidden', maxHeight: 400, overflowY: 'auto' }}>
          {loading && <div style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text3)' }}>Searching...</div>}
          {!loading && !hasResults && <div style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text3)' }}>No results for "{query}"</div>}
          {!loading && hasResults && (
            <>
              {results.subs.length > 0 && (
                <Section title="Subcontractors">
                  {results.subs.map(s => (
                    <ResultRow key={s.id} icon="👷" title={s.company_name} sub={s.trade} status={s.status} onClick={() => go(`/subcontractors/${s.id}`)} />
                  ))}
                </Section>
              )}
              {results.projects.length > 0 && (
                <Section title="Projects">
                  {results.projects.map(p => (
                    <ResultRow key={p.id} icon="🏗️" title={p.project_name} sub={[p.project_ref, p.town].filter(Boolean).join(' · ')} status={p.status} onClick={() => go(`/projects/${p.id}`)} />
                  ))}
                </Section>
              )}
              {results.clients.length > 0 && (
                <Section title="Clients">
                  {results.clients.map(c => (
                    <ResultRow key={c.id} icon="🏢" title={c.name} onClick={() => go(`/clients/${c.id}`)} />
                  ))}
                </Section>
              )}
              {results.suppliers.length > 0 && (
                <Section title="Suppliers">
                  {results.suppliers.map(s => (
                    <ResultRow key={s.id} icon="🏪" title={s.company_name} sub={s.category} onClick={() => go('/suppliers')} />
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em', borderTop: '1px solid var(--border)' }}>{title}</div>
      {children}
    </div>
  )
}

function ResultRow({ icon, title, sub, status, onClick }) {
  const statusColors = { active: 'var(--green)', approved: 'var(--blue)', on_hold: 'var(--amber)', inactive: 'var(--text3)', tender: 'var(--purple)', completed: 'var(--blue)' }
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer', transition: 'background .1s' }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{sub}</div>}
      </div>
      {status && <div style={{ fontSize: 11, color: statusColors[status] || 'var(--text3)', textTransform: 'capitalize', flexShrink: 0 }}>{status.replace('_', ' ')}</div>}
    </div>
  )
}
