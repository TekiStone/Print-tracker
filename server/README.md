# API Print Tracker

## Configuration

Copie `.env.example` vers `.env`, puis renseigne `DATABASE_URL`.
Variables utiles :

- `HOST` pour l’écoute du serveur Node
- `WEB_ORIGIN` pour autoriser le frontend avec cookie de session
- `SESSION_SECRET` et `SESSION_COOKIE_SECURE` pour l’authentification
- `PRUSALINK_SYNC_INTERVAL_MS` et `PRUSALINK_REQUEST_TIMEOUT_MS` pour la synchronisation des imprimantes

Les migrations [001_initial.sql](./migrations/001_initial.sql), [002_add_prusament_qr.sql](./migrations/002_add_prusament_qr.sql), [003_add_users.sql](./migrations/003_add_users.sql), [003_add_prusalink_sync.sql](./migrations/003_add_prusalink_sync.sql), [004_link_prusalink_spools.sql](./migrations/004_link_prusalink_spools.sql) et [005_add_admin_console.sql](./migrations/005_add_admin_console.sql) préparent le stockage des imprimantes, bobines, QR Prusament, utilisateurs, sessions, données PrusaLink et paramètres applicatifs.

## Lancement

```bash
npm run server
```

## Endpoints actuels

- `GET /health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/printers`
- `POST /api/printers`
- `PATCH /api/printers/:id`
- `DELETE /api/printers/:id`
- `POST /api/printers/:id/sync`
- `GET /api/printers/:id/jobs`
- `GET /api/spools`
- `POST /api/spools`
- `PATCH /api/spools/:id`
- `DELETE /api/spools/:id`
- `GET /api/settings` (public : indique si l'inscription, la connexion locale et Authentik sont activés)
- `PATCH /api/settings` (admin uniquement)
- `GET /api/admin/users` (admin uniquement)
- `PATCH /api/admin/users/:id` (admin uniquement, changement de rôle)
- `DELETE /api/admin/users/:id` (admin uniquement)

## Console d'administration

Le rôle `admin` (colonne `role` sur `users`) donne accès à `/api/admin/*` et à `PATCH /api/settings`. Le tout premier compte créé sur une instance (table `users` vide) devient automatiquement admin ; les suivants sont créés en tant que `member`. Un admin ne peut pas se supprimer lui-même, ni supprimer ou rétrograder le dernier compte admin restant, via l'API.

La table `app_settings` (ligne unique) stocke trois interrupteurs : `registration_enabled`, `local_login_enabled` et `authentik_enabled`. Désactiver l'inscription ou la connexion locale bloque respectivement `POST /api/auth/register` et `POST /api/auth/login` avec un 403. `authentik_enabled` ne peut pas encore être activé (l'intégration OIDC de `server/auth.ts` n'est pas branchée sur ce serveur) ; l'API refuse aussi toute mise à jour qui désactiverait simultanément la connexion locale et Authentik, pour éviter un verrouillage complet.

## Liaison automatique bobine / impression

Assigne `activeSpoolId` à une imprimante via `POST /api/printers` ou `PATCH /api/printers/:id`.
Lors d’une synchronisation PrusaLink, l’API rattache l’impression en cours à cette bobine et tente de lire `; filament used [g] = ...` dans le G-code distant.
Quand une impression PrusaLink passe à l’état `completed`, le stock de la bobine assignée est décrémenté du poids estimé.
