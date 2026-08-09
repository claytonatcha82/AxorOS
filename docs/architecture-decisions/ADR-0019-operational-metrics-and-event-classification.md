# ADR-0019 — Operational Metrics and Event Classification

## Status
Accepted — Phase 6 Step 5

## Problem
AxorOS needs enough observability to distinguish routine traffic, client-side errors, server failures, degraded dependencies, and performance trends before telemetry is exported to a monitoring vendor.

## Existing decision
AxorOS emits structured JSON logs with secret redaction. Better Stack is the selected central observability provider, but pilot cost and vendor lock-in should be minimized.

## Decision
Maintain a small in-process metrics registry in the API for the pilot. Classify completed HTTP requests as success, client_error, or server_error; record counts, total/average/max duration, readiness failures, and process uptime. Emit explicit warning events for degraded readiness checks. Expose a read-only `/api/v1/metrics` endpoint for internal verification and future Control Center consumption.

Do not add a monitoring SDK or metrics database yet. The registry is process-local and intentionally non-durable; durable aggregation will be provided by the selected observability backend once connected.

## Reason
This establishes a stable observability contract with no additional service dependency, recurring cost, or vendor-specific instrumentation. It is sufficient for pilot debugging and can later feed Better Stack or another compatible backend.

## Cost impact
R0 additional recurring cost for this slice.

## Security impact
Metrics expose aggregate operational data only and contain no secret values, credentials, or business payloads. External exposure should be restricted by the future authentication layer before production.

## Migration impact
A future metrics exporter can consume the same event/metric concepts without changing application business logic.
