# API Print Tracker

## Configuration

Copie `.env.example` vers `.env`, puis renseigne `DATABASE_URL`.

La migration [001_initial.sql](./migrations/001_initial.sql) crée les tables `printers`, `spools` et `print_jobs`.

## Lancement

```bash
npm run server
```

Endpoints actuels :

- `GET /health`
- `GET /api/printers`
- `POST /api/printers`
- `PATCH /api/printers/:id`
- `DELETE /api/printers/:id`
- `GET /api/spools`
