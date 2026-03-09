# T09: 14.2-docs-content-quality 09

**Slice:** S04 — **Milestone:** M004

## Description

Quality gate: validate doc quality across all 3 projects, re-sync vault, and human-verify Obsidian navigation.

Purpose: Ensure all Phase 14.2 work is correct, consistent, and properly reflected in the Obsidian vault. This is the final verification step before the phase is complete.
Output: All validation passing, vault re-synced, human-approved Obsidian navigation.

## Must-Haves

- [ ] "validate-doc-structure reports 0 errors across all 3 projects"
- [ ] "No active doc exceeds 500 lines across any project"
- [ ] "All hub docs under 100 lines"
- [ ] "All l0_refs resolve to valid L0 slugs"
- [ ] "Vault re-synced with no errors"
- [ ] "Obsidian vault navigation and graph view work correctly"
- [ ] "Full MCP test suite green"

## Files

- `mcp-server/tests/integration/doc-structure.test.ts`
- `mcp-server/src/vault/sync-engine.ts`
- `mcp-server/src/vault/moc-generator.ts`
