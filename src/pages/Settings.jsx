import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ROLES, ROLE_PERMISSIONS, sortBy } from '../lib/utils'
import { Avatar, Pill, Spinner, Modal, Field, IconPlus, IconEdit, PasswordInput } from '../components/ui'
import { useAuth } from '../lib/auth'

// Domain that identifies internal CCG staff. Anyone whose email is NOT under
// this domain is treated as an "external" user (consultants, EAs, clients
// invited per-project, etc.) and grouped into the second table. Comparison
// is case-insensitive.
const INTERNAL_DOMAIN = 'cltd.co.uk'

function isInternalEmail(email) {
  if (!email) return false
  const at = email.indexOf('@')
  if (at < 0) return false
  return email.slice(at + 1).toLowerCase() === INTERNAL_DOMAIN
}

// Theme picker options. Each entry mirrors a [data-theme="..."] block in
// index.css. The preview object has the four colours rendered in the swatch
// tile (page bg, sidebar, primary text, accent pill bg + fg). These are
// hardcoded RGB values matching the corresponding CSS — keeping them in
// sync is part of the change checklist whenever a theme palette is edited.
const THEME_OPTIONS = [
  { value: 'light',  label: 'Light',  preview: { bg: '#F5F4F0', sidebar: '#FFFFFF', border: '#E2E0D8', text: '#1C1B18', accent: '#448a40', accentBg: '#e8f5e7' } },
  { value: 'dark',   label: 'Dark',   preview: { bg: '#0f1117', sidebar: '#13151f', border: 'rgba(255,255,255,0.07)', text: '#e8e9f0', accent: '#5cb85c', accentBg: 'rgba(68,138,64,0.15)' } },
  { value: 'rose',   label: 'Rose',   preview: { bg: '#FBF4F1', sidebar: '#FFFFFF', border: '#F0DCD3', text: '#4A1B0C', accent: '#993556', accentBg: '#FBEAF0' } },
  { value: 'mint',   label: 'Mint',   preview: { bg: '#EFF5F1', sidebar: '#FBFCFB', border: '#D5E5DD', text: '#04342C', accent: '#0F6E56', accentBg: '#E1F5EE' } },
  { value: 'forest', label: 'Forest', preview: { bg: '#0F1A14', sidebar: '#14241B', border: 'rgba(159,225,203,0.10)', text: '#E1F5EE', accent: '#5DCAA5', accentBg: 'rgba(29,158,117,0.18)' } },
  { value: 'sand',   label: 'Sand',   preview: { bg: '#F4EEDD', sidebar: '#FBF7EB', border: '#E2D5B5', text: '#412402', accent: '#854F0B', accentBg: '#FAEEDA' } },
  { value: 'slate',  label: 'Slate',  preview: { bg: '#1A1E2A', sidebar: '#20253A', border: 'rgba(133,183,235,0.10)', text: '#E6F1FB', accent: '#85B7EB', accentBg: 'rgba(55,138,221,0.18)' } },
  { value: 'pearl',  label: 'Pearl White', preview: { bg: '#FFFFFF', sidebar: '#FFFFFF', border: '#E2E0D8', text: '#1C1B18', accent: '#5B9BD5', accentBg: '#EFF6FB' } },
]

