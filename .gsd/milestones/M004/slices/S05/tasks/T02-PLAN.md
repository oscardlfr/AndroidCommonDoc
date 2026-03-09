# T02: 14.3-skill-materialization-registry 02

**Slice:** S05 — **Milestone:** M004

## Description

Define the `l0-manifest.json` schema that downstream L1/L2 projects use to declare which L0 skills, agents, and commands they adopt. Includes Zod-based validation, default manifest generation, and type exports.

Purpose: The manifest is the declaration layer between the L0 registry and downstream projects. The sync engine reads this to know what to materialize.
Output: `manifest-schema.ts` module + unit tests

## Must-Haves

- [ ] "l0-manifest.json schema validates correctly with Zod"
- [ ] "include-all mode with excludes is the default selection model"
- [ ] "l2_specific section protects project-specific files from sync"
- [ ] "checksums record maps relative paths to sha256 hashes"

## Files

- `mcp-server/src/sync/manifest-schema.ts`
- `mcp-server/tests/unit/sync/manifest-schema.test.ts`
