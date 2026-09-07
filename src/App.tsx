import { useEffect, useMemo, useState } from 'react'
import { listPrinters, listSpools, type Printer, type PrinterStatus, type Spool } from './api'
import { SpoolsPage } from './SpoolsPage'

const statusLabel: Record<PrinterStatus, string> = {
  printing: 'En impression',
  ready: 'Prête',
  offline: 'Hors ligne',
  error: 'Erreur',
}

function Icon({ children }: { children: string }) {
  return <span className="icon" aria-hidden="true">{children}</span>
}

function formatCurrentDate() {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date()).toUpperCase()
}

function formatLastSeen(lastSeenAt?: string) {
  if (!lastSeenAt) return 'Dernière connexion inconnue'

  return `Dernière connexion : ${new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(lastSeenAt))}`
}

function spoolColorPreview(color: string) {
  const normalized = color.toLowerCase()
  if (normalized.includes('black')) return '#272b35'
  if (normalized.includes('orange')) return '#ed754e'
  if (normalized.includes('white')) return '#e9edf3'
  return '#ec6c45'
}

function spoolPercentage(spool: Spool) {
  return Math.round((spool.remaining / spool.initial) * 100)
}

function PrinterCard({ printer }: { printer: Printer }) {
  return (
    <article className="printer-card">
      <div className="printer-card__top">
        <div className="printer-avatar" style={{ background: printer.color }}><Icon>▣</Icon></div>
        <div>
          <h3>{printer.name}</h3>
          <p>{printer.model}</p>
        </div>
        <span className={`status status--${printer.status}`}><span />{statusLabel[printer.status]}</span>
      </div>
      {printer.status === 'printing' && printer.job && printer.progress !== undefined ? (
        <div className="job">
          <div className="job__row"><span>{printer.job}</span><strong>{printer.progress}%</strong></div>
          <div className="progress"><span style={{ width: `${printer.progress}%` }} /></div>
        </div>
      ) : (
        <div className="printer-empty">
          <span>{printer.status === 'ready' ? 'Aucun travail en attente' : formatLastSeen(printer.lastSeenAt)}</span>
          <button type="button" className="text-button">Voir les détails →</button>
        </div>
      )}
    </article>
  )
}

