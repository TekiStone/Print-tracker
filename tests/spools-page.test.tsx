import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSpool, deleteSpool, listSpools, updateSpool } from '../src/api'
import { SpoolsPage } from '../src/SpoolsPage'

const mocks = vi.hoisted(() => ({
  decodeOnceFromVideoDevice: vi.fn(),
}))

vi.mock('@zxing/browser', () => ({
  BrowserQRCodeReader: vi.fn(function BrowserQRCodeReader() {
    return { decodeOnceFromVideoDevice: mocks.decodeOnceFromVideoDevice }
  }),
}))

vi.mock('../src/api', () => ({
  createSpool: vi.fn(),
  deleteSpool: vi.fn(),
  listSpools: vi.fn(),
  updateSpool: vi.fn(),
}))

const spools = [
  { id: 'spool-1', brand: 'Prusament', material: 'PLA', color: 'Galaxy Black', remaining: 100, initial: 1000, location: 'Boîte A', qrUrl: 'https://prusament.com/spool/ABC', prusamentId: 'ABC' },
  { id: 'spool-2', brand: 'Polymaker', material: 'PETG', color: 'Arctic White', remaining: 900, initial: 1000, location: 'Boîte B' },
]

describe('gestion des bobines', () => {
  beforeEach(() => {
    vi.mocked(listSpools).mockResolvedValue(spools)
  })

  it('charge les statistiques, filtre par recherche et matière', async () => {
    render(<SpoolsPage />)

    expect(await screen.findByText('Prusament')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1.00 kg')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Rechercher une bobine...'), { target: { value: 'Polymaker' } })
    expect(screen.getByText('Polymaker')).toBeInTheDocument()
    expect(screen.queryByText('Prusament')).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'PLA' } })
    expect(screen.getByText('Aucune bobine ne correspond à ta recherche.')).toBeInTheDocument()
  })

  it('crée une bobine et l’ajoute en tête de liste', async () => {
    vi.mocked(createSpool).mockResolvedValue({ id: 'spool-3', brand: 'Fillamentum', material: 'PLA', color: 'Bleu', remaining: 850, initial: 1000, location: 'Boîte Z' })
    render(<SpoolsPage />)

    await screen.findByText('Prusament')
    fireEvent.click(screen.getByRole('button', { name: /Ajouter une bobine/i }))
    fireEvent.change(screen.getByPlaceholderText('Ex. Prusament'), { target: { value: ' Fillamentum ' } })
    fireEvent.change(screen.getByPlaceholderText('Ex. Galaxy Black'), { target: { value: 'Bleu' } })
    fireEvent.change(screen.getByLabelText('Poids restant (g)'), { target: { value: '850' } })
    fireEvent.change(screen.getByPlaceholderText('Ex. Boîte A · 03'), { target: { value: ' Boîte Z ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter la bobine' }))

    await waitFor(() => expect(createSpool).toHaveBeenCalledWith({
      brand: 'Fillamentum',
      material: 'PLA',
      color: 'Bleu',
      initialGrams: 1000,
      remainingGrams: 850,
      location: 'Boîte Z',
      qrUrl: undefined,
      prusamentId: undefined,
    }))
    expect(screen.getByText('Fillamentum')).toBeInTheDocument()
  })

  it('modifie puis retire une bobine après confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(updateSpool).mockResolvedValue({ ...spools[0], remaining: 75, location: 'Boîte C' })
    vi.mocked(deleteSpool).mockResolvedValue(undefined)
    render(<SpoolsPage />)

    await screen.findByText('Prusament')
    fireEvent.click(screen.getAllByRole('button', { name: 'Modifier' })[0])
    fireEvent.change(screen.getByLabelText('Poids restant (g)'), { target: { value: '75' } })
    fireEvent.change(screen.getByPlaceholderText('Ex. Boîte A · 03'), { target: { value: 'Boîte C' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(updateSpool).toHaveBeenCalledWith('spool-1', {
      remainingGrams: 75,
      location: 'Boîte C',
      qrUrl: 'https://prusament.com/spool/ABC',
      prusamentId: 'ABC',
    }))
    expect(screen.getByText('Boîte C')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Retirer' })[0])
    await waitFor(() => expect(deleteSpool).toHaveBeenCalledWith('spool-1'))
    expect(screen.queryByText('Prusament')).not.toBeInTheDocument()
  })

  it('pré-remplit le formulaire avec un QR Prusament valide et rejette les QR invalides', async () => {
    mocks.decodeOnceFromVideoDevice.mockResolvedValueOnce({ getText: () => 'https://prusament.com/spool/XYZ' })
    render(<SpoolsPage />)

    fireEvent.click(await screen.findByRole('button', { name: /Scanner un QR/ }))

    expect(await screen.findByText('QR Prusament reconnu · XYZ')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Prusament')).toBeInTheDocument()
  })

  it('affiche une erreur pour un QR non Prusament', async () => {
    mocks.decodeOnceFromVideoDevice.mockResolvedValueOnce({ getText: () => 'https://example.test/spool/XYZ' })
    render(<SpoolsPage />)

    fireEvent.click(await screen.findByRole('button', { name: /Scanner un QR/ }))
    expect(await screen.findByText('Ce QR code ne correspond pas à une fiche Prusament.')).toBeInTheDocument()
  })

  it('affiche les erreurs de sauvegarde et de suppression', async () => {
    vi.mocked(createSpool).mockRejectedValueOnce(new Error('Création refusée'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<SpoolsPage />)

    await screen.findByText('Prusament')
    fireEvent.click(screen.getByRole('button', { name: /Ajouter une bobine/i }))
    fireEvent.change(screen.getByPlaceholderText('Ex. Prusament'), { target: { value: 'Test' } })
    fireEvent.change(screen.getByPlaceholderText('Ex. Galaxy Black'), { target: { value: 'Blue' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter la bobine' }))
    expect(await screen.findByText('Création refusée')).toBeInTheDocument()

    vi.mocked(deleteSpool).mockRejectedValueOnce(new Error('Suppression refusée'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Retirer' })[0])
    expect(await screen.findByText('Suppression refusée')).toBeInTheDocument()
  })

  it('ne supprime pas une bobine si la confirmation est refusée', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<SpoolsPage />)
    await screen.findByText('Prusament')

    fireEvent.click(screen.getAllByRole('button', { name: 'Retirer' })[0])
    expect(deleteSpool).not.toHaveBeenCalled()
    expect(screen.getByText('Prusament')).toBeInTheDocument()
  })

  it('affiche les erreurs de chargement et de suppression sans masquer la page', async () => {
    vi.mocked(listSpools).mockRejectedValueOnce(new Error('API indisponible'))
    render(<SpoolsPage />)

    expect(await screen.findByText('API indisponible')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tes bobines' })).toBeInTheDocument()
  })
})
