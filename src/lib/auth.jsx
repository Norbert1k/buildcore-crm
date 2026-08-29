import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext(null)

// Each division remembers its own theme: profiles.theme = Construction's,
// profiles.theme_fitout = Fit-Out's (falls back to the construction theme,
// then light). Picking a theme in Settings saves to the ACTIVE division's
// slot; switching division applies that division's saved look.
function themeFor(profileData, div) {
  // Fallback chain ends at the browser's last-applied theme, NOT hard
  // 'light' — a profile with no saved theme must never stomp the look the
  // user was already running (that regression forced light on every refresh).
  const remembered = localStorage.getItem('theme') || 'light'
  // Fit-out defaults to its signature Blueprint theme (Stage 6) until the
  // user explicitly picks something else for that division.
  if (div === 'fitout') return profileData?.theme_fitout || 'blueprint'
  return profileData?.theme || remembered
}

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
  // ── Division context (Construction / Fit-Out) ──────────────────────────
  // The active division scopes every divisioned list and create-form.
  // Resolved on profile load: the user's saved choice (per-user key) if they
  // still hold that division, else the pre-login chooser pick, else their
  // first division. Single-division users (e.g. fit-out-only) can never land
  // outside their division regardless of what was chosen pre-login.
  const [division, setDivisionState] = useState('construction')

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
    {
      const held = (data?.divisions && data.divisions.length) ? data.divisions : ['construction']
      const saved = localStorage.getItem(`ccg_division_${userId}`)
      const choice = localStorage.getItem('ccg_division_choice')
      const resolved = held.includes(saved) ? saved : (held.includes(choice) ? choice : held[0])
      setDivisionState(resolved)
      document.documentElement.setAttribute('data-division', resolved)
      localStorage.setItem(`ccg_division_${userId}`, resolved)
      applyTheme(themeFor(data, resolved))
    }
    if (data?.role === 'site_manager') {
      const { data: access } = await supabase.from('user_project_access').select('project_id').eq('user_id', userId)
      setProjectAccess((access || []).map(a => a.project_id))
    }
    setLoading(false)
  }

  async function setTheme(theme) {
    applyTheme(theme)
    // Save to the ACTIVE division's theme slot.
    const col = division === 'fitout' ? 'theme_fitout' : 'theme'
    setProfile(p => ({ ...p, [col]: theme }))
    if (user) await supabase.from('profiles').update({ [col]: theme }).eq('id', user.id)
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

  // Divisions this user may enter; admins hold both via profiles.divisions.
  const divisions = (profile?.divisions && profile.divisions.length) ? profile.divisions : ['construction']

  function setDivision(d) {
    if (!divisions.includes(d)) return
    setDivisionState(d)
    // Fit-out mode re-themes the app chrome (see [data-division="fitout"] in
    // index.css) so switching divisions is visually unmistakable — and each
    // division applies its own saved theme.
    document.documentElement.setAttribute('data-division', d)
    applyTheme(themeFor(profile, d))
    if (user) localStorage.setItem(`ccg_division_${user.id}`, d)
  }

  const role = profile?.role

  // Operations Manager and Project Director have identical permissions to
  // Project Manager — aliased at the permission check so every existing
  // permission entry applies to all three. (Audit 29/08: project_director
  // previously appeared in ZERO capability lists — the role could open pages
  // via nav but failed every can() gate inside.)
  const effectiveRole = (role === 'operations_manager' || role === 'project_director') ? 'project_manager' : role

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
      // Credit limits and portal/login info — hidden from site managers
      // who only need supplier contact/account info on-site, not commercial
      // or credentials data. All other supplier-viewing roles retain access.
      view_supplier_credit:    ['project_manager', 'accountant', 'director_viewer'],
      view_supplier_login:     ['project_manager', 'accountant', 'director_viewer'],
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
      // Site managers: view + download of general company documents
      // (Templates, Other). VAT & Bank stay restricted, and manage_documents
      // (upload/rename/delete) deliberately still excludes them.
      view_company_other:    ['project_manager', 'accountant', 'director_viewer', 'document_controller', 'site_manager'],
      view_company_templates:['project_manager', 'accountant', 'director_viewer', 'document_controller', 'site_manager'],
      manage_settings:       ['project_manager', 'accountant'],
      // Company Information panel: all staff can view the general block; only
      // admins can edit (empty list → admin short-circuit only). Sensitive
      // sub-blocks (banking, director personal details) reuse view_company_bank.
      manage_company_info:   [],
      view_company_info:     ['project_manager', 'accountant', 'director_viewer', 'site_manager', 'document_controller', 'viewer'],
      view_tracker:          ['project_manager', 'accountant', 'director_viewer', 'viewer'],
      blacklist_manage:      [], // admin-only, handled by `role === 'admin'` short-circuit above
      create_tasks:          ['project_manager', 'operations_manager'],
      edit_tasks:            ['project_manager', 'operations_manager'],
    }
    return permissions[action]?.includes(effectiveRole) ?? false
  }

  const canAccessProject = (projectId) => {
    if (!profile) return false
    if (['admin', 'project_manager', 'operations_manager', 'project_director', 'accountant', 'director_viewer', 'document_controller', 'viewer'].includes(role)) return true
    if (role === 'site_manager') return projectAccess.includes(projectId)
    return false
  }

  // Activity log visibility: Admin + Project Manager + Operations Manager
  const canViewActivity = () => ['admin', 'project_manager', 'operations_manager', 'project_director'].includes(role)

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut, can, canAccessProject, canViewActivity, projectAccess, role, setTheme, mfaVerified, markMfaVerified, division, divisions, setDivision }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
