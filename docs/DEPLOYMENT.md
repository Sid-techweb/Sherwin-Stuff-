# Deployment

## Local, everything in Docker

```bash
docker compose up -d --build        # postgres, redis, backend (API), frontend (nginx)
```

| Service | URL / port |
|---|---|
| Web app | http://localhost:8088 (nginx serves the SPA and proxies `/api` to the backend) |
| API | http://localhost:4100/api/health |
| PostgreSQL | localhost:5440 (user `bmw`) |
| Redis | localhost:6390 |

The backend container runs migrations automatically on start. Load demo data once from your machine:

```bash
cd backend && npm install && npx tsx src/db/seed.ts      # destructive: resets the database to synthetic data
```

Ports are overridable with `WEB_PORT`, `API_PORT`, `POSTGRES_PORT`, `REDIS_PORT`.

## Enabling the AI features

1. LLM (optional): in `backend/.env` set `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY` (and `LLM_BASE_URL` for non-default endpoints). Restart the backend. Without these, the assistant runs in data-only mode.
2. Hindsight (optional): `HINDSIGHT_LLM_API_KEY=... docker compose --profile ai up -d hindsight`, then set `HINDSIGHT_URL=http://hindsight:8888` in `backend/.env` and restart the backend. The Settings and AI pages show whether it is reachable.

## Production checklist

* Set a strong `JWT_SECRET` (>= 32 random chars) and a unique `POSTGRES_PASSWORD`; never commit `.env`.
* Terminate TLS in front of nginx (the app sets HSTS headers via helmet, which only matter over HTTPS).
* Set `CORS_ORIGIN` to the real web origin if the API is exposed separately; with the bundled nginx proxy the browser uses a single origin.
* Do **not** run `seed` against a production database (the script refuses when `NODE_ENV=production`).
* Back up the `pgdata` volume. Redis holds only cache and rate-limit counters and can be wiped safely.
* Run several API instances behind a load balancer if needed: sessions are stateless (JWT), the alert scan is protected by a Redis lock, and cache invalidation is shared through Redis.
* Change the demo passwords or delete the demo users.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `port is already allocated` | Another project uses the port; set the matching `*_PORT` variable |
| Login works, dashboard empty | Database has no data: run the seed |
| `/api/health` says `degraded` | Redis unreachable; the app still works from PostgreSQL |
| AI page says "Data-only mode" | No LLM key configured: expected; answers still come from the database |
| `Invalid environment configuration` at start | `JWT_SECRET` shorter than 32 characters or `DATABASE_URL` missing |
