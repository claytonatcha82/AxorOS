# ADR-0017 — Secret Environment Separation

## Status
Accepted — Phase 6 Step 4

## Problem
AxorOS must prevent development, staging, and production processes from silently consuming secrets from the wrong environment.

## Existing decision
Infisical is the machine/application secret store. AxorOS has logical development, staging, and production environments and service-scoped secret paths such as `/api`.

## Decision
Use separate Infisical environments with the slugs `dev`, `staging`, and `prod`. Store API secrets under `/api` in each environment. Each environment must define `AXOROS_ENV` with the matching AxorOS runtime value:

- `dev` -> `development`
- `staging` -> `staging`
- `prod` -> `production`

Repository verification scripts check this mapping before environment-specific runtime use. Secrets are never copied automatically between environments. Production values must be created deliberately when production infrastructure exists.

Development may contain the current pilot database credential. Staging and production may remain without provider credentials until those environments are actually provisioned.

## Reason
Environment/path scoping creates explicit separation and reduces the risk that local development operates against production systems. It also avoids paying for or provisioning duplicated infrastructure before the pilot needs it.

## Cost impact
No additional recurring software cost within the selected Infisical pilot tier.

## Security impact
Reduces cross-environment credential misuse. Production secrets remain distinct and are not populated merely to make environments symmetrical.

## Migration impact
Future machine identities will be granted environment/path-specific access without changing application secret names.
