import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { Pool } from 'pg'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { authConfigured, completeLogin, hashPassword, requireAuth, sessionMiddleware, startLogin, verifyPassword } from './auth.js'

const app = express()
const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const frontendDirectory = path.join(projectRoot, 'dist')

app.set('trust proxy', 1)
app.use(cors())
app.use(sessionMiddleware())
app.use(express.json())

app.get('/auth/config', (_request, response) => response.json({ enabled: authConfigured() || pool !== null, oidc: authConfigured() }))
app.get('/auth/login', async (request, response, next) => {
  try { await startLogin(request, response) } catch (error) { next(error) }
})
app.get('/auth/callback', async (request, response, next) => {
  try {
    const user = await completeLogin(request, response)
    if (user && pool) {
      await pool.query(
        `INSERT INTO users (oidc_subject, username, email, display_name, picture_url, last_login_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (oidc_subject) DO UPDATE SET username = $2, email = $3, display_name = $4, picture_url = $5, last_login_at = now()`,
        [user.subject, user.username, user.email ?? null, user.name ?? null, user.picture ?? null],
      )
    }
  } catch (error) { next(error) }
})
app.get('/auth/me', (request, response) => response.json({ authenticated: Boolean(request.session.user), user: request.session.user ?? null }))
app.post('/auth/logout', (request, response) => {
  request.session.destroy((error) => {
    if (error) { response.status(500).json({ error: 'Unable to logout' }); return }
    response.clearCookie('connect.sid')
    response.status(204).end()
  })

  app.post('/auth/register', async (request, response, next) => {
    const database = requirePool(response)
    if (!database) return
    const { username, email, password } = request.body as Record<string, unknown>
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,32}$/.test(username) ||
        (email !== undefined && typeof email !== 'string') ||
        typeof password !== 'string' || password.length < 10) {
      response.status(400).json({ error: 'Nom utilisateur ou mot de passe invalide' })
      return
    }
    try {
      const passwordHash = await hashPassword(password)
      const result = await database.query<{ id: string; username: string; email: string | null }>(
        `INSERT INTO users (oidc_subject, username, email, password_hash)
         VALUES (NULL, $1, $2, $3)
         RETURNING id, username, email`,
        [username.trim(), typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null, passwordHash],
      )
      const user = result.rows[0]
      request.session.user = { subject: `local:${user.id}`, username: user.username, email: user.email ?? undefined }
      response.status(201).json({ user: request.session.user })
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
        response.status(409).json({ error: 'Nom utilisateur ou adresse e-mail déjà utilisé' })
        return
      }
      next(error)
    }
  })

  app.post('/auth/login', async (request, response, next) => {
    const database = requirePool(response)
    if (!database) return
    const { identifier, password } = request.body as Record<string, unknown>
    if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier.trim() || !password) {
      response.status(400).json({ error: 'Identifiants invalides' })
      return
    }
    try {
      const result = await database.query<{ id: string; username: string; email: string | null; password_hash: string | null }>(
        `SELECT id, username, email, password_hash FROM users
         WHERE lower(username) = lower($1) OR lower(email) = lower($1)
         LIMIT 1`,
        [identifier.trim()],
      )
      const account = result.rows[0]
      if (!account?.password_hash || !(await verifyPassword(password, account.password_hash))) {
        response.status(401).json({ error: 'Identifiants invalides' })
        return
      }
      request.session.user = { subject: `local:${account.id}`, username: account.username, email: account.email ?? undefined }
      response.json({ user: request.session.user })
    } catch (error) {
      next(error)
    }
  })
})

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

app.use('/api', (request, response, next) => requireAuth(request, response, next, authConfigured() || pool !== null))
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

app.use(express.static(frontendDirectory))
app.get(/^(?!\/api(?:\/|$)|\/health$).*/, (_request, response) => {
  response.sendFile(path.join(frontendDirectory, 'index.html'))
})

app.listen(port, host, () => {
  console.log(`Print Tracker listening on http://${host}:${port}`)
})
