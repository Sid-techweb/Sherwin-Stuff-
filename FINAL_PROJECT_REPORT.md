# Final Project Report - Biomedical Waste Tracking & AI Compliance System

> All data in the system is synthetic demo data.

## 1. Problem statement
Biomedical waste (sharps, anatomical waste, contaminated plastics, glassware) must be tracked from the ward to final disposal. Paper or spreadsheet tracking makes it hard to prove that every batch was collected, transported and treated on time, to spot delays and missing disposals early, and to produce an audit trail. Managers also need quick answers ("which facility has the most delays?") without writing queries.

## 2. Solution
A web system that records every batch through a strict lifecycle, enforces who may do what, raises alerts for abnormal events, keeps a tamper-resistant audit trail, shows live dashboards and analytics, and offers an AI assistant that answers questions from live database data and remembers useful operational history.

Lifecycle: `SEGREGATED -> COLLECTION_PENDING -> COLLECTED -> IN_TRANSIT -> ARRIVED -> TREATMENT_PENDING -> TREATED -> DISPOSED -> CLOSED` (`REJECTED` possible before treatment).

## 3. Architecture
Browser (React SPA) -> nginx (static files + `/api` proxy) -> Express API -> PostgreSQL (system of record), Redis (cache, rate limiting, locks), optional Hindsight + LLM (assistant). Backend layering: routes -> controllers -> services -> repositories. See `docs/ARCHITECTURE.md`.

## 4. Technology stack
React 18, Vite, TypeScript, Recharts, React Router; Node 22, Express, TypeScript, zod, JWT, bcrypt, pino, helmet; PostgreSQL 16; Redis 7; Hindsight (memory) and a configurable LLM; Docker Compose; vitest + supertest.

## 5. Database design
15 tables: facilities, treatment_facilities, users, waste_categories, vehicles, waste_records, waste_status_history, collection_records, transport_records, disposal_records, alerts, notifications, audit_logs, ai_memories (+ schema_migrations). Foreign keys, enums, CHECK constraints, partial unique indexes (one live collection/transport per waste, one open alert per type+waste), query-driven indexes, and a trigger that makes `audit_logs` append-only. See `docs/DATABASE.md`.

## 6. Backend design
* **Services own the rules**: the single `moveStatus` function is the only code that changes a waste status; it locks the row (`SELECT ... FOR UPDATE`), validates against the state machine, writes history and audit in the same transaction.
* **Auth**: bcrypt hashes, JWT, token re-validated against the database on every request; **RBAC** enforced server-side with per-role route guards plus row-level scoping (staff -> own facility, collectors/transporters -> own jobs).
* **Validation**: zod on every input; parameterised SQL; whitelisted sort columns; uniform error envelope; sanitised 500s.
* **Alerts**: event-driven (late arrival, excessive quantity, invalid transition) and a periodic rule scan (overdue collection, late in-transit, unassigned/stale waste, missing disposal); idempotent and auto-resolving.
* **Analytics**: dashboard totals/series and operational metrics (average collection, transport, disposal turnaround, lifecycle durations, delay %, completion %) computed from real timestamps.

## 7. Frontend design
Sidebar app with role-aware navigation: dashboard (filters, KPI cards, charts, Redis indicator), waste list (search/filter/sort/paginate) and detail (lifecycle stepper, role-aware action buttons, history, audit), collections, transportation, disposal, analytics, alerts, audit logs, facilities and fleet, AI assistant, settings/system status. Business rules stay in the API; the UI only hides unusable actions. Loading skeletons, toasts, confirm dialogs, empty/error states, responsive layout.

## 8. Redis usage
Versioned dashboard/analytics cache (60 s TTL; one `INCR` invalidates everything on any write), fixed-window rate limiting (strict on login and the AI endpoint), alert-scan distributed lock and last-scan summary. Redis failure is tolerated: reads go to PostgreSQL, limiting is skipped (tested).

## 9. Hindsight architecture
Hindsight is the assistant's long-term memory (retain/recall over HTTP). The backend keeps a policy layer in front of it (categories, redaction, dedupe, aggregates only) and a local ledger table as transparency log and fallback. See `docs/AI.md`.

## 10. AI assistant architecture
Question -> recall memories -> LLM with 9 controlled read-only tools (or the deterministic offline planner when no LLM is configured) -> labelled answer (Database fact / Memory / Inference / Uncertainty) with sources -> retain distilled findings. Tools run as the calling user; no SQL generation; provider/model are environment variables.

## 11. Security
bcrypt, JWT with DB re-check, server-side RBAC and row scoping, zod validation, parameterised SQL, sort whitelist, helmet, CORS allow-list, Redis rate limiting, sanitised errors, append-only audit table, memory redaction, secrets only in environment variables (`.env` is git-ignored).

## 12. Testing
72 automated integration tests (vitest + supertest) against real PostgreSQL and Redis: authentication, RBAC and scoping, full lifecycle, invalid transitions, collection/transport/disposal rules, alert generation and scan idempotence, audit immutability, Redis caching/invalidation/rate limiting/outage fallback, operational analytics versus independent SQL, AI tool safety and role scoping, memory policy and recall, Hindsight (mock server) and LLM tool-calling (mock OpenAI and Anthropic servers). The tests found and helped fix real defects (e.g. a SQL parameter type clash, date handling in tool results, a sanitiser that mangled dates). The frontend was exercised manually in a browser; it has no automated tests.

## 13. Example workflows
1. **Happy path**: staff registers waste -> requests collection -> assigns collector -> collector marks collected -> transporter plans transport (vehicle capacity checked) -> departs -> arrives on time -> operator records treatment/disposal -> staff closes the record. Every step appears in history and audit logs.
2. **Delay**: arrival after the expected time -> `is_delayed`, a severity-graded DELAYED_TRANSPORT alert, dashboard and analytics update, assistant can explain "which facility has the most delays".
3. **Missing disposal**: waste sits in ARRIVED for > 24 h -> scan raises MISSING_DISPOSAL; recording the disposal auto-resolves it.
4. **Assistant with memory**: "Which facility has the most delayed transports?" -> database answer + a memory is stored; later "What was the issue we saw with that facility earlier?" -> the memory is recalled and shown, labelled as memory.

## 14. Future improvements
Refresh tokens and token revocation, e-mail/SMS notifications, CSV/PDF compliance reports, QR/barcode labels for bags, GPS tracking for vehicles, frontend automated tests (Vitest + Playwright), streaming assistant responses, regulation knowledge base (retrieval) with citations, multi-tenant support, full end-to-end validation against a live Hindsight service and a production LLM.

## 15. Known limitations
* The live Hindsight service and a real LLM key were **not** exercised in the automated run (mock servers speak their documented APIs); data-only mode is fully verified.
* No frontend automated tests; UI verified manually in a desktop browser.
* JWT only (no refresh/revocation list beyond deactivating a user); no notification delivery channel.
* Demo data and categories are synthetic; regulatory rules are not encoded beyond configurable storage-hour and quantity thresholds.
* Single database; no read replicas or partitioning (not needed at this scale).
