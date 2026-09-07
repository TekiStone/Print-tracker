import type { Pool } from 'pg'

type PrinterStatus = 'printing' | 'ready' | 'offline' | 'error'
type PrintJobStatus = 'queued' | 'printing' | 'completed' | 'failed' | 'cancelled'

type SyncablePrinter = {
  id: string
  prusalink_url: string | null
  prusalink_api_key: string | null
  active_spool_id: string | null
}

type VersionResponse = {
  original?: string
  firmware?: string
  server?: string
}

type PrinterFlags = {
  operational?: boolean
  paused?: boolean
  printing?: boolean
  error?: boolean
  ready?: boolean
}

type PrinterState = {
  text?: string
  flags?: PrinterFlags
}

type PrinterTemperature = {
  actual?: number
  target?: number
}

type PrinterResponse = {
  temperature?: {
    bed?: PrinterTemperature
    tool0?: PrinterTemperature
  }
  state?: PrinterState | string
  telemetry?: Record<string, unknown>
}

type JobResponse = {
  state?: string | { text?: string }
  job?: {
    file?: {
      path?: string
      display?: string
      name?: string
    }
  }
  progress?: {
    completion?: number
  }
}

type SyncResult = {
  status: PrinterStatus
  currentJob: string | null
  progress: number | null
  nozzleTemperature: number | null
  nozzleTargetTemperature: number | null
  bedTemperature: number | null
  bedTargetTemperature: number | null
  firmwareVersion: string | null
  prusalinkVersion: string | null
  externalJobPath: string | null
  estimatedFilamentGrams: number | null
  jobStatus: PrintJobStatus
}

const defaultSyncIntervalMs = Number(process.env.PRUSALINK_SYNC_INTERVAL_MS ?? 60000)
const requestTimeoutMs = Number(process.env.PRUSALINK_REQUEST_TIMEOUT_MS ?? 8000)

function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, '')
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function statusText(value: JobResponse['state'] | PrinterResponse['state']) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text
  return ''
}

function determinePrinterStatus(printer: PrinterResponse, job: JobResponse) {
  const flags = typeof printer.state === 'object' && printer.state ? printer.state.flags : undefined
  const jobState = statusText(job.state).toLowerCase()
  const printerState = statusText(printer.state).toLowerCase()
  const combined = `${printerState} ${jobState}`

  if (flags?.error || combined.includes('error') || combined.includes('attention')) return 'error'
  if (flags?.printing || combined.includes('printing') || combined.includes('paus')) return 'printing'
  if (flags?.operational || flags?.ready || combined.includes('ready') || combined.includes('operational') || combined.includes('idle') || combined.includes('finished')) return 'ready'
  return 'offline'
}

function determineJobStatus(status: PrinterStatus, job: JobResponse): PrintJobStatus {
  const state = statusText(job.state).toLowerCase()
  if (state.includes('cancel')) return 'cancelled'
  if (state.includes('fail') || state.includes('error')) return 'failed'
  if (status === 'printing') return 'printing'
  if (state.includes('queue')) return 'queued'
  return 'completed'
}

function mapProgress(progress?: number) {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return null
  return progress <= 1 ? Math.round(progress * 100) : Math.round(progress)
}

function readTelemetryTemperature(telemetry: Record<string, unknown> | undefined, key: string) {
  if (!telemetry) return null
  return asNumber(telemetry[key])
}

function buildSyncResult(version: VersionResponse, printer: PrinterResponse, job: JobResponse): SyncResult {
  const status = determinePrinterStatus(printer, job)
  const externalJobPath = job.job?.file?.path ?? null
  const currentJob = job.job?.file?.display ?? job.job?.file?.name ?? externalJobPath
  const nozzleTemperature = asNumber(printer.temperature?.tool0?.actual) ?? readTelemetryTemperature(printer.telemetry, 'temp-nozzle')
  const nozzleTargetTemperature = asNumber(printer.temperature?.tool0?.target) ?? readTelemetryTemperature(printer.telemetry, 'target-nozzle')
  const bedTemperature = asNumber(printer.temperature?.bed?.actual) ?? readTelemetryTemperature(printer.telemetry, 'temp-bed')
  const bedTargetTemperature = asNumber(printer.temperature?.bed?.target) ?? readTelemetryTemperature(printer.telemetry, 'target-bed')

  return {
    status,
    currentJob: currentJob ?? null,
    progress: mapProgress(job.progress?.completion),
    nozzleTemperature,
    nozzleTargetTemperature,
    bedTemperature,
    bedTargetTemperature,
    firmwareVersion: version.firmware ?? null,
    prusalinkVersion: version.server ?? null,
    externalJobPath,
    estimatedFilamentGrams: null,
    jobStatus: determineJobStatus(status, job),
  }
}

