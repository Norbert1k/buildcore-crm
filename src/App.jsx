import { useEffect, useState, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { supabase } from './lib/supabase'
import Sidebar from './components/Sidebar'
import Login from './pages/Login'
import GlobalSearch from './components/GlobalSearch'
import { Spinner } from './components/ui'

// ── Code-split routes ──────────────────────────────────────────────────────
// Each page is downloaded only when first visited rather than included in
// the initial JS bundle. This dramatically reduces the time-to-interactive
// on first load — instead of parsing the entire app (33k+ lines, including
// 2000+ line pages like TaskDetail, ProjectDocumentation, CffGeneratorModal),
// the user only downloads the entry shell + the page they actually open.
//
// Subsequent navigation between pages triggers a tiny JS fetch per route,
// which Vercel's edge cache serves in <50ms after the first visit.
//
// Login is NOT lazy — it's the very first thing logged-out users see, and
// lazy-loading it would add a Suspense fallback flash before the login form
// appears. Sidebar + GlobalSearch stay eager because they render on every
// authenticated page.
const Dashboard         = lazy(() => import('./pages/Dashboard'))
const Subcontractors    = lazy(() => import('./pages/Subcontractors'))
const SubcontractorDetail = lazy(() => import('./pages/SubcontractorDetail'))
const Documents         = lazy(() => import('./pages/Documents'))
const Projects          = lazy(() => import('./pages/Projects'))
const ProjectCalendar   = lazy(() => import('./pages/ProjectCalendar'))
const ProjectDetail     = lazy(() => import('./pages/ProjectDetail'))
const ProjectTracker    = lazy(() => import('./pages/ProjectTracker'))
const Suppliers         = lazy(() => import('./pages/Suppliers'))
const Settings          = lazy(() => import('./pages/Settings'))
const CompanyDocuments  = lazy(() => import('./pages/CompanyDocuments'))
const Clients           = lazy(() => import('./pages/Clients'))
const ClientDetail      = lazy(() => import('./pages/ClientDetail'))
const TaskTracker       = lazy(() => import('./pages/TaskTracker'))
const TaskDetail        = lazy(() => import('./pages/TaskDetail'))
const Quotes            = lazy(() => import('./pages/Quotes'))

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
  const [expCounts, setExpCounts] = useState({ expired: 0, expiring: 0 })
  const [reminderCount, setReminderCount] = useState(0)
  // The next reminder that's due AND hasn't been popped up to the user yet.
  // Drives the live popup modal. Set to null when no popup needs to show.
  const [pendingPopup, setPendingPopup] = useState(null)
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
    if (user) fetchReminderCount()
    setSidebarOpen(false)
  }, [user, location.pathname])

  // Poll reminder count every 60s so the sidebar dot stays current without
  // requiring navigation. Cleaned up on unmount / user change.
  useEffect(() => {
    if (!user) return
    const id = setInterval(fetchReminderCount, 60_000)
    return () => clearInterval(id)
  }, [user])

  // Wheel-event forwarder. Some staff have wide screens where the
  // .page-content scroll area (max-width 1400px, centered) leaves
  // empty margins on the sides. Scrolling on those margins does
  // nothing because the .app-layout has overflow: hidden and there's
  // no scrollable parent for the wheel event to bubble to.
  //
  // This listener catches wheel events that land OUTSIDE .page-content
  // (and outside the sidebar) and forwards their deltaY to .page-content
  // so scrolling works anywhere on the main area.
  //
  // Skipped when a modal/overlay is open so background scrolling can't
  // leak through (FileLightbox, Modal, EML viewer all set body
  // overflow:hidden OR use .modal-overlay; we detect by checking for
  // those elements in the DOM).
  useEffect(() => {
    function handleWheel(e) {
      // Find the current scroll container.
      const pageContent = document.querySelector('.page-content')
      if (!pageContent) return

      const path = e.composedPath ? e.composedPath() : []

      // If the event already happened inside the scroll container,
      // let the browser handle it natively.
      if (path.includes(pageContent)) return

      // If the event happened inside the sidebar, leave it alone —
      // the sidebar has its own overflow-y:auto.
      const sidebar = document.querySelector('.sidebar')
      if (sidebar && path.includes(sidebar)) return

      // If a modal or lightbox overlay is open, don't forward —
      // otherwise the page underneath would scroll while the user
      // is interacting with the modal.
      const modalOpen = document.querySelector('.modal-overlay')
        || document.querySelector('[data-lightbox-open]')
      if (modalOpen) return

      // Forward the wheel delta to .page-content.
      pageContent.scrollTop += e.deltaY
    }

    window.addEventListener('wheel', handleWheel, { passive: true })
    return () => window.removeEventListener('wheel', handleWheel)
  }, [])

  async function fetchExpCount() {
    const [expiredRes, expiringRes] = await Promise.all([
      supabase.from('documents_with_status').select('id', { count: 'exact', head: true }).eq('status', 'expired'),
      supabase.from('documents_with_status').select('id', { count: 'exact', head: true }).eq('status', 'expiring_soon'),
    ])
    setExpCounts({
      expired: expiredRes.count || 0,
      expiring: expiringRes.count || 0,
    })
  }

  // Fetches every reminder that's currently due AND un-dismissed. Two
  // outputs from one query:
  //   • reminderCount  — drives the sidebar dot (any due reminder = dot)
  //   • pendingPopup   — the OLDEST due-and-not-yet-notified reminder, joined
  //                      with its task for the live popup. Once popped, the
  //                      row's notified_at is set so it never re-fires.
  // Joining tasks(title, project_id) and projects(project_name, project_ref)
  // in one query keeps the popup zero-flicker — all data ready before render.
  async function fetchReminderCount() {
    const { data, error } = await supabase
      .from('task_reminders')
      .select('id, task_id, remind_at, created_at, notified_at, tasks(title, project_id, projects(project_name, project_ref))')
      .is('dismissed_at', null)
      .lte('remind_at', new Date().toISOString())
      .order('remind_at', { ascending: true })
    if (error) { console.warn('[App] reminder fetch:', error.message); return }
    const rows = data || []
    setReminderCount(rows.length)
    // First un-notified row becomes the popup. If all due reminders have
    // already been notified, no popup — they live in the Task Tracker banner.
    const next = rows.find(r => !r.notified_at)
    setPendingPopup(next || null)
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
    '/quotes': 'Quotes',
    '/settings': 'Settings',
  }
  const title = pageTitles[location.pathname] || 'BuildCore CRM'

  return (
    <div className="app-layout">
      <Sidebar expCounts={expCounts} reminderCount={reminderCount} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
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
          <Suspense fallback={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 40 }}>
              <Spinner size={32} />
            </div>
          }>
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
              <Route path="/quotes" element={<Quotes />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/company-documents" element={<CompanyDocuments />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/clients/:id" element={<ClientDetail />} />
              <Route path="/tasks" element={<TaskTracker />} />
              <Route path="/tasks/:taskId" element={<TaskDetail />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </div>

      <LiveReminderPopup
        reminder={pendingPopup}
        onClose={() => setPendingPopup(null)}
        onAfterAction={fetchReminderCount}
      />
    </div>
  )
}

