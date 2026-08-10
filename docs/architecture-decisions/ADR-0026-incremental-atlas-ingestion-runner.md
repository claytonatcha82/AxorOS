# ADR-0026 — Incremental Atlas Ingestion Runner

## Status
Accepted — Phase 6 Step 6

## Problem
The Atlas Knowledge Service needs one executable pipeline that discovers Atlas Markdown, detects changes against the current knowledge index, parses and chunks only added/changed documents, and records ingestion provenance without rebuilding unchanged content.

## Existing decision
Atlas OS Markdown is authoritative. The PostgreSQL knowledge index is derived and reconstructable. Change detection uses normalized source paths and SHA-256 checksums. Missing source files must not be deleted or archived automatically.

## Decision
Add an incremental ingestion runner that:

1. scans an explicit `AXOROS_ATLAS_ROOT` directory;
2. compares discovered checksums with `knowledge.documents` fingerprints;
3. skips unchanged documents;
4. loads only added/changed Markdown;
5. passes those documents through the existing parse/chunk/transactional-ingestion service;
6. reports added, changed, unchanged, missing-from-source, ingested-document, and ingested-chunk counts;
7. leaves missing-from-source documents untouched pending an explicit lifecycle policy.

Expose the pipeline through `npm run ingest:atlas`. The Atlas root remains a runtime-local path and is never hard-coded into the repository.

## Reason
This joins the already-tested ingestion components into a repeatable pipeline while preserving provenance, reducing unnecessary work, and keeping local Obsidian-vault location details outside source control.

## Cost impact
No added recurring cost. The runner uses existing local filesystem, PostgreSQL, and Infisical infrastructure.

## Security impact
The runner receives the database credential through Infisical. It reads Atlas files but never writes to Atlas OS. The local Atlas root path is configuration, not a secret, and is not committed.

## Migration impact
Future GitHub-backed or CI-triggered acquisition can invoke the same runner after materializing an Atlas source tree. Embedding and staging/promotion steps can be layered after deterministic ingestion without changing the source-acquisition contract.
