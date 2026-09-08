import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPrinter, listPrinterJobs, listPrinters, listSpools, syncPrinterNow, updatePrinter } from '../src/api'
import { PrintersPage } from '../src/PrintersPage'

vi.mock('../src/api', () => ({
  createPrinter: vi.fn(),
  listPrinterJobs: vi.fn(),
  listPrinters: vi.fn(),
  listSpools: vi.fn(),
  syncPrinterNow: vi.fn(),
  updatePrinter: vi.fn(),
}))

const printer = {
  id: 'printer-1',
  name: 'Prusa XL',
  model: 'XL 5T',
  status: 'printing',
  job: 'benchy.gcode',
  progress: 42,
  color: '#f27852',
  prusalinkUrl: 'http://printer.local',
  prusalinkEnabled: true,
  nozzleTemperature: 214.6,
  nozzleTargetTemperature: 220,
  bedTemperature: 60,
  bedTargetTemperature: 65,
  firmwareVersion: '6.0.0',
  prusalinkVersion: '2.0.0',
  activeSpoolId: 'spool-1',
  activeSpoolLabel: 'Prusament PLA',
  activeSpoolAssignedAt: '2026-09-08T07:00:00Z',
  lastSyncAt: '2026-09-08T07:15:00Z',
  lastSeenAt: '2026-09-08T07:16:00Z',
} as const

const spool = { id: 'spool-1', brand: 'Prusament', material: 'PLA', color: 'Orange', remaining: 900, initial: 1000, location: 'A1' }

