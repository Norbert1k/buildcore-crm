import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Avatar, IconDashboard, IconUsers, IconDoc, IconProject, IconAlert, IconSettings } from './ui'

export default function Sidebar({ expCount }) {
  const { profile } = useAuth()
  const location = useLocation()

  const navItems = [
    { to: '/', label: 'Dashboard', icon: <IconDashboard /> },
    { to: '/subcontractors', label: 'Subcontractors', icon: <IconUsers /> },
    { to: '/documents', label: 'Documents', icon: <IconDoc />, badge: expCount > 0 ? expCount : null },
    { to: '/projects', label: 'Projects', icon: <IconProject /> },
  ]

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, background: 'var(--accent)', borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="#fff">
              <path d="M2 14V6l6-4 6 4v8H2zm4-1h4V9H6v4z" />
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.2 }}>BuildCore</div>
            <div style={{ fontSize: 10, color: 'var(--text3)' }}>CRM System</div>
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
          >
            {item.icon}
            {item.label}
            {item.badge && <span className="nav-badge">{item.badge}</span>}
          </NavLink>
        ))}

        <div className="nav-section" style={{ marginTop: 8 }}>Account</div>
        <NavLink to="/settings" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <IconSettings />
          Settings
        </NavLink>
      </nav>

      {profile && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar name={profile.full_name} size="sm" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.full_name}</div>
            <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'capitalize' }}>{profile.role?.replace('_', ' ')}</div>
          </div>
        </div>
      )}
    </aside>
  )
}
