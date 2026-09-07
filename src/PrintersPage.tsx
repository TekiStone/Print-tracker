import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

export type PrinterStatus = 'printing' | 'ready' | 'offline' | 'error'

export type Printer = {
  id: string
  name: string
  model: string
  status: PrinterStatus
  currentJob?: string | null
  progress?: number | null
  color: string
  prusalinkUrl?: string | null
  lastSeenAt?: string | null
}

type PrinterForm = Pick<Printer, 'name' | 'model' | 'status' | 'currentJob' | 'progress' | 'color' | 'prusalinkUrl'>
type ApiPrinter = {
  id: string
  name: string
  model: string
  status: PrinterStatus
  current_job?: string | null
  progress?: number | null
  color: string
  prusalink_url?: string | null
  last_seen_at?: string | null
}

const initialPrinters: Printer[] = [
  { id: 'local-xl', name: 'Prusa XL', model: '5 outils', status: 'printing', currentJob: 'Support mural', progress: 68, color: '#f47b5f' },
  { id: 'local-core', name: 'Prusa Core One+', model: 'Core One+', status: 'ready', color: '#4b9bff' },
  { id: 'local-mini', name: 'Prusa MINI+', model: 'MINI+', status: 'offline', color: '#a58bff' },
]

const emptyForm: PrinterForm = { name: '', model: '', status: 'ready', currentJob: '', progress: null, color: '#f27852', prusalinkUrl: '' }
const statusLabel: Record<PrinterStatus, string> = { printing: 'En impression', ready: 'Prête', offline: 'Hors ligne', error: 'Erreur' }

function readLocalPrinters() {
  const saved = localStorage.getItem('print-tracker-printers')
  if (!saved) return initialPrinters
  try {
    const parsed = JSON.parse(saved) as Printer[]
    return Array.isArray(parsed) ? parsed : initialPrinters
  } catch {
    return initialPrinters
  }
}

function saveLocalPrinters(printers: Printer[]) {
  localStorage.setItem('print-tracker-printers', JSON.stringify(printers))
}

export function PrintersPage() {
  const [printers, setPrinters] = useState<Printer[]>(readLocalPrinters)
  const [form, setForm] = useState<PrinterForm>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetch('/api/printers')
      .then(async (response) => {
        if (!response.ok) throw new Error('API indisponible')
        const data = await response.json() as ApiPrinter[]
        setPrinters(data.map((printer) => ({ id: printer.id, name: printer.name, model: printer.model, status: printer.status, progress: printer.progress, color: printer.color, currentJob: printer.current_job, prusalinkUrl: printer.prusalink_url, lastSeenAt: printer.last_seen_at })))
      })
      .catch(() => setMessage('Mode local : connecte une base pour synchroniser les imprimantes.'))
  }, [])

  function update(next: Printer[]) {
    setPrinters(next)
    saveLocalPrinters(next)
  }

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm)
    setIsFormOpen(true)
  }

  function openEdit(printer: Printer) {
    setEditingId(printer.id)
    setForm({ name: printer.name, model: printer.model, status: printer.status, currentJob: printer.currentJob ?? '', progress: printer.progress ?? null, color: printer.color, prusalinkUrl: printer.prusalinkUrl ?? '' })
    setIsFormOpen(true)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.name.trim() || !form.model.trim() || (form.status === 'printing' && (!form.currentJob?.trim() || form.progress === null || form.progress < 0 || form.progress > 100))) return
    const normalized = { ...form, name: form.name.trim(), model: form.model.trim(), currentJob: form.status === 'printing' ? form.currentJob?.trim() : null, progress: form.status === 'printing' ? form.progress : null }
    update(editingId
      ? printers.map((printer) => printer.id === editingId ? { ...printer, ...normalized } : printer)
      : [{ ...normalized, id: `local-${Date.now()}` }, ...printers])
    setIsFormOpen(false)
  }

  function remove(id: string) {
    if (window.confirm('Retirer cette imprimante ?')) update(printers.filter((printer) => printer.id !== id))
  }

  return (
    <div className="content printer-page">
      <div className="page-heading">
        <div><p className="eyebrow">GESTION DU PARC</p><h1>Tes imprimantes</h1><p className="subtitle">Gère tes machines et suis leur état.</p></div>
        <button type="button" className="primary-button" onClick={openCreate}><span>+</span> Ajouter une imprimante</button>
      </div>
      {message && <p className="inline-message">{message}</p>}
      <section className="managed-printers">
        {printers.map((printer) => <article className="managed-printer" key={printer.id}>
          <div className="managed-printer__header"><div className="printer-avatar" style={{ background: printer.color }}>▣</div><div><h3>{printer.name}</h3><p>{printer.model}</p></div><span className={`status status--${printer.status}`}><span />{statusLabel[printer.status]}</span></div>
          {printer.status === 'printing' ? <><div className="job__row"><span>{printer.currentJob}</span><strong>{printer.progress}%</strong></div><div className="progress"><span style={{ width: `${printer.progress}%` }} /></div></> : <p className="printer-detail">{printer.status === 'ready' ? 'Aucun travail en attente' : printer.status === 'offline' ? 'Machine hors ligne' : 'Une erreur nécessite ton attention'}</p>}
          <div className="managed-spool__actions"><button type="button" className="text-button" onClick={() => openEdit(printer)}>Modifier</button><button type="button" className="danger-button" onClick={() => remove(printer.id)}>Retirer</button></div>
        </article>)}
        {printers.length === 0 && <div className="empty-spools">Aucune imprimante. Ajoute ta première machine.</div>}
      </section>
      {isFormOpen && <div className="modal-backdrop" role="presentation"><form className="spool-form" onSubmit={submit}><div className="modal-heading"><div><p className="eyebrow">{editingId ? 'MODIFICATION' : 'NOUVELLE IMPRIMANTE'}</p><h2>{editingId ? 'Modifier l’imprimante' : 'Ajouter une imprimante'}</h2></div><button type="button" className="close-button" onClick={() => setIsFormOpen(false)}>×</button></div><label>Nom<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex. Prusa XL" /></label><label>Modèle<input required value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="Ex. 5 outils" /></label><div className="form-grid"><label>État<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as PrinterStatus })}>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Couleur<input type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} /></label></div>{form.status === 'printing' && <div className="form-grid"><label>Travail en cours<input required value={form.currentJob ?? ''} onChange={(event) => setForm({ ...form, currentJob: event.target.value })} /></label><label>Progression (%)<input required type="number" min="0" max="100" value={form.progress ?? ''} onChange={(event) => setForm({ ...form, progress: event.target.value === '' ? null : Number(event.target.value) })} /></label></div>}<label>URL PrusaLink <input type="url" value={form.prusalinkUrl ?? ''} onChange={(event) => setForm({ ...form, prusalinkUrl: event.target.value })} placeholder="https://..." /></label><button type="submit" className="primary-button form-submit">Enregistrer</button></form></div>}
    </div>
  )
}
