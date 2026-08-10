# ADR-0027 — Cloud Atlas Ingestion Execution

## Status
Accepted — Phase 6 Step 6.6

## Problem
Local Atlas ingestion from the development workstation has shown intermittent DNS resolution failures and connection instability when reaching the Supabase shared pooler. The ingestion pipeline itself must remain deterministic and secure without adding a recurring paid IPv4 dependency for the pilot.

## Existing decisions
Atlas OS Markdown remains the authoritative knowledge source. PostgreSQL is a derived and reconstructable knowledge index. Secrets are managed through Infisical. The incremental ingestion runner preserves source commit and release provenance and does not automatically delete source-missing documents.

## Decision
Run production-like Atlas ingestion as a manually dispatched GitHub Actions job while retaining local execution for development and diagnostics.

The cloud workflow must:

1. remain manual-only during the pilot;
2. execute the existing AxorOS ingestion code rather than introduce a second ingestion implementation;
3. obtain the Atlas source from a separate private mirror repository, never from committed Atlas content inside the AxorOS application repository;
4. treat the private GitHub Atlas repository as a transport/mirror layer only, not as the authoritative knowledge source;
5. record the exact Atlas mirror commit SHA as `sourceCommit` provenance;
6. obtain AxorOS runtime secrets from Infisical at job runtime using GitHub OIDC and a narrowly scoped Infisical machine identity;
7. never store the Supabase database connection string as a long-lived GitHub repository secret;
8. use read-only credentials for the private Atlas mirror;
9. prevent overlapping Atlas ingestion jobs through GitHub Actions concurrency controls;
10. preserve existing PostgreSQL transaction, retry, timeout, and incremental-change behavior.

## Reason
A GitHub-hosted runner provides a stable cloud network path without introducing a paid dedicated IPv4 add-on. Reusing the same ingestion implementation avoids architecture drift. Separating the Atlas mirror from the AxorOS repository protects knowledge-source boundaries while allowing reproducible cloud execution.

## Security impact
Infisical remains the secret source of truth. GitHub OIDC provides short-lived workload authentication rather than a long-lived Infisical credential. The Atlas mirror requires only read access from the ingestion workflow. Atlas content must remain in a private repository.

## Cost impact
No new recurring infrastructure cost is introduced for the pilot. GitHub-hosted Actions usage remains within the repository/account plan limits and should be monitored before increasing ingestion frequency.

## Operational impact
The workflow is intentionally manual during Phase 6. Automatic schedules, push-triggered ingestion, promotion, embeddings, and production release automation are deferred until the ingestion pipeline is proven and cost/security controls are reviewed.

## Source-of-truth clarification
Atlas OS remains authoritative. The private GitHub mirror is a materialized transport copy used solely to make the authoritative source available to the cloud runner. Changes should originate in Atlas OS and then be synchronized to the mirror before ingestion.
