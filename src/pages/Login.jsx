import { useState, useEffect } from 'react'
import { useAuth } from '../lib/auth'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import logoWhite from '../assets/brand/logo_white.png'
import markWhite from '../assets/brand/mark_white.png'

export default function Login() {
  const { signIn, signOut, markMfaVerified, user } = useAuth()
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
  // Pre-login division choice (Construction / Fit-Out). Persisted; validated
  // after sign-in by the auth provider against the divisions the account
  // actually holds — a single-division user lands in their division
  // regardless of the card picked here.
  const [chosenDivision, setChosenDivision] = useState(() => localStorage.getItem('ccg_division_choice') || 'construction')
  function pickDivision(d) {
    setChosenDivision(d)
    localStorage.setItem('ccg_division_choice', d)
  }

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

  async function switchAccount() {
    try { await signOut() } catch { /* already signed out */ }
    setCode(''); setError(''); setFactorId(''); setStep('login')
  }

  const fitout = chosenDivision === 'fitout'
  const errBox = msg => msg && <div className="lg-err">{msg}</div>

  return (
    <div className={`lg-page${fitout ? ' fitout' : ''}`}>
      <img src={markWhite} alt="" aria-hidden="true" className="lg-mark" />
      <img src={markWhite} alt="" aria-hidden="true" className="lg-mark lg-mark-2" />

      <div className="lg-wrap">
        <img src={logoWhite} alt="City Construction" className="lg-logo" />

        <div className="lg-card">
          {step === 'login' && (
            <>
              <h1 className="lg-h">Welcome back</h1>
              <p className="lg-sub">Sign in to BuildCore to continue.</p>

              {/* Division chooser — Construction / Fit-Out */}
              <div className="lg-seg" role="tablist" aria-label="Division">
                <button type="button" role="tab" aria-selected={!fitout} className={!fitout ? 'on' : ''} onClick={() => pickDivision('construction')}><i />Construction</button>
                <button type="button" role="tab" aria-selected={fitout} className={fitout ? 'on' : ''} onClick={() => pickDivision('fitout')}><i className="t" />Fit-Out</button>
              </div>

              <form onSubmit={handleLogin}>
                <label className="lg-lbl" htmlFor="lg-email">Email address</label>
                <div className="lg-field">
                  <IconMail />
                  <input id="lg-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@cltd.co.uk" autoComplete="username" required autoFocus />
                </div>
                <label className="lg-lbl" htmlFor="lg-pass">Password</label>
                <Secret id="lg-pass" value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" autoComplete="current-password" />
                {errBox(error)}
                <button type="submit" className="lg-btn" disabled={loading}>
                  {loading ? 'Signing in…' : <>Sign in <IconArrow /></>}
                </button>
              </form>
              <div className="lg-secure"><IconShield />Secure sign-in · two-factor protected</div>
            </>
          )}

          {step === '2fa' && (
            <>
              <div className="lg-badge"><IconPhone /></div>
              <h1 className="lg-h center">Two-step verification</h1>
              <p className="lg-sub center">Enter the 6-digit code from your authenticator app{user?.email ? <> for <b>{user.email}</b></> : ''}.</p>
              <form onSubmit={handle2FA}>
                <Otp value={code} onChange={v => { setCode(v); setError('') }} />
                {errBox(error)}
                <button type="submit" className="lg-btn" disabled={loading || code.length !== 6}>
                  {loading ? 'Verifying…' : <>Verify and continue <IconArrow /></>}
                </button>
              </form>
              <button type="button" className="lg-link" onClick={switchAccount}>Not you? <b>Sign in with a different account</b></button>
              <div className="lg-secure"><IconShield />Codes refresh every 30 seconds</div>
            </>
          )}

          {step === 'change_password' && (
            <>
              <div className="lg-badge"><IconKey /></div>
              <h1 className="lg-h center">Create your password</h1>
              <p className="lg-sub center">You're using a temporary password. Choose a new one to continue.</p>
              <form onSubmit={handleChangePassword}>
                <label className="lg-lbl">New password</label>
                <Secret value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" autoFocus />
                <label className="lg-lbl">Confirm password</label>
                <Secret value={confirmPass} onChange={e => setConfirmPass(e.target.value)} placeholder="Repeat new password" autoComplete="new-password" />
                {newPass && (
                  <div className="lg-rules">
                    {[
                      { label: '8+ characters', ok: newPass.length >= 8 },
                      { label: 'Uppercase', ok: /[A-Z]/.test(newPass) },
                      { label: 'Number', ok: /[0-9]/.test(newPass) },
                      { label: 'Matches', ok: newPass === confirmPass && confirmPass.length > 0 },
                    ].map(r => <span key={r.label} className={r.ok ? 'ok' : ''}>{r.ok ? '✓' : '○'} {r.label}</span>)}
                  </div>
                )}
                {errBox(passError)}
                <button type="submit" className="lg-btn" disabled={passLoading || newPass.length < 8 || newPass !== confirmPass}>
                  {passLoading ? 'Saving…' : <>Set password and continue <IconArrow /></>}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="lg-foot">
          {step === 'login' && <>Need an account? Contact your administrator.<br /></>}
          City Construction Group Ltd · One Canada Square, Canary Wharf, London
        </p>
      </div>
    </div>
  )
}

// Password field with lock icon and show / hide
function Secret({ value, onChange, placeholder, autoComplete, autoFocus, id }) {
  const [show, setShow] = useState(false)
  return (
    <div className="lg-field">
      <IconLock />
      <input id={id} type={show ? 'text' : 'password'} value={value} onChange={onChange} placeholder={placeholder} autoComplete={autoComplete} autoFocus={autoFocus} required />
      <button type="button" className="lg-eye" onClick={() => setShow(v => !v)} tabIndex={-1} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <IconEyeOff /> : <IconEye />}</button>
    </div>
  )
}

// Six boxes over one real input, so typing, pasting and phone autofill all work
function Otp({ value, onChange }) {
  const [focus, setFocus] = useState(true)
  return (
    <div className="lg-otp">
      <input value={value} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus aria-label="6-digit code"
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} />
      {[0, 1, 2, 3, 4, 5].map(i => (
        <span key={i} className={`${i === 3 ? 'gap ' : ''}${focus && i === Math.min(value.length, 5) ? 'on' : ''}`}>{value[i] || ''}</span>
      ))}
    </div>
  )
}

const I = ({ children }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
const IconMail = () => <I><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></I>
const IconLock = () => <I><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></I>
const IconEye = () => <I><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></I>
const IconEyeOff = () => <I><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></I>
const IconShield = () => <I><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></I>
const IconArrow = () => <I><path d="M5 12h14M13 6l6 6-6 6" /></I>
const IconPhone = () => <I><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10.5 18.5h3" /><path d="m9.5 11 2 2 3.5-3.5" /></I>
const IconKey = () => <I><circle cx="8" cy="15" r="4" /><path d="m10.8 12.2 8.2-8.2M16 7l3 3M14 9l2 2" /></I>
