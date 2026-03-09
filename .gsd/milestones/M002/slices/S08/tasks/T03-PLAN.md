# T03: 12-ecosystem-vault-expansion 02

**Slice:** S08 — **Milestone:** M002

## Description

Rewrite the vault type system and config management to support the L0/L1/L2 hierarchy with rich per-project configuration.

Purpose: Types are the foundation -- every other vault module depends on these interfaces. Getting the contracts right first prevents cascading changes later. This is a breaking change (projects: string[] -> ProjectConfig[]) which is allowed per CONTEXT.md.
Output: Rewritten types.ts and config.ts with ProjectConfig, SubProjectConfig, layer-first types

## Must-Haves

- [ ] "VaultConfig uses ProjectConfig[] instead of string[]"
- [ ] "ProjectConfig has layer, collectGlobs, excludeGlobs, subProjects, features fields"
- [ ] "SubProjectConfig allows independent collection configuration"
- [ ] "VaultSourceType includes 'architecture' for .planning/codebase/ docs"
- [ ] "VaultSource carries layer as a required field"
- [ ] "VaultConfig has version: 1 field for future migrations"
- [ ] "Config loader handles new ProjectConfig schema with sensible defaults"

## Files

- `mcp-server/src/vault/types.ts`
- `mcp-server/src/vault/config.ts`
