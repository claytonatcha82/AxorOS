# ADR-0029 — Knowledge Retrieval Evaluation Baseline

## Status
Accepted — Phase 6 Step 6.9

## Problem
AxorOS now exposes controlled Atlas knowledge retrieval through PostgreSQL full-text search, metadata policy filters and source provenance. Before adding embeddings or other semantic infrastructure, the pilot needs a repeatable way to determine whether the existing retrieval approach is sufficiently reliable and policy-safe.

## Decision
Establish a deterministic retrieval evaluation harness against the real Atlas-derived PostgreSQL index.

The evaluation must:

1. use the same knowledge repository and retrieval service used by the API;
2. execute through the proven Infisical EU Cloud and PostgreSQL cloud path;
3. run a version-controlled pilot query suite;
4. require a minimum query hit rate;
5. execute each case twice and require stable result ordering and chunk identity;
6. verify required source provenance for returned chunks;
7. verify returned knowledge remains inside the requested security ceiling;
8. fail visibly when quality, determinism, provenance or policy requirements are not met;
9. remain manual during the pilot;
10. introduce no embedding provider or additional paid retrieval infrastructure.

## Reason
Semantic retrieval should be introduced only if measured retrieval quality shows that deterministic PostgreSQL full-text search is insufficient. A repeatable evaluation baseline makes that decision evidence-based rather than assumption-driven and prevents unnecessary cost and complexity.

## Pilot baseline
The initial evaluation suite targets production-agent website-development knowledge and requires at least a 75 percent query hit rate. Exact relevance expectations can be tightened as agent tasks and curated evaluation cases mature.

## Security impact
The evaluator never bypasses the knowledge retrieval service. Security-classification ceilings and provenance requirements remain part of the evaluated behavior.

## Cost impact
No new recurring infrastructure cost is introduced. Evaluation uses the existing PostgreSQL database, GitHub Actions execution path and Infisical secret injection.

## Future decision point
Embeddings, vector search or hybrid retrieval may be evaluated later only when the measured full-text baseline demonstrates a material retrieval-quality gap that justifies added operational complexity and cost.
