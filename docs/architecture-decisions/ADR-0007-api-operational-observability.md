# ADR-0007 — API Operational Observability

## Status
Accepted

## Context
Before AxorOS connects PostgreSQL, agents, or external providers, the core API needs enough observability to diagnose startup, shutdown, request behavior, and failures without introducing another paid logging stack prematurely.

## Decision
The pilot API will emit newline-delimited JSON logs to stdout/stderr using a minimal internal logger.

The API records:
- service startup;
- graceful and forced shutdown;
- completed HTTP requests;
- request IDs;
- method and path;
- response status;
- request duration;
- unhandled request errors.

A versioned metadata endpoint is available at `GET /api/v1/meta` for non-secret runtime metadata.

Better Stack remains the selected external monitoring destination for a later Phase 6 step. The API logger is intentionally provider-neutral so logs can be forwarded without changing application behavior.

## Security
Logs must never intentionally include secrets, credentials, raw authorization headers, payment credentials, or sensitive client payloads.

## Cost impact
R0 additional recurring cost for this implementation.

## Deferred
- Better Stack transport/configuration;
- distributed tracing;
- metrics exporters;
- full OpenTelemetry instrumentation.

These are introduced only when implementation need justifies them.
