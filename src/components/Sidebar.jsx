import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Avatar, IconDashboard, IconUsers, IconDoc, IconProject, IconSettings, IconBuilding } from './ui'

export default function Sidebar({ expCount, open, onClose }) {
  const { profile } = useAuth()
  const location = useLocation()

  // Close sidebar on nav on mobile
  function handleNav() {
    if (window.innerWidth < 768) onClose()
  }

  const navItems = [
    { to: '/', label: 'Dashboard', icon: <IconDashboard /> },
    { to: '/subcontractors', label: 'Subcontractors', icon: <IconUsers /> },
    { to: '/documents', label: 'Documents', icon: <IconDoc />, badge: expCount > 0 ? expCount : null },
    { to: '/projects', label: 'Projects', icon: <IconProject /> },
    { to: '/suppliers', label: 'Suppliers', icon: <IconBuilding /> },
  ]

  return (
    <>
      {/* Mobile overlay */}
      <div className={`sidebar-overlay ${open ? 'open' : ''}`} onClick={onClose} />

      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-logo" style={{ background: '#448a40', margin: '-1px -1px 0', borderRadius: '0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/logo.png" alt="City Construction" style={{ height: 36, width: 'auto', objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.2, color: '#fff' }}>City Construction</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.7)' }}>CRM System</div>
            </div>
          </div>
        </div>

        <nav style={{ flex: 1, padding: '8px 0' }}>
          <div className="nav-section">Navigation</div>
          {navItems.map(item => (
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
              <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'capitalize' }}>{profile.role?.replace('_', ' ')}</div>
            </div>
          </div>
        )}
      </aside>
    </>
  )
}
