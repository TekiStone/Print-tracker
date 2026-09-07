# API Print Tracker

## Configuration

Copie `.env.example` vers `.env`, puis renseigne `DATABASE_URL`.

La migration [001_initial.sql](./migrations/001_initial.sql) crée les tables `printers`, `spools` et `print_jobs` sans injecter de données de démonstration.

## Lancement

```bash
npm run server
```

Endpoints actuels :

- `GET /health`
- `GET /api/printers`
- `GET /api/spools`
- `POST /api/spools`
- `PATCH /api/spools/:id`
- `DELETE /api/spools/:id`
