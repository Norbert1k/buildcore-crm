import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ROLES, ROLE_PERMISSIONS } from '../lib/utils'
import { Avatar, Pill, Spinner, Modal, Field, IconPlus, IconEdit } from '../components/ui'
import { useAuth } from '../lib/auth'

export default function Settings() {
  const { profile, can, signOut, setTheme } = useAuth()
  const [activeTheme, setActiveTheme] = useState(() => document.documentElement.getAttribute('data-theme') || localStorage.getItem('theme') || 'light')
  const [users, setUsers] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddUser, setShowAddUser] = useState(false)
  const [showEditUser, setShowEditUser] = useState(null)
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
    const { data } = await supabase.from('profiles').select('*').order('full_name')
    // Load project access for site managers
    const { data: access } = await supabase.from('user_project_access').select('*')
    const usersWithAccess = (data || []).map(u => ({
      ...u,
      projectIds: (access || []).filter(a => a.user_id === u.id).map(a => a.project_id)
    }))
    setUsers(usersWithAccess)
    setLoading(false)
  }

  async function loadProjects() {
    const { data } = await supabase.from('projects').select('id, project_name, project_ref').order('project_name')
    setProjects(data || [])
  }

  async function createUser() {
    if (!addForm.email || !addForm.full_name || !addForm.password) { setAddError('All fields are required'); return }
    if (addForm.password.length < 6) { setAddError('Password must be at least 6 characters'); return }
    setSaving(true)
    setAddError('')
    const { data, error } = await supabase.auth.signUp({
      email: addForm.email,
      password: addForm.password,
      options: { data: { full_name: addForm.full_name, role: addForm.role } }
    })
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

      {/* My Profile */}
      <div style={{ marginBottom: 28 }}>
        <div className="section-title" style={{ marginBottom: 14 }}>My Profile</div>
        <div className="card card-pad" style={{ maxWidth: 500 }}>
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
          {/* Theme switcher */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Appearance</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { value: 'light', label: '☀️ Light', },
                { value: 'dark',  label: '🌙 Dark', },
              ].map(t => (
                <button key={t.value} onClick={() => { setTheme(t.value); setActiveTheme(t.value) }}
                  className={`btn btn-sm ${activeTheme === t.value ? 'btn-primary' : ''}`}
                  style={{ minWidth: 90 }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => setShowChangePassword(true)}>🔑 Change Password</button>
            <button className="btn btn-primary btn-sm" onClick={() => setShow2FA(true)}>🔐 Two-Factor Authentication</button>
            <button className="btn btn-danger btn-sm" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </div>

      {/* Team Management */}
      {can('manage_users') && (
        <div>
          <div className="section-header">
            <div className="section-title">Team Members ({users.length} / 10)</div>
            <button className="btn btn-primary btn-sm" onClick={() => { setShowAddUser(true); setAddError(''); setAddSuccess('') }}>
              <IconPlus size={13} /> Add User
            </button>
          </div>

          {loading ? <Spinner /> : (
            <>
              <div className="table-wrap" style={{ marginBottom: 16 }}>
                <table>
                  <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Access</th><th>Added</th><th></th></tr></thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
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
                        <td><Pill cls={ROLES[u.role]?.cls || 'pill-gray'}>{ROLES[u.role]?.label || u.role}</Pill></td>
                        <td>
                          {u.role === 'site_manager' ? (
                            <span style={{ fontSize: 12, color: 'var(--text2)' }}>
                              {u.projectIds?.length > 0 ? `${u.projectIds.length} project${u.projectIds.length > 1 ? 's' : ''}` : <span style={{ color: 'var(--amber)' }}>No projects assigned</span>}
                            </span>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{ROLE_PERMISSIONS[u.role]?.nav?.length || 0} sections</span>
                          )}
                        </td>
                        <td className="td-muted">{new Date(u.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                        <td>
                          {u.id !== profile?.id && (
                            <button className="btn btn-sm" onClick={() => { setEditForm({ full_name: u.full_name, role: u.role, projectIds: u.projectIds || [] }); setShowEditUser(u) }}>
                              <IconEdit size={13} /> Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

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
      )}

      {/* Change Password Modal */}
      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}

      {/* 2FA Modal */}
      {show2FA && <TwoFAModal onClose={() => setShow2FA(false)} profile={profile} />}

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
              <Field label="Temporary Password *"><input type="password" value={addForm.password} onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))} placeholder="Min. 6 characters" /></Field>
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
            <input type="password" value={current} onChange={e => setCurrent(e.target.value)} placeholder="Enter your current password" autoFocus />
          </Field>
          <Field label="New Password">
            <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="Min. 8 characters" />
          </Field>
          <Field label="Confirm New Password">
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat new password" />
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
