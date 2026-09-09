# Print Tracker

Application web mobile-first pour suivre les imprimantes 3D et le stock de bobines.

## État actuel

Le dépôt contient un dashboard React/Vite responsive et un backend Express/PostgreSQL :

- authentification par email + mot de passe (inscription, connexion, déconnexion) avec session serveur (cookie httpOnly, stockée en base via `connect-pg-simple`)
- modèle `users` prévu pour une future authentification déléguée à Authentik (colonnes `auth_provider`/`external_id`)
- toutes les routes `/api/printers` et `/api/spools` nécessitent d'être authentifié
- état des machines et progression d'impression depuis la base PostgreSQL et PrusaLink
- synchronisation PrusaLink automatique côté backend avec timeout, journalisation d’erreur et historique des impressions
- liaison d’une bobine active par imprimante, avec décrément automatique du stock à la fin d’une impression PrusaLink lorsque le G-code expose `filament used [g]`
- stock de bobines avec matière, couleur, emplacement et niveau restant, entièrement piloté par l'API
- écran de gestion des bobines avec recherche, filtres, ajout, modification et retrait
- écran de gestion des imprimantes avec configuration PrusaLink, synchronisation manuelle, bobine active et historique récent
- scan caméra des QR codes Prusament (`https://prusament.com/spool/...`) avec lien vers le rapport qualité
- console d'administration (`/admin`, réservée au rôle `admin`) pour gérer les utilisateurs (rôle, suppression), retrouver les écrans imprimantes/bobines, et activer/désactiver l'inscription, la connexion locale par mot de passe et un futur toggle Authentik (placeholder, pas encore actif)
- API `/health`, `/api/auth/*`, `/api/settings`, `/api/admin/*` et CRUD `/api/printers` / `/api/spools`
- migrations PostgreSQL dans `server/migrations/001_initial.sql`, `002_add_prusament_qr.sql`, `003_add_users.sql`, `003_add_prusalink_sync.sql`, `004_link_prusalink_spools.sql` et `005_add_admin_console.sql`

## Démarrage

```bash
npm install
cp .env.example .env
```

Configure `DATABASE_URL`, `SESSION_SECRET` et si besoin les variables PrusaLink dans `.env`, puis applique les migrations :

```bash
npm run migrate
```

Lance l'API puis le frontend (le serveur de dev Vite proxifie `/api` et `/health` vers `http://localhost:3000`) :

```bash
npm run server
npm run dev
```

Crée un compte depuis l'écran d'inscription pour accéder au tableau de bord : sans backend/PostgreSQL configuré, l'application reste bloquée sur l'écran de connexion.

En développement, lance `npm run server` et `npm run dev` dans deux terminaux. Ouvre ensuite l'adresse Vite affichée (généralement `http://localhost:5173`) : elle relaie automatiquement `/api` et `/health` vers l'API sur le port 3000.

### Authentification par email et mot de passe

Avec `DATABASE_URL` configurée, l'écran de connexion permet de créer un compte avec un email, un mot de passe (8 caractères minimum) et un nom affiché. Les mots de passe sont hachés avec `bcrypt` et ne sont jamais stockés en clair. La session est stockée côté serveur (cookie httpOnly `print_tracker_sid`) via `connect-pg-simple`, dans la table `session`.

Ajoute un `SESSION_SECRET` aléatoire dans l'environnement (et `SESSION_COOKIE_SECURE=true` en production derrière HTTPS).

La table `users` possède des colonnes `auth_provider`/`external_id` prévues pour une future authentification déléguée à Authentik, non activée pour le moment.

### Console d'administration

Le premier compte créé sur une instance (base vide) devient automatiquement `admin` ; tous les comptes suivants sont créés en `member`. Un admin accède à `/admin` pour gérer les autres comptes (changement de rôle, suppression — impossible sur son propre compte ou sur le dernier admin restant) et pour activer/désactiver l'inscription et la connexion locale depuis l'onglet Paramètres. Le toggle Authentik y est visible mais désactivé tant que l'intégration OIDC n'est pas branchée sur le serveur.

### Intégration PrusaLink

Configure `PRUSALINK_SYNC_INTERVAL_MS` pour la fréquence de synchronisation et `PRUSALINK_REQUEST_TIMEOUT_MS` pour le timeout réseau.
Les clés API PrusaLink sont stockées uniquement côté backend et ne sont jamais renvoyées au frontend.
Pour imputer automatiquement la consommation de filament, assigne une bobine active à chaque imprimante depuis l’écran Imprimantes.

## Déploiement V0 sur un LXC Debian

Le dépôt fournit un service API, un script de mise à jour et des timers systemd. La configuration recommandée héberge deux instances sur le même LXC :

