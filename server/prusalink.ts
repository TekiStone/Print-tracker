import type { Pool } from 'pg'

type PrinterStatus = 'printing' | 'ready' | 'offline' | 'error'
type PrintJobStatus = 'queued' | 'printing' | 'completed' | 'failed' | 'cancelled'

type SyncablePrinter = {
  id: string
  prusalink_url: string | null
  prusalink_api_key: string | null
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

async function closeActiveJobs(database: Pool, printerId: string, nextStatus: PrintJobStatus) {
  await database.query(
    `UPDATE print_jobs
     SET status = $1,
         completed_at = COALESCE(completed_at, now())
     WHERE printer_id = $2 AND source = 'prusalink' AND completed_at IS NULL`,
    [nextStatus, printerId],
  )
}

async function syncPrintJob(database: Pool, printerId: string, result: SyncResult) {
  if (result.status !== 'printing' || !result.externalJobPath || !result.currentJob) {
    await closeActiveJobs(database, printerId, result.jobStatus)
    return
  }

  await database.query(
    `INSERT INTO print_jobs (printer_id, name, status, started_at, source, external_job_path)
     VALUES ($1, $2, $3, now(), 'prusalink', $4)
     ON CONFLICT (printer_id, external_job_path) WHERE source = 'prusalink' AND completed_at IS NULL
     DO UPDATE SET status = EXCLUDED.status`,
    [printerId, result.currentJob, result.jobStatus, result.externalJobPath],
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

    await syncPrintJob(database, printer.id, result)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Synchronisation PrusaLink impossible'
    await updateSyncError(database, printer.id, message)
    throw error
  }
}

export async function syncEnabledPrinters(database: Pool) {
  const result = await database.query<SyncablePrinter>(
    `SELECT id, prusalink_url, prusalink_api_key
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
