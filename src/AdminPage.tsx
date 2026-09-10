import { useEffect, useState } from 'react'
import { deleteUser, getSettings, listUsers, updateSettings, updateUserRole, type AdminUser, type AppSettings } from './api'
import { PrintersPage } from './PrintersPage'
import { SpoolsPage } from './SpoolsPage'
import { useAuth } from './auth'

const tabs = ['Utilisateurs', 'Imprimantes', 'Bobines', 'Paramètres'] as const
type Tab = (typeof tabs)[number]

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function UsersTab() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setIsLoading(true)
    setError('')
    try {
      setUsers(await listUsers())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Impossible de charger les utilisateurs')
    } finally {
      setIsLoading(false)
    }
  }

  async function toggleRole(target: AdminUser) {
    const nextRole = target.role === 'admin' ? 'member' : 'admin'
    setBusyId(target.id)
    setError('')
    try {
      const updated = await updateUserRole(target.id, nextRole)
      setUsers((current) => current.map((item) => item.id === updated.id ? updated : item))
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : 'Impossible de modifier le rôle')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(target: AdminUser) {
    if (!window.confirm(`Supprimer le compte « ${target.name} » ?`)) return

    setBusyId(target.id)
    setError('')
    try {
      await deleteUser(target.id)
      setUsers((current) => current.filter((item) => item.id !== target.id))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Impossible de supprimer l’utilisateur')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="panel">
      {error && <div className="page-message page-message--error">{error}</div>}
      {isLoading && <div className="page-message">Chargement des utilisateurs…</div>}
      {!isLoading && users.length === 0 && <div className="empty-panel empty-panel--compact">Aucun utilisateur.</div>}

      <div className="user-list">
        {users.map((item) => (
          <div className="user-row" key={item.id}>
            <div className="user-info">
              <strong>{item.name}</strong>
              <span>{item.email} · {item.authProvider === 'authentik' ? 'Authentik' : 'Local'} · Créé le {formatDateTime(item.createdAt)}</span>
            </div>
            <span className={item.role === 'admin' ? 'role-badge role-badge--admin' : 'role-badge'}>
              {item.role === 'admin' ? 'Administrateur' : 'Membre'}
            </span>
            <div className="user-actions">
              <button
                type="button"
                className="text-button"
                disabled={busyId === item.id}
                onClick={() => void toggleRole(item)}
              >
                {item.role === 'admin' ? 'Rétrograder membre' : 'Promouvoir admin'}
              </button>
              <button
                type="button"
                className="text-button text-button--danger"
                disabled={busyId === item.id || item.id === currentUser?.id}
                onClick={() => void remove(item)}
              >
                Supprimer
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function SettingsTab() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setError('')
    try {
      setSettings(await getSettings())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Impossible de charger les paramètres')
    }
  }

  async function toggle(key: keyof AppSettings) {
    if (!settings) return
    setIsSaving(true)
    setError('')
    try {
      const updated = await updateSettings({ [key]: !settings[key] })
      setSettings(updated)
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Impossible de mettre à jour les paramètres')
    } finally {
      setIsSaving(false)
    }
  }

  if (!settings) {
    return (
      <section className="panel">
        {error && <div className="page-message page-message--error">{error}</div>}
        {!error && <div className="page-message">Chargement des paramètres…</div>}
      </section>
    )
  }

  return (
    <section className="panel">
      {error && <div className="page-message page-message--error">{error}</div>}

      <div className="settings-row">
        <div>
          <strong>Inscription</strong>
          <p>Autorise la création de nouveaux comptes depuis l’écran de connexion.</p>
        </div>
        <label className="checkbox-field">
          <input type="checkbox" checked={settings.registrationEnabled} disabled={isSaving} onChange={() => void toggle('registrationEnabled')} />
        </label>
      </div>

      <div className="settings-row">
        <div>
          <strong>Connexion par mot de passe</strong>
          <p>Autorise la connexion locale par email et mot de passe.</p>
        </div>
        <label className="checkbox-field">
          <input type="checkbox" checked={settings.localLoginEnabled} disabled={isSaving} onChange={() => void toggle('localLoginEnabled')} />
        </label>
      </div>

      {settings.authentikConfigured ? (
        <div className="settings-row">
          <div>
            <strong>Authentification Authentik (SSO)</strong>
            <p>Autorise la connexion déléguée via Authentik.</p>
          </div>
          <label className="checkbox-field">
            <input type="checkbox" checked={settings.authentikEnabled} disabled={isSaving} onChange={() => void toggle('authentikEnabled')} />
          </label>
        </div>
      ) : (
        <div className="settings-row settings-row--disabled">
          <div>
            <strong>Authentification Authentik <span className="soon-badge">Bientôt disponible</span></strong>
            <p>Configure les variables OIDC_* côté serveur pour l’activer.</p>
          </div>
          <label className="checkbox-field">
            <input type="checkbox" checked={settings.authentikEnabled} disabled />
          </label>
        </div>
      )}
    </section>
  )
}

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('Utilisateurs')
  const rendersOwnContent = tab === 'Imprimantes' || tab === 'Bobines'

  return (
    <>
      <div className="content admin-heading">
        <div className="page-heading">
          <div><p className="eyebrow">ADMINISTRATION</p><h1>Administration</h1><p className="subtitle">Gère les utilisateurs, les équipements et les fonctionnalités de l’instance.</p></div>
        </div>

        <div className="admin-tabs">
          {tabs.map((item) => (
            <button key={item} type="button" className={tab === item ? 'admin-tab active' : 'admin-tab'} onClick={() => setTab(item)}>
              {item}
            </button>
          ))}
        </div>

        {!rendersOwnContent && (tab === 'Utilisateurs' ? <UsersTab /> : <SettingsTab />)}
      </div>

      {tab === 'Imprimantes' && <PrintersPage />}
      {tab === 'Bobines' && <SpoolsPage />}
    </>
  )
}
