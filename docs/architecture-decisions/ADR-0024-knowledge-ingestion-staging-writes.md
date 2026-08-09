# ADR-0024 — Knowledge Ingestion Staging Writes

## Status
Accepted — Phase 6 Step 6.4

## Problem
Parsed Atlas OS documents and structure-aware chunks need to enter PostgreSQL reproducibly without partial document state or silent metadata corruption.

## Existing decision
Atlas OS Markdown is the source of truth. The knowledge database is derived and reconstructable. Knowledge releases must be versioned and validated before production promotion.

## Decision
Implement a knowledge ingestion repository and service that:

- creates an explicit `knowledge.ingestion_runs` record for each release;
- validates controlled lifecycle, authority, security and retrieval metadata before writing;
- upserts derived document metadata by stable `document_id`;
- replaces all chunks for a document inside one PostgreSQL transaction;
- persists deterministic chunk checksums and heading/group metadata;
- links previous/next chunks after insertion;
- marks the ingestion run `succeeded` with document/chunk counts only after all documents are written;
- marks the run `failed` with a bounded error summary if ingestion fails.

The ingestion service does not write to Atlas OS and does not promote a staging knowledge release to production.

## Reason
Transactional document replacement prevents mixed old/new chunk state. Explicit ingestion provenance provides reproducibility and makes failed releases inspectable without treating them as valid production knowledge.

## Cost impact
No additional recurring cost. Uses the existing Supabase PostgreSQL instance.

## Security impact
Only controlled derived metadata/content is written. No secrets should enter the knowledge ingestion pipeline; secret scanning and promotion gates remain separate required controls.

## Migration impact
Embedding generation, staging-index promotion and retrieval services can be layered on top without changing Atlas OS ownership or the document/chunk persistence boundary.
