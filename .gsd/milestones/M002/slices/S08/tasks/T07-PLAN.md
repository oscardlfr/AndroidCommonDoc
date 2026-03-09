# T07: 12-ecosystem-vault-expansion 06

**Slice:** S08 — **Milestone:** M002

## Description

Update MCP tools (sync-vault, vault-status, find-pattern) and the sync-vault skill definition for ecosystem-aware operation.

Purpose: MCP tools are the agent-facing surface -- they must expose the L0/L1/L2 model consistently (ECOV-06). find-pattern needs ecosystem-aware queries so agents can ask "give me all patterns for DawSync" and get L0 + L1 + L2-DawSync results. The vault-status tool needs per-layer breakdowns. The skill definition needs updated parameters.
Output: Updated sync-vault, vault-status, find-pattern tools + updated SKILL.md

## Must-Haves

- [ ] "sync-vault MCP tool accepts optional project and layer filter parameters"
- [ ] "vault-status returns per-layer file breakdown alongside existing fields"
- [ ] "find-pattern supports ecosystem-aware queries: 'give me all patterns for DawSync' returns L0 + L1 + L2-DawSync"
- [ ] "sync-vault skill definition updated with new parameters"

## Files

- `mcp-server/src/tools/sync-vault.ts`
- `mcp-server/src/tools/vault-status.ts`
- `mcp-server/src/tools/find-pattern.ts`
- `skills/sync-vault/SKILL.md`
