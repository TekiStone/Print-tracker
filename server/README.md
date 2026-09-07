# API Print Tracker

## Configuration

Copie `.env.example` vers `.env`, puis renseigne `DATABASE_URL`.
Variables utiles :

- `HOST` pour l’écoute du serveur Node
- `WEB_ORIGIN` pour autoriser le frontend avec cookie de session
- `SESSION_SECRET` et `SESSION_COOKIE_SECURE` pour l’authentification
- `PRUSALINK_SYNC_INTERVAL_MS` et `PRUSALINK_REQUEST_TIMEOUT_MS` pour la synchronisation des imprimantes

Les migrations [001_initial.sql](./migrations/001_initial.sql), [002_add_prusament_qr.sql](./migrations/002_add_prusament_qr.sql), [003_add_users.sql](./migrations/003_add_users.sql), [003_add_prusalink_sync.sql](./migrations/003_add_prusalink_sync.sql) et [004_link_prusalink_spools.sql](./migrations/004_link_prusalink_spools.sql) préparent le stockage des imprimantes, bobines, QR Prusament, utilisateurs, sessions et données PrusaLink.

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

## Liaison automatique bobine / impression

Assigne `activeSpoolId` à une imprimante via `POST /api/printers` ou `PATCH /api/printers/:id`.
Lors d’une synchronisation PrusaLink, l’API rattache l’impression en cours à cette bobine et tente de lire `; filament used [g] = ...` dans le G-code distant.
Quand une impression PrusaLink passe à l’état `completed`, le stock de la bobine assignée est décrémenté du poids estimé.
