import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPrinter, createSpool, deleteSpool, listPrinterJobs, listPrinters, listSpools, syncPrinterNow, updatePrinter, updateSpool } from '../src/api'
import { getCsrfToken } from '../src/csrf'

const apiPrinter = {
  id: 'printer-1',
  name: 'Prusa XL',
  model: 'XL 5T',
  status: 'printing',
  current_job: 'benchy.gcode',
  progress: 42,
  color: '#f27852',
  last_seen_at: '2026-09-08T07:00:00Z',
  prusalink_url: 'http://printer.local',
  prusalink_enabled: true,
  nozzle_temperature: 215,
  nozzle_target_temperature: 220,
  bed_temperature: 60,
  bed_target_temperature: 65,
  firmware_version: '6.0.0',
  prusalink_version: '2.0.0',
  last_sync_at: '2026-09-08T07:10:00Z',
  last_sync_error: null,
  active_spool_id: 'spool-1',
  active_spool_assigned_at: '2026-09-08T07:05:00Z',
  active_spool_brand: 'Prusament',
  active_spool_material: 'PLA',
  active_spool_color: 'Orange',
}

const apiSpool = {
  id: 'spool-1',
  brand: 'Prusament',
  material: 'PLA',
  color: 'Orange',
  remaining_grams: 900,
  initial_grams: 1000,
  location: null,
  qr_url: null,
  prusament_id: null,
}

