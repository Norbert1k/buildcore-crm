import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState('login') // login | 2fa
  const [factorId, setFactorId] = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) { setError(error.message); return }

    // Check if 2FA is required
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (data?.nextLevel === 'aal2' && data?.nextLevel !== data?.currentLevel) {
      // Get factors to find the factorId
      const { data: factorsData } = await supabase.auth.mfa.listFactors()
      const totp = factorsData?.totp?.[0]
      if (totp) {
        setFactorId(totp.id)
        setStep('2fa')
        return
      }
    }
    navigate('/')
  }

  async function handle2FA(e) {
    e.preventDefault()
    if (!code || code.length !== 6) { setError('Please enter the 6-digit code'); return }
    setError('')
    setLoading(true)
    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
    if (challengeError) { setError(challengeError.message); setLoading(false); return }
    const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challengeData.id, code })
    setLoading(false)
    if (verifyError) { setError('Incorrect code — please try again'); return }
    navigate('/')
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ background: '#448a40', borderRadius: 16, padding: '16px 24px', display: 'inline-block', marginBottom: 20 }}>
            <img src="/logo.png" alt="City Construction" style={{ height: 70, display: 'block', objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
          </div>
        </div>

        <div style={{ background: '#fff', border: '1px solid #e2e0d8', borderRadius: 12, padding: 28, borderTop: '3px solid #448a40' }}>

          {/* Step 1 — Email & Password */}
          {step === 'login' && (
            <>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Sign in</h2>
              <p style={{ color: '#808080', fontSize: 13, marginBottom: 20 }}>Access the City Construction CRM</p>
              <form onSubmit={handleLogin}>
                <div style={{ marginBottom: 14 }}>
                  <label>Email address</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@cltd.co.uk" required autoFocus />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label>Password</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
                </div>
                {error && <div style={{ background: '#FCEBEB', color: '#A32D2D', border: '1px solid #F7C1C1', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 14 }}>{error}</div>}
                <button type="submit" style={{ width: '100%', justifyContent: 'center', padding: '11px 0', background: '#448a40', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: loading ? .7 : 1 }} disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign in'}
                </button>
              </form>
            </>
          )}

          {/* Step 2 — 2FA code */}
          {step === '2fa' && (
            <>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>🔐</div>
                <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Two-factor authentication</h2>
                <p style={{ color: '#808080', fontSize: 13 }}>Open your authenticator app and enter the 6-digit code for City Construction CRM</p>
              </div>
              <form onSubmit={handle2FA}>
                <div style={{ marginBottom: 20 }}>
                  <label>6-Digit Code</label>
                  <input
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    style={{ fontSize: 24, letterSpacing: '0.4em', textAlign: 'center', fontFamily: 'monospace' }}
                    autoFocus maxLength={6}
                  />
                </div>
                {error && <div style={{ background: '#FCEBEB', color: '#A32D2D', border: '1px solid #F7C1C1', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 14 }}>{error}</div>}
                <button type="submit" style={{ width: '100%', padding: '11px 0', background: '#448a40', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: loading ? .7 : 1 }} disabled={loading || code.length !== 6}>
                  {loading ? 'Verifying...' : 'Verify'}
                </button>
                <button type="button" onClick={() => { setStep('login'); setCode(''); setError('') }} style={{ width: '100%', marginTop: 8, padding: '8px 0', background: 'none', border: 'none', color: '#808080', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                  ← Back to login
                </button>
              </form>
            </>
          )}
        </div>
        <p style={{ textAlign: 'center', fontSize: 12, color: '#9C9A94', marginTop: 16 }}>Contact your administrator to create an account.</p>
      </div>
    </div>
  )
}
