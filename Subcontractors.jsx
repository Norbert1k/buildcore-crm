import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ROLES } from '../lib/utils'
import { Avatar, Pill, Spinner, Modal, Field, IconPlus, IconEdit, ConfirmDialog } from '../components/ui'
import { useAuth } from '../lib/auth'

export default function Settings() {
  const { profile, can, signOut } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [showEditUser, setShowEditUser] = useState(null)
  const [inviteForm, setInviteForm] = useState({ email: '', full_name: '', role: 'viewer' })
  const [editForm, setEditForm] = useState({ full_name: '', role: 'viewer' })
  const [saving, setSaving] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState('')

  useEffect(() => { if (can('manage_users')) { loadUsers() } else { setLoading(false) } }, [])

  async function loadUsers() {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*').order('full_name')
    setUsers(data || [])
    setLoading(false)
  }

  async function inviteUser() {
    setSaving(true)
    setInviteError('')
    setInviteSuccess('')
    const { error } = await supabase.auth.admin.inviteUserByEmail(inviteForm.email, {
      data: { full_name: inviteForm.full_name, role: inviteForm.role }
    })
    setSaving(false)
    if (error) {
      // Fallback: create via signUp (for non-admin keys)
      setInviteError('Invitation requires admin API key. Share these credentials with the new user and ask them to sign up, then update their role here.')
      return
    }
    setInviteSuccess(`Invitation sent to ${inviteForm.email}`)
    setInviteForm({ email: '', full_name: '', role: 'viewer' })
    loadUsers()
  }

  async function updateUserRole() {
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
        <div className="card card-pad" style={{ maxWidth: 480 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <Avatar name={profile?.full_name} size="lg" />
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{profile?.full_name}</div>
              <div style={{ color: 'var(--text2)', fontSize: 13 }}>{profile?.email}</div>
              <div style={{ marginTop: 4 }}><Pill cls={ROLES[profile?.role]?.cls || 'pill-gray'}>{ROLES[profile?.role]?.label || profile?.role}</Pill></div>
            </div>
          </div>
          <button className="btn btn-danger btn-sm" onClick={signOut}>Sign out</button>
        </div>
      </div>

      {/* User Management — admin only */}
      {can('manage_users') && (
        <div>
          <div className="section-header">
            <div className="section-title">Team Members ({users.length} / 10)</div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowInvite(true)}>
              <IconPlus size={13} /> Add User
            </button>
          </div>

          {loading ? <Spinner /> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Member Since</th>
                    <th></th>
                  </tr>
                </thead>
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
                            <IconEdit size={13} /> Edit Role
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
            <strong style={{ color: 'var(--text2)' }}>Role permissions:</strong>{' '}
            Admin — full access including user management &nbsp;|&nbsp;
            Project Manager — manage projects, subcontractors, documents &nbsp;|&nbsp;
            Document Controller — add/edit documents only &nbsp;|&nbsp;
            Viewer — read-only access
          </div>
        </div>
      )}

      {/* Invite modal */}
      <Modal open={showInvite} onClose={() => { setShowInvite(false); setInviteError(''); setInviteSuccess('') }}
        title="Add Team Member" size="sm"
        footer={
          <>
            <button className="btn" onClick={() => setShowInvite(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={inviteUser} disabled={saving || !inviteForm.email || !inviteForm.full_name}>
              {saving ? 'Sending…' : 'Send Invitation'}
            </button>
          </>
        }>
        {inviteError && <div style={{ background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', borderRadius: 'var(--radius)', padding: '10px 12px', fontSize: 13, color: 'var(--amber)', marginBottom: 14 }}>{inviteError}</div>}
        {inviteSuccess && <div style={{ background: 'var(--green-bg)', border: '1px solid var(--green-border)', borderRadius: 'var(--radius)', padding: '10px 12px', fontSize: 13, color: 'var(--green)', marginBottom: 14 }}>{inviteSuccess}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Full Name *">
            <input value={inviteForm.full_name} onChange={e => setInviteForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Jane Smith" autoFocus />
          </Field>
          <Field label="Email Address *">
            <input type="email" value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@yourcompany.com" />
          </Field>
          <Field label="Role">
            <select value={inviteForm.role} onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))}>
              {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
        </div>
      </Modal>

      {/* Edit user role modal */}
      <Modal open={!!showEditUser} onClose={() => setShowEditUser(null)}
        title={`Edit — ${showEditUser?.full_name}`} size="sm"
        footer={
          <>
            <button className="btn" onClick={() => setShowEditUser(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={updateUserRole} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </>
        }>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Full Name">
            <input value={editForm.full_name} onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))} />
          </Field>
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
