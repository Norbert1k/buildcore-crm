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
      minHeight: '100vh', background: '#f5f4f0',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img
            src="/logo.png"
            alt="City Construction"
            style={{ height: 90, margin: '0 auto 20px', display: 'block', objectFit: 'contain' }}
          />
        </div>

        <div style={{ background: '#fff', border: '1px solid #e2e0d8', borderRadius: 12, padding: 28, borderTop: '3px solid #448a40' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, color: '#1C1B18' }}>Sign in</h2>
          <p style={{ color: '#808080', fontSize: 13, marginBottom: 20 }}>Access the City Construction CRM</p>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <label>Email address</label>
              <input
                type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@cityconstruction.co.uk" required autoFocus
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
              <div style={{ background: '#FCEBEB', color: '#A32D2D', border: '1px solid #F7C1C1', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 14 }}>
                {error}
              </div>
            )}
            <button
              type="submit"
              style={{ width: '100%', justifyContent: 'center', padding: '11px 0', background: '#448a40', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: loading ? .7 : 1 }}
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#9C9A94', marginTop: 16 }}>
          Contact your administrator to create an account.
        </p>
      </div>
    </div>
  )
}
