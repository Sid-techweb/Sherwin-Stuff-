# AI assistant & Hindsight memory - DESIGN ONLY (not implemented yet)

> Status: **planned, not built.** Nothing in this document exists in the code yet. It records the intended design so
> the later phases can be built consistently on the current backend.

## Principles
* **Database facts come from PostgreSQL**, via a fixed set of parameterised tools. The LLM never writes SQL.
* **Hindsight is the long-term memory layer, not the LLM.** It stores and retrieves what was learned in past interactions; the LLM reasons over (current DB facts + recalled memories).
* Answers are labelled: DATABASE FACT / MEMORY / INFERENCE / UNCERTAINTY. Missing data is stated as unavailable.
* LLM provider/model are environment variables (`LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`).

## Planned flow
```
React assistant → POST /api/ai/chat → recall(Hindsight) → LLM with tools → tool calls (getWasteStatistics, getDelayedTransports, …)
                                     → answer with sources → selectively retain(Hindsight)
```

## Planned tools (read-only, role-scoped, reuse existing services)
`getWasteStatistics`, `getWasteRecords`, `getFacilityStatistics`, `getDelayedTransports`, `getActiveAlerts`, `getWasteLifecycle`, `getAuditHistory`, `getDisposalStatistics`.

## Planned memory policy
Categories: USER_PREFERENCE, OPERATIONAL_CONTEXT, INCIDENT, COMPLIANCE_PATTERN, FACILITY_HISTORY, TRANSPORT_HISTORY, CONVERSATION_CONTEXT. Retain only distilled, operationally useful statements (never raw chats, credentials or personal data); one Hindsight bank per deployment, tagged by category and facility.

## Hindsight integration notes (from its public docs, to verify when implementing)
Docker image `ghcr.io/vectorize-io/hindsight` (API :8888, UI :9999) with `HINDSIGHT_API_LLM_PROVIDER` / `HINDSIGHT_API_LLM_API_KEY`;
HTTP: `PUT /v1/default/banks/{bank}`, `POST /v1/default/banks/{bank}/memories` (retain), `POST /v1/default/banks/{bank}/memories/recall`.
