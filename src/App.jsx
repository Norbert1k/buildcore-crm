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
import ProjectDetail from './pages/ProjectDetail'
import Settings from './pages/Settings'
import { Spinner } from './components/ui'

function ProtectedLayout() {
  const { user, loading } = useAuth()
  const [expCount, setExpCount] = useState(0)
  const location = useLocation()

  useEffect(() => {
    if (user) fetchExpCount()
  }, [user, location.pathname])

  async function fetchExpCount() {
    const { count } = await supabase
      .from('documents_with_status')
      .select('id', { count: 'exact', head: true })
      .in('status', ['expired', 'expiring_soon'])
    setExpCount(count || 0)
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Spinner size={32} />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  const pageTitles = {
    '/': 'Dashboard',
    '/subcontractors': 'Subcontractors',
    '/documents': 'Documents & Compliance',
    '/projects': 'Projects',
    '/settings': 'Settings',
  }
  const title = pageTitles[location.pathname] || 'BuildCore CRM'

  return (
    <div className="app-layout">
      <Sidebar expCount={expCount} />
      <div className="main-area">
        <div className="topbar">
          <div style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>
            {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </div>
        <div className="page-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/subcontractors" element={<Subcontractors />} />
            <Route path="/subcontractors/:id" element={<SubcontractorDetail />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/settings" element={<Settings />} />
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
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
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
