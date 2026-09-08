import type { Pool } from 'pg'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { app, setDatabasePool } from '../server/index.js'

const webOrigin = 'http://localhost:5173'

type FakePool = Pool & { query: ReturnType<typeof vi.fn> }

function fakePool() {
  return { query: vi.fn() } as unknown as FakePool
}

async function csrfToken(agent: ReturnType<typeof request.agent>) {
  const response = await agent.get('/api/auth/csrf-token')
  expect(response.status).toBe(200)
  return response.body.token as string
}

async function register(agent: ReturnType<typeof request.agent>, user = { id: 'user-1', email: 'atelier@example.test', name: 'Atelier', role: 'admin' }) {
  const token = await csrfToken(agent)
  return agent
    .post('/api/auth/register')
    .set('Origin', webOrigin)
    .set('x-csrf-token', token)
    .send({ email: user.email, password: 'mot-de-passe-valide', name: user.name })
}

describe('API HTTP', () => {
  afterEach(() => {
    setDatabasePool(null)
  })

  it('signale une base non configurée sur health et auth', async () => {
    const health = await request(app).get('/health')
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .set('Origin', webOrigin)
      .set('x-csrf-token', 'invalid')
      .send({ email: 'atelier@example.test', password: 'mot-de-passe-valide', name: 'Atelier' })

    expect(health.status).toBe(503)
    expect(health.body).toEqual({ status: 'unconfigured', database: false })
    expect(registerResponse.status).toBe(403)
  })

  it('refuse les mutations API sans origine de confiance', async () => {
    setDatabasePool(fakePool())

    const response = await request(app).post('/api/spools').send({})

    expect(response.status).toBe(403)
    expect(response.body).toEqual({ error: 'CSRF protection rejected this request' })
  })

  it('refuse l’API sans session quand une base est configurée', async () => {
    setDatabasePool(fakePool())

    const response = await request(app).get('/api/spools')

    expect(response.status).toBe(401)
    expect(response.body).toEqual({ error: 'Authentication required' })
  })

  it('signale une base configurée mais indisponible sur health', async () => {
    const database = fakePool()
    database.query.mockRejectedValueOnce(new Error('connection refused'))
    setDatabasePool(database)

    const response = await request(app).get('/health')

    expect(response.status).toBe(503)
    expect(response.body).toEqual({ status: 'degraded', database: false, error: 'connection refused' })
  })

  it('inscrit un utilisateur, recharge la session puis déconnecte', async () => {
    const database = fakePool()
    database.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', email: 'atelier@example.test', name: 'Atelier', role: 'admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', email: 'atelier@example.test', name: 'Atelier', role: 'admin' }] })
    setDatabasePool(database)
    const agent = request.agent(app)

    const created = await register(agent)
    const me = await agent.get('/api/auth/me')
    const token = await csrfToken(agent)
    const logout = await agent.post('/api/auth/logout').set('Origin', webOrigin).set('x-csrf-token', token)

    expect(created.status).toBe(201)
    expect(created.body).toEqual({ id: 'user-1', email: 'atelier@example.test', name: 'Atelier', role: 'admin' })
    expect(me.status).toBe(200)
    expect(me.body.name).toBe('Atelier')
    expect(logout.status).toBe(204)
  })

  it('valide inscription, doublon et connexion locale', async () => {
    const database = fakePool()
    database.query
      .mockRejectedValueOnce({ code: '23505' })
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', email: 'atelier@example.test', name: 'Atelier', role: 'admin', password_hash: await import('bcryptjs').then(({ default: bcrypt }) => bcrypt.hash('mot-de-passe-valide', 4)) }] })
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', email: 'atelier@example.test', name: 'Atelier', role: 'admin', password_hash: 'hash-invalide' }] })
    setDatabasePool(database)

    const duplicateAgent = request.agent(app)
    const duplicate = await register(duplicateAgent)
    const badPayloadToken = await csrfToken(duplicateAgent)
    const badPayload = await duplicateAgent.post('/api/auth/register').set('Origin', webOrigin).set('x-csrf-token', badPayloadToken).send({ email: '', password: 'court', name: '' })

    const loginAgent = request.agent(app)
    const loginToken = await csrfToken(loginAgent)
    const login = await loginAgent.post('/api/auth/login').set('Origin', webOrigin).set('x-csrf-token', loginToken).send({ email: 'atelier@example.test', password: 'mot-de-passe-valide' })
    const failedLoginAgent = request.agent(app)
    const failedLoginToken = await csrfToken(failedLoginAgent)
    const failedLogin = await failedLoginAgent.post('/api/auth/login').set('Origin', webOrigin).set('x-csrf-token', failedLoginToken).send({ email: 'atelier@example.test', password: 'mauvais' })

    expect(duplicate.status).toBe(409)
    expect(badPayload.status).toBe(400)
    expect(login.status).toBe(200)
    expect(login.body).toEqual({ id: 'user-1', email: 'atelier@example.test', name: 'Atelier', role: 'admin' })
    expect(failedLogin.status).toBe(401)
  })

  it('crée, modifie, liste et archive les bobines', async () => {
    const database = fakePool()
    database.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', email: 'atelier@example.test', name: 'Atelier', role: 'admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'spool-1', brand: 'Prusament', material: 'PLA', color: 'Orange', remaining_grams: 900, initial_grams: 1000, location: 'A1', qr_url: null, prusament_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'spool-1', brand: 'Prusament', material: 'PLA', color: 'Orange', remaining_grams: 850, initial_grams: 1000, location: 'B2', qr_url: null, prusament_id: null }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'spool-1', brand: 'Prusament', material: 'PLA', color: 'Orange', remaining_grams: 850, initial_grams: 1000, location: 'B2', qr_url: null, prusament_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'spool-1' }], rowCount: 1 })
    setDatabasePool(database)
    const agent = request.agent(app)
    await register(agent)

    const createToken = await csrfToken(agent)
    const create = await agent.post('/api/spools').set('Origin', webOrigin).set('x-csrf-token', createToken).send({ brand: ' Prusament ', material: 'PLA', color: 'Orange', initialGrams: 1000, remainingGrams: 900, location: 'A1' })
    const updateToken = await csrfToken(agent)
    const update = await agent.patch('/api/spools/spool-1').set('Origin', webOrigin).set('x-csrf-token', updateToken).send({ remainingGrams: 850, location: 'B2' })
    const list = await agent.get('/api/spools')
    const deleteToken = await csrfToken(agent)
    const archive = await agent.delete('/api/spools/spool-1').set('Origin', webOrigin).set('x-csrf-token', deleteToken)

    expect(create.status).toBe(201)
    expect(update.status).toBe(200)
    expect(list.body).toHaveLength(1)
    expect(archive.status).toBe(204)
  })

  it('valide les données bobine avant écriture', async () => {
    const database = fakePool()
    database.query.mockResolvedValueOnce({ rows: [{ id: 'user-1', email: 'atelier@example.test', name: 'Atelier', role: 'admin' }] })
    setDatabasePool(database)
    const agent = request.agent(app)
    await register(agent)

    const createToken = await csrfToken(agent)
    const create = await agent.post('/api/spools').set('Origin', webOrigin).set('x-csrf-token', createToken).send({ brand: 'Prusament', material: 'PLA', color: 'Orange', initialGrams: 1000, remainingGrams: 1200 })
    const updateToken = await csrfToken(agent)
    const update = await agent.patch('/api/spools/spool-1').set('Origin', webOrigin).set('x-csrf-token', updateToken).send({ remainingGrams: -1 })

    expect(create.status).toBe(400)
    expect(update.status).toBe(400)
    expect(database.query).toHaveBeenCalledTimes(1)
  })

  it('crée, modifie, liste, synchronise et supprime une imprimante', async () => {
    const database = fakePool()
    const printerRow = { id: 'printer-1', name: 'Prusa XL', model: 'XL 5T', status: 'ready', current_job: null, progress: null, color: '#f27852', last_seen_at: null, prusalink_url: 'http://printer.local', prusalink_enabled: true }
    database.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', email: 'atelier@example.test', name: 'Atelier', role: 'admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'spool-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'printer-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [printerRow] })
      .mockResolvedValueOnce({ rows: [{ prusalink_url: 'http://printer.local', prusalink_api_key: 'secret', prusalink_enabled: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'spool-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'printer-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ ...printerRow, name: 'Prusa XL 2' }] })
      .mockResolvedValueOnce({ rows: [{ ...printerRow, name: 'Prusa XL 2' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'printer-1', prusalink_url: null, prusalink_api_key: null, active_spool_id: null }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ ...printerRow, last_sync_error: 'Configuration PrusaLink incomplète' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'job-1', name: 'benchy.gcode', status: 'completed', filament_grams: 12, started_at: null, completed_at: null, source: 'manual', external_job_path: null, estimated_filament_grams: null, spool_id: null }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'printer-1' }], rowCount: 1 })
    setDatabasePool(database)
    const agent = request.agent(app)
    await register(agent)

    const createToken = await csrfToken(agent)
    const create = await agent.post('/api/printers').set('Origin', webOrigin).set('x-csrf-token', createToken).send({ name: 'Prusa XL', model: 'XL 5T', color: '#f27852', prusalinkUrl: 'http://printer.local', prusalinkApiKey: 'secret', prusalinkEnabled: true, activeSpoolId: 'spool-1' })
    const updateToken = await csrfToken(agent)
    const update = await agent.patch('/api/printers/printer-1').set('Origin', webOrigin).set('x-csrf-token', updateToken).send({ name: 'Prusa XL 2', activeSpoolId: 'spool-1' })
    const list = await agent.get('/api/printers')
    const syncToken = await csrfToken(agent)
    const sync = await agent.post('/api/printers/printer-1/sync').set('Origin', webOrigin).set('x-csrf-token', syncToken)
    const jobs = await agent.get('/api/printers/printer-1/jobs')
    const deleteToken = await csrfToken(agent)
    const remove = await agent.delete('/api/printers/printer-1').set('Origin', webOrigin).set('x-csrf-token', deleteToken)

    expect(create.status).toBe(201)
    expect(update.status).toBe(200)
    expect(list.status).toBe(200)
    expect(sync.status).toBe(502)
    expect(jobs.body[0].name).toBe('benchy.gcode')
    expect(remove.status).toBe(204)
  })

  it('couvre les validations et erreurs des routes imprimantes', async () => {
    const database = fakePool()
    database.query.mockResolvedValueOnce({ rows: [{ id: 'user-1', email: 'atelier@example.test', name: 'Atelier', role: 'admin' }] })
    setDatabasePool(database)
    const agent = request.agent(app)
    await register(agent)

    const invalidCreateToken = await csrfToken(agent)
    const invalidCreate = await agent.post('/api/printers').set('Origin', webOrigin).set('x-csrf-token', invalidCreateToken).send({ name: '', model: '', color: 'red' })
    const invalidConfigToken = await csrfToken(agent)
    const invalidConfig = await agent.post('/api/printers').set('Origin', webOrigin).set('x-csrf-token', invalidConfigToken).send({ name: 'Prusa', model: 'XL', color: '#ffffff', prusalinkEnabled: true })
    const invalidPatchToken = await csrfToken(agent)
    const invalidPatch = await agent.patch('/api/printers/printer-1').set('Origin', webOrigin).set('x-csrf-token', invalidPatchToken).send({ color: 'red', prusalinkEnabled: 'yes' })

    database.query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const missingPatchToken = await csrfToken(agent)
    const missingPatch = await agent.patch('/api/printers/missing').set('Origin', webOrigin).set('x-csrf-token', missingPatchToken).send({ name: 'Missing' })
    database.query.mockRejectedValueOnce(new Error('printer list failed'))
    const list = await agent.get('/api/printers')
    database.query.mockRejectedValueOnce(new Error('printer delete failed'))
    const deleteToken = await csrfToken(agent)
    const remove = await agent.delete('/api/printers/printer-1').set('Origin', webOrigin).set('x-csrf-token', deleteToken)
    database.query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const syncToken = await csrfToken(agent)
    const sync = await agent.post('/api/printers/missing/sync').set('Origin', webOrigin).set('x-csrf-token', syncToken)
    database.query.mockRejectedValueOnce(new Error('jobs failed'))
    const jobs = await agent.get('/api/printers/printer-1/jobs')

    expect(invalidCreate.status).toBe(400)
    expect(invalidConfig.status).toBe(400)
    expect(invalidPatch.status).toBe(400)
    expect(missingPatch.status).toBe(404)
    expect(list.status).toBe(500)
    expect(remove.status).toBe(500)
    expect(sync.status).toBe(404)
    expect(jobs.status).toBe(500)
  })

  it('couvre les erreurs et ressources absentes des routes bobines et auth', async () => {
    const database = fakePool()
    database.query.mockResolvedValueOnce({ rows: [{ id: 'user-1', email: 'atelier@example.test', name: 'Atelier', role: 'admin' }] })
    setDatabasePool(database)
    const agent = request.agent(app)
    await register(agent)

    database.query.mockRejectedValueOnce(new Error('spool list failed'))
    const listTokenless = await agent.get('/api/spools')
    const invalidCreateToken = await csrfToken(agent)
    const invalidCreate = await agent.post('/api/spools').set('Origin', webOrigin).set('x-csrf-token', invalidCreateToken).send({ brand: 'x', material: 'PLA', color: 'x', initialGrams: 1, remainingGrams: 2 })
    database.query.mockRejectedValueOnce(new Error('spool create failed'))
    const createToken = await csrfToken(agent)
    const create = await agent.post('/api/spools').set('Origin', webOrigin).set('x-csrf-token', createToken).send({ brand: 'x', material: 'PLA', color: 'x', initialGrams: 1, remainingGrams: 1 })
    const invalidUpdateToken = await csrfToken(agent)
    const invalidUpdate = await agent.patch('/api/spools/spool-1').set('Origin', webOrigin).set('x-csrf-token', invalidUpdateToken).send({ location: 12 })
    database.query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const missingUpdateToken = await csrfToken(agent)
    const missingUpdate = await agent.patch('/api/spools/missing').set('Origin', webOrigin).set('x-csrf-token', missingUpdateToken).send({ remainingGrams: 1 })
    database.query.mockRejectedValueOnce(new Error('spool update failed'))
    const updateToken = await csrfToken(agent)
    const update = await agent.patch('/api/spools/spool-1').set('Origin', webOrigin).set('x-csrf-token', updateToken).send({ remainingGrams: 1 })
    database.query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const missingDeleteToken = await csrfToken(agent)
    const missingDelete = await agent.delete('/api/spools/missing').set('Origin', webOrigin).set('x-csrf-token', missingDeleteToken)
    database.query.mockRejectedValueOnce(new Error('spool delete failed'))
    const deleteToken = await csrfToken(agent)
    const deleteResponse = await agent.delete('/api/spools/spool-1').set('Origin', webOrigin).set('x-csrf-token', deleteToken)

    expect(listTokenless.status).toBe(500)
    expect(invalidCreate.status).toBe(400)
    expect(create.status).toBe(500)
    expect(invalidUpdate.status).toBe(400)
    expect(missingUpdate.status).toBe(404)
    expect(update.status).toBe(500)
    expect(missingDelete.status).toBe(404)
    expect(deleteResponse.status).toBe(500)
  })
})
