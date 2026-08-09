# ADR-0005 — Core Backend Foundation

**Status:** Accepted
**Date:** 2026-08-09
**Phase:** 6 — Step 2

## Context

AxorOS requires a backend service boundary before database, secrets, RAG, or agent runtime integration. The pilot needs reliable configuration, request routing, health/readiness endpoints, error handling, and testability without premature framework or infrastructure expansion.

## Decision

Use Node.js built-in HTTP capabilities for the initial AxorOS API foundation.

Structure the API into distinct responsibilities:

- `config.ts` — validated runtime configuration.
- `app.ts` — request handling and HTTP response behavior.
- `server.ts` — process bootstrap and network listener only.
- `*.test.ts` — executable TypeScript tests through the existing `tsx` dependency.

Expose:

- `GET /health` — process health.
- `GET /ready` — readiness boundary. It currently reports ready because no external dependencies are attached yet. Future database and required-service checks will extend this endpoint.

Unknown routes return structured `404` JSON. Unexpected request-handler failures return structured `500` JSON.

## Framework decision

Do not introduce Express, Fastify, NestJS, or another backend framework during this foundation step.

The built-in Node HTTP layer is sufficient for the current pilot requirements. A framework may be introduced later only when route volume, middleware complexity, schema validation, plugin integration, or operational evidence justifies the added dependency.

## Consequences

- Zero new recurring cost.
- Zero new runtime framework dependency.
- Backend logic becomes independently testable.
- Configuration fails fast on invalid environment or port values.
- Readiness has a stable endpoint that can later incorporate PostgreSQL and external-service health.
- More routing/middleware utilities may eventually be required; this will be reassessed based on implementation evidence.
