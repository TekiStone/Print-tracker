import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { Pool } from 'pg'

const app = express()
const port = Number(process.env.PORT ?? 3000)
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null

app.use(cors())
app.use(express.json())

function requirePool(response: express.Response): Pool | null {
  if (!pool) {
    response.status(503).json({ error: 'DATABASE_URL is not configured' })
    return null
  }
  return pool
}

app.get('/health', async (_request, response) => {
  if (!pool) {
    response.status(503).json({ status: 'unconfigured', database: false })
    return
  }

  try {
    await pool.query('SELECT 1')
    response.json({ status: 'ok', database: true })
  } catch (error) {
    response.status(503).json({ status: 'degraded', database: false, error: error instanceof Error ? error.message : 'Database unavailable' })
  }
})

app.get('/api/printers', async (_request, response) => {
  if (!pool) {
    response.status(503).json({ error: 'DATABASE_URL is not configured' })
    return
  }

  try {
    const result = await pool.query(`
      SELECT id, name, model, status, current_job, progress, color, last_seen_at
      FROM printers
      ORDER BY created_at
    `)
    response.json(result.rows)
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to load printers' })
  }
})

app.post('/api/printers', async (request, response) => {
  const database = requirePool(response)
  if (!database) return
  const { name, model, status, currentJob, progress, color, prusalinkUrl } = request.body as Record<string, unknown>
  if (typeof name !== 'string' || !name.trim() || typeof model !== 'string' || !model.trim() ||
      !['printing', 'ready', 'offline', 'error'].includes(String(status)) ||
      (progress !== null && progress !== undefined && (!Number.isInteger(progress) || Number(progress) < 0 || Number(progress) > 100))) {
    response.status(400).json({ error: 'Invalid printer data' })
    return
  }
  try {
    const result = await database.query(
      `INSERT INTO printers (name, model, status, current_job, progress, color, prusalink_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, model, status, current_job, progress, color, prusalink_url, last_seen_at`,
      [name.trim(), model.trim(), status, typeof currentJob === 'string' ? currentJob.trim() : null, progress ?? null, typeof color === 'string' ? color : '#f27852', typeof prusalinkUrl === 'string' ? prusalinkUrl.trim() : null],
    )
    response.status(201).json(result.rows[0])
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to create printer' })
  }
})

app.patch('/api/printers/:id', async (request, response) => {
  const database = requirePool(response)
  if (!database) return
  const { name, model, status, currentJob, progress, color, prusalinkUrl } = request.body as Record<string, unknown>
  if ((name !== undefined && (typeof name !== 'string' || !name.trim())) ||
      (model !== undefined && (typeof model !== 'string' || !model.trim())) ||
      (status !== undefined && !['printing', 'ready', 'offline', 'error'].includes(String(status))) ||
      (progress !== undefined && progress !== null && (!Number.isInteger(progress) || Number(progress) < 0 || Number(progress) > 100))) {
    response.status(400).json({ error: 'Invalid printer update' })
    return
  }
  try {
    const result = await database.query(
      `UPDATE printers SET name = COALESCE($1, name), model = COALESCE($2, model), status = COALESCE($3, status),
       current_job = COALESCE($4, current_job), progress = COALESCE($5, progress), color = COALESCE($6, color),
       prusalink_url = COALESCE($7, prusalink_url) WHERE id = $8
       RETURNING id, name, model, status, current_job, progress, color, prusalink_url, last_seen_at`,
      [name === undefined ? null : name.trim(), model === undefined ? null : model.trim(), status ?? null, currentJob === undefined ? null : currentJob, progress === undefined ? null : progress, color ?? null, prusalinkUrl === undefined ? null : prusalinkUrl, request.params.id],
    )
    if (!result.rowCount) {
      response.status(404).json({ error: 'Printer not found' })
      return
    }
    response.json(result.rows[0])
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to update printer' })
  }
})

