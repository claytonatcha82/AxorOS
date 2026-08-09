# ADR-0004 — Repository and CI Hardening

Date: 2026-08-09
Status: Accepted

## Context

AxorOS has passed local environment, typecheck, test, and build verification. Before adding backend infrastructure and agents, dependency installation and CI behaviour must be reproducible.

## Decision

- Commit `package-lock.json` and treat it as authoritative dependency resolution for the npm-workspace monorepo.
- CI uses `npm ci`, never an unconstrained install.
- Enforce the Node engine declared in `package.json` through `.npmrc` with `engine-strict=true`.
- Keep package-lock generation enabled.
- Keep npm audit enabled for explicit audit runs; do not silently introduce third-party dependency scanners during the pilot.
- GitHub Actions receives read-only repository content permission unless a later workflow has a concrete need for more.
- CI continues to run typecheck, tests, and build for pull requests and pushes to `main`.
- New repository tooling must have a concrete quality, security, or operational justification.

## Cost impact

No added recurring cost. GitHub Actions usage remains within the existing pilot allowance unless usage grows substantially.

## Security impact

Positive. Locked dependencies improve reproducibility and reduce unreviewed dependency drift. Restricted workflow permissions reduce blast radius if a workflow dependency is compromised.

## Migration impact

The locally generated `package-lock.json` from the verified Windows environment must be committed once. Future dependency changes must update the lockfile in the same change.
