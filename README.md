# Biomedical Waste Tracking & AI Compliance System

Tracks biomedical waste from segregation at the source → collection → transport → treatment/disposal → closure, with
role-based access, alerts for abnormal events, a tamper-resistant audit trail and a Redis-accelerated analytics dashboard.

> **Data in this repository is synthetic demo data.**

## Project status (be honest about scope)

| Area | Status |
|---|---|
| Architecture & docs (Phase 0) | Done |
| Scaffolding, Docker (1, 23) | Done (backend, Postgres, Redis) |
| PostgreSQL schema + seed (2, 20) | Done |
| Backend foundation (3) | Done |
| Auth + RBAC (4) | Done |
| Waste lifecycle, collections, transport, disposal (5, 11) | Done |
| REST API (6) | Done |
| Redis cache / rate limit / locks (7) | Done |
| Alerts (12), audit log (13), dashboard analytics endpoint (9, partial 14) | Done in the API |
| Tests (21) | 50 integration tests passing |
| Frontend (8, 9-UI, 10, 11-UI) | Done: React + Vite + TypeScript SPA (dashboard, records, lifecycle stepper, workflows, alerts, audit) |
| Frontend polish (25) | Partial: skeletons, toasts, confirm dialogs, empty/error states, responsive layout |
| **Hindsight + AI assistant (15-19)** | **Not started** (design in `docs/AI.md`) |
| Final report / viva docs (27) | Not started |

## Tech stack
React 18 · Vite · TypeScript · Recharts · Node 22 · Express · TypeScript · PostgreSQL 16 · Redis 7 · zod · JWT + bcrypt · vitest/supertest · Docker Compose.
(Planned: Hindsight + configurable LLM.)

## Quick start
```bash
docker compose up -d postgres redis
cd backend && cp .env.example .env && npm install
npm run migrate && npm run seed
npm run dev            # API: http://localhost:4100/api/health
npm test               # 50 tests

# second terminal - the web app
cd frontend && npm install && npm run dev    # http://localhost:5173
```
Or run the API in Docker too: `docker compose up --build`. Details: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

Host ports: Postgres **5440**, Redis **6390**, API **4100** (chosen to avoid clashing with common defaults; override with `POSTGRES_PORT`, `REDIS_PORT`, `API_PORT`).

## Demo credentials (password for all: `Demo@1234`)
| Email | Role |
|---|---|
| admin@bmw.demo | ADMIN |
| staff.dgh@bmw.demo (also .dcc .dlm .dpl .drh) | HOSPITAL_STAFF (one per facility) |
| collector1@bmw.demo, collector2@bmw.demo | WASTE_COLLECTOR |
| transporter1@bmw.demo, transporter2@bmw.demo | TRANSPORTER |
| operator@bmw.demo | TREATMENT_OPERATOR |
| auditor@bmw.demo | AUDITOR |

## Lifecycle
`SEGREGATED → COLLECTION_PENDING → COLLECTED → IN_TRANSIT → ARRIVED → TREATMENT_PENDING → TREATED → DISPOSED → CLOSED`
(`REJECTED` possible before treatment). Illegal moves return `409 INVALID_TRANSITION` and raise an alert. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Documentation
[Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [API](docs/API.md) · [Development](docs/DEVELOPMENT.md) · [AI (design)](docs/AI.md)

## Environment variables
See [`backend/.env.example`](backend/.env.example). `JWT_SECRET` must be ≥ 32 chars; never commit `.env`.

## Security notes
bcrypt password hashing · JWT re-validated against the DB on every request · server-side RBAC and row-level scoping · zod validation on all input · parameterised SQL with whitelisted sort columns · helmet + CORS allow-list · Redis rate limiting (strict on login) · sanitised 500 errors · append-only audit table enforced by a DB trigger.

## Known limitations
No AI assistant yet and no frontend automated tests · JWT only (no refresh tokens / revocation list beyond deactivating the user) · no email/SMS delivery for notifications · single-instance alert scheduler guarded by a Redis lock only · analytics beyond the dashboard summary (turnaround times, lifecycle durations) not yet exposed.
