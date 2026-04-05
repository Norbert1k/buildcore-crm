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
  const [addForm, setAddForm] = useState({ email: '', full_name: '', password: '', role: 'viewer' })
  const [editForm, setEditForm] = useState({ full_name: '', role: 'viewer' })
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState('')
  const [addSuccess, setAddSuccess] = useState('')

  useEffect(() => { if (can('manage_users')) { loadUsers() } else { setLoading(false) } }, [])

  async function loadUsers() {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*').order('full_name')
    setUsers(data || [])
    setLoading(false)
  }

  async function createUser() {
    if (!addForm.email || !addForm.full_name || !addForm.password) {
      setAddError('All fields are required')
      return
    }
    if (addForm.password.length < 6) {
      setAddError('Password must be at least 6 characters')
      return
    }
    setSaving(true)
    setAddError('')

    // Sign up the new user
    const { data, error } = await supabase.auth.signUp({
      email: addForm.email,
      password: addForm.password,
      options: {
        data: { full_name: addForm.full_name, role: addForm.role }
      }
    })

    if (error) {
      setAddError(error.message)
      setSaving(false)
      return
    }

    // If user was created, update their profile role directly
    if (data?.user) {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        email: addForm.email,
        full_name: addForm.full_name,
        role: addForm.role,
      })
    }

    setSaving(false)
    setAddSuccess(`Account created for ${addForm.full_name}. They can now log in at crm.cltd.co.uk with their email and password.`)
    setAddForm({ email: '', full_name: '', password: '', role: 'viewer' })
    loadUsers()
  }

  async function updateUser() {
    setSaving(true)
    await supabase.from('profiles').update({
      full_name: editForm.full_name,
      role: editForm.role
    }).eq('id', showEditUser.id)
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
              <div style={{ marginTop: 4 }}>
                <Pill cls={ROLES[profile?.role]?.cls || 'pill-gray'}>
                  {ROLES[profile?.role]?.label || profile?.role}
                </Pill>
              </div>
            </div>
          </div>
          <button className="btn btn-danger btn-sm" onClick={signOut}>Sign out</button>
        </div>
      </div>

      {/* Team Management — admin only */}
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
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Added</th>
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
            Admin — full access &nbsp;|&nbsp;
            Project Manager — manage projects & subcontractors &nbsp;|&nbsp;
            Document Controller — documents only &nbsp;|&nbsp;
            Viewer — read only
          </div>
        </div>
      )}

      {/* Add User Modal */}
      <Modal
        open={showAddUser}
        onClose={() => { setShowAddUser(false); setAddError(''); setAddSuccess('') }}
        title="Add Team Member"
        size="sm"
        footer={
          !addSuccess ? (
            <>
              <button className="btn" onClick={() => { setShowAddUser(false); setAddError('') }}>Cancel</button>
              <button className="btn btn-primary" onClick={createUser} disabled={saving}>
                {saving ? 'Creating...' : 'Create Account'}
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => { setShowAddUser(false); setAddSuccess('') }}>Done</button>
          )
        }
      >
        {addSuccess ? (
          <div style={{ background: 'var(--green-bg)', border: '1px solid var(--green-border)', borderRadius: 'var(--radius)', padding: '12px 14px', fontSize: 13, color: 'var(--green)', lineHeight: 1.6 }}>
            {addSuccess}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {addError && (
              <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 13, color: 'var(--red)' }}>
                {addError}
              </div>
            )}
            <Field label="Full Name *">
              <input value={addForm.full_name} onChange={e => setAddForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Jane Smith" autoFocus />
            </Field>
            <Field label="Email Address *">
              <input type="email" value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@cltd.co.uk" />
            </Field>
            <Field label="Temporary Password *">
              <input type="password" value={addForm.password} onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))} placeholder="Min. 6 characters" />
            </Field>
            <Field label="Role">
              <select value={addForm.role} onChange={e => setAddForm(f => ({ ...f, role: e.target.value }))}>
                {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <div style={{ fontSize: 12, color: 'var(--text3)', background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '8px 10px' }}>
              The user will log in at <strong>crm.cltd.co.uk</strong> using their email and this password. Ask them to change it after first login.
            </div>
          </div>
        )}
      </Modal>

      {/* Edit User Modal */}
      <Modal
        open={!!showEditUser}
        onClose={() => setShowEditUser(null)}
        title={`Edit: ${showEditUser?.full_name}`}
        size="sm"
        footer={
          <>
            <button className="btn" onClick={() => setShowEditUser(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={updateUser} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </>
        }
      >
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
