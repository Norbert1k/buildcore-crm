import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ROLES } from '../lib/utils'
import { Avatar, Pill, Spinner, Modal, Field, IconPlus, IconEdit } from '../components/ui'
import { useAuth } from '../lib/auth'

export default function Settings() {
  const { profile, can, signOut } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddUser, setShowAddUser] = useState(false)
  const [showEditUser, setShowEditUser] = useState(null)
  const [show2FA, setShow2FA] = useState(false)
  const [addForm, setAddForm] = useState({ email: '', full_name: '', password: '', role: 'viewer' })
  const [editForm, setEditForm] = useState({ full_name: '', role: 'viewer' })
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState('')
  const [addSuccess, setAddSuccess] = useState('')

  useEffect(() => { if (can('manage_users')) loadUsers(); else setLoading(false) }, [])

  async function loadUsers() {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*').order('full_name')
    setUsers(data || [])
    setLoading(false)
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
      await supabase.from('profiles').upsert({ id: data.user.id, email: addForm.email, full_name: addForm.full_name, role: addForm.role })
    }
    setSaving(false)
    setAddSuccess(`Account created for ${addForm.full_name}. They can log in at crm.cltd.co.uk`)
    setAddForm({ email: '', full_name: '', password: '', role: 'viewer' })
    loadUsers()
  }

  async function updateUser() {
    setSaving(true)
    await supabase.from('profiles').update({ full_name: editForm.full_name, role: editForm.role }).eq('id', showEditUser.id)
    setSaving(false)
    setShowEditUser(null)
    loadUsers()
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
              <div style={{ marginTop: 4 }}><Pill cls={ROLES[profile?.role]?.cls || 'pill-gray'}>{ROLES[profile?.role]?.label || profile?.role}</Pill></div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={() => setShow2FA(true)}>
              🔐 Set Up Two-Factor Authentication
            </button>
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
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Added</th><th></th></tr></thead>
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
                      <td className="td-muted">{new Date(u.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                      <td>
                        {u.id !== profile?.id && (
                          <button className="btn btn-sm" onClick={() => { setEditForm({ full_name: u.full_name, role: u.role }); setShowEditUser(u) }}>
                            <IconEdit size={13} /> Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--text3)' }}>
            <strong style={{ color: 'var(--text2)' }}>Roles:</strong>{' '}
            Admin — full access &nbsp;|&nbsp; Project Manager — manage projects & subcontractors &nbsp;|&nbsp; Document Controller — documents only &nbsp;|&nbsp; Viewer — read only
          </div>
        </div>
      )}

      {/* 2FA Setup Modal */}
      {show2FA && <TwoFAModal onClose={() => setShow2FA(false)} profile={profile} />}

      {/* Add User Modal */}
      <Modal open={showAddUser} onClose={() => { setShowAddUser(false); setAddError(''); setAddSuccess('') }}
        title="Add Team Member" size="sm"
        footer={!addSuccess ? (
          <><button className="btn" onClick={() => setShowAddUser(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={createUser} disabled={saving}>{saving ? 'Creating...' : 'Create Account'}</button></>
        ) : (
          <button className="btn btn-primary" onClick={() => { setShowAddUser(false); setAddSuccess('') }}>Done</button>
        )}>
        {addSuccess ? (
          <div style={{ background: 'var(--green-bg)', border: '1px solid var(--green-border)', borderRadius: 'var(--radius)', padding: '12px 14px', fontSize: 13, color: 'var(--green)', lineHeight: 1.6 }}>{addSuccess}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {addError && <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 13, color: 'var(--red)' }}>{addError}</div>}
            <Field label="Full Name *"><input value={addForm.full_name} onChange={e => setAddForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Jane Smith" autoFocus /></Field>
            <Field label="Email Address *"><input type="email" value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@cltd.co.uk" /></Field>
            <Field label="Temporary Password *"><input type="password" value={addForm.password} onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))} placeholder="Min. 6 characters" /></Field>
            <Field label="Role">
              <select value={addForm.role} onChange={e => setAddForm(f => ({ ...f, role: e.target.value }))}>
                {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <div style={{ fontSize: 12, color: 'var(--text3)', background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '8px 10px' }}>
              User logs in at <strong>crm.cltd.co.uk</strong> with their email and this password.
            </div>
          </div>
        )}
      </Modal>

      {/* Edit User Modal */}
      <Modal open={!!showEditUser} onClose={() => setShowEditUser(null)} title={`Edit: ${showEditUser?.full_name}`} size="sm"
        footer={<><button className="btn" onClick={() => setShowEditUser(null)}>Cancel</button><button className="btn btn-primary" onClick={updateUser} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Full Name"><input value={editForm.full_name} onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))} /></Field>
          <Field label="Role">
            <select value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}>
              {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
        </div>
      </Modal>
    </div>
  )
}

