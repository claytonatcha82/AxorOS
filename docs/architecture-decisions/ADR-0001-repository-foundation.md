# ADR-0001 — Repository Foundation

**Status:** Accepted
**Date:** 2026-08-09
**Phase:** 6 — Step 1

## Problem

AxorOS needs an implementation repository that supports the Control Center, backend API, shared typed contracts, future database infrastructure, and incremental agent development without creating duplicate systems.

## Existing decision

The Phase 6 baseline requires a React Control Center, backend application/API services, PostgreSQL/Supabase, controlled agent runtime, Atlas OS knowledge service, Git, and a private GitHub repository.

## Decision

Use a single private monorepo with npm workspaces.

Initial boundaries:

- `apps/control-center` — React web control plane.
- `apps/api` — backend application/API process.
- `packages/contracts` — cross-boundary TypeScript contracts only.
- `infra/supabase` — future migrations and database configuration.
- `docs/architecture-decisions` — implementation deviations and decisions.

Use Node.js 24 LTS as the production runtime line.

Do not add Turborepo, Nx, Docker, Kubernetes, a backend framework, or agent SDK during Step 1. Introduce them only if a later implementation requirement justifies them.

## Reason

One repository keeps the pilot simple, gives atomic changes across frontend/backend/contracts, and avoids infrastructure duplication. npm workspaces provide the required package boundaries without another package-management or task-orchestration dependency.

## Cost impact

- Repository architecture: R0.
- npm workspaces: R0.
- Node.js: R0.
- Git: R0.
- GitHub private repository: R0 on GitHub Free within account limits.
- GitHub Actions: expected R0 during pilot while usage remains within included private-repository minutes.

## Security impact

Positive. Central `.gitignore`, environment policy, CI permissions, and a single controlled repository reduce accidental secret leakage and configuration drift.

## Migration impact

Low. Individual services can later be extracted if scale or security boundaries require separate repositories.
