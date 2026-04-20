import { useState, useEffect } from 'react'
import { useAuth } from '../lib/auth'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PasswordInput } from '../components/ui'

export default function Login() {
  const { signIn, markMfaVerified, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState('login')
  const [factorId, setFactorId] = useState('')
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [passError, setPassError] = useState('')
  const [passLoading, setPassLoading] = useState(false)

  // If redirected here with mfaFactorId from ProtectedLayout, go straight to 2FA
  useEffect(() => {
    const mfaFid = location.state?.mfaFactorId
    if (mfaFid && user) {
      setFactorId(mfaFid)
      setStep('2fa')
    }
  }, [location.state, user])

  async function handleLogin(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) { setError(error.message); return }

    // Check 2FA
    try {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal?.nextLevel === 'aal2' && aal?.nextLevel !== aal?.currentLevel) {
        const { data: fd } = await supabase.auth.mfa.listFactors()
        const totp = fd?.totp?.find(f => f.status === 'verified')
        if (totp) { setFactorId(totp.id); setStep('2fa'); return }
      }
    } catch (e) { /* no MFA enrolled */ }

    // No MFA — mark verified and check password change
    markMfaVerified()

    try {
      const { data: { user: u } } = await supabase.auth.getUser()
      if (u) {
        const { data: profileData } = await supabase.from('profiles').select('must_change_password').eq('id', u.id).single()
        if (profileData?.must_change_password) { setStep('change_password'); return }
      }
    } catch (e) { /* ignore */ }

    navigate('/')
  }

  async function handle2FA(e) {
    e.preventDefault()
    if (!code || code.length !== 6) { setError('Please enter the 6-digit code'); return }
    setError(''); setLoading(true)
    try {
      const { data: cd, error: ce } = await supabase.auth.mfa.challenge({ factorId })
      if (ce) { setError(ce.message); setLoading(false); return }
      const { error: ve } = await supabase.auth.mfa.verify({ factorId, challengeId: cd.id, code })
      setLoading(false)
      if (ve) { setError('Incorrect code — please try again'); return }

      // MFA verified — mark it in auth context
      markMfaVerified()

      // Check forced password change
      try {
        const { data: { user: u } } = await supabase.auth.getUser()
        if (u) {
          const { data: profileData } = await supabase.from('profiles').select('must_change_password').eq('id', u.id).single()
          if (profileData?.must_change_password) { setStep('change_password'); return }
        }
      } catch (e) { /* ignore */ }
      navigate('/')
    } catch (e) {
      setError('Verification failed — please try again')
      setLoading(false)
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    setPassError('')
    if (newPass.length < 8) { setPassError('Password must be at least 8 characters'); return }
    if (newPass !== confirmPass) { setPassError('Passwords do not match'); return }
    setPassLoading(true)
    const { error } = await supabase.auth.updateUser({ password: newPass })
    if (error) { setPassError(error.message); setPassLoading(false); return }
    const { data: { user: u } } = await supabase.auth.getUser()
    await supabase.from('profiles').update({ must_change_password: false }).eq('id', u.id)
    setPassLoading(false)
    navigate('/')
  }

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #f5f4f0)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img src={isDark ? "/logo-dark.png" : "/logo.png"} alt="City Construction" style={{ height: 90, display: 'block', margin: '0 auto', objectFit: 'contain', filter: isDark ? 'none' : 'brightness(0)' }} />
        </div>

        <div style={{ background: 'var(--surface, #fff)', border: '1px solid var(--border, #e2e0d8)', borderRadius: 12, padding: 28, borderTop: '3px solid #448a40' }}>

          {step === 'login' && (
            <>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, color: 'var(--text, #1c1b18)' }}>Sign in</h2>
              <p style={{ color: 'var(--text2, #808080)', fontSize: 13, marginBottom: 20 }}>Access the City Construction CRM</p>
              <form onSubmit={handleLogin}>
                <div style={{ marginBottom: 14 }}>
                  <label>Email address</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@cltd.co.uk" required autoFocus />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label>Password</label>
                  <PasswordInput value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
                </div>
                {error && <div style={{ background: 'var(--red-bg, #FCEBEB)', color: 'var(--red, #A32D2D)', border: '1px solid var(--red-border, #F7C1C1)', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 14 }}>{error}</div>}
                <button type="submit" style={{ width: '100%', padding: '11px 0', background: '#448a40', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: loading ? .7 : 1 }} disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign in'}
                </button>
              </form>
            </>
          )}

          {step === '2fa' && (
            <>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>🔐</div>
                <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, color: 'var(--text, #1c1b18)' }}>Two-factor authentication</h2>
                <p style={{ color: 'var(--text2, #808080)', fontSize: 13 }}>Enter the 6-digit code from your authenticator app</p>
              </div>
              <form onSubmit={handle2FA}>
                <div style={{ marginBottom: 20 }}>
                  <label>6-Digit Code</label>
                  <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000"
                    style={{ fontSize: 24, letterSpacing: '0.4em', textAlign: 'center', fontFamily: 'monospace' }} autoFocus maxLength={6} />
                </div>
                {error && <div style={{ background: 'var(--red-bg, #FCEBEB)', color: 'var(--red, #A32D2D)', border: '1px solid var(--red-border, #F7C1C1)', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 14 }}>{error}</div>}
                <button type="submit" style={{ width: '100%', padding: '11px 0', background: '#448a40', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: loading ? .7 : 1 }} disabled={loading || code.length !== 6}>
                  {loading ? 'Verifying...' : 'Verify'}
                </button>
                <button type="button" onClick={() => { setStep('login'); setCode(''); setError('') }} style={{ width: '100%', marginTop: 8, padding: '8px 0', background: 'none', border: 'none', color: 'var(--text2, #808080)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                  ← Back to login
                </button>
              </form>
            </>
          )}

          {step === 'change_password' && (
            <>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>🔑</div>
                <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, color: 'var(--text, #1c1b18)' }}>Create your password</h2>
                <p style={{ color: 'var(--text2, #808080)', fontSize: 13 }}>You are using a temporary password. Please create a new secure password to continue.</p>
              </div>
              <form onSubmit={handleChangePassword}>
                <div style={{ marginBottom: 14 }}>
                  <label>New Password</label>
                  <PasswordInput value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="Min. 8 characters" autoFocus required />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label>Confirm Password</label>
                  <PasswordInput value={confirmPass} onChange={e => setConfirmPass(e.target.value)} placeholder="Repeat new password" required />
                </div>
                {newPass && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                    {[
                      { label: '8+ chars', ok: newPass.length >= 8 },
                      { label: 'Uppercase', ok: /[A-Z]/.test(newPass) },
                      { label: 'Number', ok: /[0-9]/.test(newPass) },
                      { label: 'Matches', ok: newPass === confirmPass && confirmPass.length > 0 },
                    ].map(r => (
                      <span key={r.label} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: r.ok ? '#e8f5e7' : 'var(--surface2, #f5f4f0)', color: r.ok ? '#448a40' : '#9C9A94', fontWeight: 500 }}>
                        {r.ok ? '✓' : '○'} {r.label}
                      </span>
                    ))}
                  </div>
                )}
                {passError && <div style={{ background: 'var(--red-bg, #FCEBEB)', color: 'var(--red, #A32D2D)', border: '1px solid var(--red-border, #F7C1C1)', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 14 }}>{passError}</div>}
                <button type="submit" style={{ width: '100%', padding: '11px 0', background: '#448a40', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: passLoading ? .7 : 1 }} disabled={passLoading || newPass.length < 8 || newPass !== confirmPass}>
                  {passLoading ? 'Saving...' : 'Set New Password & Continue'}
                </button>
              </form>
            </>
          )}
        </div>

        {step !== 'change_password' && (
          <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text3, #9C9A94)', marginTop: 16 }}>Contact your administrator to create an account.</p>
        )}
      </div>
    </div>
  )
}