- DEV : `/opt/print-tracker-dev`, branche `develop`, API sur `3001`, service `print-tracker-dev.service`.
- PROD : `/opt/print-tracker-prod`, branche `master`, API sur `3000`, service `print-tracker-prod.service`.
- Chaque instance possède son environnement et sa base PostgreSQL.
- [auto-pull.sh](./deploy/scripts/auto-pull.sh) fait `fetch`, fast-forward, `npm ci`, lint, build, applique les migrations PostgreSQL manquantes (`npm run migrate`) puis redémarre uniquement l'instance concernée.
- Les migrations [003_add_users.sql](./server/migrations/003_add_users.sql), [003_add_prusalink_sync.sql](./server/migrations/003_add_prusalink_sync.sql) et [004_link_prusalink_spools.sql](./server/migrations/004_link_prusalink_spools.sql) ajoutent l’authentification, la synchronisation PrusaLink et l’imputation automatique de filament.
- [server/migrate.ts](./server/migrate.ts) applique les fichiers de `server/migrations/` dans l'ordre, une seule fois chacun (suivi dans la table `schema_migrations`). Il est sûr de le relancer : les migrations déjà appliquées sont ignorées. L'API exécute aussi ce contrôle au démarrage avant d'écouter le port HTTP.

### Installation initiale

À exécuter en root sur le LXC Debian :

```bash
apt update
apt install -y ca-certificates curl git postgresql-client
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

useradd --system --home /opt/print-tracker-dev --shell /usr/sbin/nologin print-tracker-dev
useradd --system --home /opt/print-tracker-prod --shell /usr/sbin/nologin print-tracker-prod
git clone --branch develop https://github.com/TekiStone/Print-tracker.git /opt/print-tracker-dev
git clone --branch master https://github.com/TekiStone/Print-tracker.git /opt/print-tracker-prod
chown -R print-tracker-dev:print-tracker-dev /opt/print-tracker-dev
chown -R print-tracker-prod:print-tracker-prod /opt/print-tracker-prod
```

Pour un dépôt privé, remplace l'URL HTTPS par une URL SSH et installe une clé de déploiement GitHub en lecture seule dans `/root/.ssh/`.

Configure ensuite l'environnement :

```bash
install -m 600 -o root -g root /opt/print-tracker-dev/deploy/env/print-tracker-dev.env.example /etc/print-tracker-dev.env
install -m 600 -o root -g root /opt/print-tracker-prod/deploy/env/print-tracker-prod.env.example /etc/print-tracker-prod.env
nano /etc/print-tracker-dev.env
nano /etc/print-tracker-prod.env
```

Applique les migrations PostgreSQL (une seule fois, exécutable de nouveau sans risque) :

```bash
cd /opt/print-tracker-dev
set -a; . /etc/print-tracker-dev.env; set +a
npm ci
npm run migrate

cd /opt/print-tracker-prod
set -a; . /etc/print-tracker-prod.env; set +a
npm ci
npm run migrate
```

Active les services :

```bash
chmod 755 /opt/print-tracker-dev/deploy/scripts/auto-pull.sh /opt/print-tracker-prod/deploy/scripts/auto-pull.sh
cp /opt/print-tracker-dev/deploy/systemd/print-tracker-dev.service /etc/systemd/system/
cp /opt/print-tracker-dev/deploy/systemd/print-tracker-dev-auto-pull.service /etc/systemd/system/
cp /opt/print-tracker-dev/deploy/systemd/print-tracker-dev-auto-pull.timer /etc/systemd/system/
cp /opt/print-tracker-prod/deploy/systemd/print-tracker-prod.service /etc/systemd/system/
cp /opt/print-tracker-prod/deploy/systemd/print-tracker-prod-auto-pull.service /etc/systemd/system/
cp /opt/print-tracker-prod/deploy/systemd/print-tracker-prod-auto-pull.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now print-tracker-dev.service print-tracker-dev-auto-pull.timer
systemctl enable --now print-tracker-prod.service print-tracker-prod-auto-pull.timer
systemctl start print-tracker-dev-auto-pull.service
systemctl start print-tracker-prod-auto-pull.service
```

Vérifie le fonctionnement :

```bash
systemctl status print-tracker-dev.service print-tracker-prod.service
systemctl status print-tracker-dev-auto-pull.timer print-tracker-prod-auto-pull.timer
journalctl -u print-tracker-dev-auto-pull.service -u print-tracker-prod-auto-pull.service -f
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3000/health
```

Le timer ne redéploie que si la branche distante a changé. En cas d'échec du lint, du build ou d'une migration, le script s'arrête (`set -e`) et le service en cours n'est pas redémarré.

### Publication avec Caddy

Les fichiers [print-tracker-dev.example.caddy](./deploy/caddy/print-tracker-dev.example.caddy) et [print-tracker-prod.example.caddy](./deploy/caddy/print-tracker-prod.example.caddy) transmettent chaque domaine au service Node correspondant. Le service Node sert à la fois le build React et `/api`. Remplace les domaines et l'adresse IP du LXC, copie-les dans le Caddyfile du reverse-proxy, puis recharge Caddy :

```bash
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```
