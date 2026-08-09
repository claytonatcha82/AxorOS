# ADR-0006 — API Request Pipeline Hardening

**Status:** Accepted  
**Date:** 2026-08-09  
**Phase:** Phase 6 — Step 2 Core Backend Foundation

## Problem

AxorOS needs a stable API boundary before persistent state and agent services are introduced. The initial health-only server did not yet provide request correlation, versioned business routes, controlled browser access, consistent error responses, or graceful process shutdown.

## Decision

Use the existing Node.js HTTP server and add the following pilot controls without introducing another backend framework:

- Keep `/health` and `/ready` as unversioned operational endpoints.
- Place business API routes under `/api/v1`.
- Generate or propagate an `x-request-id` for every request and response.
- Use structured success and error envelopes for versioned API responses.
- Restrict browser CORS access to the configured AxorOS Control Center origin.
- Reject disallowed CORS preflight requests.
- Centralise unexpected request errors and avoid leaking implementation details to clients.
- Handle `SIGINT` and `SIGTERM` with graceful server shutdown and a bounded forced-shutdown fallback.

## Reason

These controls improve observability, API stability, security, and future compatibility while retaining the pilot principle of minimal dependencies.

## Cost impact

Added recurring cost: R0.

No paid service or additional framework is required.

## Security impact

Positive. Browser origins are allow-listed, error responses do not expose internal stack details, request IDs support audit correlation, and graceful shutdown reduces abrupt request termination.

CORS is not authentication or authorisation. Authentication and permission enforcement remain future backend responsibilities.

## Migration impact

Future business endpoints should be added beneath `/api/v1`. A future breaking API contract may introduce `/api/v2` while preserving required compatibility policy.
