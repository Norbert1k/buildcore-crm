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

export default function Sidebar({ expCount, open, onClose }) {
  const { profile } = useAuth()
  const [isDark, setIsDark] = useState(document.documentElement.getAttribute('data-theme') === 'dark')
  const location = useLocation()
  const [expandedKey, setExpandedKey] = useState(null)

  useEffect(() => {
    if (location.pathname.startsWith('/subcontractors')) setExpandedKey('subcontractors')
    if (location.pathname.startsWith('/projects')) setExpandedKey('projects')
  }, [location.pathname])

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.getAttribute('data-theme') === 'dark')
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
    { to: '/subcontractors', key: 'subcontractors', label: 'Subcontractors', icon: <IconUsers />, badge: expCount > 0 ? expCount : null,
      children: [
        { to: '/subcontractors/ea', key: 'subcontractors', label: 'Employers Agent', before: true, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M8 3v3"/><path d="M16 3v3"/><circle cx="12" cy="13" r="3"/><path d="M6 21v-1a6 6 0 0 1 12 0v1"/></svg> },
        { to: '/subcontractors/design-team', key: 'subcontractors', label: 'Design Team', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> },
        { to: '/subcontractors/compliance', key: 'documents', label: 'Compliance', icon: <IconDoc /> },
      ]
    },
    { to: '/projects',          key: 'projects', label: 'Projects',     icon: <IconProject />,
      children: [
        { to: '/projects/tracker', key: 'tracker', label: 'Project Tracker', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> },
      ]
    },
    { to: '/clients',           key: 'clients',  label: 'Clients',      icon: <IconClients /> },
    { to: '/suppliers',         key: 'suppliers', label: 'Suppliers',    icon: <IconBuilding /> },
    { to: '/company-documents', key: 'company',  label: 'Company Docs', icon: <IconDoc /> },
    { to: '/google-drive',      key: 'gdrive',   label: 'Google Drive', icon: <IconProject /> },
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
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>CRM System</div>
            </div>
          </div>
        </div>

        <nav style={{ flex: 1, padding: '8px 0' }}>
          <div className="nav-section">Navigation</div>
          {visibleItems.map(item => (
            <div key={item.to}>
              {item.children ? (
                <div
                  className={`nav-item${location.pathname.startsWith(item.to) ? ' active' : ''}`}
                  onClick={() => setExpandedKey(k => k === item.key ? null : item.key)}
                  style={{ userSelect: 'none' }}
                >
                  {item.icon}
                  {item.label}
                  {item.badge && <span className="nav-badge">{item.badge}</span>}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: 'auto', flexShrink: 0, transition: 'transform .2s', transform: expandedKey === item.key ? 'rotate(180deg)' : 'none' }}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </div>
              ) : (
                <NavLink to={item.to} end={item.to === '/'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} onClick={handleNav}>
                  {item.icon}
                  {item.label}
                  {item.badge && <span className="nav-badge">{item.badge}</span>}
                </NavLink>
              )}
              {item.children && expandedKey === item.key && (
                <>
                  {item.children.filter(child => child.before && perms.nav.includes(child.key)).map(child => (
                    <NavLink key={child.to} to={child.to} className={({ isActive }) => `nav-item nav-item-child${isActive ? ' active' : ''}`} onClick={handleNav}>
                      <span style={{ opacity: 0.4, fontSize: 10, marginLeft: 2, marginRight: 2 }}>{'\u203A'}</span>
                      {child.icon}
                      {child.label}
                    </NavLink>
                  ))}
                  <NavLink to={item.to} end className={({ isActive }) => `nav-item nav-item-child${isActive ? ' active' : ''}`} onClick={handleNav}>
                    <span style={{ opacity: 0.4, fontSize: 10, marginLeft: 2, marginRight: 2 }}>{'\u203A'}</span>
                    {item.icon}
                    All {item.label}
                  </NavLink>
                  {item.children.filter(child => !child.before && perms.nav.includes(child.key)).map(child => (
                    <NavLink key={child.to} to={child.to} className={({ isActive }) => `nav-item nav-item-child${isActive ? ' active' : ''}`} onClick={handleNav}>
                      <span style={{ opacity: 0.4, fontSize: 10, marginLeft: 2, marginRight: 2 }}>{'\u203A'}</span>
                      {child.icon}
                      {child.label}
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
