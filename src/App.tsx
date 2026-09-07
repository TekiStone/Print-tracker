import { useEffect, useState } from 'react'
import { SpoolsPage } from './SpoolsPage'
import { LoginPage } from './LoginPage'
import { useAuth } from './auth'
import { PrintersPage } from './PrintersPage'

type PrinterStatus = 'printing' | 'ready' | 'offline' | 'error'

type Printer = {
  id: string
  name: string
  model: string
  status: PrinterStatus
  current_job: string | null
  progress: number | null
  color: string
  last_seen_at: string | null
}

type Spool = {
  id: string
  brand: string
  material: string
  color: string
  remaining_grams: number
  initial_grams: number
  location: string | null
}

const statusLabel: Record<PrinterStatus, string> = {
  printing: 'En impression',
  ready: 'Prête',
  offline: 'Hors ligne',
  error: 'Erreur',
}

function Icon({ children }: { children: string }) {
  return <span className="icon" aria-hidden="true">{children}</span>
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
      {printer.status === 'printing' ? (
        <div className="job">
          <div className="job__row"><span>{printer.current_job}</span><strong>{printer.progress}%</strong></div>
          <div className="progress"><span style={{ width: `${printer.progress}%` }} /></div>
        </div>
      ) : (
        <div className="printer-empty">
          <span>{printer.status === 'ready' ? 'Aucun travail en attente' : 'Aucune connexion récente'}</span>
          <button type="button" className="text-button">Voir les détails →</button>
        </div>
      )}
    </article>
  )
}

function spoolColorSwatch(color: string) {
  const value = color.toLowerCase()
  if (value.includes('black')) return '#272b35'
  if (value.includes('orange')) return '#ed754e'
  if (value.includes('white')) return '#e9edf3'
  return '#ec6c45'
}

function Dashboard({ user }: { user: { name: string } }) {
  const [printers, setPrinters] = useState<Printer[]>([])
  const [spools, setSpools] = useState<Spool[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [printersResponse, spoolsResponse] = await Promise.all([
          fetch('/api/printers', { credentials: 'include' }),
          fetch('/api/spools', { credentials: 'include' }),
        ])
        if (!printersResponse.ok || !spoolsResponse.ok) {
          if (!cancelled) setError('Impossible de charger les données de l’atelier.')
          return
        }
        const [printersData, spoolsData] = await Promise.all([printersResponse.json(), spoolsResponse.json()])
        if (!cancelled) {
          setPrinters(printersData)
          setSpools(spoolsData)
        }
      } catch {
        if (!cancelled) setError('Impossible de charger les données de l’atelier.')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const activePrinters = printers.filter((printer) => printer.status !== 'offline').length
  const lowSpools = spools.filter((spool) => Math.round((spool.remaining_grams / spool.initial_grams) * 100) < 20).length
  const totalRemainingKg = (spools.reduce((total, spool) => total + spool.remaining_grams, 0) / 1000).toFixed(2)

  return (
    <div className="content">
      <div className="page-heading">
        <div><h1>Bonjour {user.name} <span>👋</span></h1><p className="subtitle">Voici l’état de ton atelier aujourd’hui.</p></div>
      </div>

      {error && <p className="auth-error">{error}</p>}

      <section className="stats">
        <div className="stat-card"><div className="stat-icon stat-icon--blue"><Icon>▣</Icon></div><div><span>Imprimantes actives</span><strong>{activePrinters} <small>/ {printers.length}</small></strong></div></div>
        <div className="stat-card"><div className="stat-icon stat-icon--orange"><Icon>◉</Icon></div><div><span>Bobines en stock</span><strong>{spools.length}</strong></div><em className="neutral">{lowSpools} bientôt vides</em></div>
        <div className="stat-card"><div className="stat-icon stat-icon--purple"><Icon>↺</Icon></div><div><span>Poids de filament restant</span><strong>{totalRemainingKg} kg</strong></div></div>
      </section>

      <div className="section-heading"><div><h2>Tes imprimantes</h2><p>Suivi en temps réel de ton parc</p></div></div>
      {printers.length > 0 ? (
        <section className="printer-grid">{printers.map((printer) => <PrinterCard key={printer.id} printer={printer} />)}</section>
      ) : (
        <p className="empty-spools">Aucune imprimante enregistrée pour le moment.</p>
      )}

      <div className="lower-grid">
        <section className="panel">
          <div className="section-heading"><div><h2>Stock de bobines</h2><p>Les dernières bobines ajoutées</p></div></div>
          {spools.length > 0 ? (
            <div className="spool-list">{spools.slice(0, 6).map((spool) => {
              const percent = Math.round((spool.remaining_grams / spool.initial_grams) * 100)
              return (
                <div className="spool-row" key={spool.id}>
                  <div className="spool-color" style={{ background: spoolColorSwatch(spool.color) }} />
                  <div className="spool-info"><strong>{spool.brand} <small>{spool.material}</small></strong><span>{spool.color} · {spool.location ?? 'Emplacement non défini'}</span></div>
                  <div className="spool-remaining"><strong>{percent}%</strong><div className="mini-progress"><span className={percent < 20 ? 'low' : ''} style={{ width: `${percent}%` }} /></div></div>
                </div>
              )
            })}</div>
          ) : (
            <p className="empty-spools">Aucune bobine enregistrée pour le moment.</p>
          )}
        </section>
      </div>
    </div>
  )
}

export function App() {
  const { user, status, logout } = useAuth()
  const [activeNav, setActiveNav] = useState('Vue d’ensemble')
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)

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
          {['Vue d’ensemble', 'Imprimantes', 'Bobines'].map((item) => (
            <button key={item} type="button" className={activeNav === item ? 'nav-item active' : 'nav-item'} onClick={() => { setActiveNav(item); setIsMobileNavOpen(false) }}>
              <Icon>{item === 'Vue d’ensemble' ? '⌂' : item === 'Imprimantes' ? '▣' : '◉'}</Icon>{item}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile"><div className="profile-avatar">{user.name.charAt(0).toUpperCase()}</div><div><strong>{user.name}</strong><small>{user.role === 'admin' ? 'Administrateur' : 'Membre'}</small></div></div>
          <button type="button" className="nav-item" onClick={() => { setIsMobileNavOpen(false); logout() }}><Icon>⏻</Icon>Déconnexion</button>
        </div>
      </aside>
      {isMobileNavOpen && <button type="button" className="sidebar-overlay" aria-label="Fermer le menu" onClick={() => setIsMobileNavOpen(false)} />}

      <main className="main">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark">P</div><strong>print<span>tracker</span></strong></div>
          <button type="button" className="mobile-menu" aria-label="Ouvrir le menu" aria-expanded={isMobileNavOpen} onClick={() => setIsMobileNavOpen((open) => !open)}>☰</button>
          <button type="button" className="text-button" onClick={() => logout()}>Déconnexion</button>
        </header>

        {activeNav === 'Bobines' ? <SpoolsPage /> : activeNav === 'Imprimantes' ? <PrintersPage /> : <Dashboard user={user} />}
      </main>
    </div>
  )
}
