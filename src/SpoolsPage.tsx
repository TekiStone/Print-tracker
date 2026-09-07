import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'

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

const initialSpools: Spool[] = [
  { id: 'PLA-001', brand: 'Prusament', material: 'PLA', color: 'Galaxy Black', remaining: 820, initial: 1000, location: 'Boîte A · 01' },
  { id: 'PETG-014', brand: 'eSUN', material: 'PETG', color: 'Orange', remaining: 410, initial: 1000, location: 'Boîte A · 02' },
  { id: 'PLA-023', brand: 'Prusament', material: 'PLA', color: 'Prusa Orange', remaining: 160, initial: 1000, location: 'Boîte B · 04' },
  { id: 'ASA-003', brand: 'Polymaker', material: 'ASA', color: 'White', remaining: 70, initial: 1000, location: 'Boîte C · 01' },
]

type FormState = Omit<Spool, 'id'>
const emptyForm: FormState = { brand: '', material: 'PLA', color: '', remaining: 1000, initial: 1000, location: '', qrUrl: '', prusamentId: '' }

function parsePrusamentQr(value: string) {
  try {
    const url = new URL(value)
    if (url.hostname !== 'prusament.com' && !url.hostname.endsWith('.prusament.com')) return null
    const match = url.pathname.match(/\/spool\/([^/?#]+)/i)
    return match ? { qrUrl: url.toString(), prusamentId: match[1] } : null
  } catch {
    return null
  }
}

function percentage(spool: Spool) {
  return Math.round((spool.remaining / spool.initial) * 100)
}

export function SpoolsPage() {
  const [spools, setSpools] = useState<Spool[]>(() => {
    const saved = localStorage.getItem('print-tracker-spools')
    return saved ? JSON.parse(saved) as Spool[] : initialSpools
  })
  const [query, setQuery] = useState('')
  const [material, setMaterial] = useState('Tous')
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isScannerOpen, setIsScannerOpen] = useState(false)
  const [scanError, setScanError] = useState('')

  const filteredSpools = useMemo(() => spools.filter((spool) => {
    const matchesQuery = `${spool.brand} ${spool.material} ${spool.color} ${spool.location}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (material === 'Tous' || spool.material === material)
  }), [material, query, spools])

  function save(next: Spool[]) {
    setSpools(next)
    localStorage.setItem('print-tracker-spools', JSON.stringify(next))
  }

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm)
    setIsFormOpen(true)
  }

  async function scanQr() {
    setScanError('')
    setIsScannerOpen(true)
    const reader = new BrowserQRCodeReader()
    try {
      const result = await reader.decodeOnceFromVideoDevice(undefined, 'qr-video')
      const parsed = parsePrusamentQr(result.getText())
      if (!parsed) {
        setScanError('Ce QR code ne correspond pas à une fiche Prusament.')
        setIsScannerOpen(false)
        return
      }
      setEditingId(null)
      setForm({ ...emptyForm, brand: 'Prusament', qrUrl: parsed.qrUrl, prusamentId: parsed.prusamentId })
      setIsScannerOpen(false)
      setIsFormOpen(true)
    } catch {
      setScanError('Impossible de lire le QR code. Vérifie l’autorisation caméra.')
    }
  }

  function openEdit(spool: Spool) {
    setEditingId(spool.id)
    setForm({ brand: spool.brand, material: spool.material, color: spool.color, remaining: spool.remaining, initial: spool.initial, location: spool.location, qrUrl: spool.qrUrl ?? '', prusamentId: spool.prusamentId ?? '' })
    setIsFormOpen(true)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.brand.trim() || !form.color.trim() || form.initial <= 0 || form.remaining < 0 || form.remaining > form.initial) return
    if (editingId) {
      save(spools.map((spool) => spool.id === editingId ? { ...spool, ...form } : spool))
    } else {
      save([{ ...form, id: `${form.material}-${Date.now().toString().slice(-4)}` }, ...spools])
    }
    setIsFormOpen(false)
  }

  function archive(id: string) {
    if (window.confirm('Retirer cette bobine du stock ?')) save(spools.filter((spool) => spool.id !== id))
  }

  return (
    <div className="content spool-page">
      <div className="page-heading">
        <div><p className="eyebrow">GESTION DU STOCK</p><h1>Tes bobines</h1><p className="subtitle">Gère ton filament, son emplacement et son poids restant.</p></div>
        <div className="heading-actions"><button type="button" className="secondary-button scan-button" onClick={scanQr}>▣ Scanner un QR</button><button type="button" className="primary-button" onClick={openCreate}><span>+</span> Ajouter une bobine</button></div>
      </div>
      <section className="spool-summary">
        <div><span>Bobines suivies</span><strong>{spools.length}</strong></div>
        <div><span>Poids total restant</span><strong>{(spools.reduce((total, spool) => total + spool.remaining, 0) / 1000).toFixed(2)} kg</strong></div>
        <div><span>À surveiller</span><strong className="warning-text">{spools.filter((spool) => percentage(spool) < 20).length}</strong></div>
      </section>
      <div className="spool-toolbar"><label className="search-box">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher une bobine..." /></label><select value={material} onChange={(event) => setMaterial(event.target.value)}><option>Tous</option><option>PLA</option><option>PETG</option><option>ASA</option><option>ABS</option><option>TPU</option></select></div>
      <section className="managed-spools">
        {filteredSpools.map((spool) => {
          const percent = percentage(spool)
          return <article className="managed-spool" key={spool.id}>
            <div className="managed-spool__header"><div className="spool-color large" style={{ background: spool.color.toLowerCase().includes('black') ? '#272b35' : spool.color.toLowerCase().includes('white') ? '#e9edf3' : '#ed754e' }} /><div><h3>{spool.brand} <small>{spool.material}</small></h3><p>{spool.color}</p></div><span className={percent < 20 ? 'low-badge' : 'ok-badge'}>{percent < 20 ? 'Bientôt vide' : 'En stock'}</span></div>
            <div className="managed-spool__meta"><span><b>{spool.remaining} g</b> restants sur {spool.initial} g</span><span>{spool.location || 'Emplacement non défini'}</span></div>
            {spool.qrUrl && <a className="prusament-link" href={spool.qrUrl} target="_blank" rel="noreferrer">Rapport qualité Prusament ↗</a>}
            <div className="progress spool-progress"><span className={percent < 20 ? 'low' : ''} style={{ width: `${percent}%` }} /></div>
            <div className="managed-spool__actions"><button type="button" className="text-button" onClick={() => openEdit(spool)}>Modifier</button><button type="button" className="danger-button" onClick={() => archive(spool.id)}>Retirer</button></div>
          </article>
        })}
        {filteredSpools.length === 0 && <div className="empty-spools">Aucune bobine ne correspond à ta recherche.</div>}
      </section>
      {isFormOpen && <div className="modal-backdrop" role="presentation"><form className="spool-form" onSubmit={submit}><div className="modal-heading"><div><p className="eyebrow">{editingId ? 'MODIFICATION' : 'NOUVELLE BOBINE'}</p><h2>{editingId ? 'Modifier la bobine' : 'Ajouter une bobine'}</h2></div><button type="button" className="close-button" onClick={() => setIsFormOpen(false)}>×</button></div><label>Marque<input required value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} placeholder="Ex. Prusament" /></label><div className="form-grid"><label>Matière<select value={form.material} onChange={(event) => setForm({ ...form, material: event.target.value })}><option>PLA</option><option>PETG</option><option>ASA</option><option>ABS</option><option>TPU</option></select></label><label>Couleur<input required value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} placeholder="Ex. Galaxy Black" /></label></div><div className="form-grid"><label>Poids initial (g)<input required type="number" min="1" value={form.initial} onChange={(event) => setForm({ ...form, initial: Number(event.target.value) })} /></label><label>Poids restant (g)<input required type="number" min="0" max={form.initial} value={form.remaining} onChange={(event) => setForm({ ...form, remaining: Number(event.target.value) })} /></label></div><label>Emplacement<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Ex. Boîte A · 03" /></label>{form.prusamentId && <div className="qr-confirmed">QR Prusament reconnu · {form.prusamentId}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setIsFormOpen(false)}>Annuler</button><button type="submit" className="primary-button">{editingId ? 'Enregistrer' : 'Ajouter la bobine'}</button></div></form></div>}
      {isScannerOpen && <div className="modal-backdrop" role="presentation"><div className="scanner-modal"><div className="modal-heading"><div><p className="eyebrow">IDENTIFICATION</p><h2>Scanner le QR Prusament</h2></div><button type="button" className="close-button" onClick={() => setIsScannerOpen(false)}>×</button></div><video id="qr-video" className="qr-video" autoPlay muted playsInline />{scanError && <p className="scan-error">{scanError}</p>}<p className="scanner-help">Autorise la caméra puis place le QR code de la bobine dans le cadre.</p></div></div>}
    </div>
  )
}
