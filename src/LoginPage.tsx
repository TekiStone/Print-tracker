import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from './auth'

export function LoginPage() {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

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

        <button type="button" className="text-button auth-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
          {mode === 'login' ? 'Pas encore de compte ? S’inscrire' : 'Déjà un compte ? Se connecter'}
        </button>
      </form>
    </div>
  )
}