async function requestJson<T>(printer: SyncablePrinter, path: string): Promise<T> {
  const signal = AbortSignal.timeout(requestTimeoutMs)
  const response = await fetch(`${normalizeBaseUrl(printer.prusalink_url ?? '')}${path}`, {
    headers: {
      Accept: 'application/json',
      'X-Api-Key': printer.prusalink_api_key ?? '',
    },
    signal,
  })

  if (!response.ok) {
    throw new Error(`PrusaLink ${response.status} sur ${path}`)
  }

  return response.json() as Promise<T>
}

async function requestText(printer: SyncablePrinter, path: string): Promise<string> {
  const signal = AbortSignal.timeout(requestTimeoutMs)
  const response = await fetch(`${normalizeBaseUrl(printer.prusalink_url ?? '')}${path}`, {
    headers: {
      Accept: 'text/plain, application/octet-stream;q=0.9, */*;q=0.8',
      'X-Api-Key': printer.prusalink_api_key ?? '',
    },
    signal,
  })

  if (!response.ok) {
    throw new Error(`PrusaLink ${response.status} sur ${path}`)
  }

  const reader = response.body?.getReader()
  if (!reader) return response.text()

  const decoder = new TextDecoder()
  let content = ''
  let bytes = 0

  while (bytes < 128_000) {
    const { done, value } = await reader.read()
    if (done || !value) break
    bytes += value.byteLength
    content += decoder.decode(value, { stream: true })
    if (content.includes('\n; END') || content.length >= 128_000) break
  }

  content += decoder.decode()
  reader.releaseLock()
  return content
}

function parseEstimatedFilament(header: string) {
  const line = header.match(/^;\s*filament used \[g\]\s*=\s*(.+)$/im)
  if (!line?.[1]) return null

  const values = Array.from(line[1].matchAll(/(\d+(?:[.,]\d+)?)/g), (match) => Number(match[1].replace(',', '.')))
    .filter((value) => Number.isFinite(value))

  if (values.length === 0) return null
  return Math.max(0, Math.round(values.reduce((total, value) => total + value, 0)))
}

function buildFileCandidates(path: string) {
  const normalized = path.replace(/^\/+/, '')
  if (!normalized) return []

  const candidates = [{ target: 'local', path: normalized }]

  if (normalized.startsWith('sdcard/')) {
    candidates.unshift({ target: 'sdcard', path: normalized.slice('sdcard/'.length) })
  } else if (normalized.startsWith('local/')) {
    candidates.unshift({ target: 'local', path: normalized.slice('local/'.length) })
  }

  return candidates.filter((candidate) => candidate.path)
}

function encodeFilePath(path: string) {
  return path
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')
}

async function estimateFilamentUsage(printer: SyncablePrinter, externalJobPath: string | null) {
  if (!externalJobPath) return null

  const candidates = buildFileCandidates(externalJobPath)
  for (const candidate of candidates) {
    try {
      const raw = await requestText(printer, `/api/files/${candidate.target}/${encodeFilePath(candidate.path)}/raw`)
      const estimated = parseEstimatedFilament(raw)
      if (estimated !== null) return estimated
    } catch {
      // Try next candidate path.
    }
  }

  return null
}

