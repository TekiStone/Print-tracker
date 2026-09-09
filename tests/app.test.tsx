import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { AuthProvider } from '../src/auth'
import { getSettings, listPrinters, listSpools } from '../src/api'

vi.mock('../src/api', () => ({
  getSettings: vi.fn(),
  listPrinters: vi.fn(),
  listSpools: vi.fn(),
}))

const printers = [
  {
    id: 'printer-1',
    name: 'Prusa XL',
    model: 'XL 5T',
    status: 'printing',
    job: 'benchy.gcode',
    progress: 42,
    color: '#f27852',
    prusalinkEnabled: true,
  },
  {
    id: 'printer-2',
    name: 'Mini',
    model: 'Mini+',
    status: 'offline',
    color: '#315f9c',
    prusalinkEnabled: false,
    lastSyncError: 'timeout',
  },
] as const

const spools = [
  { id: 'spool-1', brand: 'Prusament', material: 'PLA', color: 'Galaxy Black', remaining: 100, initial: 1000, location: 'A1' },
  { id: 'spool-2', brand: 'Polymaker', material: 'PETG', color: 'White', remaining: 900, initial: 1000, location: '' },
]

function renderAuthenticatedApp() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/auth/me') {
      return Response.json({ id: 'user-1', email: 'thomas@example.test', name: 'Thomas', role: 'admin' })
    }
    if (url === '/api/auth/csrf-token') return Response.json({ token: 'csrf-token' })
    if (url === '/api/auth/logout') return new Response(null, { status: 204 })
    return Response.json({ error: 'unexpected call' }, { status: 500 })
  }))

  render(
    <AuthProvider>
      <App />
    </AuthProvider>,
  )
}

describe('application React', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
    vi.mocked(listPrinters).mockResolvedValue([...printers])
    vi.mocked(listSpools).mockResolvedValue(spools)
    vi.mocked(getSettings).mockResolvedValue({ registrationEnabled: true, localLoginEnabled: true, authentikEnabled: false })
  })

  it('charge le tableau de bord depuis l’API et affiche les indicateurs clés', async () => {
    renderAuthenticatedApp()

    expect(await screen.findByText(/Bonjour Thomas/)).toBeInTheDocument()
    expect(screen.getByText('Imprimantes suivies')).toBeInTheDocument()
    expect(await screen.findByText('1 synchro PrusaLink en erreur')).toBeInTheDocument()
    expect(await screen.findByText('benchy.gcode')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByText('1 à surveiller')).toBeInTheDocument()
  })

  it('navigue entre le tableau de bord, les imprimantes et les bobines', async () => {
    renderAuthenticatedApp()

    await screen.findByText(/Bonjour Thomas/)
    fireEvent.click(screen.getByRole('button', { name: /Imprimantes/ }))
    expect(await screen.findByRole('heading', { name: 'Imprimantes' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/printers')

    fireEvent.click(screen.getByRole('button', { name: /Bobines/ }))
    expect(await screen.findByRole('heading', { name: 'Tes bobines' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/spools')
  })

  it('charge la page correspondant à l’URL et suit l’historique du navigateur', async () => {
    window.history.replaceState(null, '', '/printers')
    renderAuthenticatedApp()

    expect(await screen.findByRole('heading', { name: 'Imprimantes' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Bobines/ }))
    expect(await screen.findByRole('heading', { name: 'Tes bobines' })).toBeInTheDocument()

    window.history.back()
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(await screen.findByRole('heading', { name: 'Imprimantes' })).toBeInTheDocument()
  })

  it('affiche la page de connexion quand la session est absente', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Not authenticated' }, { status: 401 })))

    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument()
    expect(screen.getByText('Accède à ton atelier d’impression.')).toBeInTheDocument()
  })

  it('déconnecte la session depuis le menu principal', async () => {
    renderAuthenticatedApp()

    await screen.findByText(/Bonjour Thomas/)
    const logoutButtons = screen.getAllByRole('button', { name: 'Déconnexion' })
    expect(logoutButtons).toHaveLength(1)
    expect(logoutButtons[0].querySelector('.icon')).toHaveTextContent('↪')
    fireEvent.click(logoutButtons[0])

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument())
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-csrf-token': 'csrf-token' },
    })
  })

  it('ouvre et ferme le menu mobile', async () => {
    renderAuthenticatedApp()
    await screen.findByText(/Bonjour Thomas/)

    const menu = screen.getByRole('button', { name: 'Ouvrir le menu' })
    fireEvent.click(menu)
    expect(menu).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getAllByRole('button', { name: 'Fermer le menu' })[0])
    expect(menu).toHaveAttribute('aria-expanded', 'false')
  })

  it('affiche les états vides et les erreurs du tableau de bord', async () => {
    vi.mocked(listPrinters).mockRejectedValueOnce(new Error('API indisponible'))
    vi.mocked(listSpools).mockRejectedValueOnce(new Error('API indisponible'))
    renderAuthenticatedApp()

    expect(await screen.findByText('API indisponible')).toBeInTheDocument()
    expect(screen.getByText('Connexion API indisponible')).toBeInTheDocument()
  })

  it('affiche les états vides sans imprimantes ni bobines', async () => {
    vi.mocked(listPrinters).mockResolvedValueOnce([])
    vi.mocked(listSpools).mockResolvedValueOnce([])
    renderAuthenticatedApp()

    expect(await screen.findByText('Aucune imprimante n’est encore enregistrée.')).toBeInTheDocument()
    expect(screen.getByText('Aucune bobine en stock.')).toBeInTheDocument()
    expect(screen.getByText('Aucune imprimante configurée')).toBeInTheDocument()
  })

  it('affiche une imprimante prête, les dates et les raccourcis du tableau de bord', async () => {
    vi.mocked(listPrinters).mockResolvedValueOnce([{
      ...printers[0],
      status: 'ready',
      job: undefined,
      progress: undefined,
      lastSyncError: undefined,
      lastSeenAt: '2026-09-08T07:00:00Z',
    }])
    renderAuthenticatedApp()

    expect(await screen.findByText('Toutes les imprimantes remontent des données')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Voir tout →' }))
    expect(await screen.findByRole('heading', { name: 'Imprimantes' })).toBeInTheDocument()
  })

  it('affiche la dernière connexion d’une imprimante hors ligne', async () => {
    vi.mocked(listPrinters).mockResolvedValueOnce([{ ...printers[1], lastSeenAt: '2026-09-08T07:00:00Z' }])
    renderAuthenticatedApp()

    expect(await screen.findByText(/Dernière connexion/)).toBeInTheDocument()
  })

  it('ouvre les bobines depuis le raccourci stock et ferme avec le voile', async () => {
    renderAuthenticatedApp()
    await screen.findByText(/Bonjour Thomas/)
    fireEvent.click(screen.getByRole('button', { name: 'Gérer le stock →' }))
    expect(await screen.findByRole('heading', { name: 'Tes bobines' })).toBeInTheDocument()
  })
})
