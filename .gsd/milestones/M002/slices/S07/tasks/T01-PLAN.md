# T01: Plan 01

**Slice:** S07 — **Milestone:** M002

## Description

Define vault types, configuration management, and source file collection for the Obsidian vault sync pipeline.

Purpose: Establish the foundational types and collection layer that all downstream vault modules depend on. Types define the pipeline contract. Config enables "runnable from any directory" by centralizing vault location. Collector gathers ALL source content (patterns, skills, project knowledge) from across the KMP ecosystem.

Output: Three source files (types.ts, config.ts, collector.ts) and two test files covering VAULT-01, VAULT-02, VAULT-03, VAULT-13.
