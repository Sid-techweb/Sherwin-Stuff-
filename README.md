# Biomedical Waste Tracking & AI Compliance System

Tracks biomedical waste from segregation at the source → collection → transport → treatment/disposal → closure, with
role-based access, alerts for abnormal events, a tamper-resistant audit trail, Redis-accelerated analytics, and an AI
assistant that answers from live database data and remembers useful operational history (Hindsight).

> **All data in this repository is synthetic demo data.**

## Features
* Strict waste lifecycle state machine with history and audit for every transition
* Role-based access (ADMIN, HOSPITAL_STAFF, WASTE_COLLECTOR, TRANSPORTER, TREATMENT_OPERATOR, AUDITOR) enforced server-side with row-level scoping
* Collections, transportation (vehicle capacity, expected vs actual arrival, delay detection), treatment/disposal records
* Alerts: delayed collection/transport, excessive quantity, missing disposal, unassigned waste, invalid transitions, manual vehicle/segregation issues
* Dashboard and operational analytics (average collection/transport/disposal/lifecycle times, delay %, completion %)
* Redis: dashboard cache with instant invalidation, rate limiting, alert-scan lock; app keeps working if Redis is down
* AI assistant with 9 read-only controlled tools, labelled answers (Database fact / Memory / Inference / Uncertainty), sources, memory ledger
* Hindsight long-term memory integration with local-ledger fallback; configurable LLM (Anthropic or any OpenAI-compatible API); works without an LLM key in data-only mode
* React web app, Docker Compose, 72 integration tests

## Quick start (Docker, one command)
```bash
docker compose up -d --build
cd backend && npm install && npx tsx src/db/seed.ts     # load synthetic demo data (once)
```
Open **http://localhost:8088** and sign in (demo accounts below). API: http://localhost:4100/api/health.

## Quick start (development)
```bash
docker compose up -d postgres redis
cd backend && cp .env.example .env && npm install
npm run migrate && npm run seed
npm run dev                  # API  http://localhost:4100
npm test                     # 72 tests (needs the postgres + redis containers)

cd ../frontend && npm install && npm run dev      # web http://localhost:5173
```
Host ports (chosen to avoid clashing with common defaults): Postgres **5440**, Redis **6390**, API **4100**, web **8088**.
More: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) · [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

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
(`REJECTED` possible before treatment). Illegal moves return `409 INVALID_TRANSITION` and raise an alert.

## AI assistant
Open **AI assistant** in the app. Try: "Which facility generated the most waste?", "Show me delayed transports",
"Summarize this week's operational problems", "Compare this month with last month", then
"What was the issue we saw with that facility earlier?". Without an LLM key it answers in **data-only mode**; to enable an
LLM set `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY` in `backend/.env`; to enable Hindsight run
`docker compose --profile ai up -d hindsight` and set `HINDSIGHT_URL`. Design, safety controls and exactly what has been verified: [docs/AI.md](docs/AI.md).

## Architecture
```
React SPA ─▶ nginx ─▶ Express API (routes → controllers → services → repositories) ─▶ PostgreSQL
                                   ├─▶ Redis (cache · rate limit · locks)
                                   └─▶ AI: tools (read-only, as the user) · LLM (optional) · Hindsight (optional) · local memory ledger
```

## Documentation
[Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [API](docs/API.md) · [AI](docs/AI.md) · [Development](docs/DEVELOPMENT.md) · [Deployment](docs/DEPLOYMENT.md) · [Final report](FINAL_PROJECT_REPORT.md) · [Viva preparation](VIVA_PREPARATION.md)

## Testing
`cd backend && npm test` - 72 integration tests on real PostgreSQL/Redis (separate `bmw_test` database, Redis DB 15). Also `npm run typecheck` and `npm run lint` in `backend/`; `npm run build` in `frontend/`.
Not covered by automated tests: the React UI (checked manually in a browser) and live calls to Hindsight / an LLM provider (tested against mock servers implementing their documented APIs).

## Security notes
bcrypt · JWT re-validated against the DB each request · server-side RBAC + row scoping · zod validation · parameterised SQL with whitelisted sort columns · helmet + CORS allow-list · Redis rate limiting (strict on login/AI) · sanitised 500s · append-only audit table (DB trigger) · AI tools without SQL access and memory redaction · secrets only in `.env` (git-ignored).

## Known limitations
Live Hindsight/LLM not verified in the automated run · no frontend automated tests · JWT only (no refresh/revocation list) · no e-mail/SMS delivery · regulatory rules are configurable thresholds, not a full legal rule set. See the [final report](FINAL_PROJECT_REPORT.md).
