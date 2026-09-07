# API Print Tracker

## Configuration

Copie `.env.example` vers `.env`, puis renseigne `DATABASE_URL`.
Optionnellement :

- `PRUSALINK_SYNC_INTERVAL_MS` pour définir la fréquence de synchronisation
- `PRUSALINK_REQUEST_TIMEOUT_MS` pour définir le timeout réseau vers les imprimantes

Les migrations [001_initial.sql](./migrations/001_initial.sql), [002_add_prusament_qr.sql](./migrations/002_add_prusament_qr.sql) et [003_add_prusalink_sync.sql](./migrations/003_add_prusalink_sync.sql) préparent le stockage des imprimantes, bobines, QR Prusament et données de synchronisation PrusaLink.

## Lancement

```bash
npm run server
```

Endpoints actuels :

- `GET /health`
- `GET /api/printers`
- `POST /api/printers`
- `PATCH /api/printers/:id`
- `POST /api/printers/:id/sync`
- `GET /api/printers/:id/jobs`
- `GET /api/spools`
- `POST /api/spools`
- `PATCH /api/spools/:id`
- `DELETE /api/spools/:id`
