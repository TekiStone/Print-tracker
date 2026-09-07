export type PrinterStatus = 'printing' | 'ready' | 'offline' | 'error'

type ApiPrinter = {
  id: string
  name: string
  model: string
  status: PrinterStatus
  current_job: string | null
  progress: number | null
  color: string
  last_seen_at: string | null
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

export type Printer = {
  id: string
  name: string
  model: string
  status: PrinterStatus
  job?: string
  progress?: number
  color: string
  lastSeenAt?: string
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
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
