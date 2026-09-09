import { useCallback, useEffect, useMemo, useState } from 'react'
import { listPrinters, listSpools, type Printer, type PrinterStatus, type Spool } from './api'
import { LoginPage } from './LoginPage'
import { PrintersPage } from './PrintersPage'
import { SpoolsPage } from './SpoolsPage'
import { useAuth } from './auth'

const statusLabel: Record<PrinterStatus, string> = {
  printing: 'En impression',
  ready: 'Prête',
  offline: 'Hors ligne',
  error: 'Erreur',
}

const navigationItems = [
  { label: 'Vue d’ensemble', path: '/', icon: '⌂' },
  { label: 'Imprimantes', path: '/printers', icon: '▣' },
  { label: 'Bobines', path: '/spools', icon: '◉' },
] as const

type NavigationItem = (typeof navigationItems)[number]
type NavigationLabel = NavigationItem['label']

function navigationFromPath(pathname: string): NavigationLabel {
  return navigationItems.find((item) => item.path === pathname)?.label ?? 'Vue d’ensemble'
}

function pathFromNavigation(label: NavigationLabel) {
  return navigationItems.find((item) => item.label === label)!.path
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

function PrinterCard({ printer, onSelect }: { printer: Printer, onSelect: () => void }) {
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
          <button type="button" className="text-button" onClick={onSelect}>Voir les détails →</button>
        </div>
      )}
    </article>
  )
}

function Dashboard({ user, onSelectNav }: { user: { name: string }, onSelectNav: (nav: NavigationLabel) => void }) {
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
        setSpools(spoolsData.slice(0, 6))
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
  const printersWithSyncError = useMemo(() => printers.filter((printer) => printer.lastSyncError).length, [printers])
  const lowSpools = useMemo(() => spools.filter((spool) => spoolPercentage(spool) < 20).length, [spools])
  const totalRemainingKg = useMemo(() => (spools.reduce((total, spool) => total + spool.remaining, 0) / 1000).toFixed(2), [spools])
  const connectionMessage = useMemo(() => {
    if (loadError) return 'Connexion API indisponible'
    if (isLoading) return 'Chargement des équipements...'
    if (printersWithSyncError > 0) return `${printersWithSyncError} synchro${printersWithSyncError > 1 ? 's' : ''} PrusaLink en erreur`
    if (printers.length === 0) return 'Aucune imprimante configurée'
    if (activePrinters === printers.length) return 'Toutes les imprimantes remontent des données'
    return `${activePrinters} imprimante${activePrinters > 1 ? 's' : ''} active${activePrinters > 1 ? 's' : ''} sur ${printers.length}`
  }, [activePrinters, isLoading, loadError, printers.length, printersWithSyncError])

  return (
    <div className="content">
      <div className="page-heading">
        <div><p className="eyebrow">{formatCurrentDate()}</p><h1>Bonjour {user.name} <span>👋</span></h1><p className="subtitle">Voici l’état réel de ton atelier.</p></div>
      </div>

      {loadError && <div className="page-message page-message--error">{loadError}</div>}
      {isLoading && <div className="page-message">Chargement du tableau de bord…</div>}

      <section className="stats">
        <div className="stat-card"><div className="stat-icon stat-icon--blue"><Icon>▣</Icon></div><div><span>Imprimantes suivies</span><strong>{printers.length}</strong></div><em className="neutral">Source API</em></div>
        <div className="stat-card"><div className="stat-icon stat-icon--orange"><Icon>◉</Icon></div><div><span>Imprimantes actives</span><strong>{activePrinters} <small>/ {printers.length}</small></strong></div><em className={activePrinters > 0 ? 'positive' : 'neutral'}>{activePrinters > 0 ? 'Connectées' : 'En attente'}</em></div>
        <div className="stat-card"><div className="stat-icon stat-icon--purple"><Icon>↺</Icon></div><div><span>Poids de filament restant</span><strong>{totalRemainingKg} kg</strong></div><em className={lowSpools > 0 ? 'neutral' : 'positive'}>{lowSpools} à surveiller</em></div>
      </section>

      <div className="section-heading"><div><h2>Tes imprimantes</h2><p>{connectionMessage}</p></div><button type="button" className="text-button" onClick={() => onSelectNav('Imprimantes')}>Voir tout →</button></div>
      <section className="printer-grid">
        {!isLoading && printers.length === 0
          ? <div className="empty-panel">Aucune imprimante n’est encore enregistrée.</div>
          : printers.map((printer) => <PrinterCard key={printer.id} printer={printer} onSelect={() => onSelectNav('Imprimantes')} />)}
      </section>

      <div className="lower-grid">
        <section className="panel">
          <div className="section-heading"><div><h2>Stock de bobines</h2><p>Les dernières bobines enregistrées</p></div><button type="button" className="text-button" onClick={() => onSelectNav('Bobines')}>Gérer le stock →</button></div>
          <div className="spool-list">
            {!isLoading && spools.length === 0
              ? <div className="empty-panel empty-panel--compact">Aucune bobine en stock.</div>
              : spools.map((spool) => <div className="spool-row" key={spool.id}><div className="spool-color" style={{ background: spoolColorPreview(spool.color) }} /><div className="spool-info"><strong>{spool.brand} <small>{spool.material}</small></strong><span>{spool.color} · {spool.location || 'Sans emplacement'}</span></div><div className="spool-remaining"><strong>{spoolPercentage(spool)}%</strong><div className="mini-progress"><span className={spoolPercentage(spool) < 20 ? 'low' : ''} style={{ width: `${spoolPercentage(spool)}%` }} /></div></div></div>)}
          </div>
        </section>
      </div>
    </div>
  )
}

