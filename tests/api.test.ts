import type { Pool } from 'pg'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { app, setDatabasePool } from '../server/index.js'

function fakePool() {
  return { query: vi.fn() } as unknown as Pool & { query: ReturnType<typeof vi.fn> }
}

describe('API HTTP', () => {
  afterEach(() => setDatabasePool(null))

  it('signale une base non configurée sur health et inscription', async () => {
    const health = await request(app).get('/health')
    const register = await request(app).post('/auth/register').send({
      username: 'atelier',
      password: 'mot-de-passe-valide',
    })

    expect(health.status).toBe(503)
    expect(health.body).toEqual({ status: 'unconfigured', database: false })
    expect(register.status).toBe(503)
    expect(register.body.error).toContain('DATABASE_URL')
  })

  it('refuse l’API sans session quand une base est configurée', async () => {
    setDatabasePool(fakePool())

    const response = await request(app).get('/api/spools')

    expect(response.status).toBe(401)
    expect(response.body).toEqual({ error: 'Authentication required' })
  })

  it('inscrit un utilisateur puis charge ses bobines', async () => {
    const database = fakePool()
    database.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', username: 'atelier', email: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'spool-1', brand: 'Prusament', material: 'PLA', remaining_grams: 800 }] })
    setDatabasePool(database)
    const agent = request.agent(app)

    const register = await agent.post('/auth/register').send({
      username: 'atelier',
      password: 'mot-de-passe-valide',
    })
    const spools = await agent.get('/api/spools')
    const logout = await agent.post('/auth/logout')

    expect(register.status).toBe(201)
    expect(register.body.user).toMatchObject({ subject: 'local:user-1', username: 'atelier' })
    expect(spools.status).toBe(200)
    expect(spools.body).toHaveLength(1)
    expect(logout.status).toBe(204)
    expect(database.query).toHaveBeenCalledTimes(2)
  })

  it('valide les données avant de créer ou modifier une bobine', async () => {
    const database = fakePool()
    setDatabasePool(database)
    const agent = request.agent(app)
    database.query.mockResolvedValueOnce({ rows: [{ id: 'user-1', username: 'atelier', email: null }] })
    await agent.post('/auth/register').send({ username: 'atelier', password: 'mot-de-passe-valide' })

    const create = await agent.post('/api/spools').send({
      brand: 'Prusament',
      material: 'PLA',
      color: 'Orange',
      initialGrams: 1000,
      remainingGrams: 1200,
    })
    const update = await agent.patch('/api/spools/spool-1').send({ remainingGrams: -1 })

    expect(create.status).toBe(400)
    expect(update.status).toBe(400)
    expect(database.query).toHaveBeenCalledTimes(1)
  })
})
