import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const migrationsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is not configured, skipping migrations')
    process.exit(1)
  }

  const pool = new Pool({ connectionString })

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)

    const files = fs.readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith('.sql'))
      .sort()

    const { rows } = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations')
    const applied = new Set(rows.map((row) => row.filename))

    for (const file of files) {
      if (applied.has(file)) continue

      const sql = fs.readFileSync(path.join(migrationsDirectory, file), 'utf8')
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
        await client.query('COMMIT')
        console.log(`Applied migration ${file}`)
      } catch (error) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        client.release()
      }
    }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
