# ADR-0015 — Database Least-Privilege Role

## Status
Accepted — Phase 6 Step 3

## Problem
The AxorOS API should not operate with database-owner or migration-level privileges during normal runtime.

## Existing decision
PostgreSQL/Supabase stores operational state. Knowledge access, tool permissions, and financial authority remain separate. Secrets must not be committed to Git or Atlas OS.

## Decision
Create a PostgreSQL NOLOGIN group role named `axoros_api` through migration. Grant only the privileges required by the current operational repository:

- `USAGE` on schema `operational`;
- `SELECT` on `operational.clients`;
- `SELECT, INSERT, UPDATE` on `operational.leads`;
- `SELECT, INSERT, UPDATE` on `operational.projects`;
- `SELECT, INSERT` on `operational.workflow_events`;
- no access to schema `knowledge`;
- no delete, DDL, ownership, or migration privileges.

The role remains `NOLOGIN`. A separate runtime login credential will be created later through secret-managed infrastructure and granted membership in `axoros_api`. Its password must never appear in a migration, Git, Atlas OS, logs, or prompts.

## Reason
Separating deploy/migration authority from runtime authority reduces blast radius if the API credential is compromised and preserves the architecture rule that knowledge access and action authority are independently controlled.

## Cost impact
No additional recurring cost.

## Security impact
The runtime API can be constrained to the tables and operations it actually needs. `knowledge` remains inaccessible to the operational API role at this stage.

## Migration impact
Future operational tables require explicit privilege review before the runtime role receives access. Future knowledge-service roles should be created separately rather than expanding `axoros_api` by default.
