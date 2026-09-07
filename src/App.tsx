import { useState } from 'react'
import { SpoolsPage } from './SpoolsPage'

type PrinterStatus = 'printing' | 'ready' | 'offline'

type Printer = {
  name: string
  model: string
  status: PrinterStatus
  job?: string
  progress?: number
  color: string
}

type Spool = {
  id: string
  brand: string
  material: string
  color: string
  remaining: number
  location: string
}

const printers: Printer[] = [
  { name: 'Prusa XL', model: '5 outils', status: 'printing', job: 'Support mural', progress: 68, color: '#f47b5f' },
  { name: 'Prusa Core One+', model: 'Core One+', status: 'ready', color: '#4b9bff' },
  { name: 'Prusa MINI+', model: 'MINI+', status: 'offline', color: '#a58bff' },
]

const spools: Spool[] = [
  { id: 'PLA-001', brand: 'Prusament', material: 'PLA', color: 'Galaxy Black', remaining: 82, location: 'Boîte A · 01' },
  { id: 'PETG-014', brand: 'eSUN', material: 'PETG', color: 'Orange', remaining: 41, location: 'Boîte A · 02' },
  { id: 'PLA-023', brand: 'Prusament', material: 'PLA', color: 'Prusa Orange', remaining: 16, location: 'Boîte B · 04' },
  { id: 'ASA-003', brand: 'Polymaker', material: 'ASA', color: 'White', remaining: 7, location: 'Boîte C · 01' },
]

const statusLabel: Record<PrinterStatus, string> = {
  printing: 'En impression',
  ready: 'Prête',
  offline: 'Hors ligne',
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
          <div className="job__row"><span>{printer.job}</span><strong>{printer.progress}%</strong></div>
          <div className="progress"><span style={{ width: `${printer.progress}%` }} /></div>
          <small>Fin estimée dans 1 h 24</small>
        </div>
      ) : (
        <div className="printer-empty">
          <span>{printer.status === 'ready' ? 'Aucun travail en attente' : 'Dernière connexion : hier à 22:14'}</span>
          <button type="button" className="text-button">Voir les détails →</button>
        </div>
      )}
    </article>
  )
}

export function App() {
  const [activeNav, setActiveNav] = useState('Vue d’ensemble')

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
          <div className="profile"><div className="profile-avatar">T</div><div><strong>Thomas</strong><small>Administrateur</small></div><span>•••</span></div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark">P</div><strong>print<span>tracker</span></strong></div>
          <div className="connection"><span className="connection-dot" /> Toutes les machines sont connectées</div>
          <button type="button" className="notification" aria-label="Notifications">♧<i /></button>
        </header>

        {activeNav === 'Bobines' ? <SpoolsPage /> : <div className="content">
          <div className="page-heading">
            <div><p className="eyebrow">LUNDI 7 SEPTEMBRE 2026</p><h1>Bonjour Thomas <span>👋</span></h1><p className="subtitle">Voici l’état de ton atelier aujourd’hui.</p></div>
            <button type="button" className="primary-button"><span>+</span> Ajouter</button>
          </div>

          <section className="stats">
            <div className="stat-card"><div className="stat-icon stat-icon--blue"><Icon>▣</Icon></div><div><span>Imprimantes actives</span><strong>2 <small>/ 3</small></strong></div><em className="positive">+1 ce mois</em></div>
            <div className="stat-card"><div className="stat-icon stat-icon--orange"><Icon>◉</Icon></div><div><span>Bobines en stock</span><strong>48 <small>/ 52</small></strong></div><em className="neutral">4 bientôt vides</em></div>
            <div className="stat-card"><div className="stat-icon stat-icon--purple"><Icon>↺</Icon></div><div><span>Impressions ce mois</span><strong>27</strong></div><em className="positive">+12% vs août</em></div>
          </section>

          <div className="section-heading"><div><h2>Tes imprimantes</h2><p>Suivi en temps réel de ton parc</p></div><button type="button" className="text-button">Voir tout →</button></div>
          <section className="printer-grid">{printers.map((printer) => <PrinterCard key={printer.name} printer={printer} />)}</section>

          <div className="lower-grid">
            <section className="panel">
              <div className="section-heading"><div><h2>Stock de bobines</h2><p>Les dernières bobines ajoutées</p></div><button type="button" className="text-button">Gérer le stock →</button></div>
              <div className="spool-list">{spools.map((spool) => <div className="spool-row" key={spool.id}><div className="spool-color" style={{ background: spool.color.toLowerCase().includes('black') ? '#272b35' : spool.color.toLowerCase().includes('orange') ? '#ed754e' : spool.color.toLowerCase().includes('white') ? '#e9edf3' : '#ec6c45' }} /><div className="spool-info"><strong>{spool.brand} <small>{spool.material}</small></strong><span>{spool.color} · {spool.location}</span></div><div className="spool-remaining"><strong>{spool.remaining}%</strong><div className="mini-progress"><span className={spool.remaining < 20 ? 'low' : ''} style={{ width: `${spool.remaining}%` }} /></div></div></div>)}</div>
            </section>
            <section className="panel quick-panel"><div className="section-heading"><div><h2>Actions rapides</h2><p>Gagne du temps</p></div></div><button type="button" className="quick-action"><span className="quick-icon orange">+</span><span><strong>Ajouter une bobine</strong><small>Enregistrer un nouveau filament</small></span><b>→</b></button><button type="button" className="quick-action"><span className="quick-icon purple">↺</span><span><strong>Déclarer une impression</strong><small>Ajouter une impression manuelle</small></span><b>→</b></button></section>
          </div>
        </div>}
      </main>
    </div>
  )
}
