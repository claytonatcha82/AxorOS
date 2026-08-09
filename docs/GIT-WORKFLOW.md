# AxorOS Git Workflow

## Purpose
This workflow protects the AxorOS pilot from accidental or unreviewed changes while keeping infrastructure cost at R0 during the pilot.

## Branch model
- `main` is the authoritative integration branch.
- Feature/fix work should use short-lived branches.
- Recommended naming:
  - `feat/<short-description>`
  - `fix/<short-description>`
  - `chore/<short-description>`
  - `docs/<short-description>`

## Normal change flow
1. Update local `main`.
2. Create a short-lived branch.
3. Implement one coherent change.
4. Run local verification:
   - `npm run verify:env`
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
5. Commit with a concise conventional-style message.
6. Push the branch.
7. Open a pull request into `main`.
8. Confirm CI passes.
9. Review the diff and scope before merge.
10. Merge only when verification is green.
11. Delete the merged branch.

## Direct commits to main
Direct commits to `main` are discouraged. During the solo-founder pilot, they are permitted only for low-risk administrative corrections when creating a PR would add no meaningful safety value. Code, security, database, agent, deployment, payment, or infrastructure changes should use a branch and PR.

## Merge strategy
Prefer squash merge for normal feature/fix branches so `main` retains a concise history. Preserve separate commits only when the commit history itself has diagnostic or migration value.

## Required verification gate
The baseline CI gate is:
- install dependencies
- typecheck
- test
- build

A failing gate blocks normal merge by policy.

## High-impact changes
The following require explicit founder review before merge:
- production deployment logic
- authentication/authorization
- database migrations
- Row Level Security or client-isolation rules
- secrets/configuration infrastructure
- payment workflows
- agent tool permissions
- Atlas OS knowledge promotion logic
- security controls

## Emergency changes
If an urgent production correction eventually requires an expedited change:
1. Use a `fix/` branch.
2. Make the smallest safe patch.
3. Run the verification gate.
4. Record why the expedited path was required.
5. Follow with a normal review/cleanup PR if necessary.

## Pilot limitation
The repository is private and currently uses a personal GitHub account. Enforced private-repository branch protection/rulesets require a paid GitHub plan. AxorOS therefore uses policy + CI during the pilot rather than adding a subscription solely for branch protection.

Upgrade should be reconsidered when additional human collaborators or autonomous write-capable agents can push repository changes, or when production risk makes technical enforcement materially valuable.
