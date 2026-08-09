# ADR-0009 — API PostgreSQL Connectivity

## Status
Accepted — Phase 6 Step 3

## Problem
AxorOS requires persistent PostgreSQL state, and API readiness must reflect whether that critical dependency is reachable.

## Existing decision
Supabase-managed PostgreSQL is the pilot database. Operational state is stored in PostgreSQL and credentials must remain server-side.

## Decision
Use the `pg` Node.js driver with a small connection pool in the API. Configure the connection using the server-only `AXOROS_DATABASE_URL` environment variable. Keep `/health` process-only, while `/ready` executes a lightweight `select 1` database check and returns HTTP 503 if PostgreSQL is unavailable. Close the pool during graceful API shutdown.

The database connection string must never be exposed through `VITE_*`, committed to Git, placed in Atlas OS, or logged.

## Reason
A direct PostgreSQL driver is sufficient for the pilot, avoids adding an ORM before its value is demonstrated, and makes readiness accurately represent a critical dependency.

## Cost impact
No additional recurring AxorOS software cost. PostgreSQL remains within the selected Supabase pilot plan subject to its usage limits.

## Security impact
Database credentials remain backend-only. Connection errors returned by readiness are intentionally generic so credentials and provider details are not leaked to callers.

## Migration impact
Future repository/data-access layers can be introduced above this pool without changing the database schema or connection boundary.
