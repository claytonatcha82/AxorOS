# ADR-0008 — Database and State Foundation

## Status
Accepted — Phase 6 Step 3

## Decision
AxorOS will use Supabase-managed PostgreSQL as the pilot database platform, with migrations committed under `supabase/migrations/`.

Logical separation begins with two schemas:

- `operational` — persistent business and workflow state.
- `knowledge` — reserved for derived Atlas OS knowledge infrastructure and populated later by the knowledge-service implementation.

The first operational migration creates only the minimum persistent entities required to support later workflow implementation:

- `clients`
- `leads`
- `projects`
- `workflow_events`

## Rationale
This implements the established architecture without prematurely creating every future table. It provides stable client/project identifiers and an append-oriented event trail while keeping agent runs, tasks, approvals, payments, and knowledge tables for the implementation step that actually needs them.

Database schema changes are source-controlled migrations. Direct production schema editing is not an authoritative workflow.

## Local development strategy
Supabase documents a local CLI workflow backed by a Docker-compatible runtime. AxorOS will keep migration files compatible with that workflow, but local containerized Supabase is not required for this first migration-design slice. The migration can be applied to a dedicated pilot Supabase project after provisioning.

## Security
Client/project boundaries are represented explicitly from the first migration. Row Level Security policies will be introduced before client-facing or agent-facing database access is enabled. Until then, database access remains backend-controlled only.

No secrets belong in migrations, seed files, Git, Atlas OS, or logs.

## Cost impact
Pilot target: Supabase Free plan at $0/month while within current Free-plan limits. Upgrade only when reliability, storage, inactivity-pausing, backup, or production requirements justify it.

## Migration impact
Future database changes must be additive or deliberately migrated through versioned SQL files. The production database must not become the sole source of schema truth.