export function App() {
  const { user, status, logout } = useAuth()
  const [activeNav, setActiveNav] = useState<NavigationLabel>(() => navigationFromPath(window.location.pathname))
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)

  useEffect(() => {
    function handlePopState() {
      setActiveNav(navigationFromPath(window.location.pathname))
      setIsMobileNavOpen(false)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = useCallback((label: NavigationLabel) => {
    const path = pathFromNavigation(label)
    if (window.location.pathname !== path) window.history.pushState(null, '', path)
    setActiveNav(label)
    setIsMobileNavOpen(false)
  }, [])

  if (status === 'loading') {
    return <div className="auth-shell"><p>Chargement…</p></div>
  }

  if (status === 'unauthenticated' || !user) {
    return <LoginPage />
  }

  return (
    <div className="app-shell">
      <aside className={isMobileNavOpen ? 'sidebar sidebar--open' : 'sidebar'}>
        <div className="brand"><div className="brand-mark">P</div><span>print<span>tracker</span></span></div>
        <button type="button" className="mobile-close" aria-label="Fermer le menu" onClick={() => setIsMobileNavOpen(false)}>×</button>
        <nav>
          {navigationItems.map((item) => (
            <button key={item.label} type="button" className={activeNav === item.label ? 'nav-item active' : 'nav-item'} onClick={() => navigate(item.label)}>
              <Icon>{item.icon}</Icon>{item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile"><div className="profile-avatar">{user.name.charAt(0).toUpperCase()}</div><div><strong>{user.name}</strong><small>{user.role === 'admin' ? 'Administrateur' : 'Membre'}</small></div></div>
          <button type="button" className="nav-item" onClick={() => { setIsMobileNavOpen(false); void logout() }}><Icon>↪</Icon>Déconnexion</button>
        </div>
      </aside>
      {isMobileNavOpen && <button type="button" className="sidebar-overlay" aria-label="Fermer le menu" onClick={() => setIsMobileNavOpen(false)} />}

      <main className="main">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark">P</div><strong>print<span>tracker</span></strong></div>
          <button type="button" className="mobile-menu" aria-label="Ouvrir le menu" aria-expanded={isMobileNavOpen} onClick={() => setIsMobileNavOpen((open) => !open)}>☰</button>
        </header>

        {activeNav === 'Bobines'
          ? <SpoolsPage />
          : activeNav === 'Imprimantes'
            ? <PrintersPage />
            : <Dashboard user={user} onSelectNav={navigate} />}
      </main>
    </div>
  )
}
