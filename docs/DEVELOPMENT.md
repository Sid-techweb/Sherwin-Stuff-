# Development guide

## Prerequisites
Node 20+ (tested on 22), Docker Desktop.

## First run
```bash
docker compose up -d postgres redis      # Postgres on :5440, Redis on :6390 (non-default ports to avoid clashes)
cd backend
cp .env.example .env
npm install
npm run migrate                           # creates the schema
npm run seed                              # synthetic demo data
npm run dev                               # API on http://localhost:4100
```
Create the test database once: `docker exec <postgres-container> psql -U bmw -d bmw -c "create database bmw_test"`.

## Everything in Docker
`docker compose up --build` starts Postgres, Redis and the API (migrations run automatically on container start; run `npm run seed` locally against `:5440` to load demo data).

## Scripts (`backend/`)
| Script | What it does |
|---|---|
| `npm run dev` | API with auto-reload |
| `npm run build` / `npm start` | Compile to `dist/` and run |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (typescript-eslint) |
| `npm run migrate` | Apply new SQL files from `database/migrations` |
| `npm run seed` | **Destructive** reset + synthetic data (refuses in production) |
| `npm test` | Vitest integration suite |

## Tests
`npm test` rebuilds the **`bmw_test`** database schema from the real migrations (the setup refuses to touch a DB whose name does not end in `_test`), uses Redis logical DB 15, and drives the real Express app through supertest. Files run serially because they share one database.
Set `DEBUG_ERRORS=1` to print the underlying error for any 500 while debugging.

## Adding a feature
1. New table/column → add `00N_name.sql` (never edit applied migrations).
2. SQL in a repository, rules in a service (use `withTransaction`, call `audit`, call `invalidateCaches`), thin controller, route with `requireRole`.
3. zod schema in `validators/schemas.ts`.
4. Add a test.

## Frontend (`frontend/`)
`npm install && npm run dev` serves the SPA on http://localhost:5173 and proxies `/api` to the API on :4100 (override with `VITE_API_TARGET`). `npm run build` type-checks and produces `dist/`. Pages: login, dashboard (filters, charts, Redis cache indicator), waste list/detail with lifecycle stepper and role-aware action buttons, collections, transportation, disposal, alerts, audit logs, facilities & fleet, settings/system status. Authorization is always enforced by the API; the UI only hides actions a role cannot use.
