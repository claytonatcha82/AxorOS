# ADR-0030 — Controlled Knowledge Context Assembly

## Status
Accepted — Phase 6 Step 6.10

## Problem
Controlled Atlas retrieval is now verified, deterministic, provenance-rich, and sufficient for the pilot baseline. Future AxorOS agents will need retrieved knowledge converted into model-consumable context without bypassing retrieval policy, losing citations, or allowing unbounded prompt growth.

## Decision
Introduce a model-agnostic knowledge context assembly service between controlled retrieval and any future LLM/agent runtime.

The context assembler must:

1. consume only results returned by the controlled knowledge retrieval service;
2. preserve retrieval order rather than re-rank knowledge independently;
3. retain source provenance, authority level, source version, and checksums outside the rendered context;
4. assign stable per-package source references such as `[ATLAS-01]`;
5. render concise source and authority headers alongside retrieved content;
6. enforce a bounded character budget before model invocation;
7. report truncation explicitly;
8. remain independent of any specific LLM or embedding provider.

## Reason
RAG should not mean giving an AI model unrestricted access to the Atlas vault. The context assembly boundary converts already-authorized retrieval results into a bounded evidence package suitable for future agent reasoning while preserving auditability and source traceability.

## Cost impact
No new recurring cost. The service is local application logic and continues using PostgreSQL full-text retrieval.

## Deferred work
LLM/provider integration, prompt execution, response grounding evaluation, embeddings, vector search, and autonomous agent behavior remain deferred until the context boundary is verified.
