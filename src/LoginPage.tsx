import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { getSettings, type AppSettings } from './api'
import { useAuth } from './auth'

const defaultSettings: AppSettings = { registrationEnabled: true, localLoginEnabled: true, authentikEnabled: false, authentikConfigured: false }

const authErrorMessages: Record<string, string> = {
  disabled: 'La connexion Authentik est désactivée.',
  no_email: 'Ton compte Authentik doit avoir un email pour se connecter ici.',
}

export function LoginPage() {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)

  useEffect(() => {
    let cancelled = false
    getSettings()
      .then((loaded) => {
        if (!cancelled) setSettings(loaded)
      })
      .catch(() => {
        // Garde les valeurs par défaut si le chargement échoue
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const authError = new URLSearchParams(window.location.search).get('authError')
    if (authError) {
      setError(authErrorMessages[authError] ?? 'Connexion Authentik impossible')
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  useEffect(() => {
    if (!settings.registrationEnabled && mode === 'register') setMode('login')
  }, [mode, settings.registrationEnabled])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      if (mode === 'login') {
        await login(email, password)
      } else {
        await register(email, password, name)
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Une erreur est survenue')
    } finally {
      setIsSubmitting(false)
    }
  }

  const authentikButton = settings.authentikEnabled && (
    <button type="button" className="primary-button auth-submit" onClick={() => { window.location.href = '/auth/login' }}>
      Continuer avec Authentik
    </button>
  )

  if (!settings.localLoginEnabled) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="brand"><div className="brand-mark">P</div><span>print<span>tracker</span></span></div>
          <h1>Connexion</h1>
          {error && <p className="auth-error">{error}</p>}
          {authentikButton}
          {!authentikButton && <p className="subtitle">La connexion par mot de passe est désactivée. Contacte un administrateur.</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand"><div className="brand-mark">P</div><span>print<span>tracker</span></span></div>
        <h1>{mode === 'login' ? 'Connexion' : 'Créer un compte'}</h1>
        <p className="subtitle">{mode === 'login' ? 'Accède à ton atelier d’impression.' : 'Suis tes imprimantes et tes bobines en quelques secondes.'}</p>

        {mode === 'register' && (
          <label>Nom
            <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex. Thomas" autoComplete="name" />
          </label>
        )}
        <label>Email
          <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="toi@exemple.com" autoComplete="email" />
        </label>
        <label>Mot de passe
          <input required type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8 caractères minimum" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </label>

        {error && <p className="auth-error">{error}</p>}

        <button type="submit" className="primary-button auth-submit" disabled={isSubmitting}>
          {isSubmitting ? 'Un instant…' : mode === 'login' ? 'Se connecter' : 'S’inscrire'}
        </button>

        {settings.registrationEnabled && (
          <button type="button" className="text-button auth-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
            {mode === 'login' ? 'Pas encore de compte ? S’inscrire' : 'Déjà un compte ? Se connecter'}
          </button>
        )}

        {authentikButton}
      </form>
    </div>
  )
}