describe('page imprimantes', () => {
  beforeEach(() => {
    vi.mocked(listPrinters).mockResolvedValue([printer])
    vi.mocked(listSpools).mockResolvedValue([spool])
  })

  it('affiche les données PrusaLink et l’historique', async () => {
    vi.mocked(listPrinterJobs).mockResolvedValue([{ id: 'job-1', name: 'benchy.gcode', status: 'completed', source: 'prusalink', externalJobPath: '/local/benchy.gcode', estimatedFilamentGrams: 14, spoolLabel: 'Prusament PLA' }])
    render(<PrintersPage />)

    expect(await screen.findByText('Prusa XL')).toBeInTheDocument()
    expect(screen.getByText('En impression')).toBeInTheDocument()
    expect(screen.getByText('215° / 220°')).toBeInTheDocument()
    expect(screen.getByText('Firmware 6.0.0 · PrusaLink 2.0.0')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Historique' }))

    expect(await screen.findByText('Dernières impressions')).toBeInTheDocument()
    expect(screen.getByText('/local/benchy.gcode · 14 g estimés · Prusament PLA')).toBeInTheDocument()
  })

  it('crée une imprimante avec bobine active', async () => {
    vi.mocked(createPrinter).mockResolvedValue({ ...printer, id: 'printer-2', name: 'Prusa Mini', model: 'Mini+' })
    render(<PrintersPage />)

    await screen.findByText('Prusa XL')
    fireEvent.click(screen.getByRole('button', { name: /Ajouter une imprimante/i }))
    fireEvent.change(screen.getByPlaceholderText('Ex. Prusa XL'), { target: { value: ' Prusa Mini ' } })
    fireEvent.change(screen.getByPlaceholderText('Ex. XL 5T'), { target: { value: ' Mini+ ' } })
    fireEvent.change(screen.getByLabelText('Bobine active'), { target: { value: 'spool-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }))

    await waitFor(() => expect(createPrinter).toHaveBeenCalledWith({
      name: 'Prusa Mini',
      model: 'Mini+',
      color: '#f27852',
      prusalinkUrl: undefined,
      prusalinkEnabled: false,
      activeSpoolId: 'spool-1',
    }))
    expect(screen.getByText('Prusa Mini')).toBeInTheDocument()
  })

  it('modifie une imprimante sans écraser une clé PrusaLink vide', async () => {
    vi.mocked(updatePrinter).mockResolvedValue({ ...printer, name: 'Prusa XL modifiée' })
    render(<PrintersPage />)

    await screen.findByText('Prusa XL')
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }))
    fireEvent.change(screen.getByPlaceholderText('Ex. Prusa XL'), { target: { value: 'Prusa XL modifiée' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(updatePrinter).toHaveBeenCalledWith('printer-1', expect.not.objectContaining({ prusalinkApiKey: expect.any(String) })))
    expect(screen.getByText('Prusa XL modifiée')).toBeInTheDocument()
  })

  it('synchronise une imprimante puis recharge son historique', async () => {
    vi.mocked(syncPrinterNow).mockResolvedValue({ ...printer, progress: 84 })
    vi.mocked(listPrinterJobs).mockResolvedValue([])
    render(<PrintersPage />)

    await screen.findByText('Prusa XL')
    fireEvent.click(screen.getByRole('button', { name: 'Synchroniser' }))

    await waitFor(() => expect(syncPrinterNow).toHaveBeenCalledWith('printer-1'))
    expect(await screen.findByText('84%')).toBeInTheDocument()
    expect(screen.getByText('Aucune impression enregistrée.')).toBeInTheDocument()
  })

  it('affiche les erreurs de chargement', async () => {
    vi.mocked(listPrinters).mockRejectedValueOnce(new Error('API imprimantes indisponible'))
    render(<PrintersPage />)

    expect(await screen.findByText('API imprimantes indisponible')).toBeInTheDocument()
    expect(screen.getByText('Aucune imprimante configurée.')).toBeInTheDocument()
  })

  it('refuse une création incomplète et une configuration PrusaLink sans URL ou clé', async () => {
    render(<PrintersPage />)
    await screen.findByText('Prusa XL')
    fireEvent.click(screen.getByRole('button', { name: /Ajouter une imprimante/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }))
    expect(createPrinter).not.toHaveBeenCalled()

    fireEvent.change(screen.getByPlaceholderText('Ex. Prusa XL'), { target: { value: 'New Printer' } })
    fireEvent.change(screen.getByPlaceholderText('Ex. XL 5T'), { target: { value: 'Model' } })
    fireEvent.click(screen.getByLabelText('Activer la synchronisation automatique'))
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }))
    expect(createPrinter).not.toHaveBeenCalled()
  })

  it('affiche les erreurs de synchronisation et d’historique', async () => {
    vi.mocked(syncPrinterNow).mockRejectedValueOnce(new Error('Sync refusée'))
    vi.mocked(listPrinterJobs).mockRejectedValueOnce(new Error('Historique indisponible'))
    render(<PrintersPage />)
    await screen.findByText('Prusa XL')

    fireEvent.click(screen.getByRole('button', { name: 'Synchroniser' }))
    expect(await screen.findByText('Sync refusée')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Historique' }))
    expect(await screen.findByText('Historique indisponible')).toBeInTheDocument()
  })

  it('formate les températures partielles et ferme le formulaire', async () => {
    vi.mocked(listPrinters).mockResolvedValueOnce([{ ...printer, nozzleTemperature: undefined, nozzleTargetTemperature: 220, bedTemperature: 60, bedTargetTemperature: undefined }])
    render(<PrintersPage />)
    await screen.findByText('Prusa XL')

    expect(screen.getByText('220°')).toBeInTheDocument()
    expect(screen.getByText('60°')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }))
    fireEvent.click(screen.getByRole('button', { name: '×' }))
    expect(screen.queryByRole('heading', { name: 'Modifier l’imprimante' })).not.toBeInTheDocument()
  })

  it('affiche une erreur après une sauvegarde', async () => {
    vi.mocked(updatePrinter).mockRejectedValueOnce(new Error('Sauvegarde refusée'))
    render(<PrintersPage />)
    await screen.findByText('Prusa XL')
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }))
    fireEvent.change(screen.getByPlaceholderText('Ex. Prusa XL'), { target: { value: 'Prusa XL modifiée' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(await screen.findByText('Sauvegarde refusée')).toBeInTheDocument()
  })
})
