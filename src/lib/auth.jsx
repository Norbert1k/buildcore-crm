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
  const [mfaRequired, setMfaRequired] = useState(false)
  const [mfaFactorId, setMfaFactorId] = useState(null)

  useEffect(() => {
    // Apply theme from localStorage immediately on mount
    const saved = localStorage.getItem('theme') || 'light'
    applyTheme(saved)

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        // Check if MFA is required but not yet verified
        const mfaOk = await checkMfaAssurance()
        if (mfaOk) {
          setUser(session.user)
          fetchProfile(session.user.id)
        } else {
          // User has a session but MFA not verified — don't treat as logged in
          setUser(null)
          setLoading(false)
        }
      } else {
        setUser(null)
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const mfaOk = await checkMfaAssurance()
        if (mfaOk) {
          setUser(session.user)
          fetchProfile(session.user.id)
        } else {
          setUser(null)
          setLoading(false)
        }
      } else {
        setUser(null)
        setProfile(null)
        setProjectAccess([])
        setMfaRequired(false)
        setMfaFactorId(null)
        const saved = localStorage.getItem('theme') || 'light'
        applyTheme(saved)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function checkMfaAssurance() {
    try {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') {
        // MFA is enrolled but session is only aal1 — need verification
        const { data: fd } = await supabase.auth.mfa.listFactors()
        const totp = fd?.totp?.find(f => f.status === 'verified')
        if (totp) {
          setMfaRequired(true)
          setMfaFactorId(totp.id)
          return false
        }
      }
      setMfaRequired(false)
      setMfaFactorId(null)
      return true
    } catch {
      return true
    }
  }

  // Called from Login after successful MFA verification
  async function completeMfa() {
    setMfaRequired(false)
    setMfaFactorId(null)
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      setUser(session.user)
      await fetchProfile(session.user.id)
    }
  }

  async function fetchProfile(userId) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    setProfile(data)
    // Apply theme from profile, save to localStorage
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
    await supabase.auth.signOut()
    // Theme stays as-is from localStorage — don't reset it
  }

  const role = profile?.role

  const can = (action) => {
    if (!profile) return false
    if (role === 'admin') return true
    const permissions = {
      manage_subcontractors: ['project_manager', 'accountant', 'site_manager'],
      manage_documents:      ['project_manager', 'accountant', 'document_controller'],
      manage_projects:       ['project_manager', 'accountant'],
      manage_suppliers:      ['project_manager', 'accountant'],
      manage_users:          [],
      delete:                [],
      view_financials:       ['project_manager', 'accountant', 'director_viewer'],
      view_subcontractors:   ['project_manager', 'accountant', 'director_viewer', 'site_manager', 'document_controller', 'viewer'],
      view_projects:         ['project_manager', 'accountant', 'director_viewer', 'site_manager', 'document_controller', 'viewer'],
      view_suppliers:        ['project_manager', 'accountant', 'director_viewer', 'site_manager'],
      view_supplier_detail:  ['project_manager', 'accountant', 'director_viewer'],
      view_performance:      ['project_manager', 'accountant', 'director_viewer', 'site_manager'],
      issue_ratings:         ['project_manager', 'accountant', 'site_manager'],
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
      manage_settings:       ['project_manager', 'accountant'],
      view_tracker:          ['project_manager', 'accountant', 'director_viewer', 'viewer'],
    }
    return permissions[action]?.includes(role) ?? false
  }

  const canAccessProject = (projectId) => {
    if (!profile) return false
    if (['admin', 'project_manager', 'accountant', 'director_viewer', 'document_controller', 'viewer'].includes(role)) return true
    if (role === 'site_manager') return projectAccess.includes(projectId)
    return false
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut, can, canAccessProject, projectAccess, role, setTheme, mfaRequired, mfaFactorId, completeMfa }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