export function App() {
  const [activeNav, setActiveNav] = useState('Vue d’ensemble')
  const [printers, setPrinters] = useState<Printer[]>([])
  const [spools, setSpools] = useState<Spool[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadDashboard() {
      setIsLoading(true)
      setLoadError('')

      try {
        const [printersData, spoolsData] = await Promise.all([listPrinters(), listSpools()])
        if (cancelled) return
        setPrinters(printersData)
        setSpools(spoolsData.slice(0, 4))
      } catch (error) {
        if (cancelled) return
        setLoadError(error instanceof Error ? error.message : 'Impossible de charger le tableau de bord')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadDashboard()
    return () => {
      cancelled = true
    }
  }, [])

  const activePrinters = useMemo(
    () => printers.filter((printer) => printer.status === 'ready' || printer.status === 'printing').length,
    [printers],
  )
  const lowSpools = useMemo(() => spools.filter((spool) => spoolPercentage(spool) < 20).length, [spools])
  const connectionMessage = useMemo(() => {
    if (loadError) return 'Connexion API indisponible'
    if (isLoading) return 'Chargement des équipements...'
    if (printers.length === 0) return 'Aucune imprimante configurée'
    if (activePrinters === printers.length) return 'Toutes les imprimantes remontent des données'
    return `${activePrinters} imprimante${activePrinters > 1 ? 's' : ''} active${activePrinters > 1 ? 's' : ''} sur ${printers.length}`
  }, [activePrinters, isLoading, loadError, printers.length])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">P</div><span>print<span>tracker</span></span></div>
        <nav>
          {['Vue d’ensemble', 'Imprimantes', 'Bobines', 'Historique'].map((item, index) => (
            <button key={item} type="button" className={activeNav === item ? 'nav-item active' : 'nav-item'} onClick={() => setActiveNav(item)}>
              <Icon>{['⌂', '▣', '◉', '↺'][index]}</Icon>{item}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button type="button" className="nav-item"><Icon>⚙</Icon>Paramètres</button>
          <div className="profile"><div className="profile-avatar">P</div><div><strong>Print Tracker</strong><small>Tableau de bord</small></div><span>•••</span></div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark">P</div><strong>print<span>tracker</span></strong></div>
          <div className="connection"><span className="connection-dot" /> {connectionMessage}</div>
          <button type="button" className="notification" aria-label="Notifications">♧<i /></button>
        </header>

        {activeNav === 'Bobines' ? <SpoolsPage /> : <div className="content">
          <div className="page-heading">
            <div><p className="eyebrow">{formatCurrentDate()}</p><h1>Bonjour <span>👋</span></h1><p className="subtitle">Voici l’état réel de ton atelier.</p></div>
            <button type="button" className="primary-button"><span>+</span> Ajouter</button>
          </div>

          <section className="stats">
            <div className="stat-card"><div className="stat-icon stat-icon--blue"><Icon>▣</Icon></div><div><span>Imprimantes suivies</span><strong>{printers.length}</strong></div><em className="neutral">Source API</em></div>
            <div className="stat-card"><div className="stat-icon stat-icon--orange"><Icon>◉</Icon></div><div><span>Imprimantes actives</span><strong>{activePrinters} <small>/ {printers.length}</small></strong></div><em className={activePrinters > 0 ? 'positive' : 'neutral'}>{activePrinters > 0 ? 'Connectées' : 'En attente'}</em></div>
            <div className="stat-card"><div className="stat-icon stat-icon--purple"><Icon>↺</Icon></div><div><span>Bobines à surveiller</span><strong>{lowSpools}</strong></div><em className={lowSpools > 0 ? 'neutral' : 'positive'}>{spools.length} en stock</em></div>
          </section>

          {loadError && <div className="page-message page-message--error">{loadError}</div>}
          {isLoading && <div className="page-message">Chargement du tableau de bord…</div>}

          <div className="section-heading"><div><h2>Tes imprimantes</h2><p>Suivi issu de la base de données</p></div><button type="button" className="text-button">Voir tout →</button></div>
          <section className="printer-grid">
            {!isLoading && printers.length === 0
              ? <div className="empty-panel">Aucune imprimante n’est encore enregistrée.</div>
              : printers.map((printer) => <PrinterCard key={printer.id} printer={printer} />)}
          </section>

          <div className="lower-grid">
            <section className="panel">
              <div className="section-heading"><div><h2>Stock de bobines</h2><p>Les dernières bobines enregistrées</p></div><button type="button" className="text-button">Gérer le stock →</button></div>
              <div className="spool-list">
                {!isLoading && spools.length === 0
                  ? <div className="empty-panel empty-panel--compact">Aucune bobine en stock.</div>
                  : spools.map((spool) => <div className="spool-row" key={spool.id}><div className="spool-color" style={{ background: spoolColorPreview(spool.color) }} /><div className="spool-info"><strong>{spool.brand} <small>{spool.material}</small></strong><span>{spool.color} · {spool.location || 'Sans emplacement'}</span></div><div className="spool-remaining"><strong>{spoolPercentage(spool)}%</strong><div className="mini-progress"><span className={spoolPercentage(spool) < 20 ? 'low' : ''} style={{ width: `${spoolPercentage(spool)}%` }} /></div></div></div>)}
              </div>
            </section>
            <section className="panel quick-panel"><div className="section-heading"><div><h2>Actions rapides</h2><p>Gagne du temps</p></div></div><button type="button" className="quick-action"><span className="quick-icon orange">+</span><span><strong>Ajouter une bobine</strong><small>Enregistrer un nouveau filament</small></span><b>→</b></button><button type="button" className="quick-action"><span className="quick-icon purple">↺</span><span><strong>Déclarer une impression</strong><small>Connecter cette action à PrusaLink</small></span><b>→</b></button></section>
          </div>
        </div>}
      </main>
    </div>
  )
}
