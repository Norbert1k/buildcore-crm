import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { useNavigate } from 'react-router-dom'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) setError(error.message)
    else navigate('/')
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
    }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 48, height: 48, background: 'var(--accent)', borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px'
          }}>
            <svg width="26" height="26" viewBox="0 0 16 16" fill="#fff">
              <path d="M2 14V6l6-4 6 4v8H2zm4-1h4V9H6v4z" />
            </svg>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>BuildCore CRM</h1>
          <p style={{ color: 'var(--text2)', fontSize: 13 }}>Sign in to your account</p>
        </div>

        <div className="card card-pad">
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <label>Email address</label>
              <input
                type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com" required autoFocus
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label>Password</label>
              <input
                type="password" value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required
              />
            </div>
            {error && (
              <div style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red-border)', borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 13, marginBottom: 14 }}>
                {error}
              </div>
            )}
            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '10px 0' }} disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text3)', marginTop: 20 }}>
          Contact your administrator to create an account.
        </p>
      </div>
    </div>
  )
}
