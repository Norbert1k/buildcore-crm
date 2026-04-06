import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ROLE_PERMISSIONS, ROLES } from '../lib/utils'
import { Avatar, IconDashboard, IconUsers, IconDoc, IconProject, IconSettings, IconBuilding } from './ui'

export default function Sidebar({ expCount, open, onClose }) {
  const { profile } = useAuth()
  const role = profile?.role || 'viewer'
  const perms = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.viewer

  function handleNav() {
    if (window.innerWidth < 768) onClose()
  }

  const allNavItems = [
    { to: '/',               key: 'dashboard',       label: 'Dashboard',       icon: <IconDashboard /> },
    { to: '/subcontractors', key: 'subcontractors',  label: 'Subcontractors',  icon: <IconUsers />, badge: expCount > 0 ? expCount : null },
    { to: '/documents',      key: 'documents',       label: 'Documents',       icon: <IconDoc /> },
    { to: '/projects',       key: 'projects',        label: 'Projects',        icon: <IconProject /> },
    { to: '/suppliers',      key: 'suppliers',       label: 'Suppliers',       icon: <IconBuilding /> },
    { to: '/company-documents', key: 'company',         label: 'Company Docs',    icon: <IconDoc /> },
    { to: '/google-drive',      key: 'gdrive',          label: 'Google Drive',    icon: <IconProject /> },
  ]

  const visibleItems = allNavItems.filter(item => perms.nav.includes(item.key))

  return (
    <>
      <div className={`sidebar-overlay ${open ? 'open' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/logo.png" alt="City Construction" style={{ height: 36, width: 'auto', objectFit: 'contain' }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.2 }}>City Construction</div>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>CRM System</div>
            </div>
          </div>
        </div>

        <nav style={{ flex: 1, padding: '8px 0' }}>
          <div className="nav-section">Navigation</div>
          {visibleItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              onClick={handleNav}
            >
              {item.icon}
              {item.label}
              {item.badge && <span className="nav-badge">{item.badge}</span>}
            </NavLink>
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
