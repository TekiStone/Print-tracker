import 'dotenv/config'
import bcrypt from 'bcryptjs'
import connectPgSimple from 'connect-pg-simple'
import cors from 'cors'
import express from 'express'
import session from 'express-session'
import { Pool } from 'pg'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

export const app = express()

export function setDatabasePool(database: Pool | null) {
  pool = database
}

app.set('trust proxy', 1)
app.use(cors({ origin: webOrigin, credentials: true }))
app.use(express.json())

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

type PublicUser = { id: string; email: string; name: string; role: string }

async function findPublicUserById(database: Pool, id: string): Promise<PublicUser | null> {
  const result = await database.query('SELECT id, email, name, role FROM users WHERE id = $1', [id])
  return result.rows[0] ?? null
}

app.post('/api/auth/register', async (request, response) => {
  const database = requirePool(response)
  if (!database) return
  const { email, password, name } = request.body as Record<string, unknown>
  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || password.length < 8 ||
      typeof name !== 'string' || !name.trim()) {
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

app.post('/api/auth/login', async (request, response) => {
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

app.post('/api/auth/logout', (request, response) => {
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

app.get('/api/spools', requireAuth, async (_request, response) => {
app.post('/api/printers', requireAuth, async (request, response) => {
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

app.patch('/api/printers/:id', requireAuth, async (request, response) => {
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

app.delete('/api/printers/:id', requireAuth, async (request, response) => {
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

app.post('/api/spools', requireAuth, async (request, response) => {
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

app.patch('/api/spools/:id', requireAuth, async (request, response) => {
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

app.delete('/api/spools/:id', requireAuth, async (request, response) => {
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

app.use(express.static(frontendDirectory))
app.get(/^(?!\/api(?:\/|$)|\/health$).*/, (_request, response) => {
  response.sendFile(path.join(frontendDirectory, 'index.html'))
})

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  app.listen(port, host, () => {
    console.log(`Print Tracker listening on http://${host}:${port}`)
  })
}