export default function Settings() {
  const { profile, can, signOut, setTheme } = useAuth()
  const navigate = useNavigate()
  const [activeTheme, setActiveTheme] = useState(() => document.documentElement.getAttribute('data-theme') || localStorage.getItem('theme') || 'light')
  const [users, setUsers] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddUser, setShowAddUser] = useState(false)
  const [showEditUser, setShowEditUser] = useState(null)
  // Delete-user state: holds the row currently being confirmed for delete.
  // Null = no modal open; { user, mode } = modal open. mode is 'profile'
  // for CRM users (hard delete) or 'client_user' for portal-only users
  // (revoke access only).
  const [showDeleteUser, setShowDeleteUser] = useState(null)
  const [show2FA, setShow2FA] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [addForm, setAddForm] = useState({ email: '', full_name: '', password: '', role: 'viewer' })
  const [editForm, setEditForm] = useState({ full_name: '', role: 'viewer', projectIds: [] })
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState('')
  const [addSuccess, setAddSuccess] = useState('')

  useEffect(() => {
    if (can('manage_users')) { loadUsers(); loadProjects() }
    else setLoading(false)
  }, [])

  async function loadUsers() {
    setLoading(true)
    // Three parallel sources:
    //   1. profiles + user_project_access — internal/CRM staff access
    //   2. client_users + clients — external portal access (which client
    //      they're a portal user of, from which we derive projects)
    //   3. projects — already loaded by loadProjects(), used to resolve
    //      client_id → list of projects for portal users
    const [profilesRes, accessRes, clientUsersRes, clientsRes, projectsRes] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('user_project_access').select('*'),
      supabase.from('client_users').select('id, email, full_name, role, client_id, created_at'),
      supabase.from('clients').select('id, name'),
      supabase.from('projects').select('id, project_name, project_ref, client_id'),
    ])

    const profiles    = profilesRes.data    || []
    const access      = accessRes.data      || []
    const clientUsers = clientUsersRes.data || []
    const clients     = clientsRes.data     || []
    const allProjects = projectsRes.data    || []

    // Build a map: email → list of { client_id, role, full_name } for fast
    // lookup when matching profiles to portal access.
    const portalByEmail = new Map()
    for (const cu of clientUsers) {
      const key = (cu.email || '').toLowerCase()
      if (!key) continue
      if (!portalByEmail.has(key)) portalByEmail.set(key, [])
      portalByEmail.get(key).push(cu)
    }

    // Build a map: client_id → list of projects (id only).
    const projectsByClient = new Map()
    for (const p of allProjects) {
      if (!p.client_id) continue
      if (!projectsByClient.has(p.client_id)) projectsByClient.set(p.client_id, [])
      projectsByClient.get(p.client_id).push(p.id)
    }
    const clientName = (id) => clients.find(c => c.id === id)?.name || null

    // Step 1 — profile-based rows. Each gets:
    //   • projectIds from user_project_access (CRM site-manager access)
    //   • portalProjectIds from any matching client_users row (portal access)
    //   • portalClientNames so the UI can show "Bloom Building Consultancy"
    //   • unified projectIds = union of both for display
    const profileRows = profiles.map(u => {
      const crmIds = access.filter(a => a.user_id === u.id).map(a => a.project_id)
      const emailKey = (u.email || '').toLowerCase()
      const matchingPortal = portalByEmail.get(emailKey) || []
      const portalIds = matchingPortal.flatMap(cu => projectsByClient.get(cu.client_id) || [])
      const portalClientNames = matchingPortal.map(cu => clientName(cu.client_id)).filter(Boolean)
      const merged = Array.from(new Set([...crmIds, ...portalIds]))
      return {
        ...u,
        projectIds: merged,
        crmProjectIds: crmIds,
        portalProjectIds: portalIds,
        portalClientNames,
        _portalOnly: false,
      }
    })

    // Step 2 — synthetic rows for portal-only users (in client_users but
    // NOT in profiles). Match is by lowercase email so casing differences
    // don't create duplicates. id is a sentinel "portal:<id>" so React keys
    // remain unique and the renderer can detect via _portalOnly.
    const profileEmails = new Set(profiles.map(p => (p.email || '').toLowerCase()).filter(Boolean))
    const portalOnly = clientUsers.filter(cu => {
      const k = (cu.email || '').toLowerCase()
      return k && !profileEmails.has(k)
    })
    const portalOnlyRows = portalOnly.map(cu => ({
      id: `portal:${cu.id}`,
      email: cu.email,
      full_name: cu.full_name || cu.email,
      // Role pill — synthetic role string used only for display. Falls back
      // to a "Portal" pill in the renderer when role is one of these.
      role: cu.role === 'admin' ? 'portal_admin' : 'portal_viewer',
      created_at: cu.created_at,
      client_id: cu.client_id,
      projectIds: projectsByClient.get(cu.client_id) || [],
      crmProjectIds: [],
      portalProjectIds: projectsByClient.get(cu.client_id) || [],
      portalClientNames: [clientName(cu.client_id)].filter(Boolean),
      _portalOnly: true,
      _portalClientId: cu.client_id,
    }))

    setUsers(sortBy([...profileRows, ...portalOnlyRows], 'full_name'))
    setLoading(false)
  }

  async function loadProjects() {
    const { data } = await supabase.from('projects').select('id, project_name, project_ref').order('project_name')
    setProjects(sortBy(data || [], 'project_name'))
  }

  async function createUser() {
    if (!addForm.email || !addForm.full_name || !addForm.password) { setAddError('All fields are required'); return }
    if (addForm.password.length < 6) { setAddError('Password must be at least 6 characters'); return }
    setSaving(true)
    setAddError('')

    // Capture the current admin session before signUp — Supabase's signUp will
    // hijack the browser session and log us in as the new user. We restore our
    // session immediately after.
    const { data: sessionData } = await supabase.auth.getSession()
    const adminSession = sessionData?.session

    const { data, error } = await supabase.auth.signUp({
      email: addForm.email,
      password: addForm.password,
      options: { data: { full_name: addForm.full_name, role: addForm.role } }
    })

    // Restore the admin session *before* any other supabase calls run with
    // the new user's credentials.
    if (adminSession) {
      await supabase.auth.setSession({
        access_token: adminSession.access_token,
        refresh_token: adminSession.refresh_token,
      })
    }

    if (error) { setAddError(error.message); setSaving(false); return }
    if (data?.user) {
      await supabase.from('profiles').upsert({ id: data.user.id, email: addForm.email, full_name: addForm.full_name, role: addForm.role, must_change_password: true })
    }
    setSaving(false)
    setAddSuccess(`Account created for ${addForm.full_name}. They can log in at crm.cltd.co.uk`)
    setAddForm({ email: '', full_name: '', password: '', role: 'viewer' })
    loadUsers()
  }

  async function updateUser() {
    setSaving(true)
    await supabase.from('profiles').update({ full_name: editForm.full_name, role: editForm.role }).eq('id', showEditUser.id)

    // Update project access for site managers
    await supabase.from('user_project_access').delete().eq('user_id', showEditUser.id)
    if (editForm.role === 'site_manager' && editForm.projectIds.length > 0) {
      await supabase.from('user_project_access').insert(
        editForm.projectIds.map(pid => ({ user_id: showEditUser.id, project_id: pid, granted_by: profile?.id }))
      )
    }
    setSaving(false)
    setShowEditUser(null)
    loadUsers()
  }

  function toggleProject(pid) {
    setEditForm(f => ({
      ...f,
      projectIds: f.projectIds.includes(pid)
        ? f.projectIds.filter(p => p !== pid)
        : [...f.projectIds, pid]
    }))
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Settings</h2>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 2 }}>Manage your account and team</p>
      </div>

      {/* My Profile — two cards side by side at desktop widths, stack on
          narrow screens. Profile card holds identity + auth buttons; the
          Appearance card holds the theme picker. minmax(360px, 1fr) lets
          each card claim half the row but fall back to a single column when
          the available width drops below ~720px. */}
      <div style={{ marginBottom: 28 }}>
        <div className="section-title" style={{ marginBottom: 14 }}>My Profile</div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: 16,
          alignItems: 'start',
        }}>
          {/* Card 1 — Identity + auth actions */}
          <div className="card card-pad">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <Avatar name={profile?.full_name} size="lg" />
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{profile?.full_name}</div>
                <div style={{ color: 'var(--text2)', fontSize: 13 }}>{profile?.email}</div>
                <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Pill cls={ROLES[profile?.role]?.cls || 'pill-gray'}>{ROLES[profile?.role]?.label || profile?.role}</Pill>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{ROLES[profile?.role]?.desc}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-sm" onClick={() => setShowChangePassword(true)}>🔑 Change Password</button>
              <button className="btn btn-primary btn-sm" onClick={() => setShow2FA(true)}>🔐 Two-Factor Authentication</button>
              <button className="btn btn-danger btn-sm" onClick={signOut}>Sign out</button>
            </div>
          </div>

          {/* Card 2 — Appearance (theme swatches). Heading lives inside the
              card now since it's no longer nested under Profile. */}
          <div className="card card-pad">
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Appearance</div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 10,
            }}>
              {THEME_OPTIONS.map(t => {
                const isActive = activeTheme === t.value
                return (
                  <button key={t.value}
                    onClick={() => { setTheme(t.value); setActiveTheme(t.value) }}
                    style={{
                      position: 'relative',
                      padding: 0,
                      borderRadius: 10,
                      border: isActive ? '2px solid var(--accent)' : '1px solid var(--border)',
                      background: 'transparent',
                      cursor: 'pointer',
                      overflow: 'hidden',
                      transition: 'transform .15s, border-color .15s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    {/* Mini palette preview: sidebar bar + main surface + accent pill */}
                    <div style={{ display: 'flex', height: 56, background: t.preview.bg }}>
                      <div style={{ width: '32%', background: t.preview.sidebar, borderRight: `1px solid ${t.preview.border}` }} />
                      <div style={{ flex: 1, padding: 6, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                        <div style={{ height: 4, width: '70%', background: t.preview.text, opacity: 0.7, borderRadius: 2 }} />
                        <div style={{
                          alignSelf: 'flex-start',
                          padding: '2px 6px',
                          fontSize: 8,
                          background: t.preview.accentBg,
                          color: t.preview.accent,
                          borderRadius: 99,
                          fontWeight: 600,
                        }}>active</div>
                      </div>
                    </div>
                    {/* Label */}
                    <div style={{
                      padding: '6px 8px',
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--text)',
                      background: 'var(--surface)',
                      textAlign: 'left',
                    }}>
                      {t.label}
                    </div>
                    {/* Active indicator */}
                    {isActive && (
                      <div style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        width: 18, height: 18,
                        borderRadius: '50%',
                        background: 'var(--accent)',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 700,
                      }}>✓</div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Team Management — split into two tables: internal CCG staff
          (anyone @cltd.co.uk) on top, external users (consultants, EAs,
          clients with project-specific access) below. The external table
          replaces the generic "Access" column with project pills showing
          which projects each user has been allocated to. Pills are
          clickable and navigate to the project detail page. */}
      {can('manage_users') && (() => {
        // Partition by email domain. Sort within each group is already
        // alphabetical (loadUsers sorts by full_name).
        const internalUsers = users.filter(u => isInternalEmail(u.email))
        const externalUsers = users.filter(u => !isInternalEmail(u.email))
        // Project lookup map for rendering external user pills. Built once
        // per render — projects list rarely changes mid-session.
        const projectMap = new Map(projects.map(p => [p.id, p]))

        return (
          <div>
            <div className="section-header">
              <div className="section-title">Team Members ({users.length} / 100)</div>
              <button className="btn btn-primary btn-sm" onClick={() => { setShowAddUser(true); setAddError(''); setAddSuccess('') }}>
                <IconPlus size={13} /> Add User
              </button>
            </div>

            {loading ? <Spinner /> : (
              <>
                {/* ── Internal CCG Team table ──────────────────────────── */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>CCG Team</span>
                    <span style={{ fontSize: 11, color: 'var(--text3)', padding: '2px 8px', background: 'var(--surface2)', borderRadius: 99 }}>
                      {internalUsers.length} internal
                    </span>
                  </div>
                </div>
                <div className="table-wrap" style={{ marginBottom: 24 }}>
                  <table>
                    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Access</th><th>Added</th><th></th></tr></thead>
                    <tbody>
                      {internalUsers.map(u => (
                        <TeamRow key={u.id} u={u}
                          mode="internal"
                          profile={profile}
                          projectMap={projectMap}
                          onNavigateProject={(id) => navigate(`/projects/${id}`)}
                          onNavigateClient={(id) => navigate(`/clients/${id}`)}
                          onEdit={() => { setEditForm({ full_name: u.full_name, role: u.role, projectIds: u.projectIds || [] }); setShowEditUser(u) }}
                          onDelete={() => setShowDeleteUser({ user: u, mode: 'profile' })}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* ── External Users table ─────────────────────────────────
                    Only rendered if there are external users — otherwise
                    the empty header would feel out of place. */}
                {externalUsers.length > 0 && (
                  <>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>External Users</span>
                        <span style={{ fontSize: 11, color: 'var(--text3)', padding: '2px 8px', background: 'var(--surface2)', borderRadius: 99 }}>
                          {externalUsers.length} external · project-allocated
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                        People outside CCG who've been granted access to specific projects (e.g. Employer's Agents, clients, consultants).
                      </div>
                    </div>
                    <div className="table-wrap" style={{ marginBottom: 16 }}>
                      <table>
                        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Projects</th><th>Added</th><th></th></tr></thead>
                        <tbody>
                          {externalUsers.map(u => (
                            <TeamRow key={u.id} u={u}
                              mode="external"
                              profile={profile}
                              projectMap={projectMap}
                              onNavigateProject={(id) => navigate(`/projects/${id}`)}
                          onNavigateClient={(id) => navigate(`/clients/${id}`)}
                              onEdit={() => { setEditForm({ full_name: u.full_name, role: u.role, projectIds: u.projectIds || [] }); setShowEditUser(u) }}
                              onDelete={() => setShowDeleteUser({
                                user: u,
                                // Portal-only users (synthetic rows from
                                // client_users) get the lighter
                                // 'client_user' mode = revoke portal
                                // access only. Real profile-backed users
                                // get full hard-delete.
                                mode: u._portalOnly ? 'client_user' : 'profile',
                              })}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {/* Role reference */}
                <div className="card card-pad">
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Role Permissions</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                    {Object.entries(ROLES).map(([key, r]) => (
                      <div key={key} style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <Pill cls={r.cls}>{r.label}</Pill>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>{r.desc}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                        Nav: {ROLE_PERMISSIONS[key]?.nav?.join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        )
      })()}

      {/* Change Password Modal */}
      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}

      {/* 2FA Modal */}
      {show2FA && <TwoFAModal onClose={() => setShow2FA(false)} profile={profile} />}

      {/* Delete User Modal — confirmation + edge-function call */}
      {showDeleteUser && (
        <DeleteUserModal
          user={showDeleteUser.user}
          mode={showDeleteUser.mode}
          onClose={() => setShowDeleteUser(null)}
          onDeleted={() => { setShowDeleteUser(null); loadUsers() }}
        />
      )}

      {/* Add User Modal */}
      <Modal open={showAddUser} onClose={() => { setShowAddUser(false); setAddError(''); setAddSuccess('') }}
        title="Add Team Member" size="md"
        footer={!addSuccess ? (
          <><button className="btn" onClick={() => setShowAddUser(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={createUser} disabled={saving}>{saving ? 'Creating...' : 'Create Account'}</button></>
        ) : (
          <button className="btn btn-primary" onClick={() => { setShowAddUser(false); setAddSuccess('') }}>Done</button>
        )}>
        {addSuccess ? (
          <div style={{ background: 'var(--green-bg)', border: '1px solid var(--green-border)', borderRadius: 'var(--radius)', padding: '12px 14px', fontSize: 13, color: 'var(--green)', lineHeight: 1.6 }}>{addSuccess}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {addError && <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 13, color: 'var(--red)' }}>{addError}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Full Name *"><input value={addForm.full_name} onChange={e => setAddForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Jane Smith" autoFocus /></Field>
              <Field label="Email Address *"><input type="email" value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@cltd.co.uk" /></Field>
              <Field label="Temporary Password *"><PasswordInput value={addForm.password} onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))} placeholder="Min. 6 characters" /></Field>
              <Field label="Role">
                <select value={addForm.role} onChange={e => setAddForm(f => ({ ...f, role: e.target.value }))}>
                  {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </Field>
            </div>
            {/* Role description */}
            <div style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '10px 12px', fontSize: 12, color: 'var(--text2)' }}>
              <strong>{ROLES[addForm.role]?.label}:</strong> {ROLES[addForm.role]?.desc}
              <div style={{ marginTop: 4, color: 'var(--text3)' }}>
                Can access: {ROLE_PERMISSIONS[addForm.role]?.nav?.join(', ')}
                {addForm.role === 'site_manager' && ' — project access assigned after creation in Edit'}
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)', background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '8px 10px' }}>
              User logs in at <strong>crm.cltd.co.uk</strong> with their email and this password.
            </div>
          </div>
        )}
      </Modal>

      {/* Edit User Modal */}
      <Modal open={!!showEditUser} onClose={() => setShowEditUser(null)}
        title={`Edit: ${showEditUser?.full_name}`} size="md"
        footer={<><button className="btn" onClick={() => setShowEditUser(null)}>Cancel</button><button className="btn btn-primary" onClick={updateUser} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Full Name"><input value={editForm.full_name} onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))} /></Field>
            <Field label="Role">
              <select value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value, projectIds: e.target.value !== 'site_manager' ? [] : f.projectIds }))}>
                {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
          </div>

          {/* Role description */}
          <div style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '10px 12px', fontSize: 12, color: 'var(--text2)' }}>
            <strong>{ROLES[editForm.role]?.label}:</strong> {ROLES[editForm.role]?.desc}
          </div>

          {/* Project assignment for Site Managers */}
          {editForm.role === 'site_manager' && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                Assign Projects ({editForm.projectIds.length} selected)
              </div>
              <div style={{ fontSize: 12, color: 'var(--amber)', background: 'var(--amber-bg)', padding: '8px 10px', borderRadius: 'var(--radius)', marginBottom: 10 }}>
                Site Managers can only access projects assigned here. Select all relevant projects.
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                {projects.length === 0 ? (
                  <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--text3)' }}>No projects available</div>
                ) : projects.map(p => (
                  <div key={p.id} onClick={() => toggleProject(p.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: editForm.projectIds.includes(p.id) ? 'var(--green-bg)' : 'var(--surface)', transition: 'background .1s' }}>
                    <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${editForm.projectIds.includes(p.id) ? 'var(--green)' : 'var(--border2)'}`, background: editForm.projectIds.includes(p.id) ? 'var(--green)' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {editForm.projectIds.includes(p.id) && <svg width="10" height="10" viewBox="0 0 12 12" fill="white"><path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{p.project_name}</div>
                      {p.project_ref && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{p.project_ref}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

// ── Two-Factor Authentication Modal ──────────────────────────
function TwoFAModal({ onClose, profile }) {
  const [step, setStep] = useState('start')
  const [qrCode, setQrCode] = useState('')
  const [secret, setSecret] = useState('')
  const [factorId, setFactorId] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [factors, setFactors] = useState([])

  useEffect(() => { checkExisting() }, [])

  async function checkExisting() {
    const { data } = await supabase.auth.mfa.listFactors()
    const verified = data?.totp?.filter(f => f.status === 'verified') || []
    setFactors(verified)
    if (verified.length > 0) setStep('manage')
  }

  async function startSetup() {
    setLoading(true); setError('')
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'City Construction CRM' })
    if (error) { setError(error.message); setLoading(false); return }
    setQrCode(data.totp.qr_code); setSecret(data.totp.secret); setFactorId(data.id)
    setStep('setup'); setLoading(false)
  }

  async function verifyCode() {
    if (!code || code.length !== 6) { setError('Please enter the 6-digit code'); return }
    setLoading(true); setError('')
    const { data: challengeData, error: ce } = await supabase.auth.mfa.challenge({ factorId })
    if (ce) { setError(ce.message); setLoading(false); return }
    const { error: ve } = await supabase.auth.mfa.verify({ factorId, challengeId: challengeData.id, code })
    if (ve) { setError('Incorrect code — please try again'); setLoading(false); return }
    setLoading(false); setStep('done')
  }

  async function removeFactor(id) {
    setLoading(true)
    await supabase.auth.mfa.unenroll({ factorId: id })
    setLoading(false); setFactors([]); setStep('start')
  }

  return (
    <Modal open onClose={onClose} title="Two-Factor Authentication" size="sm"
      footer={
        step === 'start'  ? <><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={startSetup} disabled={loading}>{loading ? 'Loading...' : 'Set Up 2FA'}</button></> :
        step === 'setup'  ? <><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => setStep('verify')}>I have scanned it →</button></> :
        step === 'verify' ? <><button className="btn" onClick={() => setStep('setup')}>← Back</button><button className="btn btn-primary" onClick={verifyCode} disabled={loading || code.length !== 6}>{loading ? 'Verifying...' : 'Verify & Enable'}</button></> :
        step === 'done'   ? <button className="btn btn-primary" onClick={onClose}>Done</button> :
        <button className="btn" onClick={onClose}>Close</button>
      }>
      {step === 'start' && (
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔐</div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Set up two-factor authentication</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, marginBottom: 16 }}>After entering your password, you will also need to enter a code from your authenticator app.</div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <div style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 12, color: 'var(--text2)', textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 4 }}>📱</div><div style={{ fontWeight: 600 }}>Microsoft Authenticator</div><div>Free on iOS & Android</div>
            </div>
            <div style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 12, color: 'var(--text2)', textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 4 }}>📱</div><div style={{ fontWeight: 600 }}>Google Authenticator</div><div>Free on iOS & Android</div>
            </div>
          </div>
          {error && <div style={{ marginTop: 12, color: 'var(--red)', fontSize: 13 }}>{error}</div>}
        </div>
      )}
      {step === 'setup' && (
        <div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16, lineHeight: 1.7 }}>
            <strong>Step 1</strong> — Open your authenticator app on your phone<br />
            <strong>Step 2</strong> — Tap <strong>+</strong> and choose <strong>"Scan QR code"</strong><br />
            <strong>Step 3</strong> — Point your camera at this code:
          </div>
          <div style={{ textAlign: 'center', margin: '16px 0' }}>
            {qrCode && <img src={qrCode} alt="2FA QR Code" style={{ width: 180, height: 180, border: '4px solid var(--border)', borderRadius: 'var(--radius)', display: 'inline-block' }} />}
          </div>
          <div style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '10px 12px', fontSize: 12, color: 'var(--text2)' }}>
            <strong>Cannot scan?</strong> Enter this code manually:<br />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, letterSpacing: '0.1em', color: 'var(--text)' }}>{secret}</span>
          </div>
        </div>
      )}
      {step === 'verify' && (
        <div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16, lineHeight: 1.7 }}>Enter the 6-digit code from your authenticator app:</div>
          <Field label="6-Digit Code">
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000"
              style={{ fontSize: 24, letterSpacing: '0.3em', textAlign: 'center', fontFamily: 'var(--mono)' }} autoFocus maxLength={6} />
          </Field>
          {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{error}</div>}
        </div>
      )}
      {step === 'done' && (
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Two-factor authentication is now active</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7 }}>From your next login, you will be asked for a code from your authenticator app.</div>
        </div>
      )}
      {step === 'manage' && (
        <div>
          <div style={{ background: 'var(--green-bg)', border: '1px solid var(--green-border)', borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>✅</span>
            <div style={{ fontSize: 13, color: 'var(--green)' }}><strong>Two-factor authentication is enabled</strong> on your account.</div>
          </div>
          {factors.map(f => (
            <div key={f.id} style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
              <div>
                <div style={{ fontWeight: 600 }}>🔐 {f.friendly_name || 'Authenticator App'}</div>
                <div style={{ color: 'var(--text3)', fontSize: 11, marginTop: 2 }}>Added {new Date(f.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => removeFactor(f.id)} disabled={loading}>{loading ? '...' : 'Remove'}</button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

// ── Change Password Modal ─────────────────────────────────────
function ChangePasswordModal({ onClose }) {
  const [current, setCurrent] = useState('')
  const [newPass, setNewPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [saving, setSaving] = useState(false)

  async function changePassword() {
    setError('')
    if (!newPass || newPass.length < 8) { setError('New password must be at least 8 characters'); return }
    if (newPass !== confirm) { setError('Passwords do not match'); return }
    if (newPass === current) { setError('New password must be different from your current password'); return }
    setSaving(true)

    // Re-authenticate first with current password to verify identity
    const { data: { user } } = await supabase.auth.getUser()
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: current,
    })
    if (signInError) { setError('Current password is incorrect'); setSaving(false); return }

    // Update password
    const { error: updateError } = await supabase.auth.updateUser({ password: newPass })
    setSaving(false)
    if (updateError) { setError(updateError.message); return }
    setSuccess(true)
  }

  return (
    <Modal open onClose={onClose} title="Change Password" size="sm"
      footer={
        success ? (
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={changePassword} disabled={saving || !current || !newPass || !confirm}>
              {saving ? 'Updating...' : 'Update Password'}
            </button>
          </>
        )
      }>
      {success ? (
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Password updated successfully</div>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>Your new password is now active.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red-border)', borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 13 }}>
              {error}
            </div>
          )}
          <Field label="Current Password">
            <PasswordInput value={current} onChange={e => setCurrent(e.target.value)} placeholder="Enter your current password" autoFocus />
          </Field>
          <Field label="New Password">
            <PasswordInput value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="Min. 8 characters" />
          </Field>
          <Field label="Confirm New Password">
            <PasswordInput value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat new password" />
          </Field>
          {newPass && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                { label: '8+ characters', ok: newPass.length >= 8 },
                { label: 'Uppercase letter', ok: /[A-Z]/.test(newPass) },
                { label: 'Number', ok: /[0-9]/.test(newPass) },
                { label: 'Passwords match', ok: newPass === confirm && confirm.length > 0 },
              ].map(r => (
                <span key={r.label} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: r.ok ? 'var(--green-bg)' : 'var(--surface2)', color: r.ok ? 'var(--green)' : 'var(--text3)', fontWeight: 500 }}>
                  {r.ok ? '✓' : '○'} {r.label}
                </span>
              ))}
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--text3)', background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '8px 10px' }}>
            Use at least 8 characters with a mix of letters, numbers and symbols for a strong password.
          </div>
        </div>
      )}
    </Modal>
  )
}

// ─── TeamRow ────────────────────────────────────────────────────────────────
//
// Shared row renderer used by both the CCG Team table and the External
// Users table. The two tables differ in two columns:
//   • mode='internal'  → Access column shows "X sections" or "X projects"
//                        for site managers (the original behaviour)
//   • mode='external'  → Access column becomes a Projects column showing
//                        clickable pills, one per assigned project
//
// Portal-only users (no profiles row, only client_users) are signalled by
// u._portalOnly === true. These rows show a synthetic "Portal" role pill
// and a "Manage in client" button (not Edit) since their access is
// administered from the Client detail page, not via Settings → Edit User.
//
// Everything else (Name, Email, Added) is identical across modes.
function TeamRow({ u, mode, profile, projectMap, onNavigateProject, onNavigateClient, onEdit, onDelete }) {
  // Caller can delete other users if they're an admin. They never see a
  // delete button on their own row (handled by onDelete being null).
  const canDelete = profile?.role === 'admin' && u.id !== profile?.id
  return (
    <tr>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar name={u.full_name} size="sm" />
          <div>
            <div style={{ fontWeight: 500 }}>{u.full_name}</div>
            {u.id === profile?.id && <div style={{ fontSize: 11, color: 'var(--text3)' }}>You</div>}
          </div>
        </div>
      </td>
      <td className="td-muted">{u.email}</td>
      <td><RolePill role={u.role} /></td>
      <td>
        {mode === 'external'
          ? <ExternalProjectsCell user={u} projectMap={projectMap} onNavigateProject={onNavigateProject} />
          : <InternalAccessCell user={u} />
        }
      </td>
      <td className="td-muted">{new Date(u.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
      <td>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {u._portalOnly ? (
            <>
              <button className="btn btn-sm" onClick={() => onNavigateClient(u._portalClientId)}>
                Manage in client
              </button>
              {canDelete && onDelete && (
                <button
                  className="btn btn-sm btn-danger"
                  onClick={onDelete}
                  title={`Revoke ${u.email}'s portal access`}
                >
                  Remove access
                </button>
              )}
            </>
          ) : u.id !== profile?.id ? (
            <>
              <button className="btn btn-sm" onClick={onEdit}>
                <IconEdit size={13} /> Edit
              </button>
              {canDelete && onDelete && (
                <button
                  className="btn btn-sm btn-danger"
                  onClick={onDelete}
                  title={`Permanently delete ${u.full_name}`}
                >
                  Delete
                </button>
              )}
            </>
          ) : null}
        </div>
      </td>
    </tr>
  )
}

// Role pill that handles both real roles (from ROLES) and synthetic
// portal-* roles (used for portal-only users). Real roles get their
// configured colour class; portal roles get a neutral gray pill with a
// "Portal · Admin" / "Portal · Viewer" label.
function RolePill({ role }) {
  if (role === 'portal_admin') {
    return <Pill cls="pill-gray">Portal · Admin</Pill>
  }
  if (role === 'portal_viewer') {
    return <Pill cls="pill-gray">Portal · Viewer</Pill>
  }
  return <Pill cls={ROLES[role]?.cls || 'pill-gray'}>{ROLES[role]?.label || role}</Pill>
}

// Internal table's Access cell — preserves the original behaviour:
//   • Site Manager: "X projects" or amber "No projects assigned"
//   • Anyone else:  generic "X sections" count from ROLE_PERMISSIONS.nav
function InternalAccessCell({ user }) {
  if (user.role === 'site_manager') {
    return (
      <span style={{ fontSize: 12, color: 'var(--text2)' }}>
        {user.projectIds?.length > 0
          ? `${user.projectIds.length} project${user.projectIds.length > 1 ? 's' : ''}`
          : <span style={{ color: 'var(--amber)' }}>No projects assigned</span>}
      </span>
    )
  }
  return (
    <span style={{ fontSize: 12, color: 'var(--text3)' }}>
      {ROLE_PERMISSIONS[user.role]?.nav?.length || 0} sections
    </span>
  )
}

// External table's Projects cell — renders one clickable pill per project
// the user has access to. For portal users, also shows the source client
// as a subtitle ("via Bloom Building Consultancy") so admins know WHY
// they have access (it's via portal membership, not direct CRM allocation).
//
// If the user has both CRM project access AND portal access, projects
// from either source are rendered together — no double-rendering since
// projectIds is already deduplicated upstream.
function ExternalProjectsCell({ user, projectMap, onNavigateProject }) {
  const projectIds = user.projectIds || []
  const portalClientNames = user.portalClientNames || []

  if (projectIds.length === 0) {
    return (
      <span style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>
        No projects assigned
      </span>
    )
  }
  // Resolve IDs against the projects map. Some IDs might point to deleted
  // projects (orphan rows in user_project_access); render those with the
  // raw UUID prefix as a fallback so the admin notices.
  const resolved = projectIds.map(id => {
    const p = projectMap.get(id)
    return p ? { id, name: p.project_name, ref: p.project_ref } : { id, name: id.slice(0, 8) + '…', ref: null, orphan: true }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 360 }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {resolved.map(p => (
          <span key={p.id}
            onClick={(e) => { e.stopPropagation(); onNavigateProject(p.id) }}
            style={{
              fontSize: 11,
              padding: '2px 8px',
              background: p.orphan ? 'var(--red-bg)' : 'var(--blue-bg)',
              color: p.orphan ? 'var(--red)' : 'var(--blue)',
              border: `0.5px solid ${p.orphan ? 'var(--red-border)' : 'var(--blue-border)'}`,
              borderRadius: 4,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'background 0.15s',
            }}
            title={p.orphan ? 'Project no longer exists' : `Click to open ${p.name}`}
          >
            {p.name}{p.ref ? ` · ${p.ref}` : ''}
          </span>
        ))}
      </div>
      {portalClientNames.length > 0 && (
        <span style={{ fontSize: 10, color: 'var(--text3)' }}>
          via {portalClientNames.join(', ')} portal
        </span>
      )}
    </div>
  )
}

// ─── DeleteUserModal ────────────────────────────────────────────────────
//
// Confirmation modal for deleting a user. Two modes:
//   • mode='profile'      — hard delete a CRM user (auth.users + cascade).
//                           Requires typing the user's email to confirm.
//   • mode='client_user'  — revoke a portal-only user's access (delete
//                           their client_users row only). Single-click
//                           confirm (lighter consequence, doesn't touch
//                           auth user).
//
// Calls the `delete-user` edge function which validates the caller is an
// admin, runs the appropriate delete, and returns ok/error. On success the
// parent's loadUsers() is fired via onDeleted to refresh the table.
function DeleteUserModal({ user, mode, onClose, onDeleted }) {
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const isHard = mode === 'profile'

  // Hard-delete requires typing the email exactly. Soft-delete (revoke
  // portal access) is single-click.
  const canConfirm = isHard
    ? confirmText.trim().toLowerCase() === (user.email || '').toLowerCase()
    : true

  async function performDelete() {
    setError('')
    setDeleting(true)
    try {
      // Pull the auth session so we can pass the user's JWT.
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not signed in')

      if (mode === 'client_user') {
        // Portal-only user: just remove their client_users row. No edge
        // function call needed — admin RLS on client_users allows the
        // direct DELETE. Strip the 'portal:' prefix to get the raw id.
        const rawId = (user.id || '').startsWith('portal:')
          ? user.id.slice('portal:'.length)
          : user.id
        const { error: delErr } = await supabase
          .from('client_users')
          .delete()
          .eq('id', rawId)
        if (delErr) throw new Error(`Failed to remove access: ${delErr.message}`)
        onDeleted()
        return
      }

      // Hard delete: invoke the deployed delete-user edge function. Note
      // it expects `userId` (not `target_id`) in the body and only handles
      // profile-row deletes — it doesn't clean up client_users so we do
      // that ourselves after the auth delete succeeds.
      const { data, error: fnErr } = await supabase.functions.invoke('delete-user', {
        body: { userId: user.id },
      })
      if (fnErr) {
        // Surface the actual error from the edge function (parsed via
        // FunctionsHttpError context.json() — same pattern as
        // PortalAccessTab uses).
        let detailedMessage = fnErr.message || 'Failed to delete user.'
        try {
          if (fnErr.context && typeof fnErr.context.json === 'function') {
            const body = await fnErr.context.json()
            if (body?.error) detailedMessage = body.error
          }
        } catch { /* keep original */ }
        throw new Error(detailedMessage)
      }
      if (data?.error) throw new Error(data.error)

      // Clean up any client_users rows tied to this auth user. The edge
      // function only deletes profiles/auth.users, leaving any portal
      // memberships dangling. RLS allows admin to delete client_users.
      try {
        await supabase.from('client_users').delete().eq('user_id', user.id)
      } catch (e) {
        // Non-fatal — the user is already deleted, this is just cleanup.
        console.warn('client_users cleanup failed:', e)
      }

      onDeleted()
    } catch (e) {
      setError(e.message || 'Something went wrong.')
      setDeleting(false)
    }
  }

  const title = isHard
    ? `Delete ${user.full_name || user.email}?`
    : `Remove portal access for ${user.full_name || user.email}?`

  return (
    <Modal open onClose={onClose} title={title} size="sm"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={deleting}>Cancel</button>
          <button
            className="btn btn-danger"
            onClick={performDelete}
            disabled={!canConfirm || deleting}
          >
            {deleting
              ? (isHard ? 'Deleting…' : 'Removing…')
              : (isHard ? 'Delete user' : 'Remove access')}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {isHard ? (
          <>
            <div style={{ padding: 12, background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 8, fontSize: 13, color: 'var(--red)' }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>This cannot be undone</div>
              <div>
                Permanently deletes <strong>{user.email}</strong> and removes
                all their data: profile, project access, portal memberships,
                and authentication. They will no longer be able to sign in
                anywhere.
              </div>
            </div>
            <Field label={`To confirm, type the email below: ${user.email}`}>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={user.email}
                autoFocus
                disabled={deleting}
                className="input"
              />
            </Field>
          </>
        ) : (
          <>
            <div style={{ padding: 12, background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', borderRadius: 8, fontSize: 13, color: 'var(--amber)' }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Revoke portal access</div>
              <div>
                Removes <strong>{user.email}</strong> from the
                {user.portalClientNames?.[0] ? ` ${user.portalClientNames[0]}` : ''} client portal.
                Their authentication account is preserved (in case they
                have access to other portals), but they won't be able to
                sign in to this one.
              </div>
            </div>
          </>
        )}
        {error && (
          <div style={{ padding: 10, background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 6, fontSize: 12, color: 'var(--red)' }}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
