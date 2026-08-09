# ADR-0017 — Runtime Secret Policy

## Status
Accepted — Phase 6 Step 4

## Problem
AxorOS requires a consistent, auditable secret-consumption model across local development and future non-interactive runtimes. Manual environment-variable setup is error-prone, and broad secret access would violate least-privilege principles.

## Existing decision
Infisical is the machine/application secret store. Bitwarden holds founder-managed credentials. Secrets must not be committed to Git, GitHub, Atlas OS, prompts, logs, or source code.

## Decision
Use Infisical project `AxorOS` with environment separation (`dev`, `staging`, `prod`) and service-scoped paths. API runtime secrets live under `/api`.

The Infisical project ID may be committed because it is an identifier, not a credential. Universal Auth Client IDs, Client Secrets, and short-lived `INFISICAL_TOKEN` values must never be committed.

Required development API secrets currently are:
- `AXOROS_ENV`
- `AXOROS_DATABASE_URL`

Repository scripts must validate secret presence without printing secret values. Machine runtimes authenticate using the `axoros-api-runtime` machine identity and Universal Auth. Human development access may use the authenticated Infisical CLI.

Future provider credentials should be added only when their corresponding integration is implemented. Examples include Anthropic, Voyage, OpenAI, Gemini, payment providers, email providers, and monitoring services.

## Reason
This keeps secret access explicit, environment-scoped, service-scoped, reproducible, and compatible with both human development and unattended cloud execution.

## Cost impact
No additional recurring software cost during the pilot within the selected Infisical free-tier limits.

## Security impact
Secret values are injected at runtime and are not stored in repository files. Machine access can be independently revoked by disabling the identity or rotating its Universal Auth secret.

## Migration impact
Staging and production will reuse the same path/key conventions with different environment-scoped secret values when those environments are provisioned.
