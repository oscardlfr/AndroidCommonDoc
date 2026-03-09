# T03: Plan 03

**Slice:** S07 — **Milestone:** M002

## Description

Build the output pipeline: MOC page generation, vault file writer with manifest tracking, and the sync engine that orchestrates the full collect-transform-write pipeline.

Purpose: This plan completes the vault generation engine. MOC pages provide navigable index views in Obsidian's graph. The vault writer handles file I/O, .obsidian config, and change detection via content hashing. The sync engine ties everything together into a single `syncVault()` call that downstream MCP tools invoke.

Output: Three source files (moc-generator.ts, vault-writer.ts, sync-engine.ts) and two test files covering VAULT-06, VAULT-08, VAULT-09, VAULT-14, VAULT-15.
