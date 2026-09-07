import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { Pool } from 'pg'
import { startPrusaLinkScheduler, syncPrinter } from './prusalink.js'

const app = express()
const port = Number(process.env.PORT ?? 3000)
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null

const printerSelect = `
  SELECT id, name, model, status, current_job, progress, color, last_seen_at, prusalink_url,
         prusalink_enabled, nozzle_temperature, nozzle_target_temperature, bed_temperature,
         bed_target_temperature, firmware_version, prusalink_version, last_sync_at, last_sync_error
  FROM printers
`

app.use(cors())
app.use(express.json())

function requirePool(response: express.Response): Pool | null {
  if (!pool) {
    response.status(503).json({ error: 'DATABASE_URL is not configured' })
    return null
  }
  return pool
}

function trimmedText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function nullableText(value: unknown) {
  return typeof value === 'string' ? value.trim() || null : null
}

function isHexColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value)
}

function isValidUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

async function loadPrinter(database: Pool, id: string) {
  const result = await database.query(`${printerSelect} WHERE id = $1`, [id])
  return result.rows[0] ?? null
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
  const database = requirePool(response)
  if (!database) return

  try {
    const result = await database.query(`${printerSelect} ORDER BY created_at`)
    response.json(result.rows)
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to load printers' })
  }
})

app.post('/api/printers', async (request, response) => {
  const database = requirePool(response)
  if (!database) return

  const { name, model, color, prusalinkUrl, prusalinkApiKey, prusalinkEnabled } = request.body as Record<string, unknown>
  const normalizedName = trimmedText(name)
  const normalizedModel = trimmedText(model)
  const normalizedColor = trimmedText(color) || '#f27852'
  const normalizedUrl = nullableText(prusalinkUrl)
  const normalizedApiKey = nullableText(prusalinkApiKey)
  const enabled = typeof prusalinkEnabled === 'boolean' ? prusalinkEnabled : false

  if (!normalizedName || !normalizedModel || !isHexColor(normalizedColor)) {
    response.status(400).json({ error: 'Invalid printer data' })
    return
  }

  if ((normalizedUrl && !isValidUrl(normalizedUrl)) || (enabled && (!normalizedUrl || !normalizedApiKey))) {
    response.status(400).json({ error: 'Invalid PrusaLink configuration' })
    return
  }

  try {
    const result = await database.query(
      `INSERT INTO printers (name, model, color, prusalink_url, prusalink_api_key, prusalink_enabled)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [normalizedName, normalizedModel, normalizedColor, normalizedUrl, normalizedApiKey, enabled],
    )
    response.status(201).json(await loadPrinter(database, result.rows[0].id))
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to create printer' })
  }
})

app.patch('/api/printers/:id', async (request, response) => {
  const database = requirePool(response)
  if (!database) return

  const { name, model, color, prusalinkUrl, prusalinkApiKey, prusalinkEnabled } = request.body as Record<string, unknown>

  if ((name !== undefined && !trimmedText(name)) ||
      (model !== undefined && !trimmedText(model)) ||
      (color !== undefined && (!trimmedText(color) || !isHexColor(trimmedText(color)))) ||
      (prusalinkUrl !== undefined && typeof prusalinkUrl !== 'string') ||
      (prusalinkApiKey !== undefined && typeof prusalinkApiKey !== 'string') ||
      (prusalinkEnabled !== undefined && typeof prusalinkEnabled !== 'boolean')) {
    response.status(400).json({ error: 'Invalid printer update' })
    return
  }

  const current = await database.query(
    `SELECT prusalink_url, prusalink_api_key, prusalink_enabled
     FROM printers
     WHERE id = $1`,
    [request.params.id],
  )
  if (current.rowCount === 0) {
    response.status(404).json({ error: 'Printer not found' })
    return
  }

  const nextUrl = prusalinkUrl === undefined ? current.rows[0].prusalink_url : nullableText(prusalinkUrl)
  const nextApiKey = prusalinkApiKey === undefined ? current.rows[0].prusalink_api_key : nullableText(prusalinkApiKey)
  const nextEnabled = prusalinkEnabled === undefined ? current.rows[0].prusalink_enabled : prusalinkEnabled

  if ((nextUrl && !isValidUrl(nextUrl)) || (nextEnabled && (!nextUrl || !nextApiKey))) {
    response.status(400).json({ error: 'Invalid PrusaLink configuration' })
    return
  }

  try {
    const result = await database.query(
      `UPDATE printers
       SET name = COALESCE($1, name),
           model = COALESCE($2, model),
           color = COALESCE($3, color),
           prusalink_url = $4,
           prusalink_api_key = $5,
           prusalink_enabled = $6
       WHERE id = $7
       RETURNING id`,
      [
        name === undefined ? null : trimmedText(name),
        model === undefined ? null : trimmedText(model),
        color === undefined ? null : trimmedText(color),
        nextUrl,
        nextApiKey,
        nextEnabled,
        request.params.id,
      ],
    )
    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Printer not found' })
      return
    }
    response.json(await loadPrinter(database, request.params.id))
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to update printer' })
  }
})

app.post('/api/printers/:id/sync', async (request, response) => {
  const database = requirePool(response)
  if (!database) return

  try {
    const printerResult = await database.query(
      `SELECT id, prusalink_url, prusalink_api_key
       FROM printers
       WHERE id = $1 AND prusalink_enabled = true`,
      [request.params.id],
    )

    if (printerResult.rowCount === 0) {
      response.status(404).json({ error: 'Enabled printer not found' })
      return
    }

    await syncPrinter(database, printerResult.rows[0])
    response.json(await loadPrinter(database, request.params.id))
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Unable to sync printer' })
  }
})

app.get('/api/printers/:id/jobs', async (request, response) => {
  const database = requirePool(response)
  if (!database) return

  try {
    const result = await database.query(
      `SELECT id, name, status, filament_grams, started_at, completed_at, source, external_job_path
       FROM print_jobs
       WHERE printer_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [request.params.id],
    )
    response.json(result.rows)
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to load printer jobs' })
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
       RETURNING id, brand, material, color, remaining_grams, initial_grams, location, qr_url, prusament_id`,
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

if (pool) {
  startPrusaLinkScheduler(pool)
}

app.listen(port, () => {
  console.log(`Print Tracker API listening on port ${port}`)
})