// ─── Live reminder popup ────────────────────────────────────────────────────
// Modal that appears anywhere in the CRM when a task reminder becomes due.
// Server-tracked: setting notified_at=now() marks the reminder as "seen" so
// it won't pop again. The user can:
//   • Open task    — navigate to TaskDetail, mark notified, dismiss banner
//   • Snooze 1h    — push remind_at forward an hour, re-arm (notified_at=null)
//   • Dismiss      — close the reminder for good
//
// Closing via backdrop click is intentionally NOT allowed — the user must
// explicitly choose an action so they don't accidentally lose the reminder.
function LiveReminderPopup({ reminder, onClose, onAfterAction }) {
  const navigate = useNavigate()
  // Mark the reminder as notified the moment the popup actually mounts.
  // This means even if the user navigates away without clicking anything,
  // the popup never re-fires on the next 60s poll. The reminder still lives
  // on the Task Tracker banner (where notified_at doesn't matter) until the
  // user explicitly dismisses or opens it.
  useEffect(() => {
    if (!reminder?.id) return
    let cancelled = false
    supabase.from('task_reminders').update({ notified_at: new Date().toISOString() }).eq('id', reminder.id)
      .then(({ error }) => { if (error && !cancelled) console.warn('[ReminderPopup] mark notified:', error.message) })
    return () => { cancelled = true }
  }, [reminder?.id])

  if (!reminder) return null

  const task = reminder.tasks
  const project = task?.projects
  const projectLabel = project ? `${project.project_ref ? project.project_ref + ' · ' : ''}${project.project_name || ''}` : ''

  const createdAgo = (() => {
    const diff = Date.now() - new Date(reminder.created_at).getTime()
    const days = Math.floor(diff / (24 * 60 * 60 * 1000))
    if (days === 0) return 'earlier today'
    if (days === 1) return '1 day ago'
    return `${days} days ago`
  })()

  const goToTask = async () => {
    await supabase.from('task_reminders').update({ dismissed_at: new Date().toISOString() }).eq('id', reminder.id)
    navigate(`/tasks/${reminder.task_id}`)
    onClose()
    onAfterAction && onAfterAction()
  }

  const snoozeHour = async () => {
    const next = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    // notified_at=null re-arms it so the popup fires again in an hour.
    await supabase.from('task_reminders').update({ remind_at: next, notified_at: null }).eq('id', reminder.id)
    onClose()
    onAfterAction && onAfterAction()
  }

  const dismiss = async () => {
    await supabase.from('task_reminders').update({ dismissed_at: new Date().toISOString() }).eq('id', reminder.id)
    onClose()
    onAfterAction && onAfterAction()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--blue-border, rgba(91,155,213,0.4))',
        borderRadius: 10, width: 380, maxWidth: '100%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--blue, #5b9bd5)" stroke="var(--blue, #5b9bd5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Task reminder</span>
        </div>
        <div style={{ padding: '16px 18px' }}>
          {projectLabel && <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{projectLabel}</div>}
          <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 10 }}>{task?.title || 'Task'}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>You set this reminder {createdAgo}.</div>
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button className="btn btn-sm" onClick={snoozeHour}>Snooze 1h</button>
          <button className="btn btn-sm" onClick={dismiss}>Dismiss</button>
          <button className="btn btn-sm btn-primary" onClick={goToTask}>Open task →</button>
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
