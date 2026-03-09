# T03: 14.3-skill-materialization-registry 03

**Slice:** S05 — **Milestone:** M004

## Description

Build the sync engine that reads a project's l0-manifest.json, resolves desired assets against the L0 registry, computes a diff (new/updated/removed/unchanged), materializes full copies with version headers, and updates checksums. Also create the `/sync-l0` skill definition.

Purpose: This is the core distribution mechanism replacing install-claude-skills.sh and the delegate pattern. It makes skill distribution declarative, reproducible, and auditable.
Output: `sync-engine.ts` module + `/sync-l0` SKILL.md + unit tests

## Must-Haves

- [ ] "Sync engine reads manifest, resolves against registry, and materializes selected skills/agents/commands"
- [ ] "Skills get l0_source, l0_hash, l0_synced injected into YAML frontmatter"
- [ ] "Commands get HTML comment header with source, hash, synced date"
- [ ] "Drift detection compares manifest checksums to registry hashes, shows diff"
- [ ] "L2-specific files listed in manifest are never touched"
- [ ] "After sync, manifest checksums are updated to match current registry hashes"

## Files

- `mcp-server/src/sync/sync-engine.ts`
- `mcp-server/tests/unit/sync/sync-engine.test.ts`
- `skills/sync-l0/SKILL.md`
