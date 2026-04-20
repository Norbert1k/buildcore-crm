import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { supabase } from './lib/supabase'
import Sidebar from './components/Sidebar'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Subcontractors from './pages/Subcontractors'
import SubcontractorDetail from './pages/SubcontractorDetail'
import Documents from './pages/Documents'
import Projects from './pages/Projects'
import ProjectCalendar from './pages/ProjectCalendar'
import ProjectDetail from './pages/ProjectDetail'
import ProjectTracker from './pages/ProjectTracker'
import Suppliers from './pages/Suppliers'
import GlobalSearch from './components/GlobalSearch'
import Settings from './pages/Settings'
import CompanyDocuments from './pages/CompanyDocuments'
import GoogleDrive from './pages/GoogleDrive'
import Clients from './pages/Clients'
import ClientDetail from './pages/ClientDetail'
import { Spinner } from './components/ui'

function HamburgerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
      <rect y="2" width="18" height="2" rx="1"/>
      <rect y="8" width="18" height="2" rx="1"/>
      <rect y="14" width="18" height="2" rx="1"/>
    </svg>
  )
}

function NotificationBell() {
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const { user } = useAuth()

  useEffect(() => {
    if (!user) return
    loadNotifications()
    // Poll every 60 seconds
    const interval = setInterval(loadNotifications, 60000)
    return () => clearInterval(interval)
  }, [user])

  async function loadNotifications() {
    const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(20)
    if (!error && data) {
      setNotifications(data)
      setUnreadCount(data.filter(n => !n.read).length)
    }
  }

  async function markAllRead() {
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id)
    if (unreadIds.length === 0) return
    await supabase.from('notifications').update({ read: true }).in('id', unreadIds)
    setNotifications(ns => ns.map(n => ({ ...n, read: true })))
    setUnreadCount(0)
  }

  async function markOneRead(id) {
    await supabase.from('notifications').update({ read: true }).eq('id', id)
    setNotifications(ns => ns.map(n => n.id === id ? { ...n, read: true } : n))
    setUnreadCount(c => Math.max(0, c - 1))
  }

  const typeColors = {
    danger: { bg: 'var(--red-bg, #fcebeb)', color: 'var(--red, #a32d2d)', icon: '🔴' },
    warning: { bg: 'var(--amber-bg, #faeeda)', color: 'var(--amber, #ba7517)', icon: '⚠️' },
    success: { bg: 'var(--green-bg, #eaf3de)', color: 'var(--green, #448a40)', icon: '✅' },
    info: { bg: 'var(--blue-bg, #e6f1fb)', color: 'var(--blue, #0c447c)', icon: 'ℹ️' },
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', position: 'relative', padding: 6, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        title="Notifications"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            background: 'var(--red, #a32d2d)', color: 'white',
            fontSize: 10, fontWeight: 700, borderRadius: '50%',
            width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1
          }}>{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 998 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', top: '100%', right: -60, marginTop: 8,
            width: 'min(380px, calc(100vw - 24px))', maxHeight: 460, overflow: 'hidden',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg, 12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
            zIndex: 999, display: 'flex', flexDirection: 'column'
          }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Notifications</div>
              {unreadCount > 0 && (
                <button className="btn btn-sm" style={{ fontSize: 11, padding: '2px 10px' }} onClick={markAllRead}>Mark all read</button>
              )}
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {notifications.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                  No notifications yet
                </div>
              ) : notifications.map(n => {
                const tc = typeColors[n.type] || typeColors.info
                return (
                  <div
                    key={n.id}
                    style={{
                      padding: '12px 16px', borderBottom: '1px solid var(--border)',
                      background: n.read ? 'transparent' : 'var(--surface2)',
                      cursor: n.link ? 'pointer' : 'default',
                      transition: 'background .15s'
                    }}
                    onClick={() => {
                      if (!n.read) markOneRead(n.id)
                      if (n.link) { setOpen(false); window.location.href = n.link }
                    }}
                  >
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{tc.icon}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ fontSize: 13, fontWeight: n.read ? 500 : 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{n.title}</div>
                          {!n.read && <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green, #448a40)', flexShrink: 0 }} />}
                        </div>
                        {n.message && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{n.message}</div>}
                        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                          {new Date(n.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ProtectedLayout() {
  const { user, loading, mfaVerified } = useAuth()
  const [expCount, setExpCount] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mfaCheck, setMfaCheck] = useState({ done: false, needed: false, factorId: null })
  const location = useLocation()

  // On mount or when user changes, check if MFA is required
  useEffect(() => {
    if (!user) { setMfaCheck({ done: true, needed: false, factorId: null }); return }
    if (mfaVerified) { setMfaCheck({ done: true, needed: false, factorId: null }); return }
    let cancelled = false
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data: aal }) => {
      if (cancelled) return
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        supabase.auth.mfa.listFactors().then(({ data: fd }) => {
          if (cancelled) return
          const totp = fd?.totp?.find(f => f.status === 'verified')
          setMfaCheck({ done: true, needed: !!totp, factorId: totp?.id || null })
        })
      } else {
        setMfaCheck({ done: true, needed: false, factorId: null })
      }
    }).catch(() => {
      if (!cancelled) setMfaCheck({ done: true, needed: false, factorId: null })
    })
    return () => { cancelled = true }
  }, [user, mfaVerified])

  useEffect(() => {
    if (user) fetchExpCount()
    setSidebarOpen(false)
  }, [user, location.pathname])

  async function fetchExpCount() {
    const { count } = await supabase
      .from('documents_with_status')
      .select('id', { count: 'exact', head: true })
      .in('status', ['expired', 'expiring_soon'])
    setExpCount(count || 0)
  }

  if (loading || !mfaCheck.done) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Spinner size={32} />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  // User has MFA enrolled but hasn't verified this session — redirect to login for 2FA
  if (mfaCheck.needed) return <Navigate to="/login" replace state={{ mfaFactorId: mfaCheck.factorId }} />

  const pageTitles = {
    '/': 'Dashboard',
    '/subcontractors': 'Subcontractors',
    '/subcontractors/ea': 'Subcontractors',
    '/subcontractors/design-team': 'Subcontractors',
    '/subcontractors/compliance': 'Subcontractors',
    '/clients': 'Clients',
    '/projects': 'Projects',
    '/projects/tracker': 'Project Tracker',
    '/suppliers': 'Suppliers',
    '/settings': 'Settings',
  }
  const title = pageTitles[location.pathname] || 'BuildCore CRM'

  return (
    <div className="app-layout">
      <Sidebar expCount={expCount} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="main-area">
        <div className="topbar">
          <button className="topbar-menu-btn" onClick={() => setSidebarOpen(o => !o)}>
            <HamburgerIcon />
          </button>
          <div style={{ fontWeight: 600, fontSize: 15, flexShrink: 0 }}>{title}</div>
          <GlobalSearch />
          <NotificationBell />
          <div style={{ fontSize: 12, color: 'var(--text3)', display: 'none' }} className="topbar-date">
            {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
          </div>
        </div>
        <div className="page-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/subcontractors" element={<Subcontractors />} />
            <Route path="/subcontractors/ea" element={<Subcontractors />} />
            <Route path="/subcontractors/design-team" element={<Subcontractors />} />
            <Route path="/subcontractors/compliance" element={<Subcontractors />} />
            <Route path="/subcontractors/:id" element={<SubcontractorDetail />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/tracker" element={<ProjectTracker />} />
          <Route path="/projects/calendar" element={<ProjectCalendar />} />
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/suppliers" element={<Suppliers />} />
            <Route path="/settings" element={<Settings />} />
          <Route path="/company-documents" element={<CompanyDocuments />} />
          <Route path="/google-drive" element={<GoogleDrive />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}

function AppRoutes() {
  const { user, loading } = useAuth()
  if (loading) return null
  return (
    <Routes>
      <Route path="/login" element={!user ? <Login /> : <Login />} />
      <Route path="/*" element={<ProtectedLayout />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
// NOTE: imports added inline via patch below
