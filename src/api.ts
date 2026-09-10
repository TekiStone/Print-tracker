import { getCsrfToken } from './csrf'

export type PrinterStatus = 'printing' | 'ready' | 'offline' | 'error'
export type PrintJobStatus = 'queued' | 'printing' | 'completed' | 'failed' | 'cancelled'

type ApiPrinter = {
  id: string
  name: string
  model: string
  status: PrinterStatus
  current_job: string | null
  progress: number | null
  color: string
  last_seen_at: string | null
  prusalink_url: string | null
  prusalink_enabled: boolean
  nozzle_temperature: number | null
  nozzle_target_temperature: number | null
  bed_temperature: number | null
  bed_target_temperature: number | null
  firmware_version: string | null
  prusalink_version: string | null
  last_sync_at: string | null
  last_sync_error: string | null
  active_spool_id: string | null
  active_spool_assigned_at: string | null
  active_spool_brand: string | null
  active_spool_material: string | null
  active_spool_color: string | null
}

type ApiSpool = {
  id: string
  brand: string
  material: string
  color: string
  remaining_grams: number
  initial_grams: number
  location: string | null
  qr_url: string | null
  prusament_id: string | null
}

type ApiPrintJob = {
  id: string
  name: string
  status: PrintJobStatus
  filament_grams: number | null
  started_at: string | null
  completed_at: string | null
  source: 'manual' | 'prusalink'
  external_job_path: string | null
  estimated_filament_grams: number | null
  spool_id: string | null
  spool_brand: string | null
  spool_material: string | null
  spool_color: string | null
}

export type Printer = {
  id: string
  name: string
  model: string
  status: PrinterStatus
  job?: string
  progress?: number
  color: string
  lastSeenAt?: string
  prusalinkUrl?: string
  prusalinkEnabled: boolean
  nozzleTemperature?: number
  nozzleTargetTemperature?: number
  bedTemperature?: number
  bedTargetTemperature?: number
  firmwareVersion?: string
  prusalinkVersion?: string
  lastSyncAt?: string
  lastSyncError?: string
  activeSpoolId?: string
  activeSpoolAssignedAt?: string
  activeSpoolLabel?: string
  activeSpoolColor?: string
}

export type Spool = {
  id: string
  brand: string
  material: string
  color: string
  remaining: number
  initial: number
  location: string
  qrUrl?: string
  prusamentId?: string
}

export type SpoolPayload = {
  brand: string
  material: string
  color: string
  initialGrams: number
  remainingGrams: number
  location: string
  qrUrl?: string
  prusamentId?: string
}

export type PrinterPayload = {
  name: string
  model: string
  color: string
  prusalinkUrl?: string
  prusalinkApiKey?: string
  prusalinkEnabled: boolean
  activeSpoolId?: string | null
}

type ApiAppSettings = {
  registrationEnabled: boolean
  localLoginEnabled: boolean
  authentikEnabled: boolean
  authentikConfigured: boolean
}

type ApiAdminUser = {
  id: string
  email: string
  name: string
  role: 'admin' | 'member'
  auth_provider: string
  created_at: string
}

export type AppSettings = ApiAppSettings

export type AdminUser = {
  id: string
  email: string
  name: string
  role: 'admin' | 'member'
  authProvider: string
  createdAt: string
}

export type PrintJob = {
  id: string
  name: string
  status: PrintJobStatus
  filamentGrams?: number
  startedAt?: string
  completedAt?: string
  source: 'manual' | 'prusalink'
  externalJobPath?: string
  estimatedFilamentGrams?: number
  spoolId?: string
  spoolLabel?: string
  spoolColor?: string
}

function mapPrinter(printer: ApiPrinter): Printer {
  return {
    id: printer.id,
    name: printer.name,
    model: printer.model,
    status: printer.status,
    job: printer.current_job ?? undefined,
    progress: printer.progress ?? undefined,
    color: printer.color,
    lastSeenAt: printer.last_seen_at ?? undefined,
    prusalinkUrl: printer.prusalink_url ?? undefined,
    prusalinkEnabled: printer.prusalink_enabled,
    nozzleTemperature: printer.nozzle_temperature ?? undefined,
    nozzleTargetTemperature: printer.nozzle_target_temperature ?? undefined,
    bedTemperature: printer.bed_temperature ?? undefined,
    bedTargetTemperature: printer.bed_target_temperature ?? undefined,
    firmwareVersion: printer.firmware_version ?? undefined,
    prusalinkVersion: printer.prusalink_version ?? undefined,
    lastSyncAt: printer.last_sync_at ?? undefined,
    lastSyncError: printer.last_sync_error ?? undefined,
    activeSpoolId: printer.active_spool_id ?? undefined,
    activeSpoolAssignedAt: printer.active_spool_assigned_at ?? undefined,
    activeSpoolLabel: printer.active_spool_brand
      ? `${printer.active_spool_brand} ${printer.active_spool_material ?? ''}`.trim()
      : undefined,
    activeSpoolColor: printer.active_spool_color ?? undefined,
  }
}