// ── Two-Factor Authentication Modal ──────────────────────────
function TwoFAModal({ onClose, profile }) {
  const [step, setStep] = useState('start') // start | setup | verify | done | manage
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
    setLoading(true)
    setError('')
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'City Construction CRM' })
    if (error) { setError(error.message); setLoading(false); return }
    setQrCode(data.totp.qr_code)
    setSecret(data.totp.secret)
    setFactorId(data.id)
    setStep('setup')
    setLoading(false)
  }

  async function verifyCode() {
    if (!code || code.length !== 6) { setError('Please enter the 6-digit code from your app'); return }
    setLoading(true)
    setError('')
    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
    if (challengeError) { setError(challengeError.message); setLoading(false); return }
    const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challengeData.id, code })
    if (verifyError) { setError('Incorrect code — please try again'); setLoading(false); return }
    setLoading(false)
    setStep('done')
  }

  async function removeFactor(id) {
    setLoading(true)
    await supabase.auth.mfa.unenroll({ factorId: id })
    setLoading(false)
    setFactors([])
    setStep('start')
  }

  return (
    <Modal open onClose={onClose} title="Two-Factor Authentication" size="sm"
      footer={
        step === 'start' ? <><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={startSetup} disabled={loading}>{loading ? 'Loading...' : 'Set Up 2FA'}</button></> :
        step === 'setup' ? <><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => setStep('verify')}>I've scanned it →</button></> :
        step === 'verify' ? <><button className="btn" onClick={() => setStep('setup')}>← Back</button><button className="btn btn-primary" onClick={verifyCode} disabled={loading || code.length !== 6}>{loading ? 'Verifying...' : 'Verify & Enable'}</button></> :
        step === 'done' ? <button className="btn btn-primary" onClick={onClose}>Done</button> :
        <button className="btn" onClick={onClose}>Close</button>
      }>

      {/* Step: Start */}
      {step === 'start' && (
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔐</div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Set up two-factor authentication</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, marginBottom: 16 }}>
            After entering your password, you'll also need to enter a code from your authenticator app. This keeps your account secure even if your password is compromised.
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 8 }}>
            <div style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 12, color: 'var(--text2)', textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 4 }}>📱</div>
              <div style={{ fontWeight: 600 }}>Microsoft Authenticator</div>
              <div>Free on iOS & Android</div>
            </div>
            <div style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 12, color: 'var(--text2)', textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 4 }}>📱</div>
              <div style={{ fontWeight: 600 }}>Google Authenticator</div>
              <div>Free on iOS & Android</div>
            </div>
          </div>
          {error && <div style={{ marginTop: 12, color: 'var(--red)', fontSize: 13 }}>{error}</div>}
        </div>
      )}

      {/* Step: Show QR code */}
      {step === 'setup' && (
        <div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16, lineHeight: 1.7 }}>
            <strong>Step 1</strong> — Open <strong>Microsoft Authenticator</strong> or <strong>Google Authenticator</strong> on your phone<br />
            <strong>Step 2</strong> — Tap the <strong>+</strong> button and choose <strong>"Scan QR code"</strong><br />
            <strong>Step 3</strong> — Point your camera at this QR code:
          </div>
          <div style={{ textAlign: 'center', margin: '16px 0' }}>
            {qrCode && <img src={qrCode} alt="2FA QR Code" style={{ width: 180, height: 180, border: '4px solid var(--border)', borderRadius: 'var(--radius)', display: 'inline-block' }} />}
          </div>
          <div style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '10px 12px', fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
            <strong>Can't scan?</strong> Enter this code manually in the app:<br />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, letterSpacing: '0.1em', color: 'var(--text)' }}>{secret}</span>
          </div>
        </div>
      )}

      {/* Step: Verify code */}
      {step === 'verify' && (
        <div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16, lineHeight: 1.7 }}>
            Your authenticator app should now show a <strong>6-digit code</strong> for City Construction CRM. Enter it below to confirm setup:
          </div>
          <Field label="6-Digit Code from Authenticator App">
            <input
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              style={{ fontSize: 24, letterSpacing: '0.3em', textAlign: 'center', fontFamily: 'var(--mono)' }}
              autoFocus
              maxLength={6}
            />
          </Field>
          {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{error}</div>}
        </div>
      )}

      {/* Step: Done */}
      {step === 'done' && (
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Two-factor authentication is now active</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7 }}>
            From your next login, you'll be asked for a code from your authenticator app after entering your password. Keep the app on your phone — you'll need it every time you log in.
          </div>
        </div>
      )}

      {/* Step: Manage existing */}
      {step === 'manage' && (
        <div>
          <div style={{ background: 'var(--green-bg)', border: '1px solid var(--green-border)', borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>✅</span>
            <div style={{ fontSize: 13, color: 'var(--green)' }}>
              <strong>Two-factor authentication is enabled</strong> on your account.
            </div>
          </div>
          {factors.map(f => (
            <div key={f.id} style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
              <div>
                <div style={{ fontWeight: 600 }}>🔐 {f.friendly_name || 'Authenticator App'}</div>
                <div style={{ color: 'var(--text3)', fontSize: 11, marginTop: 2 }}>Added {new Date(f.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => removeFactor(f.id)} disabled={loading}>
                {loading ? '...' : 'Remove'}
              </button>
            </div>
          ))}
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 12 }}>
            To change your authenticator app, remove the current one and set up a new one.
          </div>
        </div>
      )}
    </Modal>
  )
}
