import { useState, FormEvent } from 'react'
import { api } from '../api'
import { useAuth } from '../contexts/AuthContext'

type Mode = 'signin' | 'signup'

const ERROR_MESSAGES: Record<string, string> = {
    'invalid-credentials':      'Invalid email or password.',
    'email-not-verified':       'Please verify your email before signing in.',
    'email-already-registered': 'An account with this email already exists.',
    'password-too-short':       'Password must be at least 8 characters.',
    'missing-fields':           'Please fill in all fields.',
}

export default function Login() {
    const { checkAuth } = useAuth()
    const [mode, setMode] = useState<Mode>('signin')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [pendingVerification, setPendingVerification] = useState(false)

    const switchMode = (m: Mode) => { setMode(m); setError(''); setPendingVerification(false) }

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault()
        if (!email || !password) { setError('Please fill in all fields.'); return }
        setLoading(true); setError('')
        try {
            const endpoint = mode === 'signin' ? '/auth/login' : '/auth/register'
            await api.post(endpoint, new URLSearchParams({ email, password }))
            if (mode === 'signup') {
                setPendingVerification(true)
            } else {
                await checkAuth()
            }
        } catch (err: any) {
            const key = err.message
            setError(ERROR_MESSAGES[key] ?? (mode === 'signin' ? 'Invalid email or password.' : 'Registration failed.'))
        } finally {
            setLoading(false)
        }
    }

    if (pendingVerification) return (
        <div className="login-page">
            <div className="login-card">
                <div className="login-logo">✉</div>
                <h1 className="login-title">Check your email</h1>
                <p className="login-subtitle" style={{ textAlign: 'center', marginBottom: 8 }}>
                    We sent a verification link to <strong>{email}</strong>.<br />
                    Click it to activate your account.
                </p>
                <p className="login-subtitle">The link expires in 24 hours.</p>
                <button className="link-btn" style={{ marginTop: 8 }} onClick={() => switchMode('signin')}>
                    Back to sign in
                </button>
            </div>
        </div>
    )

    return (
        <div className="login-page">
            <div className="login-card">
                <div className="login-logo">♪</div>
                <h1 className="login-title">
                    {mode === 'signin' ? 'Sign in to FretFlow' : 'Create an account'}
                </h1>
                <p className="login-subtitle">Convert MIDI files to Guitar Pro tabs with FretFlow</p>

                {mode === 'signin' && (
                    <button className="login-google-btn" onClick={() => { window.location.href = '/api/auth/google' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                        Sign in with Google
                    </button>
                )}

                {mode === 'signin' && <div className="login-separator">or</div>}

                <form className="login-form" onSubmit={handleSubmit}>
                    <div className="field">
                        <label className="field-label">Email</label>
                        <input
                            className="input"
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            autoComplete="username"
                            placeholder="you@example.com"
                        />
                    </div>

                    <div className="field">
                        <label className="field-label">Password</label>
                        <input
                            className="input"
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                            placeholder="••••••••"
                        />
                    </div>

                    {error && <p className="input-error">{error}</p>}

                    <button className="btn btn-primary login-submit" type="submit" disabled={loading}>
                        {loading
                            ? (mode === 'signin' ? 'Signing in…' : 'Creating account…')
                            : (mode === 'signin' ? 'Sign in' : 'Create account')}
                    </button>
                </form>

                <div className="login-switch">
                    {mode === 'signin' ? (
                        <>No account? <button className="link-btn" onClick={() => switchMode('signup')}>Sign up</button></>
                    ) : (
                        <>Already have an account? <button className="link-btn" onClick={() => switchMode('signin')}>Sign in</button></>
                    )}
                </div>
            </div>
        </div>
    )
}
