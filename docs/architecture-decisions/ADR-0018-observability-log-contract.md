# ADR-0018 — Observability Log Contract

## Status
Accepted — Phase 6 Step 5

## Problem
AxorOS needs centralized observability, but logs may eventually contain request context, provider errors, agent metadata, and project identifiers. Sending raw application objects to an external log platform risks leaking secrets or producing unusable, unbounded telemetry.

## Existing decision
AxorOS already emits structured JSON logs to stdout/stderr and Better Stack is the selected monitoring platform. Secrets must never enter logs.

## Decision
Maintain a provider-neutral JSON log contract in the AxorOS API. Before serialization, recursively redact fields whose names indicate credentials or secret-bearing values, including passwords, secrets, tokens, authorization data, cookies, API keys, database URLs, and connection strings. Bound excessively long strings, arrays, and object depth.

Centralized log shipping will consume this sanitized stdout/stderr stream rather than becoming the primary logging API inside application code.

## Reason
Provider-neutral structured logs preserve local debuggability, reduce vendor lock-in, and create one security boundary before telemetry leaves the process.

## Cost impact
R0 recurring cost for this slice. Better Stack connection is deferred until the local log contract is verified.

## Security impact
Redaction reduces accidental credential disclosure. Redaction is defence in depth; application code must still avoid intentionally logging sensitive values.

## Migration impact
Better Stack or another telemetry sink can be attached later without changing application call sites.
