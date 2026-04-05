import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Avatar, IconDashboard, IconUsers, IconDoc, IconProject, IconSettings } from './ui'

export default function Sidebar({ expCount }) {
  const { profile } = useAuth()

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
          <img
            src="/logo.png"
            alt="City Construction"
            style={{ height: 36, width: 'auto', objectFit: 'contain' }}
          />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.2 }}>City Construction</div>
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
