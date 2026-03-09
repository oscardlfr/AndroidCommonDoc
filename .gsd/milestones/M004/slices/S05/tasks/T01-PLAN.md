# T01: 14.3-skill-materialization-registry 01

**Slice:** S05 — **Milestone:** M004

## Description

Build the L0 skill registry generator that scans all skills, agents, and commands, computes SHA-256 content hashes, extracts metadata from frontmatter, and outputs `skills/registry.json` as the single source of truth for downstream discovery.

Purpose: Registry is the foundation for the entire materialization system. Manifest resolution, sync engine, and validation all depend on this catalog.
Output: `skill-registry.ts` module + `registry.json` generated file + unit tests

## Must-Haves

- [ ] "registry.json catalogs all 27 skills, 11 agents, and 32 commands with correct metadata"
- [ ] "SHA-256 content hashes are deterministic and reproducible"
- [ ] "registry.json is auto-generated from filesystem scanning, never hand-edited"
- [ ] "Each entry has name, type, path, description, category, tier, hash, dependencies"

## Files

- `mcp-server/src/registry/skill-registry.ts`
- `mcp-server/tests/unit/registry/skill-registry.test.ts`
- `skills/registry.json`
