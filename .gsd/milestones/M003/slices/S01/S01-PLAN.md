# S01 Plan — Multi-source Sync Engine

## Goal
Extend `syncL0()` to read `sources[]` from manifest and merge N registries before syncing. Layer priority: last source wins per entry name (L1 overrides L0).

## Tasks

- [ ] **T01: `mergeRegistries()` function** `est:30m`
- [ ] **T02: `syncMultiSource()` — N-source sync orchestrator** `est:45m`
- [ ] **T03: Full test coverage for merge + multi-source** `est:45m`
