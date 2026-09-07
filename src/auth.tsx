import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getCsrfToken } from './csrf'

export type User = { id: string; email: string; name: string; role: string }

type AuthContextValue = {
  user: User | null
  status: 'loading' | 'authenticated' | 'unauthenticated'
  error: string
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, name: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function parseJson(response: Response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me', { credentials: 'include' })
      .then(async (response) => {
        if (cancelled) return
        if (response.ok) {
          setUser(await response.json())
          setStatus('authenticated')
        } else {
          setStatus('unauthenticated')
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('unauthenticated')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    setError('')
    const csrfToken = await getCsrfToken()
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ email, password }),
    })
    const body = await parseJson(response)
    if (!response.ok) {
      setError(body?.error ?? 'Impossible de se connecter')
      throw new Error(body?.error ?? 'Impossible de se connecter')
    }
    setUser(body)
    setStatus('authenticated')
  }, [])

  const register = useCallback(async (email: string, password: string, name: string) => {
    setError('')
    const csrfToken = await getCsrfToken()
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ email, password, name }),
    })
    const body = await parseJson(response)
    if (!response.ok) {
      setError(body?.error ?? 'Impossible de créer le compte')
      throw new Error(body?.error ?? 'Impossible de créer le compte')
    }
    setUser(body)
    setStatus('authenticated')
  }, [])

  const logout = useCallback(async () => {
    const csrfToken = await getCsrfToken()
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-csrf-token': csrfToken },
    })
    setUser(null)
    setStatus('unauthenticated')
  }, [])

  return (
    <AuthContext.Provider value={{ user, status, error, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
