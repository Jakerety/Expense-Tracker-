import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { isSupabaseConfigured, missingSupabaseSettings, supabase } from '../../lib/supabase'

type AuthMode = 'sign-in' | 'sign-up' | 'recovery' | 'new-password'

interface AuthPageProps {
  onAuthenticated: () => void
  onDemoAccess: () => void
}

const modeLabels: Record<AuthMode, string> = {
  'sign-in': 'Sign in',
  'sign-up': 'Create account',
  recovery: 'Reset password',
  'new-password': 'Choose a new password',
}

interface AuthPagePropsWithRecovery extends AuthPageProps {
  initialMode?: AuthMode
  onPasswordUpdated: () => void
}

export function AuthPage({ onAuthenticated, onDemoAccess, initialMode = 'sign-in', onPasswordUpdated }: AuthPagePropsWithRecovery) {
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [workspaceType, setWorkspaceType] = useState<'personal' | 'organization'>('personal')
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [showPasswords, setShowPasswords] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')

    try {
      if (!supabase) throw new Error('Authentication needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.')
      const values = new FormData(event.currentTarget)
      const email = String(values.get('email') ?? '').trim()
      const password = String(values.get('password') ?? '')

      if (mode === 'new-password') {
        const confirmation = String(values.get('confirmation') ?? '')
        if (password !== confirmation) throw new Error('Passwords do not match.')
        const { error: authError } = await supabase.auth.updateUser({ password })
        if (authError) throw authError
        onPasswordUpdated()
        navigate('/', { replace: true })
      } else if (mode === 'sign-in') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
        if (authError) throw authError
        onAuthenticated()
        navigate('/', { replace: true })
      } else if (mode === 'sign-up') {
        const fullName = String(values.get('full_name') ?? '').trim()
        const confirmation = String(values.get('password_confirmation') ?? '')
        const organizationName = String(values.get('organization_name') ?? '').trim()
        if (!ageConfirmed) throw new Error('Please confirm that you are 18 or older to create an account.')
        if (password !== confirmation) throw new Error('Passwords do not match.')
        if (workspaceType === 'organization' && !organizationName) throw new Error('Enter your company or organization name.')
        const { error: authError, data } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              workspace_type: workspaceType,
              organization_name: workspaceType === 'organization' ? organizationName : '',
              over_18: true,
            },
          },
        })
        if (authError) throw authError
        if (data.session) {
          onAuthenticated()
          navigate('/', { replace: true })
        } else {
          setMessage('Check your email for a confirmation link to finish creating your account.')
        }
      } else {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
        if (authError) throw authError
        setMessage('Password reset instructions have been sent if that email is registered.')
      }
    } catch (caught) {
      setError(caught instanceof TypeError
        ? 'Cannot reach Supabase Auth. Check the project URL, internet connection, and VITE_SUPABASE settings, then restart the Vite server.'
        : caught instanceof Error ? caught.message : 'Unable to complete this request.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="auth-title">
        <Link to="/" className="brand-block auth-brand auth-brand-link" aria-label="Back to Expense Tracker home">
          <div className="brand-mark" aria-hidden="true"><img src="/ChatGPT%20Image%20Oct%207,%202026,%2002_42_38%20PM.png" alt="" /></div>
          <div><p className="eyebrow">Personal finance</p><h1>Expense Tracker</h1></div>
        </Link>
        <div className="auth-heading">
          <p className="eyebrow">Secure workspace access</p>
          <h2 id="auth-title">{modeLabels[mode]}</h2>
          <p>{mode === 'recovery' ? 'We will send a password reset link to your email.' : mode === 'new-password' ? 'Choose a new password for your account.' : 'Manage your money with a clear view of every workspace.'}</p>
        </div>
        {mode !== 'new-password' && <div className="auth-tabs" role="tablist" aria-label="Account access">
          <button type="button" role="tab" aria-selected={mode === 'sign-in'} className={mode === 'sign-in' ? 'selected' : ''} onClick={() => { setMode('sign-in'); setError(''); setMessage(''); setAgeConfirmed(false) }}>Sign in</button>
          <button type="button" role="tab" aria-selected={mode === 'sign-up'} className={mode === 'sign-up' ? 'selected' : ''} onClick={() => { setMode('sign-up'); setError(''); setMessage(''); setAgeConfirmed(false) }}>Create account</button>
        </div>}
        <form className="auth-form" onSubmit={submit}>
          {mode === 'sign-up' && <label className="field"><span>Full name</span><input name="full_name" type="text" autoComplete="name" minLength={2} maxLength={120} required placeholder="Your name" /></label>}
          {mode !== 'new-password' && <label className="field"><span>Email address</span><input name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></label>}
          {mode === 'sign-up' && <fieldset className="auth-workspace"><legend>What are you setting up?</legend><div className="workspace-choice-grid"><label className={workspaceType === 'personal' ? 'workspace-choice selected' : 'workspace-choice'}><input type="radio" name="workspace_type" value="personal" checked={workspaceType === 'personal'} onChange={() => setWorkspaceType('personal')} /><span>Personal</span></label><label className={workspaceType === 'organization' ? 'workspace-choice selected' : 'workspace-choice'}><input type="radio" name="workspace_type" value="organization" checked={workspaceType === 'organization'} onChange={() => setWorkspaceType('organization')} /><span>Organization</span></label></div></fieldset>}
          {mode === 'sign-up' && workspaceType === 'organization' && <label className="field"><span>Company or organization name</span><input name="organization_name" type="text" autoComplete="organization" minLength={2} maxLength={120} required placeholder="e.g. Acme Ltd" /></label>}
          {mode === 'sign-up' && <label className="auth-checkbox"><input type="checkbox" checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} required /><span>I agree that I am 18 years of age or older.</span></label>}
          {mode !== 'recovery' && <label className="field"><span>Password</span><input name="password" type={showPasswords ? 'text' : 'password'} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} minLength={8} required /><small>Use at least 8 characters.</small></label>}
          {(mode === 'new-password' || mode === 'sign-up') && <label className="field"><span>{mode === 'sign-up' ? 'Confirm password' : 'Confirm new password'}</span><input name={mode === 'sign-up' ? 'password_confirmation' : 'confirmation'} type={showPasswords ? 'text' : 'password'} autoComplete="new-password" minLength={8} required /></label>}
          {(mode === 'sign-in' || mode === 'sign-up' || mode === 'new-password') && <label className="auth-checkbox show-password-checkbox"><input type="checkbox" checked={showPasswords} onChange={(event) => setShowPasswords(event.target.checked)} /><span>Show password</span></label>}
          {mode === 'sign-in' && <button type="button" className="text-button recovery-link" onClick={() => { setMode('recovery'); setError(''); setMessage('') }}>Forgot password?</button>}
          {error && <p className="auth-message error" role="alert">{error}</p>}
          {message && <p className="auth-message success" role="status">{message}</p>}
          <button className="primary-button auth-submit" type="submit" disabled={busy || !isSupabaseConfigured}>{busy ? 'Please wait…' : isSupabaseConfigured ? modeLabels[mode] : 'Supabase credentials required'}</button>
        </form>
        {mode === 'recovery' && <button type="button" className="text-button auth-back" onClick={() => setMode('sign-in')}>Back to sign in</button>}
        {!isSupabaseConfigured && <p className="auth-message setup-message" role="status">Add {missingSupabaseSettings.join(' and ')} to <code>.env</code>, then restart Vite to enable account creation.</p>}
        <div className="demo-access"><span>{isSupabaseConfigured ? 'Having trouble connecting?' : 'Use fictional sample data while configuring Supabase.'}</span><button type="button" className="secondary-button" onClick={onDemoAccess}>Continue with demo data</button></div>
      </section>
      <aside className="auth-aside"><p className="eyebrow">A clear view, every day</p><h2>Your finances, in focus.</h2><p>Track personal and shared spending from one calm, organized workspace.</p><div className="auth-aside-rule" /></aside>
    </main>
  )
}