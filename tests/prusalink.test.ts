import type { Pool } from 'pg'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { syncEnabledPrinters, syncPrinter } from '../server/prusalink.js'

type FakeClient = { query: ReturnType<typeof vi.fn>, release: ReturnType<typeof vi.fn> }
type FakePool = Pool & { query: ReturnType<typeof vi.fn>, connect: ReturnType<typeof vi.fn<[], Promise<FakeClient>>> }

function fakeDatabase() {
  const client: FakeClient = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), release: vi.fn() }
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockResolvedValue(client),
    client,
  } as unknown as FakePool & { client: FakeClient }
}

describe('synchronisation PrusaLink', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('refuse une imprimante sans configuration PrusaLink complète', async () => {
    const database = fakeDatabase()

    await expect(syncPrinter(database, { id: 'printer-1', prusalink_url: null, prusalink_api_key: null, active_spool_id: null })).rejects.toThrow('Configuration PrusaLink incomplète')

    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('last_sync_error'), ['Configuration PrusaLink incomplète', 'printer-1'])
  })

  it('synchronise températures, progression et job actif depuis PrusaLink', async () => {
    const database = fakeDatabase()
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ firmware: '6.0.0', server: '2.0.0' }))
      .mockResolvedValueOnce(Response.json({ state: { text: 'Printing', flags: { printing: true } }, temperature: { tool0: { actual: 214.6, target: 220 }, bed: { actual: 59.8, target: 60 } } }))
      .mockResolvedValueOnce(Response.json({ state: 'Printing', job: { file: { path: '/local/benchy.gcode', display: 'benchy.gcode' } }, progress: { completion: 0.421 } }))
      .mockResolvedValueOnce(new Response('; filament used [g] = 12.4, 1.6\n; END'))

    const result = await syncPrinter(database, { id: 'printer-1', prusalink_url: 'http://printer.local/', prusalink_api_key: 'secret', active_spool_id: 'spool-1' })

    expect(result).toMatchObject({
      status: 'printing',
      currentJob: 'benchy.gcode',
      progress: 42,
      nozzleTemperature: 214.6,
      bedTargetTemperature: 60,
      firmwareVersion: '6.0.0',
      prusalinkVersion: '2.0.0',
      estimatedFilamentGrams: 14,
    })
    expect(fetch).toHaveBeenCalledWith('http://printer.local/api/files/local/benchy.gcode/raw', expect.objectContaining({ headers: expect.objectContaining({ 'X-Api-Key': 'secret' }) }))
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE printers'), expect.arrayContaining(['printing', 'benchy.gcode', 42]))
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO print_jobs'), ['printer-1', 'spool-1', 'benchy.gcode', 'printing', '/local/benchy.gcode', 14])
  })

  it('clôture les jobs actifs et décrémente la bobine quand une impression se termine', async () => {
    const database = fakeDatabase()
    database.query
      .mockResolvedValueOnce({ rows: [{ id: 'printer-1', prusalink_url: 'http://printer.local', prusalink_api_key: 'secret', active_spool_id: 'spool-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'job-1', spool_id: 'spool-1', estimated_filament_grams: 18, filament_applied_at: null }], rowCount: 1 })
    database.client.query.mockResolvedValue({ rows: [], rowCount: 1 })
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ firmware: '6.0.0', server: '2.0.0' }))
      .mockResolvedValueOnce(Response.json({ state: { text: 'Operational', flags: { ready: true } } }))
      .mockResolvedValueOnce(Response.json({ state: 'Finished', progress: { completion: 100 } }))

    await syncPrinter(database, { id: 'printer-1', prusalink_url: 'http://printer.local', prusalink_api_key: 'secret', active_spool_id: 'spool-1' })

    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('completed_at = COALESCE'), ['completed', 'printer-1'])
    expect(database.client.query).toHaveBeenCalledWith('BEGIN')
    expect(database.client.query).toHaveBeenCalledWith(expect.stringContaining('remaining_grams = GREATEST'), [18, 'spool-1'])
    expect(database.client.query).toHaveBeenCalledWith(expect.stringContaining('filament_applied_at = now()'), [18, 'job-1'])
    expect(database.client.query).toHaveBeenCalledWith('COMMIT')
    expect(database.client.release).toHaveBeenCalled()
  })

  it('continue de synchroniser les autres imprimantes quand une ligne échoue', async () => {
    const database = fakeDatabase()
    database.query.mockResolvedValueOnce({
      rows: [
        { id: 'printer-1', prusalink_url: null, prusalink_api_key: null, active_spool_id: null },
        { id: 'printer-2', prusalink_url: null, prusalink_api_key: null, active_spool_id: null },
      ],
    })

    await expect(syncEnabledPrinters(database)).resolves.toBeUndefined()

    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('WHERE prusalink_enabled = true'))
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('last_sync_error'), ['Configuration PrusaLink incomplète', 'printer-1'])
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('last_sync_error'), ['Configuration PrusaLink incomplète', 'printer-2'])
  })
})
