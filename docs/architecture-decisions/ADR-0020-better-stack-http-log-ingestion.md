# ADR-0020 — Better Stack HTTP Log Ingestion

## Status
Accepted — Phase 6 Step 5

## Problem
AxorOS needs centralized, durable pilot observability without adding a heavy logging SDK, collector, or another infrastructure service.

## Existing decision
Better Stack is the selected monitoring platform. AxorOS already emits structured, redacted JSON logs to stdout/stderr.

## Decision
Use Better Stack's HTTPS log ingestion endpoint as an optional external log sink. Configure the ingesting host and source token through Infisical using `AXOROS_BETTERSTACK_INGESTING_HOST` and `AXOROS_BETTERSTACK_SOURCE_TOKEN`.

Local stdout/stderr remains authoritative for immediate process logging. Better Stack ingestion is asynchronous and non-critical: ingestion failures must not terminate or degrade the API. Events are sanitized before they are sent externally.

Do not introduce a Better Stack SDK or collector for the pilot unless deployment architecture later makes it materially useful.

## Reason
The HTTP API accepts the structured JSON AxorOS already produces, minimizes dependencies, preserves provider portability, and satisfies the pilot observability requirement.

## Cost impact
No required recurring cost while usage remains within the selected Better Stack free allowance. Usage must be monitored before scale.

## Security impact
The Better Stack source token is a machine secret and belongs in Infisical, never Git, Atlas OS, source code, logs, or browser configuration. Sanitization occurs before external transmission.

## Failure behavior
If external ingestion fails, AxorOS continues operating and writes a local warning. Better Stack is not part of API readiness.
