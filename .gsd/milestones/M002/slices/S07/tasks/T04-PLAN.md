# T04: Plan 04

**Slice:** S07 — **Milestone:** M002

## Description

Expose the vault sync engine as two MCP tools: sync-vault (with init/sync/clean modes) and vault-status (read-only health check).

Purpose: MCP tools make vault operations available to AI agents programmatically. The sync-vault tool handles all write operations (init, sync, clean). The vault-status tool is a separate read-only endpoint for quick health checks. This follows the established pattern from Phase 10 (monitor-sources, generate-detekt-rules).

Output: Two new tool files, updated index.ts, and two test files covering VAULT-10, VAULT-11.
