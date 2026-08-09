# ADR-0011 — Operational State Services

## Status
Accepted — Phase 6 Step 3

## Problem
Repository methods protect SQL access, but future agents still need a higher-level boundary that enforces business validation and audit events before persistent state changes.

## Existing decision
Agents must not have unrestricted database access. Persistent business state belongs in PostgreSQL and important actions must be auditable.

## Decision
Introduce an operational state service above the repository. The service validates inputs, calls bounded repository methods, and records workflow events for material writes such as client registration, lead registration, and project creation.

Agent/runtime code will call service methods rather than SQL or table-shaped CRUD directly.

## Reason
This creates a stable policy enforcement point for future permissions, approvals, client isolation, and workflow transitions without coupling those controls to SQL implementation details.

## Cost impact
No additional recurring cost.

## Security impact
Reduces direct database exposure and provides a central future enforcement point for authorization. Workflow event creation improves auditability.

## Migration impact
Future status-transition, approval, payment, and agent-run services can extend this pattern without replacing the repository layer.
