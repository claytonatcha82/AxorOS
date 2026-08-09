# ADR-0023 — Structure-Aware Atlas Chunking

## Status
Accepted — Phase 6 Step 6

## Problem
Atlas OS knowledge must be converted into retrieval chunks without destroying the structure of SOPs, checklists, tables, code, callouts, and heading context.

## Existing decision
Phase 5 established that fixed-size chunking is not acceptable as the default. Atlas OS remains authoritative and chunks are derived, reconstructable artifacts.

## Decision
Chunk parsed Markdown by document structure. Preserve code fences, table blocks, checklist sequences, and callouts as atomic chunks. Prose may be split only when it exceeds a conservative target size and then only at paragraph boundaries. Every chunk records heading context, deterministic checksum, group identifier, token estimate, and previous/next relationships.

The initial prose target is approximately 3,200 characters. This is an engineering starting point, not a permanent retrieval constant.

## Reason
Structure-aware boundaries improve retrieval coherence and preserve procedural meaning while keeping chunks deterministic and reproducible.

## Cost impact
No additional recurring cost.

## Security impact
Chunking does not alter authority, permissions, or security classification. Those remain document metadata propagated into later ingestion stages.

## Migration impact
Embedding and retrieval layers can consume the deterministic chunk contract without changing Atlas OS source files.
