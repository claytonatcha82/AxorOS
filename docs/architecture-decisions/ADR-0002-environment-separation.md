# ADR-0002 — Environment Separation

**Status:** Accepted  
**Date:** 2026-08-09  
**Phase:** 6 — Build Agents  
**Step:** 1.3 — Environment Strategy

## Context

AxorOS requires development, staging and production separation before database credentials, AI-provider keys, payment configuration, or other machine secrets are introduced.

The pilot must preserve security boundaries without creating unnecessary paid infrastructure prematurely.

## Decision

AxorOS uses three logical environments:

### Development

- Runs on the founder/developer machine during Phase 6 implementation.
- Uses local URLs and development-only configuration.
- Must never use production credentials or production client data.
- Local secret-bearing files remain Git-ignored.

### Staging

- Used for integration and pre-production verification.
- Must use credentials and data separated from production.
- Must never be treated as an informal production environment.
- Physical cloud resources will be provisioned only when required by the relevant implementation step.

### Production

- Runs the live AxorOS agency system.
- Uses production-only credentials, databases and provider configuration.
- Production secrets are never stored in Git, Atlas OS, prompts, logs, or frontend bundles.
- High-impact production actions remain subject to AxorOS permission and approval controls.

## Configuration Rules

1. `AXOROS_ENV` must be one of `development`, `staging`, or `production`.
2. Configuration names may be committed; secret values may not.
3. `VITE_*` variables are public browser configuration and must never contain secrets.
4. Backend-only secrets remain server-side.
5. Staging and production credentials must be distinct.
6. Atlas OS is not an environment-variable or secret store.
7. Infisical remains the selected machine-secret system when secrets are introduced later in Phase 6.
8. Bitwarden remains the founder credential/password manager.
9. Environment boundaries do not grant permissions: environment access, knowledge access and action authority remain separate controls.

## Pilot Cost Decision

Step 1.3 creates logical separation only. It does not provision three duplicate paid infrastructure stacks.

Physical staging and production resources will be introduced only when required by later implementation steps and will receive their own cost review before provisioning.

## Consequences

- Environment intent is explicit before credentials exist.
- Production credentials cannot be reused casually in development.
- Frontend/public configuration is distinguished from backend secrets.
- The pilot incurs no new recurring cost from this decision.
- Later deployment/database steps must map resources and secret sets to these environment boundaries.
