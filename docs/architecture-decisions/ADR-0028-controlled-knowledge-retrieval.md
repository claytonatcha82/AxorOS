# ADR-0028 — Controlled Knowledge Retrieval

## Status
Accepted — Phase 6 Step 6.8

## Problem
AxorOS now has a populated, reconstructable PostgreSQL knowledge index derived from Atlas OS. Future agents need a controlled way to retrieve Atlas knowledge without querying raw Markdown or database tables directly, bypassing authority, task, agent, security, or provenance controls.

## Existing decisions
Atlas OS remains the authoritative knowledge source. PostgreSQL stores derived document and chunk representations. The knowledge schema already includes full-text search support, lifecycle status, authority levels, allowed agents, applicable tasks, security classification, retrieval weight, source versions, checksums, and source paths. Paid embeddings and external vector infrastructure are intentionally deferred for the pilot.

## Decision
Introduce a knowledge retrieval service boundary backed initially by PostgreSQL full-text search.

The retrieval boundary must:

1. require a non-empty search query;
2. require explicit agent and task execution context;
3. normalize agent/task identifiers consistently;
4. return only `active` knowledge documents;
5. enforce `allowed_agents` when a document declares agent restrictions;
6. enforce `applicable_tasks` when a document declares task restrictions;
7. enforce an explicit maximum security classification supplied by the caller;
8. rank matching chunks using PostgreSQL full-text relevance, retrieval weight, authority level, and document priority;
9. cap result counts to a conservative bounded maximum;
10. return source provenance including document path, heading path, source version, document checksum, and chunk checksum;
11. keep retrieval read-only;
12. avoid embeddings or external vector infrastructure until deterministic retrieval quality is evaluated.

Empty `allowed_agents` or `applicable_tasks` arrays mean the document is not restricted by that dimension. They do not bypass security classification controls.

## Ranking
The initial ranking model combines PostgreSQL `ts_rank_cd` with controlled multipliers. Higher-authority sources receive greater weight than examples or historical material, while document priority and explicit `retrieval_weight` remain part of the score.

Ranking is an ordering mechanism only. It must never override access-control filters.

## Security impact
Agents do not receive direct access to the raw Atlas vault or unrestricted knowledge tables through this service. Security classification, agent restrictions, and task restrictions are applied before results are returned. The service accepts a caller-provided security ceiling; future API/authentication layers must derive that ceiling from trusted execution context rather than arbitrary external input.

## Cost impact
No new recurring infrastructure cost is introduced. The implementation reuses PostgreSQL generated `tsvector` data and the existing GIN index already present in the knowledge foundation.

## Deferred work
API exposure, authenticated execution-context derivation, retrieval observability, retrieval quality evaluation, adjacent-chunk expansion, semantic/vector retrieval, embeddings, and RAG assembly are separate follow-on work. Semantic retrieval should only be introduced if measured pilot retrieval quality justifies the added complexity and cost.

## Source-of-truth clarification
Retrieval results are derived references to Atlas OS knowledge. Returned provenance must allow AxorOS to trace each result back to the authoritative Atlas source representation and the exact ingested source version.