async function applyFilamentUsage(database: Pool, spoolId: string | null, estimatedFilamentGrams: number | null, jobId: string) {
  if (!spoolId || !estimatedFilamentGrams || estimatedFilamentGrams <= 0) return

  const client = await database.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE spools
       SET remaining_grams = GREATEST(0, remaining_grams - $1)
       WHERE id = $2 AND archived_at IS NULL`,
      [estimatedFilamentGrams, spoolId],
    )
    await client.query(
      `UPDATE print_jobs
       SET filament_grams = COALESCE(filament_grams, $1),
           filament_applied_at = now()
       WHERE id = $2`,
      [estimatedFilamentGrams, jobId],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function closeActiveJobs(database: Pool, printerId: string, nextStatus: PrintJobStatus) {
  const result = await database.query<{ id: string, spool_id: string | null, estimated_filament_grams: number | null, filament_applied_at: string | null }>(
    `UPDATE print_jobs
     SET status = $1,
         completed_at = COALESCE(completed_at, now())
     WHERE printer_id = $2 AND source = 'prusalink' AND completed_at IS NULL
     RETURNING id, spool_id, estimated_filament_grams, filament_applied_at`,
    [nextStatus, printerId],
  )

  if (nextStatus !== 'completed') return

  for (const job of result.rows) {
    if (job.filament_applied_at) continue
    await applyFilamentUsage(database, job.spool_id, job.estimated_filament_grams, job.id)
  }
}

async function syncPrintJob(database: Pool, printer: SyncablePrinter, result: SyncResult) {
  if (result.status !== 'printing' || !result.externalJobPath || !result.currentJob) {
    await closeActiveJobs(database, printer.id, result.jobStatus)
    return
  }

  await database.query(
    `INSERT INTO print_jobs (printer_id, spool_id, name, status, started_at, source, external_job_path, filament_grams, estimated_filament_grams)
     VALUES ($1, $2, $3, $4, now(), 'prusalink', $5, $6, $6)
     ON CONFLICT (printer_id, external_job_path) WHERE source = 'prusalink' AND completed_at IS NULL
     DO UPDATE SET status = EXCLUDED.status,
                   spool_id = COALESCE(print_jobs.spool_id, EXCLUDED.spool_id),
                   filament_grams = COALESCE(print_jobs.filament_grams, EXCLUDED.filament_grams),
                   estimated_filament_grams = COALESCE(print_jobs.estimated_filament_grams, EXCLUDED.estimated_filament_grams)`,
    [printer.id, printer.active_spool_id, result.currentJob, result.jobStatus, result.externalJobPath, result.estimatedFilamentGrams],
  )
}

async function updateSyncError(database: Pool, printerId: string, error: string) {
  await database.query(
    `UPDATE printers
     SET last_sync_at = now(),
         last_sync_error = $1
     WHERE id = $2`,
    [error, printerId],
  )
}

export async function syncPrinter(database: Pool, printer: SyncablePrinter) {
  if (!printer.prusalink_url || !printer.prusalink_api_key) {
    await updateSyncError(database, printer.id, 'Configuration PrusaLink incomplète')
    throw new Error('Configuration PrusaLink incomplète')
  }

  try {
    const [version, printerState, job] = await Promise.all([
      requestJson<VersionResponse>(printer, '/api/version'),
      requestJson<PrinterResponse>(printer, '/api/printer'),
      requestJson<JobResponse>(printer, '/api/job'),
    ])

    const result = buildSyncResult(version, printerState, job)
    result.estimatedFilamentGrams = await estimateFilamentUsage(printer, result.externalJobPath)

    await database.query(
      `UPDATE printers
       SET status = $1,
           current_job = $2,
           progress = $3,
           nozzle_temperature = $4,
           nozzle_target_temperature = $5,
           bed_temperature = $6,
           bed_target_temperature = $7,
           firmware_version = $8,
           prusalink_version = $9,
           last_seen_at = now(),
           last_sync_at = now(),
           last_sync_error = NULL
       WHERE id = $10`,
      [
        result.status,
        result.currentJob,
        result.progress,
        result.nozzleTemperature,
        result.nozzleTargetTemperature,
        result.bedTemperature,
        result.bedTargetTemperature,
        result.firmwareVersion,
        result.prusalinkVersion,
        printer.id,
      ],
    )

    await syncPrintJob(database, printer, result)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Synchronisation PrusaLink impossible'
    await updateSyncError(database, printer.id, message)
    throw error
  }
}

export async function syncEnabledPrinters(database: Pool) {
  const result = await database.query<SyncablePrinter>(
    `SELECT id, prusalink_url, prusalink_api_key, active_spool_id
     FROM printers
     WHERE prusalink_enabled = true`,
  )

  await Promise.all(result.rows.map(async (printer) => {
    try {
      await syncPrinter(database, printer)
    } catch {
      // Errors are stored on the printer row.
    }
  }))
}

export function startPrusaLinkScheduler(database: Pool) {
  if (!Number.isFinite(defaultSyncIntervalMs) || defaultSyncIntervalMs <= 0) return

  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      await syncEnabledPrinters(database)
    } finally {
      running = false
    }
  }

  void run()
  setInterval(() => {
    void run()
  }, defaultSyncIntervalMs)
}
