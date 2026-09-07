import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'

function mockFetch(authEnabled = false, authenticated = false) {
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({
    ok: true,
    json: async () => url === '/auth/config'
      ? { enabled: authEnabled, oidc: false }
      : { authenticated, user: authenticated ? { username: 'Thomas' } : null },
  })))
}

describe('application React', () => {
  it('charge le tableau de bord et navigue vers les bobines', async () => {
    mockFetch()
    render(<App />)

    await waitFor(() => expect(screen.getByText('Bonjour Thomas')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Bobines/ }))

    expect(screen.getByRole('heading', { name: 'Tes bobines' })).toBeInTheDocument()
  })

  it('affiche la connexion et permet de basculer vers l’inscription', async () => {
    mockFetch(true)
    render(<App />)

    expect(await screen.findByText('Connecte-toi pour accéder à ton atelier.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Créer un compte' }))

    expect(screen.getByRole('heading', { name: 'Créer ton compte' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nom utilisateur')).toBeInTheDocument()
  })
})
