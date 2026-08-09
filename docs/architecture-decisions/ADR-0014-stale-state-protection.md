# ADR-0014 — Concurrency and Stale-State Protection

## Status
Accepted — Phase 6 Step 3

## Problem
Multiple agents or processes may read the same operational record and attempt conflicting status transitions. A later write must not silently overwrite a transition that already changed the record.

## Existing decision
Lead and project transitions are validated in the operational state service and executed inside PostgreSQL transactions with matching workflow events.

## Decision
Use optimistic compare-and-set updates for lead and project statuses. Repository updates must include both the record ID and the expected current status in the SQL `WHERE` clause. If the row no longer has the expected status, the update returns no row and the service raises a stale-state conflict. No audit event is written for a failed stale transition.

## Reason
This prevents lost updates without introducing distributed locks or a separate coordination service during the pilot. It composes cleanly with the existing transaction boundary.

## Cost impact
No additional recurring cost.

## Security and integrity impact
Prevents one agent/process from silently overwriting a newer workflow state based on stale information. The caller must reload state before retrying.

## Migration impact
No schema migration is required. If future workflows need field-level concurrency beyond status transitions, a version column may be introduced later.
