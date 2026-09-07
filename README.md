# Print Tracker

Application web mobile-first pour suivre les imprimantes 3D et le stock de bobines.

## État actuel

Le dépôt contient un dashboard React/Vite responsive et un premier backend Express/PostgreSQL :

- Prusa XL 5 outils, Prusa Core One+ et Prusa MINI+
- état des machines et progression d'impression
- stock de bobines avec matière, couleur, emplacement et niveau restant
- écran de gestion des bobines avec recherche, filtres, ajout, modification et retrait
- scan caméra des QR codes Prusament (`https://prusament.com/spool/...`) avec lien vers le rapport qualité
- actions rapides et statistiques d'atelier
- API `/health`, `/api/printers` et CRUD `/api/spools`
- migrations PostgreSQL dans `server/migrations/001_initial.sql` et `server/migrations/002_add_prusament_qr.sql`

## Démarrage

```bash
npm install
npm run dev
```

Pour lancer l'API :

```bash
cp .env.example .env
npm run server
```

L'API attend une base PostgreSQL configurée par `DATABASE_URL`. En attendant la connexion de la base, l'écran Bobines conserve ses données localement dans le navigateur pour permettre de travailler sur l'interface.

## Déploiement V0 sur un LXC Debian

Le dépôt fournit un service API, un script de mise à jour et des timers systemd. La configuration recommandée héberge deux instances sur le même LXC :

- DEV : `/opt/print-tracker-dev`, branche `develop`, API sur `3001`, service `print-tracker-dev.service`.
- PROD : `/opt/print-tracker-prod`, branche `master`, API sur `3000`, service `print-tracker-prod.service`.
- Chaque instance possède son environnement et sa base PostgreSQL.
- [auto-pull.sh](./deploy/scripts/auto-pull.sh) fait `fetch`, fast-forward, `npm ci`, lint, build puis redémarre uniquement l'instance concernée.

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

Applique les migrations PostgreSQL dans l'ordre :

```bash
set -a
. /etc/print-tracker-prod.env
set +a
psql "$DATABASE_URL" -f server/migrations/001_initial.sql
psql "$DATABASE_URL" -f server/migrations/002_add_prusament_qr.sql
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

Le timer ne redéploie que si `origin/master` a changé. En cas d'échec du lint ou du build, le service en cours n'est pas redémarré.

### Publication avec Caddy

Les fichiers [print-tracker-dev.example.caddy](./deploy/caddy/print-tracker-dev.example.caddy) et [print-tracker-prod.example.caddy](./deploy/caddy/print-tracker-prod.example.caddy) servent les deux builds et transmettent `/api` aux bons ports. Remplace les domaines, copie-les dans le Caddyfile du reverse-proxy, puis recharge Caddy :

```bash
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```
