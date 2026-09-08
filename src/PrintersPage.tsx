import { useEffect, useState } from 'react'
import { createPrinter, deletePrinter, listPrinterJobs, listPrinters, listSpools, syncPrinterNow, updatePrinter, type PrintJob, type Printer, type PrinterPayload, type Spool } from './api'

type FormState = PrinterPayload & { prusalinkApiKey: string }

const emptyForm: FormState = {
  name: '',
  model: '',
  color: '#f27852',
  prusalinkUrl: '',
  prusalinkApiKey: '',
  prusalinkEnabled: false,
  activeSpoolId: null,
}

const statusLabel = {
  printing: 'En impression',
  ready: 'Prête',
  offline: 'Hors ligne',
  error: 'Erreur',
}

const jobStatusLabel = {
  queued: 'En file',
  printing: 'En impression',
  completed: 'Terminée',
  failed: 'Échec',
  cancelled: 'Annulée',
}

function formatDateTime(value?: string) {
  if (!value) return 'Jamais'
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function formatTemperature(actual?: number, target?: number) {
  if (actual === undefined && target === undefined) return 'n/d'
  if (actual !== undefined && target !== undefined) return `${Math.round(actual)}° / ${Math.round(target)}°`
  return `${Math.round(actual ?? target ?? 0)}°`
}

export function PrintersPage() {
  const [printers, setPrinters] = useState<Printer[]>([])
  const [spools, setSpools] = useState<Spool[]>([])
  const [jobsByPrinter, setJobsByPrinter] = useState<Record<string, PrintJob[]>>({})
  const [loadingJobsFor, setLoadingJobsFor] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [editingPrinter, setEditingPrinter] = useState<Printer | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    void loadPrinters()
  }, [])

  async function loadPrinters() {
    setIsLoading(true)
    setLoadError('')
    try {
      const [printersData, spoolsData] = await Promise.all([listPrinters(), listSpools()])
      setPrinters(printersData)
      setSpools(spoolsData)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Impossible de charger les imprimantes')
    } finally {
      setIsLoading(false)
    }
  }

  function openCreate() {
    setEditingPrinter(null)
    setForm(emptyForm)
    setIsFormOpen(true)
  }

  function openEdit(printer: Printer) {
    setEditingPrinter(printer)
    setForm({
      name: printer.name,
      model: printer.model,
      color: printer.color,
      prusalinkUrl: printer.prusalinkUrl ?? '',
      prusalinkApiKey: '',
      prusalinkEnabled: printer.prusalinkEnabled,
      activeSpoolId: printer.activeSpoolId ?? null,
    })
    setIsFormOpen(true)
  }

  async function submit() {
    if (!form.name.trim() || !form.model.trim() || !form.color.trim()) return
    if (form.prusalinkEnabled && (!form.prusalinkUrl?.trim() || (!editingPrinter && !form.prusalinkApiKey.trim()))) return

    setIsSaving(true)
    setLoadError('')

    try {
      const payload: Partial<PrinterPayload> = {
        name: form.name.trim(),
        model: form.model.trim(),
        color: form.color.trim(),
        prusalinkUrl: form.prusalinkUrl?.trim() || undefined,
        prusalinkEnabled: form.prusalinkEnabled,
        activeSpoolId: form.activeSpoolId ?? null,
      }

      if (form.prusalinkApiKey.trim()) payload.prusalinkApiKey = form.prusalinkApiKey.trim()

      const printer = editingPrinter
        ? await updatePrinter(editingPrinter.id, payload)
        : await createPrinter(payload as PrinterPayload)

      setPrinters((current) => editingPrinter
        ? current.map((item) => item.id === printer.id ? printer : item)
        : [...current, printer])
      setIsFormOpen(false)
      setEditingPrinter(null)
      setForm(emptyForm)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Impossible d’enregistrer l’imprimante')
    } finally {
      setIsSaving(false)
    }
  }

  async function sync(printerId: string) {
    setSyncingId(printerId)
    setLoadError('')
    try {
      const printer = await syncPrinterNow(printerId)
      setPrinters((current) => current.map((item) => item.id === printer.id ? printer : item))
      await showJobs(printerId)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Impossible de synchroniser l’imprimante')
    } finally {
      setSyncingId(null)
    }
  }

  async function remove(printer: Printer) {
    if (!window.confirm(`Supprimer l’imprimante « ${printer.name} » ?`)) return

    setDeletingId(printer.id)
    setLoadError('')
    try {
      await deletePrinter(printer.id)
      setPrinters((current) => current.filter((item) => item.id !== printer.id))
      setJobsByPrinter((current) => {
        const { [printer.id]: _removed, ...rest } = current
        return rest
      })
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Impossible de supprimer l’imprimante')
    } finally {
      setDeletingId(null)
    }
  }

  async function showJobs(printerId: string) {
    setLoadingJobsFor(printerId)
    try {
      const jobs = await listPrinterJobs(printerId)
      setJobsByPrinter((current) => ({ ...current, [printerId]: jobs }))
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Impossible de charger l’historique')
    } finally {
      setLoadingJobsFor(null)
    }
  }

  return (
    <div className="content printer-page">
      <div className="page-heading">
        <div><p className="eyebrow">PRUSALINK</p><h1>Imprimantes</h1><p className="subtitle">Configure les accès, lance une synchro et consulte l’état remonté par PrusaLink.</p></div>
        <button type="button" className="primary-button" onClick={openCreate}><span>+</span> Ajouter une imprimante</button>
      </div>

      {loadError && <div className="page-message page-message--error">{loadError}</div>}
      {isLoading && <div className="page-message">Chargement des imprimantes…</div>}

      <section className="managed-printers">
        {!isLoading && printers.length === 0 && <div className="empty-panel">Aucune imprimante configurée.</div>}
        {printers.map((printer) => (
          <article key={printer.id} className="managed-printer">
            <div className="managed-printer__header">
              <div className="printer-avatar" style={{ background: printer.color }}>▣</div>
              <div>
                <h3>{printer.name}</h3>
                <p>{printer.model}</p>
              </div>
              <span className={`status status--${printer.status}`}><span />{statusLabel[printer.status]}</span>
            </div>

            <div className="managed-printer__prusalink">
              <div className="managed-printer__section-title">
                <span>Données PrusaLink</span>
                <small>{printer.prusalinkEnabled ? 'Synchronisation active' : 'Synchronisation inactive'}</small>
              </div>

              <div className="managed-printer__meta">
                <span><b>PrusaLink</b>{printer.prusalinkEnabled ? 'Activé' : 'Désactivé'}</span>
                <span><b>URL</b>{printer.prusalinkUrl || 'Non configurée'}</span>
                <span><b>Bobine active</b>{printer.activeSpoolLabel || 'Non assignée'}</span>
                <span><b>Assignée le</b>{formatDateTime(printer.activeSpoolAssignedAt)}</span>
                <span><b>Dernière synchro</b>{formatDateTime(printer.lastSyncAt)}</span>
                <span><b>Dernière activité</b>{formatDateTime(printer.lastSeenAt)}</span>
                <span><b>Buse</b>{formatTemperature(printer.nozzleTemperature, printer.nozzleTargetTemperature)}</span>
                <span><b>Plateau</b>{formatTemperature(printer.bedTemperature, printer.bedTargetTemperature)}</span>
                <span><b>Travail</b>{printer.job || 'Aucun'}</span>
                <span><b>Progression</b>{printer.progress !== undefined ? `${printer.progress}%` : 'n/d'}</span>
              </div>

              {(printer.firmwareVersion || printer.prusalinkVersion) && (
                <p className="printer-version">Firmware {printer.firmwareVersion || 'n/d'} · PrusaLink {printer.prusalinkVersion || 'n/d'}</p>
              )}

              {printer.lastSyncError && <p className="printer-error">Dernière erreur : {printer.lastSyncError}</p>}
            </div>

            <div className="managed-printer__actions">
              <button type="button" className="text-button" onClick={() => openEdit(printer)}>Modifier</button>
              <button type="button" className="text-button" onClick={() => void showJobs(printer.id)}>{loadingJobsFor === printer.id ? 'Chargement…' : 'Historique'}</button>
              <button type="button" className="primary-button primary-button--small" disabled={!printer.prusalinkEnabled || syncingId === printer.id} onClick={() => void sync(printer.id)}>
                {syncingId === printer.id ? 'Synchronisation…' : 'Synchroniser'}
              </button>
              <button type="button" className="text-button text-button--danger" disabled={deletingId === printer.id} onClick={() => void remove(printer)}>
                {deletingId === printer.id ? 'Suppression…' : 'Supprimer'}
              </button>
            </div>

            {jobsByPrinter[printer.id] && (
              <div className="printer-jobs">
                <h4>Dernières impressions</h4>
                {jobsByPrinter[printer.id].length === 0
                  ? <p className="printer-jobs__empty">Aucune impression enregistrée.</p>
                  : jobsByPrinter[printer.id].map((job) => (
                    <div className="printer-job" key={job.id}>
                      <div>
                        <strong>{job.name}</strong>
                        <small>{job.externalJobPath || job.source}{job.estimatedFilamentGrams !== undefined ? ` · ${job.estimatedFilamentGrams} g estimés` : ''}{job.spoolLabel ? ` · ${job.spoolLabel}` : ''}</small>
                      </div>
                      <div>
                        <span>{jobStatusLabel[job.status]}</span>
                        <small>{formatDateTime(job.completedAt ?? job.startedAt)}</small>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </article>
        ))}
      </section>

      {isFormOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="spool-form">
            <div className="modal-heading">
              <div><p className="eyebrow">{editingPrinter ? 'MODIFICATION' : 'NOUVELLE IMPRIMANTE'}</p><h2>{editingPrinter ? 'Modifier l’imprimante' : 'Ajouter une imprimante'}</h2></div>
              <button type="button" className="close-button" onClick={() => setIsFormOpen(false)}>×</button>
            </div>
            <label>Nom<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex. Prusa XL" /></label>
            <div className="form-grid">
              <label>Modèle<input required value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="Ex. XL 5T" /></label>
              <label>Couleur<input required value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} placeholder="#f27852" /></label>
            </div>
            <label>URL PrusaLink<input value={form.prusalinkUrl} onChange={(event) => setForm({ ...form, prusalinkUrl: event.target.value })} placeholder="http://192.168.1.42" /></label>
            <label>Clé API PrusaLink<input type="password" value={form.prusalinkApiKey} onChange={(event) => setForm({ ...form, prusalinkApiKey: event.target.value })} placeholder={editingPrinter ? 'Laisser vide pour conserver la clé' : 'Clé API'} /></label>
            <label>Bobine active<select value={form.activeSpoolId ?? ''} onChange={(event) => setForm({ ...form, activeSpoolId: event.target.value || null })}><option value="">Aucune</option>{spools.map((spool) => <option key={spool.id} value={spool.id}>{`${spool.brand} ${spool.material} · ${spool.color}`}</option>)}</select></label>
            <label className="checkbox-field"><input type="checkbox" checked={form.prusalinkEnabled} onChange={(event) => setForm({ ...form, prusalinkEnabled: event.target.checked })} />Activer la synchronisation automatique</label>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setIsFormOpen(false)}>Annuler</button>
              <button type="button" className="primary-button" disabled={isSaving} onClick={() => void submit()}>{isSaving ? 'Enregistrement…' : editingPrinter ? 'Enregistrer' : 'Ajouter'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
