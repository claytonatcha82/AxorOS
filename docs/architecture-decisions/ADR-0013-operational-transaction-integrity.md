# ADR-0013 — Operational Transaction Integrity

## Status
Accepted — Phase 6 Step 3

## Problem
AxorOS material state changes and their audit events must not diverge. A status update without its workflow event, or an audit event without the related state change, would make business history unreliable.

## Existing decision
Operational state is written through the service layer and every material change is audited in `operational.workflow_events`.

## Decision
Use PostgreSQL transactions for material operational writes. The repository transaction runner obtains a dedicated pooled connection, issues `BEGIN`, executes service work through a repository bound to that connection, and commits only after both the business-state mutation and its audit event succeed. Any error triggers `ROLLBACK` and the connection is released.

Client registration, lead registration, project creation, lead status transitions, and project status transitions use this transaction boundary.

Raw transaction clients are not exposed to agents or API callers.

## Reason
Atomic writes preserve audit integrity and make operational state reproducible and trustworthy.

## Cost impact
No additional recurring cost. Transactions use the existing PostgreSQL/Supabase infrastructure.

## Security impact
The transaction boundary remains inside the backend data-access layer. Agents receive service capabilities, not direct SQL or transaction handles.

## Migration impact
Future payments, approvals, tasks, and agent-run state changes should use the same transactional pattern where multiple records must succeed or fail together.
