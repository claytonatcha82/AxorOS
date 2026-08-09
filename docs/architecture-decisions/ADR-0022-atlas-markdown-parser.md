# ADR-0022 — Atlas Markdown Parser Foundation

## Status
Accepted — Phase 6 Step 6.2

## Problem
Atlas OS Markdown must be transformed into derived knowledge records without losing the structures that carry operational meaning. The parser must preserve source fidelity and must not silently reinterpret unsupported metadata.

## Existing decision
Atlas OS remains the authoritative source. RAG records are reconstructable derivatives. Ingestion must preserve YAML metadata, heading hierarchy, lists/checklists, code, tables, Obsidian wiki links, and callouts.

## Decision
Implement a dependency-light Atlas Markdown parser in the AxorOS API that:

- normalizes CRLF to LF for deterministic checksums;
- preserves raw Markdown and raw frontmatter;
- extracts controlled top-level YAML scalars, inline arrays, and block arrays;
- rejects unsupported nested/ambiguous YAML instead of silently flattening it;
- extracts heading hierarchy and heading paths;
- identifies Obsidian wiki links and aliases;
- identifies Obsidian callouts;
- records fenced code block boundaries and languages;
- detects Markdown tables and checklists;
- ignores Markdown-looking structure inside fenced code blocks;
- produces a SHA-256 source checksum.

This parser does not write to Atlas OS and does not yet create chunks, embeddings, or database records.

## Reason
The pilot needs deterministic, testable source parsing before chunking or embedding. Avoiding a new parser dependency at this stage keeps the implementation small and makes unsupported metadata fail visibly rather than introducing permissive parsing behavior that could corrupt authority or permission metadata.

## Cost impact
No additional recurring or usage-based cost.

## Security impact
The parser treats source content as data only. It does not execute code, follow wiki links, or interpret content instructions as system instructions. Secret scanning remains a later ingestion gate before promotion.

## Migration impact
If Atlas OS begins relying on richer nested YAML, the controlled frontmatter parser can later be replaced with a standards-compliant YAML library behind the same parsed-document contract. Existing source Markdown remains unchanged.