app.delete('/api/printers/:id', async (request, response) => {
  const database = requirePool(response)
  if (!database) return
  try {
    const result = await database.query('DELETE FROM printers WHERE id = $1 RETURNING id', [request.params.id])
    if (!result.rowCount) {
      response.status(404).json({ error: 'Printer not found' })
      return
    }
    response.status(204).end()
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to delete printer' })
  }
})

app.get('/api/spools', async (_request, response) => {
  const database = requirePool(response)
  if (!database) return

  try {
    const result = await database.query(`
      SELECT id, brand, material, color, remaining_grams, initial_grams, location, qr_url, prusament_id
      FROM spools
      WHERE archived_at IS NULL
      ORDER BY created_at DESC
    `)
    response.json(result.rows)
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to load spools' })
  }
})

app.post('/api/spools', async (request, response) => {
  const database = requirePool(response)
  if (!database) return
  const { brand, material, color, initialGrams, remainingGrams, location, qrUrl, prusamentId } = request.body as Record<string, unknown>
  if (typeof brand !== 'string' || !brand.trim() || typeof material !== 'string' || !material.trim() ||
      typeof color !== 'string' || !color.trim() || typeof initialGrams !== 'number' ||
      !Number.isInteger(initialGrams) || initialGrams <= 0 || typeof remainingGrams !== 'number' ||
      !Number.isInteger(remainingGrams) || remainingGrams < 0 || remainingGrams > initialGrams) {
    response.status(400).json({ error: 'Invalid spool data' })
    return
  }

  try {
    const result = await database.query(
      `INSERT INTO spools (brand, material, color, initial_grams, remaining_grams, location, qr_url, prusament_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, brand, material, remaining_grams, initial_grams, color, location, qr_url, prusament_id`,
      [brand.trim(), material.trim(), color.trim(), initialGrams, remainingGrams, typeof location === 'string' ? location.trim() : null,
        typeof qrUrl === 'string' ? qrUrl.trim() : null, typeof prusamentId === 'string' ? prusamentId.trim() : null],
    )
    response.status(201).json(result.rows[0])
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to create spool' })
  }
})

app.patch('/api/spools/:id', async (request, response) => {
  const database = requirePool(response)
  if (!database) return
  const { remainingGrams, location, qrUrl, prusamentId } = request.body as Record<string, unknown>
  if ((remainingGrams !== undefined && (typeof remainingGrams !== 'number' || !Number.isInteger(remainingGrams) || remainingGrams < 0)) ||
      (location !== undefined && typeof location !== 'string') ||
      (qrUrl !== undefined && typeof qrUrl !== 'string') ||
      (prusamentId !== undefined && typeof prusamentId !== 'string')) {
    response.status(400).json({ error: 'Invalid spool update' })
    return
  }

  try {
    const result = await database.query(
      `UPDATE spools
       SET remaining_grams = COALESCE($1, remaining_grams),
           location = COALESCE($2, location),
           qr_url = COALESCE($3, qr_url),
           prusament_id = COALESCE($4, prusament_id)
       WHERE id = $5 AND archived_at IS NULL
       RETURNING id, brand, material, color, remaining_grams, initial_grams, location`,
      [remainingGrams ?? null, location === undefined ? null : location.trim(),
        qrUrl === undefined ? null : qrUrl.trim(), prusamentId === undefined ? null : prusamentId.trim(), request.params.id],
    )
    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Spool not found' })
      return
    }
    response.json(result.rows[0])
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to update spool' })
  }
})

app.delete('/api/spools/:id', async (request, response) => {
  const database = requirePool(response)
  if (!database) return
  try {
    const result = await database.query(
      `UPDATE spools SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id`,
      [request.params.id],
    )
    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Spool not found' })
      return
    }
    response.status(204).end()
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to archive spool' })
  }
})

app.listen(port, () => {
  console.log(`Print Tracker API listening on port ${port}`)
})
