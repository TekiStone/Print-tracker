import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import connectPgSimple from 'connect-pg-simple'
import cors from 'cors'
import { csrfSync } from 'csrf-sync'
import express from 'express'
import rateLimit from 'express-rate-limit'
import session from 'express-session'
import { Pool } from 'pg'
import { startPrusaLinkScheduler, syncPrinter } from './prusalink.js'

declare module 'express-session' {
  interface SessionData {
    userId?: string
  }
}

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'
let pool: Pool | null = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null
const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173'
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const frontendDirectory = path.join(projectRoot, 'dist')
const { generateToken, csrfSynchronisedProtection } = csrfSync()

const printerSelect = `
  SELECT printers.id, printers.name, printers.model, printers.status, printers.current_job, printers.progress, printers.color, printers.last_seen_at, printers.prusalink_url,
         printers.prusalink_enabled, printers.nozzle_temperature, printers.nozzle_target_temperature, printers.bed_temperature,
         printers.bed_target_temperature, printers.firmware_version, printers.prusalink_version, printers.last_sync_at, printers.last_sync_error,
         printers.active_spool_id, printers.active_spool_assigned_at,
         spools.brand AS active_spool_brand, spools.material AS active_spool_material, spools.color AS active_spool_color
  FROM printers
  LEFT JOIN spools ON spools.id = printers.active_spool_id AND spools.archived_at IS NULL
`

export const app = express()

export function setDatabasePool(database: Pool | null) {
  pool = database
}

app.set('trust proxy', 1)
app.use(cors({ origin: webOrigin, credentials: true }))
app.use(express.json())
app.use('/api', rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many API requests, please retry in a moment' },
}))

const PgSession = connectPgSimple(session)
app.use(session({
  store: pool ? new PgSession({ pool, tableName: 'session', createTableIfMissing: false }) : undefined,
  secret: process.env.SESSION_SECRET ?? 'dev-only-insecure-secret',
  resave: false,
  saveUninitialized: false,
  name: 'print_tracker_sid',
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.SESSION_COOKIE_SECURE === 'true',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
}))
app.get('/api/auth/csrf-token', (request, response) => {
  response.json({ token: generateToken(request) })
})
app.use('/api', requireTrustedOrigin)

function requirePool(response: express.Response): Pool | null {
  if (!pool) {
    response.status(503).json({ error: 'DATABASE_URL is not configured' })
    return null
  }
  return pool
}

function requireAuth(request: express.Request, response: express.Response, next: express.NextFunction) {
  if (!request.session.userId) {
    response.status(401).json({ error: 'Authentication required' })
    return
  }
  next()
}

function isSafeMethod(method: string) {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
}

function hasTrustedOrigin(request: express.Request) {
  const source = request.get('origin') ?? request.get('referer')
  if (!source) return false

  try {
    return new URL(source).origin === webOrigin
  } catch {
    return false
  }
}

function requireTrustedOrigin(request: express.Request, response: express.Response, next: express.NextFunction) {
  if (isSafeMethod(request.method) || hasTrustedOrigin(request)) {
    next()
    return
  }

  response.status(403).json({ error: 'CSRF protection rejected this request' })
}

function trimmedText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function nullableText(value: unknown) {
  return typeof value === 'string' ? value.trim() || null : null
}

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
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

type PublicUser = { id: string; email: string; name: string; role: string }

