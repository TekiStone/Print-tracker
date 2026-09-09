import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminPage } from '../src/AdminPage'
import { deleteUser, getSettings, listUsers, updateSettings, updateUserRole } from '../src/api'
import { useAuth } from '../src/auth'

vi.mock('../src/api', () => ({
  deleteUser: vi.fn(),
  getSettings: vi.fn(),
  listUsers: vi.fn(),
  updateSettings: vi.fn(),
  updateUserRole: vi.fn(),
}))

vi.mock('../src/auth', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../src/PrintersPage', () => ({
  PrintersPage: () => <div>Écran imprimantes</div>,
}))

vi.mock('../src/SpoolsPage', () => ({
  SpoolsPage: () => <div>Écran bobines</div>,
}))

const admin = { id: 'user-1', email: 'admin@example.test', name: 'Admin', role: 'admin', authProvider: 'local', createdAt: '2026-01-01T00:00:00Z' }
const member = { id: 'user-2', email: 'member@example.test', name: 'Camille', role: 'member', authProvider: 'local', createdAt: '2026-01-02T00:00:00Z' }
const settings = { registrationEnabled: true, localLoginEnabled: true, authentikEnabled: false }

describe('page administration', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-1', email: 'admin@example.test', name: 'Admin', role: 'admin' },
      status: 'authenticated',
      error: '',
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    })
    vi.mocked(listUsers).mockResolvedValue([admin, member])
    vi.mocked(getSettings).mockResolvedValue(settings)
  })

  it('affiche les utilisateurs et empêche la suppression de son propre compte', async () => {
    render(<AdminPage />)

    expect(await screen.findByText('Admin')).toBeInTheDocument()
    expect(screen.getByText('Camille')).toBeInTheDocument()

    const deleteButtons = screen.getAllByRole('button', { name: 'Supprimer' })
    expect(deleteButtons[0]).toBeDisabled()
    expect(deleteButtons[1]).not.toBeDisabled()
  })

  it('promeut un membre en administrateur', async () => {
    vi.mocked(updateUserRole).mockResolvedValue({ ...member, role: 'admin' })
    render(<AdminPage />)

    await screen.findByText('Camille')
    fireEvent.click(screen.getByRole('button', { name: 'Promouvoir admin' }))

    await waitFor(() => expect(updateUserRole).toHaveBeenCalledWith('user-2', 'admin'))
  })

  it('supprime un utilisateur après confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(deleteUser).mockResolvedValue(undefined)
    render(<AdminPage />)

    await screen.findByText('Camille')
    const deleteButtons = screen.getAllByRole('button', { name: 'Supprimer' })
    fireEvent.click(deleteButtons[1])

    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith('user-2'))
  })

  it('bascule un paramètre depuis l’onglet Paramètres', async () => {
    vi.mocked(updateSettings).mockResolvedValue({ ...settings, registrationEnabled: false })
    render(<AdminPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Paramètres' }))
    const checkboxes = await screen.findAllByRole('checkbox')
    fireEvent.click(checkboxes[0])

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ registrationEnabled: false }))
  })

  it('affiche la ligne Authentik désactivée', async () => {
    render(<AdminPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Paramètres' }))
    await screen.findByText('Bientôt disponible')

    const checkboxes = await screen.findAllByRole('checkbox')
    expect(checkboxes[2]).toBeDisabled()
  })

  it('affiche les écrans imprimantes et bobines réutilisés', async () => {
    render(<AdminPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Imprimantes' }))
    expect(await screen.findByText('Écran imprimantes')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Bobines' }))
    expect(await screen.findByText('Écran bobines')).toBeInTheDocument()
  })
})
