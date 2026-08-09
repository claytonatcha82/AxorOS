# ADR-0025 — Atlas Source Acquisition and Change Detection

## Status
Accepted — Phase 6 Step 6

## Problem
Atlas OS is the authoritative knowledge source, but ingestion must not blindly rebuild the full corpus every run or hard-code one founder workstation path.

## Existing decision
Atlas OS Markdown is source-of-truth; database documents/chunks are derived and reconstructable. Ingestion must support Git/source change detection and must never overwrite Atlas OS.

## Decision
The knowledge service accepts an explicit Atlas root directory at runtime. It recursively discovers Markdown files, ignores local tooling directories such as `.git` and `.obsidian`, normalizes paths to forward-slash relative paths, computes SHA-256 checksums, and compares them with persisted knowledge document fingerprints.

Files are classified as added, changed, unchanged, or missing from source. Added/changed files become ingestion candidates. Missing files are reported but are not automatically deleted or archived in this slice; lifecycle handling requires an explicit policy step.

No Atlas source file is modified by discovery or change detection.

## Reason
Checksum-based incremental ingestion reduces unnecessary parsing, chunking, embedding cost, and database writes while remaining deterministic. Runtime root configuration keeps the service portable across local development, CI, and future controlled Git checkouts.

## Cost impact
No new recurring service cost. Reduced future API/embedding usage is expected because unchanged documents can be skipped.

## Security impact
Discovery is constrained to a caller-supplied root and Markdown files only. Tooling/internal directories are excluded. Missing-source detection does not autonomously destroy derived knowledge.

## Migration impact
A later ingestion runner can combine source discovery, Git commit/version metadata, the existing parser/chunker, and transactional staging writes. A later lifecycle policy will decide how deleted/renamed Atlas files affect production knowledge.