function mapSpool(spool: ApiSpool): Spool {
  return {
    id: spool.id,
    brand: spool.brand,
    material: spool.material,
    color: spool.color,
    remaining: spool.remaining_grams,
    initial: spool.initial_grams,
    location: spool.location ?? '',
    qrUrl: spool.qr_url ?? undefined,
    prusamentId: spool.prusament_id ?? undefined,
  }
}

function mapAdminUser(user: ApiAdminUser): AdminUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    authProvider: user.auth_provider,
    createdAt: user.created_at,
  }
}

function mapPrintJob(job: ApiPrintJob): PrintJob {
  return {
    id: job.id,
    name: job.name,
    status: job.status,
    filamentGrams: job.filament_grams ?? undefined,
    startedAt: job.started_at ?? undefined,
    completedAt: job.completed_at ?? undefined,
    source: job.source,
    externalJobPath: job.external_job_path ?? undefined,
    estimatedFilamentGrams: job.estimated_filament_grams ?? undefined,
    spoolId: job.spool_id ?? undefined,
    spoolLabel: job.spool_brand ? `${job.spool_brand} ${job.spool_material ?? ''}`.trim() : undefined,
    spoolColor: job.spool_color ?? undefined,
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method?.toUpperCase() ?? 'GET'
  const headers = new Headers(init?.headers)
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && !headers.has('x-csrf-token')) {
    headers.set('x-csrf-token', await getCsrfToken())
  }

  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...Object.fromEntries(headers.entries()),
    },
  })

  if (!response.ok) {
    let message = `Requête ${path} en échec`
    try {
      const body = await response.json() as { error?: string }
      if (body.error) message = body.error
    } catch {
      // Ignore invalid JSON body
    }
    throw new Error(message)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export async function listPrinters() {
  const printers = await request<ApiPrinter[]>('/api/printers')
  return printers.map(mapPrinter)
}

export async function createPrinter(payload: PrinterPayload) {
  const printer = await request<ApiPrinter>('/api/printers', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return mapPrinter(printer)
}

export async function updatePrinter(id: string, payload: Partial<PrinterPayload>) {
  const printer = await request<ApiPrinter>(`/api/printers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  return mapPrinter(printer)
}

export async function syncPrinterNow(id: string) {
  const printer = await request<ApiPrinter>(`/api/printers/${id}/sync`, {
    method: 'POST',
  })
  return mapPrinter(printer)
}

export async function deletePrinter(id: string) {
  await request<void>(`/api/printers/${id}`, {
    method: 'DELETE',
  })
}

export async function listPrinterJobs(id: string) {
  const jobs = await request<ApiPrintJob[]>(`/api/printers/${id}/jobs`)
  return jobs.map(mapPrintJob)
}

export async function listSpools() {
  const spools = await request<ApiSpool[]>('/api/spools')
  return spools.map(mapSpool)
}

export async function createSpool(payload: SpoolPayload) {
  const spool = await request<ApiSpool>('/api/spools', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return mapSpool(spool)
}

export async function updateSpool(id: string, payload: Partial<SpoolPayload>) {
  const spool = await request<ApiSpool>(`/api/spools/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  return mapSpool(spool)
}

export async function deleteSpool(id: string) {
  await request<void>(`/api/spools/${id}`, {
    method: 'DELETE',
  })
}

export async function getSettings() {
  return request<ApiAppSettings>('/api/settings')
}

export async function updateSettings(payload: Partial<AppSettings>) {
  return request<ApiAppSettings>('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function listUsers() {
  const users = await request<ApiAdminUser[]>('/api/admin/users')
  return users.map(mapAdminUser)
}

export async function updateUserRole(id: string, role: 'admin' | 'member') {
  const user = await request<ApiAdminUser>(`/api/admin/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  })
  return mapAdminUser(user)
}

export async function deleteUser(id: string) {
  await request<void>(`/api/admin/users/${id}`, {
    method: 'DELETE',
  })
}