describe('client API', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('récupère un jeton CSRF obligatoire', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ token: 'csrf-token' }))

    await expect(getCsrfToken()).resolves.toBe('csrf-token')
    expect(fetch).toHaveBeenCalledWith('/api/auth/csrf-token', { credentials: 'include' })
  })

  it('remonte les erreurs CSRF explicites', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'no token' }, { status: 500 }))

    await expect(getCsrfToken()).rejects.toThrow('no token')
  })

  it('refuse un jeton CSRF absent et garde le message par défaut si le corps est illisible', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce({ ok: false, json: async () => { throw new Error('invalid json') } } as Response)

    await expect(getCsrfToken()).rejects.toThrow('Jeton CSRF manquant')
    await expect(getCsrfToken()).rejects.toThrow('Impossible de récupérer le jeton CSRF')
  })

  it('mappe les imprimantes, bobines et historiques depuis le format API', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json([apiPrinter]))
      .mockResolvedValueOnce(Response.json([apiSpool]))
      .mockResolvedValueOnce(Response.json([{ id: 'job-1', name: 'benchy.gcode', status: 'completed', filament_grams: null, started_at: null, completed_at: null, source: 'prusalink', external_job_path: '/local/benchy.gcode', estimated_filament_grams: 14, spool_id: 'spool-1', spool_brand: 'Prusament', spool_material: 'PLA', spool_color: 'Orange' }]))

    await expect(listPrinters()).resolves.toEqual([expect.objectContaining({ id: 'printer-1', job: 'benchy.gcode', activeSpoolLabel: 'Prusament PLA' })])
    await expect(listSpools()).resolves.toEqual([expect.objectContaining({ id: 'spool-1', remaining: 900, location: '' })])
    await expect(listPrinterJobs('printer-1')).resolves.toEqual([expect.objectContaining({ id: 'job-1', externalJobPath: '/local/benchy.gcode', estimatedFilamentGrams: 14, spoolLabel: 'Prusament PLA' })])
  })

  it('normalise les champs optionnels absents dans les réponses API', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json([{
        ...apiPrinter,
        status: 'ready',
        current_job: null,
        progress: null,
        last_seen_at: null,
        prusalink_url: null,
        nozzle_temperature: null,
        nozzle_target_temperature: null,
        bed_temperature: null,
        bed_target_temperature: null,
        firmware_version: null,
        prusalink_version: null,
        last_sync_at: null,
        last_sync_error: null,
        active_spool_id: null,
        active_spool_assigned_at: null,
        active_spool_brand: null,
        active_spool_material: null,
        active_spool_color: null,
      }]))
      .mockResolvedValueOnce(Response.json([{ ...apiSpool, location: 'Rack A', qr_url: 'https://prusament.com/spool/ABC', prusament_id: 'ABC' }]))
      .mockResolvedValueOnce(Response.json([{ id: 'job-2', name: 'calibration.gcode', status: 'queued', filament_grams: 3, started_at: '2026-09-08T07:00:00Z', completed_at: '2026-09-08T08:00:00Z', source: 'manual', external_job_path: null, estimated_filament_grams: null, spool_id: null, spool_brand: null, spool_material: null, spool_color: null }]))

    await expect(listPrinters()).resolves.toEqual([expect.objectContaining({ job: undefined, progress: undefined, activeSpoolLabel: undefined })])
    await expect(listSpools()).resolves.toEqual([expect.objectContaining({ location: 'Rack A', qrUrl: 'https://prusament.com/spool/ABC', prusamentId: 'ABC' })])
    await expect(listPrinterJobs('printer-1')).resolves.toEqual([expect.objectContaining({ filamentGrams: 3, externalJobPath: undefined, spoolLabel: undefined })])
  })

  it('ajoute le jeton CSRF aux mutations et respecte les corps attendus', async () => {
    vi.mocked(fetch)
      .mockResolvedValue(Response.json({ token: 'csrf-token' }))
      .mockResolvedValueOnce(Response.json({ token: 'csrf-token' }))
      .mockResolvedValueOnce(Response.json(apiSpool))
      .mockResolvedValueOnce(Response.json({ token: 'csrf-token' }))
      .mockResolvedValueOnce(Response.json(apiSpool))
      .mockResolvedValueOnce(Response.json({ token: 'csrf-token' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ token: 'csrf-token' }))
      .mockResolvedValueOnce(Response.json(apiPrinter))
      .mockResolvedValueOnce(Response.json({ token: 'csrf-token' }))
      .mockResolvedValueOnce(Response.json(apiPrinter))
      .mockResolvedValueOnce(Response.json({ token: 'csrf-token' }))
      .mockResolvedValueOnce(Response.json(apiPrinter))

    await createSpool({ brand: 'Prusament', material: 'PLA', color: 'Orange', initialGrams: 1000, remainingGrams: 900, location: 'A1' })
    await updateSpool('spool-1', { remainingGrams: 800 })
    await deleteSpool('spool-1')
    await createPrinter({ name: 'Prusa XL', model: 'XL 5T', color: '#f27852', prusalinkEnabled: false })
    await updatePrinter('printer-1', { name: 'Prusa XL 2' })
    await syncPrinterNow('printer-1')

    expect(fetch).toHaveBeenCalledWith('/api/spools', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'x-csrf-token': 'csrf-token' }) }))
    expect(fetch).toHaveBeenCalledWith('/api/spools/spool-1', expect.objectContaining({ method: 'PATCH' }))
    expect(fetch).toHaveBeenCalledWith('/api/spools/spool-1', expect.objectContaining({ method: 'DELETE' }))
    expect(fetch).toHaveBeenCalledWith('/api/printers', expect.objectContaining({ method: 'POST' }))
    expect(fetch).toHaveBeenCalledWith('/api/printers/printer-1', expect.objectContaining({ method: 'PATCH' }))
    expect(fetch).toHaveBeenCalledWith('/api/printers/printer-1/sync', expect.objectContaining({ method: 'POST' }))
  })

  it('propage le message d’erreur renvoyé par le serveur', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'Serveur indisponible' }, { status: 503 }))

    await expect(listSpools()).rejects.toThrow('Serveur indisponible')
  })

  it('utilise un message générique quand le serveur renvoie une erreur non JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500, json: async () => { throw new Error('invalid json') } } as Response)

    await expect(listSpools()).rejects.toThrow('Requête /api/spools en échec')
  })
})
