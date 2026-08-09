# ADR-0021 — Atlas Knowledge Schema Foundation

## Status
Accepted — Phase 6 Step 6.1

## Problem
AxorOS needs a persistent, reproducible representation of Atlas OS knowledge before embeddings and retrieval can be implemented safely.

## Existing decision
Atlas OS Markdown is the source of truth. Database documents, chunks, embeddings, and indexes are derived and must be reconstructable. Knowledge must preserve lifecycle, authority, permissions, provenance, and structure-aware chunk relationships.

## Decision
Create the first `knowledge` schema tables:

- `knowledge.ingestion_runs`
- `knowledge.documents`
- `knowledge.chunks`

`documents` stores controlled metadata including lifecycle status, authority level, allowed agents, task applicability, security classification, source version, checksum, and source modification time.

`chunks` stores structure-aware text chunks with heading paths, group IDs, previous/next relationships, checksums, token estimates, and PostgreSQL full-text-search materialization.

`ingestion_runs` records source commit, knowledge release, index version, chunking version, metadata schema version, counts, status, and errors.

This migration intentionally does not create embeddings or vector indexes yet.

## Reason
The retrieval system needs deterministic document/chunk identity and governance before vector search is introduced. Building embeddings first would make lifecycle, authority, and provenance harder to retrofit safely.

## Cost impact
No new recurring service cost. Storage uses the existing Supabase PostgreSQL project.

## Security impact
The `knowledge` schema remains inaccessible to `public` and to the current `axoros_api` operational role. Knowledge access will be introduced later through a dedicated controlled service boundary.

## Migration impact
Future migrations will add embedding storage, vector indexes, retrieval logs, evaluation runs, and dedicated knowledge-service privileges without changing Atlas OS authority semantics.
