import { NavLink, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from '../lib/auth'
import { ROLE_PERMISSIONS, ROLES } from '../lib/utils'
import { Avatar, IconDashboard, IconUsers, IconDoc, IconProject, IconSettings, IconBuilding } from './ui'

function IconClients() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="18" rx="2"/>
      <path d="M8 3v3"/>
      <path d="M16 3v3"/>
      <circle cx="12" cy="13" r="3"/>
      <path d="M6 21v-1a6 6 0 0 1 12 0v1"/>
    </svg>
  )
}

// The logo swap needs to recognise ALL dark themes, not just 'dark'.
// As new themes get added this set must be kept in sync with index.css.
const DARK_THEMES = new Set(['dark', 'forest', 'slate'])
function isDarkTheme() {
  const t = document.documentElement.getAttribute('data-theme') || 'light'
  return DARK_THEMES.has(t)
}

export default function Sidebar({ expCounts = {}, reminderCount = 0, open, onClose }) {
  const { profile, division, divisions, setDivision } = useAuth()
  const [isDark, setIsDark] = useState(isDarkTheme())
  const location = useLocation()
  const [expandedKeys, setExpandedKeys] = useState(() => {
    try {
      const saved = localStorage.getItem('sidebar:expanded')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch { return new Set() }
  })

  useEffect(() => {
    if (location.pathname.startsWith('/subcontractors')) {
      setExpandedKeys(prev => { const n = new Set(prev); n.add('subcontractors'); return n })
    }
    if (location.pathname.startsWith('/projects')) {
      setExpandedKeys(prev => { const n = new Set(prev); n.add('projects'); return n })
    }
  }, [location.pathname])

  function toggleExpanded(key) {
    setExpandedKeys(prev => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key); else n.add(key)
      try { localStorage.setItem('sidebar:expanded', JSON.stringify([...n])) } catch {}
      return n
    })
  }

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(isDarkTheme())
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  const role = profile?.role || 'viewer'
  const perms = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.viewer

  function handleNav() {
    if (window.innerWidth < 768) onClose()
  }

  const allNavItems = [
    { to: '/',               key: 'dashboard',      label: 'Dashboard',      icon: <IconDashboard /> },
    { to: '/subcontractors', key: 'subcontractors', label: 'Subcontractors', icon: <IconUsers />,
      children: [
        { to: '/subcontractors/ea', key: 'subcontractors', label: 'Employers Agent', before: true, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M8 3v3"/><path d="M16 3v3"/><circle cx="12" cy="13" r="3"/><path d="M6 21v-1a6 6 0 0 1 12 0v1"/></svg> },
        { to: '/subcontractors/design-team', key: 'subcontractors', label: 'Design Team', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg> },
        { to: '/subcontractors/compliance', key: 'documents', label: 'Compliance', icon: <IconDoc />,
          expired: expCounts.expired || 0, expiring: expCounts.expiring || 0 },
      ]
    },
    { to: '/projects',          key: 'projects', label: 'Projects',     icon: <IconProject />,
      children: [
        { to: '/projects/tracker', key: 'tracker', label: 'Project Tracker', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> },
      ]
    },
    { to: '/tasks', key: 'tasks', label: 'Task Tracker',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
      reminderDot: reminderCount > 0,
    },
    { to: '/quotes',            key: 'quotes', label: 'Quotes',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>
    },
    { to: '/clients',           key: 'clients',  label: 'Clients',      icon: <IconClients /> },
    { to: '/suppliers',         key: 'suppliers', label: 'Suppliers',    icon: <IconBuilding /> },
    { to: '/company-documents', key: 'company',  label: 'Company Docs', icon: <IconDoc /> },
    { to: '/web-search',        key: 'websearch', label: 'Price Jobs',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="12" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="12" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="10" y2="18"/></svg>
    },
  ]

  const visibleItems = allNavItems.filter(item => perms.nav.includes(item.key))

  return (
    <>
      <div className={`sidebar-overlay ${open ? 'open' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={isDark ? "/logo-dark.png" : "/logo.png"} alt="City Construction" style={{ height: 36, width: 'auto', objectFit: 'contain' }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.2 }}>City Construction</div>
              <div style={{ fontSize: 10, color: division === 'fitout' ? '#0E7490' : 'var(--text3)', fontWeight: division === 'fitout' ? 600 : 400 }}>
                {division === 'fitout' ? 'Fit-Out Division' : 'Construction Division'}
              </div>
            </div>
          </div>
        </div>

        {/* Division badge / switcher. Single-division users see a static
            badge; dual-division users (admins) can switch without re-login. */}
        <div style={{ padding: '8px 14px 0' }}>
          {divisions.length > 1 ? (
            <div style={{ display: 'flex', gap: 6 }}>
              {divisions.map(d => (
                <button key={d} onClick={() => setDivision(d)}
                  style={{ flex: 1, padding: '5px 6px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
                    border: division === d ? `1.5px solid ${d === 'fitout' ? '#0E7490' : '#448a40'}` : '1px solid var(--border)',
                    background: division === d ? (d === 'fitout' ? 'rgba(14,116,144,0.10)' : 'rgba(68,138,64,0.10)') : 'transparent',
                    color: division === d ? (d === 'fitout' ? '#0E7490' : '#448a40') : 'var(--text3)' }}>
                  {d === 'fitout' ? 'Fit-Out' : 'Construction'}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase',
              color: division === 'fitout' ? '#0E7490' : '#448a40' }}>
              {division === 'fitout' ? 'Fit-Out Division' : 'Construction Division'}
            </div>
          )}
        </div>

        <nav style={{ flex: 1, padding: '8px 0' }}>
          <div className="nav-section">Navigation</div>
          {visibleItems.map(item => (
            <div key={item.to}>
              {item.children ? (
                <div
                  className={`nav-item${location.pathname.startsWith(item.to) ? ' active' : ''}`}
                  onClick={() => toggleExpanded(item.key)}
                  style={{ userSelect: 'none' }}
                >
                  {item.icon}
                  {item.label}
                  {item.badge && <span className="nav-badge">{item.badge}</span>}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: 'auto', flexShrink: 0, transition: 'transform .2s', transform: expandedKeys.has(item.key) ? 'rotate(180deg)' : 'none' }}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </div>
              ) : (
                <NavLink to={item.to} end={item.to === '/'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} onClick={handleNav}>
                  {item.icon}
                  {item.label}
                  {item.reminderDot && (
                    <span title="You have task reminders" style={{ marginLeft: 'auto', width: 8, height: 8, borderRadius: '50%', background: 'var(--blue, #5b9bd5)', display: 'inline-block', flexShrink: 0 }} />
                  )}
                  {item.badge && <span className="nav-badge">{item.badge}</span>}
                </NavLink>
              )}
              {item.children && expandedKeys.has(item.key) && (
                <>
                  {item.children.filter(child => child.before && perms.nav.includes(child.key)).map(child => (
                    <NavLink key={child.to} to={child.to} className={({ isActive }) => `nav-item nav-item-child${isActive ? ' active' : ''}`} onClick={handleNav}>
                      <span style={{ opacity: 0.4, fontSize: 10, marginLeft: 2, marginRight: 2 }}>{'\u203A'}</span>
                      {child.icon}
                      {child.label}
                      {child.expired > 0 && <span className="nav-badge" style={{ background: '#c00', color: 'white', marginLeft: 'auto' }}>{child.expired}</span>}
                      {child.expiring > 0 && <span className="nav-badge" style={{ background: '#b87a00', color: 'white', marginLeft: child.expired > 0 ? 4 : 'auto' }}>{child.expiring}</span>}
                    </NavLink>
                  ))}
                  <NavLink to={item.to} end className={({ isActive }) => `nav-item nav-item-child${isActive ? ' active' : ''}`} onClick={handleNav}>
                    <span style={{ opacity: 0.4, fontSize: 10, marginLeft: 2, marginRight: 2 }}>{'\u203A'}</span>
                    {item.icon}
                    {item.label}
                  </NavLink>
                  {item.children.filter(child => !child.before && perms.nav.includes(child.key)).map(child => (
                    <NavLink key={child.to} to={child.to} className={({ isActive }) => `nav-item nav-item-child${isActive ? ' active' : ''}`} onClick={handleNav}>
                      <span style={{ opacity: 0.4, fontSize: 10, marginLeft: 2, marginRight: 2 }}>{'\u203A'}</span>
                      {child.icon}
                      {child.label}
                      {child.expired > 0 && <span className="nav-badge" style={{ background: '#c00', color: 'white', marginLeft: 'auto' }}>{child.expired}</span>}
                      {child.expiring > 0 && <span className="nav-badge" style={{ background: '#b87a00', color: 'white', marginLeft: child.expired > 0 ? 4 : 'auto' }}>{child.expiring}</span>}
                    </NavLink>
                  ))}
                </>
              )}
            </div>
          ))}

          <div className="nav-section" style={{ marginTop: 8 }}>Account</div>
          <NavLink to="/settings" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} onClick={handleNav}>
            <IconSettings />
            Settings
          </NavLink>
        </nav>

        {profile && (
          <div className="nav-user">
            <Avatar name={profile.full_name} size="sm" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.full_name}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>{ROLES[role]?.label || role}</div>
            </div>
          </div>
        )}
      </aside>
    </>
  )
}
