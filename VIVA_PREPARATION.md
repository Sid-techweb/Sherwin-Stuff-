# Viva Preparation

## The project in one minute
"Hospitals produce biomedical waste that must be collected, transported and treated correctly. My system tracks every batch through a fixed lifecycle, controls who may do what, raises alerts when something is late or missing, keeps an audit trail nobody can edit, and shows dashboards. An AI assistant answers questions by querying the real database, and remembers useful findings using Hindsight."

## Core ideas in simple words
* **State machine** - a batch can only move forward through allowed steps (like a parcel: packed -> shipped -> delivered). Illegal jumps are refused and logged.
* **Role-based access control (RBAC)** - each user has one role; the server checks the role on every request.
* **Cache** - keep a recent answer in fast memory so the database is not asked the same expensive question repeatedly.
* **LLM** - a language model that writes text and decides which tool to call. It does not know our data.
* **Hindsight** - a memory service. It stores short facts from the past and finds the relevant ones later. It does not write answers.

## Likely questions and answers

**Why PostgreSQL?** Waste records are highly related (facility -> record -> collection -> transport -> disposal). A relational database enforces foreign keys, constraints, enums, transactions and triggers (e.g. append-only audit log), which matter for compliance. A document database would push those checks into code.

**Why Redis?** It is in-memory and very fast. I use it for the dashboard cache, rate limiting (counters with expiry) and a lock so only one server runs the alert scan. It is an accelerator, not the source of truth.

**Why Express?** Small, mature and unopinionated; it let me build a clear layered structure (routes -> controllers -> services -> repositories) and is easy to explain.

**Why React?** Component-based UI with reusable pieces (tables, badges, modals) and a large ecosystem (Recharts, React Router). State is kept simple with hooks.

**Why TypeScript?** Types catch mistakes at compile time (e.g. wrong field names) and document data shapes shared across layers.

**Why REST?** Resources map naturally to URLs (`/waste`, `/collections`) with standard HTTP verbs and status codes; it is simple, cacheable and testable with curl.

**Why Docker?** Everyone gets the same Postgres, Redis, API and web server with one command, without installing anything by hand.

**Why Hindsight, and what is it?** The assistant should remember useful history between sessions ("Riverside had many delays last month"). Hindsight is an open-source agent-memory service with `retain` (store a fact) and `recall` (find relevant facts). I use it so I do not have to build semantic memory search myself.

**How does Hindsight differ from an LLM?** An LLM generates language from its training and the current prompt; it forgets everything between calls. Hindsight stores and retrieves information over time; it does not answer questions. In my system: database gives facts, Hindsight gives past context, the LLM turns both into an explanation.

**How does the AI retrieve database information?** The LLM can only request nine predefined tools (e.g. `getDelayedTransports`). My server validates the arguments, runs a parameterised query as the logged-in user, and sends the result back to the LLM. The LLM never sees SQL or the schema and cannot run its own queries.

**How does the AI avoid hallucination?** (1) It must call tools for factual questions. (2) It must label answers as Database fact / Memory / Inference / Uncertainty. (3) The UI shows sources (tool, arguments, raw data). (4) If data is missing it says "unavailable". (5) If a number appears without any tool call, the response is flagged. (6) With no LLM the answer text is generated from templates over tool results, so it cannot invent anything.

**How is authentication implemented?** Login checks the password against a bcrypt hash and returns a signed JWT. On every request the server verifies the token and reloads the user from the database, so a deactivated user is locked out immediately.

**How does RBAC work?** Route guards (`requireRole`) allow only certain roles per endpoint, and queries add row-level scoping: hospital staff see only their facility, collectors only their assignments, transporters only their jobs. The frontend hides buttons, but security does not depend on that.

**How are alerts generated?** Two ways: immediately on events (late arrival, excessive quantity, illegal transition) and by a scheduled scan that looks for overdue collections, trucks past their expected arrival, stale unassigned waste and waste that arrived but was never disposed. A unique index prevents duplicates and alerts auto-resolve when the problem is fixed.

**How does the waste lifecycle work?** One function, `moveStatus`, is the only code that changes status. It locks the record, checks the allowed-transitions table, updates the status, writes a history row and an audit row in the same transaction, then clears the cache.

**How does caching work?** The dashboard result is stored in Redis for 60 s under a key that contains a version number and a hash of the filters. Any data change increments the version, so old entries are never read again. The response header `X-Cache: HIT/MISS` shows what happened.

**What happens if Redis goes down?** The app keeps working: dashboard queries go straight to PostgreSQL, rate limiting is skipped, the health endpoint reports "degraded". There is a test that disconnects Redis and checks this.

**What happens if the AI provider goes down?** The call fails, the assistant adds a warning and answers in data-only mode using the same database tools. If Hindsight is down, memory falls back to the local ledger table.

**Why do you keep a local memory table if you use Hindsight?** Transparency (admins can see exactly what was remembered), a fallback when Hindsight is unavailable, and a place to apply dedupe.

**How do you protect against SQL injection?** All queries use parameters, sort columns come from a whitelist, inputs are validated with zod, and the AI tools accept no SQL at all. A test sends injection strings through the API and the assistant.

**How do you ensure the audit log cannot be altered?** The application exposes no write endpoints for it, and a database trigger rejects UPDATE and DELETE. A test confirms it.

**What is the weakest part / what would you improve?** Live verification against a real Hindsight service and LLM key (tests use mock servers), frontend automated tests, refresh tokens, and notification delivery.

**How did you test it?** 72 integration tests on a real test database and Redis, including full workflow, permissions, failure cases, cache behaviour and AI safety. Writing them uncovered real bugs, which I fixed.

## Demo script (5 minutes)
1. Log in as `admin@bmw.demo` (password `Demo@1234`). Show the dashboard and the "served from Redis cache" badge.
2. Open Waste records, open one, show the lifecycle stepper and audit history.
3. Log in as `staff.dgh@bmw.demo`: create a record, request collection; as `collector1`: complete it; as `transporter1`: plan, depart, arrive; as `operator`: record disposal. (Or do several steps as admin.)
4. Show Alerts (delayed transports, missing disposals) and Audit logs.
5. Open Analytics, then AI assistant: ask "Which facility generated the most waste?", then "Show me delayed transports", then "What was the issue we saw with that facility earlier?" and open *Sources* and the *Memory ledger*.
6. Mention the limits honestly: data-only mode without an LLM key, mock-tested Hindsight/LLM adapters.
