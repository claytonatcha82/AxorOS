# ADR-0016 — Infisical Runtime Secret Injection

## Status
Accepted — Phase 6 Step 4

## Problem
AxorOS requires database and provider credentials without storing secrets in Git, Atlas OS, source code, prompts, or committed environment files.

## Existing decision
Infisical is the selected machine/application secret store. Bitwarden remains the founder password manager.

## Decision
Use Infisical Cloud for the pilot. Local development authenticates the Infisical CLI as the founder and injects secrets into child processes with `infisical run`. AxorOS development secrets are stored under the `dev` environment and `/api` path. Staging and production will use separate Infisical environments and machine identities rather than founder interactive login.

The first server secret is `AXOROS_DATABASE_URL`. Future Anthropic, OpenAI, Gemini, Voyage, payment, email, monitoring, and other server credentials follow the same server-only secret boundary.

Do not export secrets into committed `.env` files. Do not use `VITE_*` names for secrets.

## Reason
Runtime injection removes repeated manual CMD configuration while keeping credentials out of the repository and Atlas OS. Infisical's CLI and machine identities provide a path from local development to automated deployment without redesigning secret handling later.

## Cost impact
Infisical Secrets Manager Free is $0/month and currently supports the pilot's identity, project, and environment requirements. Upgrade only when actual limits or required Pro capabilities justify it.

## Security impact
Secret values remain external to Git and Atlas OS. Local founder authentication and future machine identities are separated. Production workloads will not depend on the founder's interactive session.

## Migration impact
Existing `AXOROS_DATABASE_URL` application configuration remains unchanged; only the mechanism that supplies it changes from manual shell variables to Infisical runtime injection.
