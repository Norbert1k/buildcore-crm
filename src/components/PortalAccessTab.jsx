// src/components/PortalAccessTab.jsx
//
// Renders inside the existing ClientDetail page as a new tab.
// Lets staff:
//   - See who has portal access for this client
//   - Invite new client users (sends a magic-link invitation email
//     via Supabase OTP — actually re-uses Supabase Auth's signInWithOtp)
//   - Revoke access
//   - Edit branding (logo_url, brand_color)
//
// Note: We use Supabase Auth's "OTP" magic-link flow as the invite
// mechanism. When you "invite" a client user, we simply create the
// client_users row. The user will be able to log in via the portal
// /login page using their email, and Supabase Auth will create their
// auth.users row automatically on first login.

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

const PORTAL_URL = 'https://client.cltd.co.uk'

export default function PortalAccessTab({ client, onClientUpdate }) {
  const { profile } = useAuth()
  const [users, setUsers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [showBranding, setShowBranding] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(null)

  const isAdmin = profile?.role === 'admin'

  useEffect(() => { load() }, [client.id])

  async function load() {
    setLoading(true)
    const [usersRes, invsRes] = await Promise.all([
      supabase.from('client_users').select('*').eq('client_id', client.id).order('created_at'),
      supabase.from('client_invitations').select('*').eq('client_id', client.id).is('accepted_at', null).order('created_at', { ascending: false }),
    ])
    setUsers(usersRes.data || [])
    setInvitations(invsRes.data || [])
    setLoading(false)
  }

  async function revokeUser(cu) {
    setConfirmRevoke(null)
    const { error } = await supabase.from('client_users').delete().eq('id', cu.id)
    if (error) { alert('Failed: ' + error.message); return }
    load()
  }

  async function deleteInvite(inv) {
    const { error } = await supabase.from('client_invitations').delete().eq('id', inv.id)
    if (error) { alert('Failed: ' + error.message); return }
    load()
  }

  return (
    <div>
      {/* Branding card */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Portal branding</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Logo and color shown to this client when they sign in</div>
          </div>
          {isAdmin && (
            <button className="btn btn-sm" onClick={() => setShowBranding(true)}>Edit</button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {client.logo_url ? (
            <img src={client.logo_url} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }} />
          ) : (
            <div style={{ width: 40, height: 40, borderRadius: 8, background: client.brand_color || '#448a40', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600, fontSize: 12 }}>
              {(client.name || 'C').split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 16, height: 16, borderRadius: 4, background: client.brand_color || '#448a40', border: '1px solid var(--border)' }} />
            <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text2)' }}>{client.brand_color || '#448a40'}</span>
          </div>
        </div>
      </div>

      {/* Active users */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Active portal users · {users.length}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Can sign in at {PORTAL_URL}</div>
          </div>
          {isAdmin && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowInvite(true)}>+ Invite user</button>
          )}
        </div>

        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--text3)', padding: 12 }}>Loading...</div>
        ) : users.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text3)', padding: 12, textAlign: 'center' }}>
            No users yet. Click &quot;Invite user&quot; to grant access.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 4 }}>
            {users.map(cu => (
              <div key={cu.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderTop: '0.5px solid var(--border)' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text2)' }}>
                  {(cu.full_name || cu.email).split(' ').map(s => s[0]?.toUpperCase()).slice(0, 2).join('')}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{cu.full_name || cu.email}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)' }}>{cu.email} · {cu.role}{cu.last_login_at ? ` · last login ${new Date(cu.last_login_at).toLocaleDateString('en-GB')}` : ' · never logged in'}</div>
                </div>
                {isAdmin && (
                  <button className="btn btn-sm" style={{ fontSize: 11, color: 'var(--red)' }} onClick={() => setConfirmRevoke(cu)}>Revoke</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <div className="card card-pad">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Pending invitations · {invitations.length}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>These users have been invited but haven&apos;t signed in yet.</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {invitations.map(inv => (
              <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderTop: '0.5px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{inv.full_name || inv.email}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)' }}>{inv.email} · invited {new Date(inv.created_at).toLocaleDateString('en-GB')} · expires {new Date(inv.expires_at).toLocaleDateString('en-GB')}</div>
                </div>
                {isAdmin && (
                  <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={() => deleteInvite(inv)}>Cancel</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {showInvite && (
        <InviteModal client={client} invitedBy={profile?.id} inviterName={profile?.full_name} onClose={() => { setShowInvite(false); load() }} />
      )}

      {showBranding && (
        <BrandingModal client={client} onClose={() => setShowBranding(false)} onSaved={(updated) => { setShowBranding(false); onClientUpdate?.(updated) }} />
      )}

      {confirmRevoke && (
        <ConfirmModal
          message={`Revoke portal access for ${confirmRevoke.full_name || confirmRevoke.email}?`}
          onCancel={() => setConfirmRevoke(null)}
          onConfirm={() => revokeUser(confirmRevoke)}
        />
      )}
    </div>
  )
}

// ─── Invite modal ─────────────────────────────────────────────
function InviteModal({ client, invitedBy, inviterName, onClose }) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('viewer')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [emailWarning, setEmailWarning] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!email.trim()) return
    setSaving(true); setError('')
    try {
      const cleanEmail = email.trim().toLowerCase()

      // Check if already a user
      const { data: existing } = await supabase
        .from('client_users')
        .select('id')
        .eq('client_id', client.id)
        .eq('email', cleanEmail)
        .maybeSingle()
      if (existing) throw new Error('This email already has portal access for this client.')

      // Check if there's already a pending invitation
      const { data: existingInv } = await supabase
        .from('client_invitations')
        .select('id')
        .eq('client_id', client.id)
        .eq('email', cleanEmail)
        .is('accepted_at', null)
        .maybeSingle()
      if (existingInv) throw new Error('This email already has a pending invitation.')

      // Create invitation row
      const { error: invErr } = await supabase.from('client_invitations').insert({
        client_id: client.id,
        email: cleanEmail,
        full_name: fullName.trim() || null,
        role,
        invited_by: invitedBy,
      })
      if (invErr) throw invErr

      // Also create the client_users row immediately. The user_id will be NULL
      // until they actually sign in and we link them up. (We'll add a trigger
      // for that in a future phase. For now, the portal /login flow will
      // create auth users on demand and we manually accept the invitation.)
      // For this MVP, just pre-create the client_users row with user_id = null
      // so that when they log in, we can match them by email.
      const { error: cuErr } = await supabase.from('client_users').insert({
        client_id: client.id,
        email: cleanEmail,
        full_name: fullName.trim() || null,
        role,
        user_id: null,
      })
      if (cuErr) throw cuErr

      // Send the branded invite email via the edge function. If sending fails
      // we still consider the invite "created" — staff can fall back to
      // emailing the portal URL manually.
      try {
        const { error: fnErr } = await supabase.functions.invoke('send-portal-invite', {
          body: {
            email: cleanEmail,
            full_name: fullName.trim() || null,
            client_id: client.id,
            inviter_name: inviterName || null,
          },
        })
        if (fnErr) throw fnErr
        setEmailSent(true)
      } catch (e) {
        console.warn('Invite email send failed:', e)
        setEmailWarning(e?.message || 'Email failed to send — please email the portal link manually.')
      }

      setSuccess(true)
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ padding: 24, maxWidth: 440 }}>
        {success ? (
          <>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              {emailSent ? 'Invitation sent' : 'Invitation created'}
            </div>
            {emailSent ? (
              <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16, lineHeight: 1.5 }}>
                We&apos;ve emailed <strong>{email}</strong> a secure sign-in link from
                <code style={{ fontSize: 12, background: 'var(--surface2)', padding: '2px 6px', borderRadius: 3, marginLeft: 4 }}>noreply@cltd.co.uk</code>.
                <br /><br />
                Their account will be linked to {client.name} automatically when they sign in.
              </p>
            ) : (
              <>
                {emailWarning && (
                  <div style={{ fontSize: 12, color: '#854F0B', background: '#FAEEDA', border: '1px solid #FAC775', borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
                    Invitation saved, but the email didn&apos;t go out: {emailWarning}
                  </div>
                )}
                <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16, lineHeight: 1.5 }}>
                  Send <strong>{email}</strong> the portal URL: <code style={{ fontSize: 12, background: 'var(--surface2)', padding: '2px 6px', borderRadius: 3 }}>{PORTAL_URL}</code>
                  <br /><br />
                  On their first visit, they enter their email and click the magic link. Their account will be linked to {client.name} automatically.
                </p>
              </>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Invite portal user</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16 }}>To {client.name}</div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>Email *</label>
              <input type="email" required autoFocus value={email} onChange={e => setEmail(e.target.value)} placeholder="contact@client.com" style={inputStyle} />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>Full name (optional)</label>
              <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Jane Smith" style={inputStyle} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>Role</label>
              <select value={role} onChange={e => setRole(e.target.value)} style={inputStyle}>
                <option value="viewer">Viewer (read-only)</option>
                <option value="admin">Admin (can invite other users from their org)</option>
              </select>
            </div>

            {error && <div style={{ fontSize: 12, color: 'var(--red)', background: '#fee', padding: 8, borderRadius: 4, marginBottom: 12 }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !email.trim()}>
                {saving ? 'Sending...' : 'Create invitation'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  )
}

// ─── Branding modal ───────────────────────────────────────────
function BrandingModal({ client, onClose, onSaved }) {
  const [logoUrl, setLogoUrl] = useState(client.logo_url || '')
  const [brandColor, setBrandColor] = useState(client.brand_color || '#448a40')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true); setError('')
    try {
      const { data, error } = await supabase.from('clients')
        .update({ logo_url: logoUrl.trim() || null, brand_color: brandColor.trim() || '#448a40' })
        .eq('id', client.id)
        .select().single()
      if (error) throw error
      onSaved(data)
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ padding: 24, maxWidth: 440 }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Edit portal branding</div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>Logo URL (optional)</label>
          <input value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://..." style={inputStyle} />
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>Square image (e.g. 200x200). Leave blank to use initials on a colored tile.</div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>Brand color (hex)</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="color" value={brandColor} onChange={e => setBrandColor(e.target.value)} style={{ width: 40, height: 32, padding: 0, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }} />
            <input value={brandColor} onChange={e => setBrandColor(e.target.value)} placeholder="#448a40" style={{ ...inputStyle, fontFamily: 'monospace' }} />
          </div>
        </div>

        {error && <div style={{ fontSize: 12, color: 'var(--red)', background: '#fee', padding: 8, borderRadius: 4, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Helpers ──────────────────────────────────────────────────
function Modal({ children, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, maxWidth: '90%', maxHeight: '90vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function ConfirmModal({ message, onCancel, onConfirm }) {
  return (
    <Modal onClose={onCancel}>
      <div style={{ padding: 24, maxWidth: 360 }}>
        <div style={{ fontSize: 13, marginBottom: 16, color: 'var(--text)' }}>{message}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-sm" onClick={onCancel}>Cancel</button>
          <button className="btn btn-sm" style={{ background: 'var(--red)', color: 'white' }} onClick={onConfirm}>Revoke</button>
        </div>
      </div>
    </Modal>
  )
}

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  border: '0.5px solid var(--border)',
  borderRadius: 5,
  background: 'var(--surface2)',
  color: 'var(--text)',
  outline: 'none',
  boxSizing: 'border-box',
}
