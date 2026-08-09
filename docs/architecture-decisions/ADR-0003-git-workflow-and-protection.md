# ADR-0003 — Git Workflow and Repository Protection

Status: Accepted
Date: 2026-08-09

## Problem
AxorOS needs a reliable path for changing the codebase without allowing accidental, unverified, or high-impact changes to enter the authoritative branch.

## Existing baseline
Phase 6 requires a private GitHub repository, Git-based version control, CI-style validation, human authority over high-impact actions, cost discipline, and duplication control.

## Decision
Use `main` as the authoritative integration branch with short-lived feature/fix branches and pull requests for normal code, security, database, agent, deployment, payment, and infrastructure changes.

The repository's required verification gate is install → typecheck → test → build. Squash merge is preferred for ordinary feature/fix work.

During the solo-founder pilot, low-risk administrative corrections may be committed directly to `main` when a PR would add negligible safety value. High-impact changes require explicit founder review.

Do not purchase GitHub Pro solely to obtain private-repository branch protection during the pilot. The current personal GitHub Free/private-repository combination does not provide enforced protected branches/rulesets for private repositories. Reassess a paid plan when additional collaborators or autonomous write-capable agents are introduced, or when production risk makes technical enforcement materially valuable.

## Reason
This preserves a disciplined workflow and CI gate while respecting the pilot's R0 infrastructure objective. It also avoids buying a platform feature before the system has collaborators or autonomous writers that materially increase branch-risk exposure.

## Cost impact
Added recurring cost: R0.
Potential later cost: GitHub paid plan if enforced private-repository branch protection becomes justified.

## Security impact
Positive: establishes explicit review and verification requirements for high-impact changes.
Residual risk: the repository owner can still bypass policy and push directly to `main` while on GitHub Free. This is accepted during the solo-founder pilot and must be reassessed before granting additional write access or autonomous repository mutation.

## Migration impact
No migration required. A future GitHub plan upgrade can enable technical enforcement without changing the branch model.
