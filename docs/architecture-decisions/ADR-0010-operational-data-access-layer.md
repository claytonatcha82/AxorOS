# ADR-0010 — Operational Data Access Layer

## Status
Accepted — Phase 6 Step 3

## Problem
Future agents and API routes need access to persistent business state without receiving raw SQL capability or unrestricted database access.

## Existing decision
Operational state is stored in PostgreSQL under the `operational` schema. Knowledge access, tool permission, and financial authority are separate concerns.

## Decision
Introduce a backend-only Operational Repository that owns SQL access to `operational.clients`, `operational.leads`, `operational.projects`, and `operational.workflow_events`.

The repository uses parameterized SQL, bounded list sizes, and explicit row-to-domain mapping. Agents and HTTP routes must call application/service interfaces above this repository rather than executing arbitrary SQL directly.

The initial repository supports read access to all four foundation tables and controlled creation of client records. Additional writes will be added only when a concrete workflow requires them.

## Reason
This creates a stable security and maintenance boundary between business logic and PostgreSQL while avoiding an ORM before its value is demonstrated.

## Cost impact
R0 additional recurring cost.

## Security impact
Reduces SQL injection and over-permission risk by preventing arbitrary SQL at the agent/API layer. Client/project isolation and authorization still need to be enforced at higher layers and later with RLS as defence in depth.

## Migration impact
Future service classes, agents, and API routes can consume repository methods without changing database connectivity or schema ownership.
