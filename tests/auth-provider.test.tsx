import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '../src/auth'

function Probe() {
  const { error, login, logout, register, status, user } = useAuth()
  return (
    <div>
      <p>{status}</p>
      <p>{user?.name ?? 'aucun utilisateur'}</p>
      {error && <p>{error}</p>}
      <button type="button" onClick={() => void login('atelier@example.test', 'mot-de-passe').catch(() => undefined)}>login</button>
      <button type="button" onClick={() => void register('new@example.test', 'mot-de-passe', 'Nouveau').catch(() => undefined)}>register</button>
      <button type="button" onClick={() => void logout().catch(() => undefined)}>logout</button>
    </div>
  )
}

function renderProbe() {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )
}

describe('AuthProvider', () => {
  it('restaure une session existante', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'user-1', email: 'atelier@example.test', name: 'Atelier', role: 'admin' })))

    renderProbe()

    expect(await screen.findByText('authenticated')).toBeInTheDocument()
    expect(screen.getByText('Atelier')).toBeInTheDocument()
  })

  it('passe en non authentifié quand la session API est absente', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Not authenticated' }, { status: 401 })))

    renderProbe()

    expect(await screen.findByText('unauthenticated')).toBeInTheDocument()
    expect(screen.getByText('aucun utilisateur')).toBeInTheDocument()
  })

  it('connecte, inscrit et déconnecte avec jeton CSRF', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'Not authenticated' }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ token: 'csrf-login' }))
      .mockResolvedValueOnce(Response.json({ id: 'user-1', email: 'atelier@example.test', name: 'Atelier', role: 'admin' }))
      .mockResolvedValueOnce(Response.json({ token: 'csrf-register' }))
      .mockResolvedValueOnce(Response.json({ id: 'user-2', email: 'new@example.test', name: 'Nouveau', role: 'member' }))
      .mockResolvedValueOnce(Response.json({ token: 'csrf-logout' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })))
    renderProbe()

    await screen.findByText('unauthenticated')
    fireEvent.click(screen.getByRole('button', { name: 'login' }))
    expect(await screen.findByText('Atelier')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'register' }))
    expect(await screen.findByText('Nouveau')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'logout' }))
    await waitFor(() => expect(screen.getByText('aucun utilisateur')).toBeInTheDocument())

    expect(fetch).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'csrf-login' },
    }))
    expect(fetch).toHaveBeenCalledWith('/api/auth/register', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'csrf-register' },
    }))
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({
      method: 'POST',
      headers: { 'x-csrf-token': 'csrf-logout' },
    }))
  })

  it('déconnecte localement même si l’appel réseau de déconnexion échoue', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ id: 'user-1', email: 'atelier@example.test', name: 'Atelier', role: 'admin' }))
      .mockRejectedValueOnce(new Error('Network error')))
    renderProbe()

    expect(await screen.findByText('Atelier')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'logout' }))

    await waitFor(() => expect(screen.getByText('unauthenticated')).toBeInTheDocument())
    expect(screen.getByText('aucun utilisateur')).toBeInTheDocument()
  })

  it('expose le message serveur quand la connexion échoue', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'Not authenticated' }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ token: 'csrf-token' }))
      .mockResolvedValueOnce(Response.json({ error: 'Email ou mot de passe incorrect' }, { status: 401 })))
    renderProbe()

    await screen.findByText('unauthenticated')
    fireEvent.click(screen.getByRole('button', { name: 'login' }))

    expect(await screen.findByText('Email ou mot de passe incorrect')).toBeInTheDocument()
  })

  it('utilise les messages de secours si les réponses auth sont invalides', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => { throw new Error('invalid json') } } as Response)
      .mockResolvedValueOnce(Response.json({ token: 'csrf-token' }))
      .mockResolvedValueOnce({ ok: false, json: async () => { throw new Error('invalid json') } } as Response))
    renderProbe()

    expect(await screen.findByText('unauthenticated')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'login' }))
    expect(await screen.findByText('Impossible de se connecter')).toBeInTheDocument()
  })

  it('ignore une réponse de session après démontage', async () => {
    let resolveRequest!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveRequest = resolve })))
    const { unmount } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    unmount()
    resolveRequest(Response.json({ id: 'user-1', email: 'x@y.test', name: 'Late', role: 'member' }))
    await Promise.resolve()
    expect(screen.queryByText('Late')).not.toBeInTheDocument()
  })

  it('passe en non authentifié sur une erreur réseau et affiche l’erreur d’inscription', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(Response.json({ token: 'csrf-token' }))
      .mockResolvedValueOnce(Response.json({ error: 'Email déjà utilisé' }, { status: 409 })))
    renderProbe()

    expect(await screen.findByText('unauthenticated')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'register' }))
    expect(await screen.findByText('Email déjà utilisé')).toBeInTheDocument()
  })

  it('protège le hook hors provider', () => {
    function BrokenProbe() {
      useAuth()
      return null
    }

    expect(() => render(<BrokenProbe />)).toThrow('useAuth must be used within an AuthProvider')
  })
})
