# ADR-0012 — Operational State Transition Rules

## Status
Accepted — Phase 6 Step 3

## Problem
Lead and project statuses are part of persistent business state. Allowing arbitrary status updates would let agents skip required workflow stages and weaken auditability.

## Existing decision
Operational state is stored in PostgreSQL and manipulated through the AxorOS service layer rather than direct agent/database access.

## Decision
Define explicit allowed transition maps for lead and project statuses in the operational state service. A transition must:

1. load the current record;
2. validate the current status;
3. verify the requested next status is allowed;
4. apply the parameterized update through the repository;
5. create a workflow audit event containing the previous and new status plus actor identity.

Initial lead transitions:
- new -> qualified | disqualified
- qualified -> engaged | disqualified
- engaged -> converted | disqualified
- converted -> terminal
- disqualified -> terminal

Initial project transitions:
- pending -> active | cancelled
- active -> qa | cancelled
- qa -> active | awaiting_approval | cancelled
- awaiting_approval -> active | delivered | cancelled
- delivered -> archived
- cancelled -> archived
- archived -> terminal

High-impact approval requirements will be layered on top in the Human Control / Approval step rather than bypassing this transition model.

## Reason
A central state machine prevents workflow skipping, makes behavior reproducible, and gives agents a bounded action surface.

## Cost impact
No additional recurring cost.

## Security impact
Agents cannot invent arbitrary workflow status changes through the supported service interface. Every accepted transition is associated with an actor and workflow event.

## Migration impact
No database migration is required because existing status constraints already contain these values. If future workflow evidence requires a new state, both the database constraint and this transition policy must be updated together.
