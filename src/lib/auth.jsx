import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [projectAccess, setProjectAccess] = useState([]) // project IDs site manager can access
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else { setProfile(null); setProjectAccess([]); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    setProfile(data)

    // If site manager, load their project access
    if (data?.role === 'site_manager') {
      const { data: access } = await supabase
        .from('user_project_access')
        .select('project_id')
        .eq('user_id', userId)
      setProjectAccess((access || []).map(a => a.project_id))
    }
    setLoading(false)
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  const role = profile?.role

  const can = (action) => {
    if (!profile) return false

    // Admin can do everything
    if (role === 'admin') return true

    const permissions = {
      // Core management
      manage_subcontractors: ['project_manager', 'site_manager'],
      manage_documents:      ['project_manager', 'site_manager', 'document_controller'],
      manage_projects:       ['project_manager'],
      manage_suppliers:      ['project_manager', 'accountant'],
      manage_users:          [],
      delete:                [],

      // View permissions
      view_financials:       ['project_manager', 'accountant'],
      view_subcontractors:   ['project_manager', 'site_manager', 'document_controller', 'accountant', 'viewer'],
      view_projects:         ['project_manager', 'site_manager', 'document_controller', 'accountant', 'viewer'],
      view_suppliers:        ['project_manager', 'accountant'],
      view_performance:      ['project_manager', 'site_manager'],
      issue_ratings:         ['project_manager', 'site_manager'],
      view_all:              ['project_manager', 'site_manager', 'document_controller', 'accountant', 'viewer'],
    }

    return permissions[action]?.includes(role) ?? false
  }

  // Check if user can access a specific project
  const canAccessProject = (projectId) => {
    if (!profile) return false
    if (role === 'admin' || role === 'project_manager' || role === 'accountant' || role === 'document_controller' || role === 'viewer') return true
    if (role === 'site_manager') return projectAccess.includes(projectId)
    return false
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut, can, canAccessProject, projectAccess, role }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
