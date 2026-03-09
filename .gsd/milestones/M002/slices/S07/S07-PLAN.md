# S07: Notebooklm Integration Skill

**Goal:** Define vault types, configuration management, and source file collection for the Obsidian vault sync pipeline.
**Demo:** Define vault types, configuration management, and source file collection for the Obsidian vault sync pipeline.

## Must-Haves


## Tasks

- [x] **T01: Plan 01**
  - Define vault types, configuration management, and source file collection for the Obsidian vault sync pipeline.

Purpose: Establish the foundational types and collection layer that all downstream vault modules depend on. Types define the pipeline contract. Config enables "runnable from any directory" by centralizing vault location. Collector gathers ALL source content (patterns, skills, project knowledge) from across the KMP ecosystem.

Output: Three source files (types.ts, config.ts, collector.ts) and two test files covering VAULT-01, VAULT-02, VAULT-03, VAULT-13.
- [x] **T02: Plan 02**
  - Build the enrichment pipeline that transforms raw source files into Obsidian-flavored Markdown with auto-generated tags, wikilinks, and enriched frontmatter.

Purpose: This is the core value-add of the vault -- transforming plain docs into interconnected Obsidian knowledge. Tags enable filtering, wikilinks light up the graph view, and enriched frontmatter makes each doc self-documenting in the vault context.

Output: Three source files (tag-generator.ts, wikilink-generator.ts, transformer.ts) and three test files covering VAULT-04, VAULT-05, VAULT-07.
- [x] **T03: Plan 03**
  - Build the output pipeline: MOC page generation, vault file writer with manifest tracking, and the sync engine that orchestrates the full collect-transform-write pipeline.

Purpose: This plan completes the vault generation engine. MOC pages provide navigable index views in Obsidian's graph. The vault writer handles file I/O, .obsidian config, and change detection via content hashing. The sync engine ties everything together into a single `syncVault()` call that downstream MCP tools invoke.

Output: Three source files (moc-generator.ts, vault-writer.ts, sync-engine.ts) and two test files covering VAULT-06, VAULT-08, VAULT-09, VAULT-14, VAULT-15.
- [x] **T04: Plan 04**
  - Expose the vault sync engine as two MCP tools: sync-vault (with init/sync/clean modes) and vault-status (read-only health check).

Purpose: MCP tools make vault operations available to AI agents programmatically. The sync-vault tool handles all write operations (init, sync, clean). The vault-status tool is a separate read-only endpoint for quick health checks. This follows the established pattern from Phase 10 (monitor-sources, generate-detekt-rules).

Output: Two new tool files, updated index.ts, and two test files covering VAULT-10, VAULT-11.
- [x] **T05: Plan 05**
  - Create the Claude Code skill (SKILL.md), build integration tests for the full vault sync pipeline, and human-verify the generated vault in Obsidian.

Purpose: The skill makes vault operations accessible via simple commands (/sync-vault, /sync-vault --init). Integration tests validate the full pipeline end-to-end (no mocks). Human verification confirms the vault actually works in Obsidian with correct graph view, wikilinks, and navigation.

Output: SKILL.md skill definition, integration test file, and human-verified vault covering VAULT-12, VAULT-16, VAULT-17.

## Files Likely Touched

