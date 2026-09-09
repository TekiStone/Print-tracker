import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSettings } from '../src/api'
import { LoginPage } from '../src/LoginPage'
import { useAuth } from '../src/auth'

vi.mock('../src/auth', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../src/api', () => ({
  getSettings: vi.fn(),
}))

describe('page de connexion', () => {
  const login = vi.fn()
  const register = vi.fn()

  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      status: 'unauthenticated',
      error: '',
      login,
      register,
      logout: vi.fn(),
    })
    vi.mocked(getSettings).mockResolvedValue({ registrationEnabled: true, localLoginEnabled: true, authentikEnabled: false })
  })

  it('connecte un utilisateur avec email et mot de passe', async () => {
    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'atelier@example.test' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'mot-de-passe-valide' } })
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))

    await waitFor(() => expect(login).toHaveBeenCalledWith('atelier@example.test', 'mot-de-passe-valide'))
  })

  it('bascule en inscription puis crée un compte', async () => {
    render(<LoginPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Pas encore de compte ? S’inscrire' }))
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Atelier' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'atelier@example.test' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'mot-de-passe-valide' } })
    fireEvent.click(screen.getByRole('button', { name: 'S’inscrire' }))

    await waitFor(() => expect(register).toHaveBeenCalledWith('atelier@example.test', 'mot-de-passe-valide', 'Atelier'))
  })

  it('affiche une erreur métier après un échec', async () => {
    login.mockRejectedValueOnce(new Error('Email ou mot de passe incorrect'))
    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'atelier@example.test' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'mauvais-mot-de-passe' } })
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))

    expect(await screen.findByText('Email ou mot de passe incorrect')).toBeInTheDocument()
  })

  it('masque le formulaire quand la connexion locale est désactivée', async () => {
    vi.mocked(getSettings).mockResolvedValue({ registrationEnabled: true, localLoginEnabled: false, authentikEnabled: false })
    render(<LoginPage />)

    expect(await screen.findByText('La connexion par mot de passe est désactivée. Contacte un administrateur.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })

  it('masque la bascule d’inscription quand elle est désactivée', async () => {
    vi.mocked(getSettings).mockResolvedValue({ registrationEnabled: false, localLoginEnabled: true, authentikEnabled: false })
    render(<LoginPage />)

    await waitFor(() => expect(getSettings).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Pas encore de compte ? S’inscrire' })).not.toBeInTheDocument()
  })
})
