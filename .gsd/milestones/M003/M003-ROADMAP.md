# M003: Chain Layer Model — L0→L1→L2 Knowledge Cascade

**Vision:** AI agents working on L2 projects inherit all knowledge, rules, skills, and agents from L1 and L0 automatically — no manual copying, no stale files, no invisible middle-layer knowledge.

## Success Criteria

- `sync-l0 --resolve` on an L2 project with `topology: "chain"` produces a `KNOWLEDGE-RESOLVED.md` containing tagged sections from L0 + L1 + L2
- An agent referencing a skill defined in L0 but not copied locally still resolves it via manifest `sources[]`
- Detekt config chain loads L0 base → L1 override → L2 override via convention plugin, last wins per key
- `find-pattern` searches docs across all layers in manifest, ranked by proximity (L2 > L1 > L0)
- `/setup` wizard asks topology (flat vs chain) and wires manifest `sources[]` accordingly
- All existing flat-topology projects continue working unchanged (backward-compatible)

## Key Risks / Unknowns

- Multi-source registry merge with name collisions — L1 overriding L0 skills by name could lose L0 intent if not handled carefully
- Agent template resolution depends on source paths being accessible at sync time — offline/CI scenarios
- Convention plugin chain config is Kotlin code in L1/L2, not L0 — we can only document and test the pattern, not ship it

## Proof Strategy

- Registry merge collisions → retire in S01 by proving merge with 2 registries where L1 overrides 1 L0 entry
- Offline scenario → retire in S02 by proving `--resolve` materializes files that work without source access
- Convention plugin → retire in S03 by shipping a documented template + integration test fixture

## Verification Classes

- Contract verification: vitest for sync engine, bats for CLI flags, unit tests for merge logic
- Integration verification: end-to-end sync from fixture L0 + L1 dirs → project with chain manifest
- Operational verification: `sync-l0 --resolve` produces correct merged files on Windows + Linux
- UAT / human verification: run on real L1 (shared-kmp-libs) → L2 (DawSync) chain

## Milestone Definition of Done

This milestone is complete only when all are true:

- All 5 slices pass their verification
- `sync-l0 --resolve` works end-to-end on a chain manifest with 2 sources
- `find-pattern` returns results from multiple layers
- `/setup` wizard offers topology choice and wires manifest correctly
- Flat-topology projects are unaffected (regression tests pass)
- KNOWLEDGE-RESOLVED.md is generated correctly with layer tags
- README updated with chain/flat documentation
- STATE.md updated

## Requirement Coverage

- Covers: chain topology sync, knowledge cascade, multi-source resolution
- Partially covers: agent template injection (schema ready, full template engine deferred)
- Leaves for later: Swift emitter (D001), version conflict resolution (open question 4)
- Orphan risks: none

## Slices

- [ ] **S01: Multi-source sync engine** `risk:high` `depends:[]`
  > After this: `sync-l0` reads `sources[]` from manifest, merges N registries, syncs from the merged set. Proven by vitest with 2-source fixture producing correct merged output.

- [ ] **S02: Knowledge cascade + agent resolve** `risk:high` `depends:[S01]`
  > After this: `sync-l0 --resolve` generates `KNOWLEDGE-RESOLVED.md` with tagged `[L0]`/`[L1]`/`[L2]` sections, and resolves agent templates with `{{LAYER_KNOWLEDGE}}` injection. Proven by vitest + bats.

- [ ] **S03: find-pattern multi-layer search** `risk:medium` `depends:[S01]`
  > After this: `find-pattern` MCP tool searches docs across all `sources[]` layers, returns results ranked by proximity. Proven by vitest with fixture docs in 2 source dirs.

- [ ] **S04: Setup wizard topology choice** `risk:low` `depends:[S01]`
  > After this: `/setup` Step 0 asks flat vs chain, Step 1 wires `sources[]` in manifest. Proven by bats testing the SKILL.md flow.

- [ ] **S05: Convention plugin template + docs** `risk:low` `depends:[S01]`
  > After this: `docs/guides/convention-plugin-chain.md` documents the Gradle chain config pattern with copy-paste Kotlin code. Integration test fixture validates config merge order. README chain section updated.

## Boundary Map

### S01 → S02

Produces:
- `mergeRegistries(registries: Registry[]): Registry` — deduped merge with layer priority
- `getOrderedSourcePaths(manifest): string[]` — resolved absolute paths for all sources
- `syncL0` accepting N sources instead of 1

Consumes:
- nothing (first slice)

### S01 → S03

Produces:
- `getOrderedSourcePaths(manifest): string[]` — reused by find-pattern to locate docs dirs

Consumes:
- nothing (first slice)

### S01 → S04

Produces:
- `createChainManifest(sources)` — already exists, wizard uses it

Consumes:
- nothing (first slice)

### S01 → S05

Produces:
- Chain model proven working — docs describe what S01 implemented

Consumes:
- nothing (first slice)

### S02 → (none)

Produces:
- `KNOWLEDGE-RESOLVED.md` generation
- Agent template resolution with `{{LAYER_KNOWLEDGE}}`

Consumes:
- S01: `getOrderedSourcePaths()` to find knowledge files per layer