async function parseJson(response: Response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function findPublicUserById(database: Pool, id: string): Promise<PublicUser | null> {
  const result = await database.query('SELECT id, email, name, role FROM users WHERE id = $1', [id])
  return result.rows[0] ?? null
}

async function loadPrinter(database: Pool, id: string) {
  const result = await database.query(`${printerSelect} WHERE printers.id = $1`, [id])
  return result.rows[0] ?? null
}

app.post('/api/auth/register', csrfSynchronisedProtection, async (request, response) => {
  const database = requirePool(response)
  if (!database) return

  const { email, password, name } = request.body as Record<string, unknown>
  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || password.length < 8 || typeof name !== 'string' || !name.trim()) {
    response.status(400).json({ error: 'Email valide, mot de passe (8 caractères min.) et nom sont requis' })
    return
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12)
    const result = await database.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, role`,
      [email.trim().toLowerCase(), passwordHash, name.trim()],
    )
    const user = result.rows[0] as PublicUser
    request.session.regenerate((error) => {
      if (error) {
        response.status(500).json({ error: 'Unable to create session' })
        return
      }
      request.session.userId = user.id
      response.status(201).json(user)
    })
  } catch (error) {
    const isUniqueViolation = typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === '23505'
    if (isUniqueViolation) {
      response.status(409).json({ error: 'Un compte existe déjà avec cet email' })
      return
    }
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to create account' })
  }
})

app.post('/api/auth/login', csrfSynchronisedProtection, async (request, response) => {
  const database = requirePool(response)
  if (!database) return

  const { email, password } = request.body as Record<string, unknown>
  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
    response.status(400).json({ error: 'Email et mot de passe requis' })
    return
  }

  try {
    const result = await database.query(
      'SELECT id, email, name, role, password_hash FROM users WHERE lower(email) = lower($1)',
      [email.trim()],
    )
    const user = result.rows[0] as (PublicUser & { password_hash: string | null }) | undefined
    if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
      response.status(401).json({ error: 'Email ou mot de passe incorrect' })
      return
    }

    request.session.regenerate((error) => {
      if (error) {
        response.status(500).json({ error: 'Unable to create session' })
        return
      }
      request.session.userId = user.id
      response.json({ id: user.id, email: user.email, name: user.name, role: user.role })
    })
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to sign in' })
  }
})

app.post('/api/auth/logout', csrfSynchronisedProtection, (request, response) => {
  request.session.destroy((error) => {
    if (error) {
      response.status(500).json({ error: 'Unable to sign out' })
      return
    }
    response.clearCookie('print_tracker_sid')
    response.status(204).end()
  })
})

app.get('/api/auth/me', async (request, response) => {
  const database = requirePool(response)
  if (!database) return
  if (!request.session.userId) {
    response.status(401).json({ error: 'Not authenticated' })
    return
  }

  try {
    const user = await findPublicUserById(database, request.session.userId)
    if (!user) {
      response.status(401).json({ error: 'Not authenticated' })
      return
    }
    response.json(user)
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to load session' })
  }
})

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

app.get('/api/printers', requireAuth, async (_request, response) => {
  const database = requirePool(response)
  if (!database) return

  try {
    const result = await database.query(`${printerSelect} ORDER BY printers.created_at`)
    response.json(result.rows)
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to load printers' })
  }
})

app.post('/api/printers', csrfSynchronisedProtection, requireAuth, async (request, response) => {
  const database = requirePool(response)
  if (!database) return

  const { name, model, color, prusalinkUrl, prusalinkApiKey, prusalinkEnabled, activeSpoolId } = request.body as Record<string, unknown>
  const normalizedName = trimmedText(name)
  const normalizedModel = trimmedText(model)
  const normalizedColor = trimmedText(color) || '#f27852'
  const normalizedUrl = nullableText(prusalinkUrl)
  const normalizedApiKey = nullableText(prusalinkApiKey)
  const normalizedActiveSpoolId = nullableText(activeSpoolId)
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
    if (normalizedActiveSpoolId) {
      const spoolResult = await database.query('SELECT id FROM spools WHERE id = $1 AND archived_at IS NULL', [normalizedActiveSpoolId])
      if (spoolResult.rowCount === 0) {
        response.status(400).json({ error: 'Invalid active spool' })
        return
      }
    }

    const result = await database.query(
      `INSERT INTO printers (name, model, color, prusalink_url, prusalink_api_key, prusalink_enabled, active_spool_id, active_spool_assigned_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 IS NULL THEN NULL ELSE now() END)
       RETURNING id`,
      [normalizedName, normalizedModel, normalizedColor, normalizedUrl, normalizedApiKey, enabled, normalizedActiveSpoolId],
    )
    response.status(201).json(await loadPrinter(database, result.rows[0].id))
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to create printer' })
  }
})

app.patch('/api/printers/:id', csrfSynchronisedProtection, requireAuth, async (request, response) => {
  const database = requirePool(response)
  if (!database) return
  const printerId = routeParam(request.params.id)
  if (!printerId) {
    response.status(400).json({ error: 'Invalid printer id' })
    return
  }

  const { name, model, color, prusalinkUrl, prusalinkApiKey, prusalinkEnabled, activeSpoolId } = request.body as Record<string, unknown>
  if ((name !== undefined && !trimmedText(name)) ||
      (model !== undefined && !trimmedText(model)) ||
      (color !== undefined && (!trimmedText(color) || !isHexColor(trimmedText(color)))) ||
      (prusalinkUrl !== undefined && prusalinkUrl !== null && typeof prusalinkUrl !== 'string') ||
      (prusalinkApiKey !== undefined && prusalinkApiKey !== null && typeof prusalinkApiKey !== 'string') ||
      (prusalinkEnabled !== undefined && typeof prusalinkEnabled !== 'boolean') ||
      (activeSpoolId !== undefined && activeSpoolId !== null && typeof activeSpoolId !== 'string')) {
    response.status(400).json({ error: 'Invalid printer update' })
    return
  }

  const current = await database.query(
    `SELECT prusalink_url, prusalink_api_key, prusalink_enabled
     FROM printers
     WHERE id = $1`,
    [printerId],
  )
  if (current.rowCount === 0) {
    response.status(404).json({ error: 'Printer not found' })
    return
  }

  const nextUrl = prusalinkUrl === undefined ? current.rows[0].prusalink_url : nullableText(prusalinkUrl)
  const nextApiKey = prusalinkApiKey === undefined ? current.rows[0].prusalink_api_key : nullableText(prusalinkApiKey)
  const nextEnabled = prusalinkEnabled === undefined ? current.rows[0].prusalink_enabled : prusalinkEnabled
  const nextActiveSpoolId = activeSpoolId === undefined ? undefined : nullableText(activeSpoolId)

  if ((nextUrl && !isValidUrl(nextUrl)) || (nextEnabled && (!nextUrl || !nextApiKey))) {
    response.status(400).json({ error: 'Invalid PrusaLink configuration' })
    return
  }

  try {
    if (nextActiveSpoolId) {
      const spoolResult = await database.query('SELECT id FROM spools WHERE id = $1 AND archived_at IS NULL', [nextActiveSpoolId])
      if (spoolResult.rowCount === 0) {
        response.status(400).json({ error: 'Invalid active spool' })
        return
      }
    }

    const result = await database.query(
      `UPDATE printers
       SET name = COALESCE($1, name),
           model = COALESCE($2, model),
           color = COALESCE($3, color),
           prusalink_url = $4,
           prusalink_api_key = $5,
           prusalink_enabled = $6,
           active_spool_id = CASE WHEN $8 THEN $7 ELSE active_spool_id END,
           active_spool_assigned_at = CASE
             WHEN $8 = false THEN active_spool_assigned_at
             WHEN $7 IS NULL THEN NULL
             WHEN $7 IS DISTINCT FROM active_spool_id THEN now()
             ELSE active_spool_assigned_at
           END
       WHERE id = $9
       RETURNING id`,
      [
        name === undefined ? null : trimmedText(name),
        model === undefined ? null : trimmedText(model),
        color === undefined ? null : trimmedText(color),
        nextUrl,
        nextApiKey,
        nextEnabled,
        nextActiveSpoolId ?? null,
        activeSpoolId !== undefined,
        printerId,
      ],
    )
    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Printer not found' })
      return
    }
    response.json(await loadPrinter(database, printerId))
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to update printer' })
  }
})

app.delete('/api/printers/:id', csrfSynchronisedProtection, requireAuth, async (request, response) => {
  const database = requirePool(response)
  if (!database) return
  const printerId = routeParam(request.params.id)
  if (!printerId) {
    response.status(400).json({ error: 'Invalid printer id' })
    return
  }
  try {
    const result = await database.query('DELETE FROM printers WHERE id = $1 RETURNING id', [printerId])
    if (!result.rowCount) {
      response.status(404).json({ error: 'Printer not found' })
      return
    }
    response.status(204).end()
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to delete printer' })
  }
})

app.post('/api/printers/:id/sync', csrfSynchronisedProtection, requireAuth, async (request, response) => {
  const database = requirePool(response)
  if (!database) return
  const printerId = routeParam(request.params.id)
  if (!printerId) {
    response.status(400).json({ error: 'Invalid printer id' })
    return
  }

  try {
    const printerResult = await database.query(
      `SELECT id, prusalink_url, prusalink_api_key, active_spool_id
       FROM printers
       WHERE id = $1 AND prusalink_enabled = true`,
      [printerId],
    )

    if (printerResult.rowCount === 0) {
      response.status(404).json({ error: 'Enabled printer not found' })
      return
    }

    await syncPrinter(database, printerResult.rows[0])
    response.json(await loadPrinter(database, printerId))
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Unable to sync printer' })
  }
})

app.get('/api/printers/:id/jobs', requireAuth, async (request, response) => {
  const database = requirePool(response)
  if (!database) return
  const printerId = routeParam(request.params.id)
  if (!printerId) {
    response.status(400).json({ error: 'Invalid printer id' })
    return
  }

  try {
    const result = await database.query(
      `SELECT print_jobs.id, print_jobs.name, print_jobs.status, print_jobs.filament_grams, print_jobs.started_at, print_jobs.completed_at, print_jobs.source, print_jobs.external_job_path,
              print_jobs.estimated_filament_grams, print_jobs.spool_id, spools.brand AS spool_brand, spools.material AS spool_material, spools.color AS spool_color
       FROM print_jobs
       LEFT JOIN spools ON spools.id = print_jobs.spool_id
       WHERE print_jobs.printer_id = $1
       ORDER BY print_jobs.created_at DESC
       LIMIT 10`,
      [printerId],
    )
    response.json(result.rows)
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to load printer jobs' })
  }
})

app.get('/api/spools', requireAuth, async (_request, response) => {
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

app.post('/api/spools', csrfSynchronisedProtection, requireAuth, async (request, response) => {
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

app.patch('/api/spools/:id', csrfSynchronisedProtection, requireAuth, async (request, response) => {
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

app.delete('/api/spools/:id', csrfSynchronisedProtection, requireAuth, async (request, response) => {
  const database = requirePool(response)
  if (!database) return
  try {
    const result = await database.query(
      'UPDATE spools SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id',
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

app.use(express.static(frontendDirectory))
app.get(/^(?!\/api(?:\/|$)|\/health$).*/, (_request, response) => {
  response.sendFile(path.join(frontendDirectory, 'index.html'))
})

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (pool) startPrusaLinkScheduler(pool)
  app.listen(port, host, () => {
    console.log(`Print Tracker listening on http://${host}:${port}`)
  })
}
