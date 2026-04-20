import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext(null)

function applyTheme(theme) {
  const t = theme || 'light'
  document.documentElement.setAttribute('data-theme', t)
  localStorage.setItem('theme', t)
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [projectAccess, setProjectAccess] = useState([])
  const [loading, setLoading] = useState(true)
  // MFA state — ProtectedLayout checks this to gate access
  const [mfaVerified, setMfaVerified] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('theme') || 'light'
    applyTheme(saved)

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else {
        setProfile(null)
        setProjectAccess([])
        setMfaVerified(false)
        const saved = localStorage.getItem('theme') || 'light'
        applyTheme(saved)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    setProfile(data)
    if (data?.theme) applyTheme(data.theme)
    if (data?.role === 'site_manager') {
      const { data: access } = await supabase.from('user_project_access').select('project_id').eq('user_id', userId)
      setProjectAccess((access || []).map(a => a.project_id))
    }
    setLoading(false)
  }

  async function setTheme(theme) {
    applyTheme(theme)
    setProfile(p => ({ ...p, theme }))
    if (user) await supabase.from('profiles').update({ theme }).eq('id', user.id)
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  async function signOut() {
    setMfaVerified(false)
    await supabase.auth.signOut()
  }

  function markMfaVerified() {
    setMfaVerified(true)
  }

  const role = profile?.role

  // Operations Manager has identical permissions to Project Manager —
  // alias at the permission check so every existing permission entry applies.
  const effectiveRole = role === 'operations_manager' ? 'project_manager' : role

  const can = (action) => {
    if (!profile) return false
    if (role === 'admin') return true
    const permissions = {
      manage_subcontractors: ['project_manager', 'accountant'],
      manage_documents:      ['project_manager', 'accountant', 'document_controller'],
      manage_projects:       ['project_manager', 'accountant'],
      manage_suppliers:      ['project_manager', 'accountant'],
      manage_users:          [],
      delete:                ['project_manager', 'accountant'],
      view_financials:       ['project_manager', 'accountant', 'director_viewer'],
      view_subcontractors:   ['project_manager', 'accountant', 'director_viewer', 'site_manager', 'document_controller', 'viewer'],
      view_projects:         ['project_manager', 'accountant', 'director_viewer', 'site_manager', 'document_controller', 'viewer'],
      view_suppliers:        ['project_manager', 'accountant', 'director_viewer', 'site_manager'],
      view_supplier_detail:  ['project_manager', 'accountant', 'director_viewer', 'site_manager'],
      view_supplier_passwords: ['project_manager', 'accountant', 'director_viewer'],
      view_performance:      ['project_manager', 'accountant', 'director_viewer', 'site_manager'],
      issue_ratings:         ['project_manager', 'accountant'],
      view_all:              ['project_manager', 'accountant', 'director_viewer', 'site_manager', 'document_controller', 'viewer'],
      view_hs_handover:      ['project_manager', 'accountant', 'director_viewer', 'document_controller', 'viewer'],
      view_photos:           ['project_manager', 'accountant', 'director_viewer', 'document_controller', 'viewer'],
      view_case_study:       ['project_manager', 'accountant', 'director_viewer', 'document_controller', 'viewer'],
      view_clients:          ['project_manager', 'accountant', 'director_viewer', 'document_controller', 'viewer'],
      view_project_value:    ['project_manager', 'accountant', 'director_viewer'],
      view_csa:              ['project_manager', 'accountant', 'director_viewer', 'document_controller'],
      view_cff:              ['project_manager', 'accountant', 'director_viewer', 'document_controller'],
      view_payments:         ['project_manager', 'accountant', 'director_viewer'],
      view_company_vat:      ['project_manager', 'accountant', 'director_viewer'],
      view_company_bank:     ['project_manager', 'accountant', 'director_viewer'],
      view_company_other:    ['project_manager', 'accountant', 'director_viewer', 'document_controller'],
      view_company_templates:['project_manager', 'accountant', 'director_viewer', 'document_controller'],
      manage_settings:       ['project_manager', 'accountant'],
      view_tracker:          ['project_manager', 'accountant', 'director_viewer', 'viewer'],
    }
    return permissions[action]?.includes(effectiveRole) ?? false
  }

  const canAccessProject = (projectId) => {
    if (!profile) return false
    if (['admin', 'project_manager', 'operations_manager', 'accountant', 'director_viewer', 'document_controller', 'viewer'].includes(role)) return true
    if (role === 'site_manager') return projectAccess.includes(projectId)
    return false
  }

  // Activity log visibility: Admin + Project Manager + Operations Manager
  const canViewActivity = () => ['admin', 'project_manager', 'operations_manager'].includes(role)

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut, can, canAccessProject, canViewActivity, projectAccess, role, setTheme, mfaVerified, markMfaVerified }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
