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
const DARK_THEMES = new Set(['dark', 'forest', 'slate', 'blueprint'])
function isDarkTheme() {
  const t = document.documentElement.getAttribute('data-theme') || 'light'
  return DARK_THEMES.has(t)
}

export default function Sidebar({ expCounts = {}, reminderCount = 0, open, onClose }) {
  const { profile, division, divisions, setDivision } = useAuth()
  const [isDark, setIsDark] = useState(isDarkTheme())
  const location = useLocation()
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

  // ── Grouped navigation (try-out) ─────────────────────────────────────────
  // Every page is one tap away (no tap-to-open groups), grouped by how people
  // work. Icons are unchanged. Routes are unchanged, so bookmarks and
  // notification links keep working. Compliance badges sit on the item itself
  // so expired-document warnings are always visible.
  const iconEA = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M8 3v3"/><path d="M16 3v3"/><circle cx="12" cy="13" r="3"/><path d="M6 21v-1a6 6 0 0 1 12 0v1"/></svg>
  const iconDesign = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
  const iconTracker = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
  const iconCalendar = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
  const iconTasks = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
  const iconQuotes = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>

  const navGroups = [
    { label: null, items: [
      { to: '/', key: 'dashboard', label: 'Home', icon: <IconDashboard />, end: true },
    ]},
    { label: 'Work', items: [
      { to: '/projects',          key: 'projects', label: 'Projects',        icon: <IconProject />, activeWhen: p => p.startsWith('/projects') && !/^\/projects\/(tracker|calendar)/.test(p) },
      { to: '/projects/tracker',  key: 'tracker',  label: 'Project Tracker', icon: iconTracker },
      { to: '/projects/calendar', key: 'calendar', label: 'Calendar',        icon: iconCalendar },
      { to: '/quotes',            key: 'quotes',   label: 'Quotes',          icon: iconQuotes, reminderDot: reminderCount > 0 },
    ]},
    { label: 'People', items: [
      { to: '/clients',                    key: 'clients',        label: 'Clients',          icon: <IconClients /> },
      { to: '/subcontractors/ea',          key: 'ea',             label: 'Employers Agents', icon: iconEA },
      { to: '/subcontractors',             key: 'subcontractors', label: 'Subcontractors',   icon: <IconUsers />, activeWhen: p => p.startsWith('/subcontractors') && !/^\/subcontractors\/(ea|design-team|compliance)/.test(p) },
      { to: '/subcontractors/design-team', key: 'design_team',    label: 'Design Team',      icon: iconDesign },
      { to: '/suppliers',                  key: 'suppliers',      label: 'Suppliers',        icon: <IconBuilding /> },
    ]},
    { label: 'Compliance & files', items: [
      { to: '/subcontractors/compliance', key: 'documents', label: 'Compliance',   icon: <IconDoc />, expired: expCounts.expired || 0, expiring: expCounts.expiring || 0 },
      { to: '/company-documents',         key: 'company',   label: 'Company Docs', icon: <IconDoc /> },
    ]},
  ]

  // Fit-Out division trims the navigation: no Quotes, no Task Tracker.
  const FITOUT_HIDDEN_NAV = new Set(['quotes', 'tasks'])
  const divisionAllows = (key) => division !== 'fitout' || !FITOUT_HIDDEN_NAV.has(key)
  // Groups open and close like drop-downs. The group holding the current page
  // always stays open; the rest remember their state per browser.
  const [collapsed, setCollapsed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('nav:collapsed') || '[]')) } catch { return new Set() }
  })
  function toggleGroup(label) {
    setCollapsed(prev => {
      const n = new Set(prev); n.has(label) ? n.delete(label) : n.add(label)
      try { localStorage.setItem('nav:collapsed', JSON.stringify([...n])) } catch {}
      return n
    })
  }
  const isItemActive = (item) => item.activeWhen ? item.activeWhen(location.pathname)
    : item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)

  const visibleGroups = navGroups
    .map(g => ({ ...g, items: g.items.filter(it => perms.nav.includes(it.key) && divisionAllows(it.key)) }))
    .filter(g => g.items.length > 0)

  return (
    <>
      <div className={`sidebar-overlay ${open ? 'open' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={isDark ? "/logo-dark.png" : "/logo.png"} alt="City Construction" style={{ height: 36, width: 'auto', objectFit: 'contain' }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.2 }}>City Construction</div>
              <div style={{ fontSize: 11, color: division === 'fitout' ? '#0E7490' : 'var(--text3)', fontWeight: division === 'fitout' ? 600 : 400 }}>
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
                  style={{ flex: 1, padding: '5px 6px', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                    border: division === d ? `1.5px solid ${d === 'fitout' ? '#0E7490' : '#448a40'}` : '1px solid var(--border)',
                    background: division === d ? (d === 'fitout' ? 'rgba(14,116,144,0.10)' : 'rgba(68,138,64,0.10)') : 'transparent',
                    color: division === d ? (d === 'fitout' ? '#0E7490' : '#448a40') : 'var(--text3)' }}>
                  {d === 'fitout' ? 'Fit-Out' : 'Construction'}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase',
              color: division === 'fitout' ? '#0E7490' : '#448a40' }}>
              {division === 'fitout' ? 'Fit-Out Division' : 'Construction Division'}
            </div>
          )}
        </div>

        <nav style={{ flex: 1, padding: '8px 0' }}>
          {visibleGroups.map((g, gi) => {
            const holdsActive = g.items.some(isItemActive)
            const isOpen = !g.label || holdsActive || !collapsed.has(g.label)
            const expired = g.items.reduce((n, it) => n + (it.expired || 0), 0)
            const expiring = g.items.reduce((n, it) => n + (it.expiring || 0), 0)
            return (
            <div key={g.label || gi} className={`nav-group${isOpen ? ' open' : ''}`}>
              {g.label && (
                <button type="button" className="nav-section nav-group-toggle" aria-expanded={isOpen}
                  onClick={() => !holdsActive && toggleGroup(g.label)} title={holdsActive ? 'Contains the page you are on' : undefined}>
                  <span>{g.label}</span>
                  {!isOpen && expired > 0 && <span className="nav-badge nav-badge-red">{expired}</span>}
                  {!isOpen && expiring > 0 && <span className="nav-badge nav-badge-amber" style={{ marginLeft: expired > 0 ? 4 : 'auto' }}>{expiring}</span>}
                  <svg className="nav-group-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
              )}
              {isOpen && g.items.map(item => (
                <NavLink key={item.to} to={item.to} end={!!item.end} className={({ isActive }) => `nav-item${(item.activeWhen ? item.activeWhen(location.pathname) : isActive) ? ' active' : ''}`} onClick={handleNav}>
                  {item.icon}
                  <span className="nav-label">{item.label}</span>
                  {item.reminderDot && (
                    <span title="You have task reminders" style={{ marginLeft: 'auto', width: 8, height: 8, borderRadius: '50%', background: 'var(--blue, #5b9bd5)', display: 'inline-block', flexShrink: 0 }} />
                  )}
                  {item.expired > 0 && <span className="nav-badge nav-badge-red" title="Expired documents">{item.expired}</span>}
                  {item.expiring > 0 && <span className="nav-badge nav-badge-amber" title="Expiring within 30 days" style={{ marginLeft: item.expired > 0 ? 4 : 'auto' }}>{item.expiring}</span>}
                </NavLink>
              ))}
            </div>
            )
          })}

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
              <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.full_name}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{ROLES[role]?.label || role}</div>
            </div>
          </div>
        )}
      </aside>
    </>
  )
}
