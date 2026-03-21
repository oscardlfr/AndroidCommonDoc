---
scope: [architecture, sync, layers]
sources: [androidcommondoc]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-03"
slug: layer-topology
status: active
layer: L0
category: architecture
description: "Chain vs flat topology for L0/L1/L2 layer consumption. How skills, agents, rules, and docs cascade."
---

# Layer Topology: Flat vs Chain

AndroidCommonDoc supports two distribution topologies that control how knowledge flows between layers.

## Topologies

### Flat (default)

Each project consumes L0 directly. No intermediary layers.

```
L0 (AndroidCommonDoc)
 ├── L1 (shared-kmp-libs)     ← consumes L0 directly
 └── L2 (DawSync)             ← consumes L0 directly
```

Best for: enterprise teams, standalone apps, projects without a shared-libs layer.

```json
{
  "version": 2,
  "topology": "flat",
  "sources": [
    { "layer": "L0", "path": "../AndroidCommonDoc", "role": "tooling" }
  ]
}
```

### Chain

Knowledge cascades: L0 → L1 → L2. Each layer inherits from its parent and can add or override.

```
L0 (AndroidCommonDoc)
 └── L1 (shared-kmp-libs)
      └── L2 (DawSync)
```

Best for: solo devs / small teams where L1 defines ecosystem conventions that L2 inherits.

```json
{
  "version": 2,
  "topology": "chain",
  "sources": [
    { "layer": "L0", "path": "../../AndroidCommonDoc", "role": "tooling" },
    { "layer": "L1", "path": "../../shared-kmp-libs", "role": "ecosystem" }
  ]
}
```

## What cascades

| Resource | Flat | Chain |
|----------|------|-------|
| **Skills** | L0 → project | L0 + L1 → project (merged, L1 overrides on name collision) |
| **Agents** | L0 → project | L0 + L1 → project |
| **Detekt rules** | L0 base + project override | L0 base → L1 override → project override |
| **Pattern docs** | L0 docs only | L0 + L1 docs (AI agent searches both) |
| **KNOWLEDGE.md** | L0 knowledge | L0 + L1 knowledge |
| **Versions** | L0 versions-manifest | L0 for tooling, L1 for library versions |
| **Decisions** | L0 architectural decisions | L0 + L1 architectural + ecosystem decisions |

## Manifest schema

### v2 (current)

```json
{
  "version": 2,
  "sources": [
    { "layer": "L0", "path": "../AndroidCommonDoc", "role": "tooling" },
    { "layer": "L1", "path": "../shared-kmp-libs", "role": "ecosystem" }
  ],
  "topology": "chain",
  "selection": { "mode": "include-all" },
  "checksums": {},
  "l2_specific": { "commands": [], "agents": [], "skills": [] }
}
```

**Fields:**
- `sources[]`: ordered list of layer sources (L0 first)
- `sources[].layer`: identifier (L0, L1, L2)
- `sources[].path`: relative path from project root to the source
- `sources[].role`: `tooling` (L0), `ecosystem` (L1), `application` (L2)
- `topology`: `flat` or `chain`

### v1 (backward compatible)

```json
{
  "version": 1,
  "l0_source": "../AndroidCommonDoc"
}
```

v1 manifests are auto-migrated to v2 at read time (treated as flat with single L0 source).

## Detekt config chain

For chain topology, the convention plugin loads Detekt configs in layer order:

```kotlin
// Resolution order: L0 base → L1 override → L2 project override
// Last file wins per YAML key
config.setFrom(l0Base, l1Override, l2ProjectDetektYml)
```

Each layer only declares what it changes:
- **L0** (`detekt-l0-base.yml`): all 17 rules `active: true`
- **L1** (`detekt.yml`): disables rules not relevant to shared-libs
- **L2** (`detekt.yml`): disables rules not relevant to the app

## Choosing topology

Use `/setup` wizard Step 0:

```
Layer topology:
  [1] flat   — This project consumes L0 directly (default)
  [2] chain  — This project inherits from a parent layer
```

Or set `topology` in `l0-manifest.json` directly.

## Constraints

- Max chain depth: 3 layers (L0 → L1 → L2)
- Each layer must work standalone if parents are offline (cached copies)
- v1 manifests continue to work (auto-migrated, treated as flat)
- Enterprise flat mode requires no parent beyond L0

## Auto-Sync

Downstream projects sync automatically via two complementary mechanisms:

### 1. Dispatch (instant)

When L0 pushes to master, `l0-sync-dispatch.yml` sends a `repository_dispatch` to every repo in `.github/downstream-repos.json`. The downstream `l0-auto-sync.yml` workflow receives the event, runs `sync-l0`, and creates a PR with the changes.

```
L0 push → dispatch → L1 sync → dispatch → L2 sync
```

For chain topology, L1 cascades the dispatch to L2 automatically after its own sync completes.

### 2. Scheduled (safety net)

`l0-auto-sync.yml` also runs daily at 06:00 UTC via cron. It compares the upstream HEAD against the `l0Commit` stored in `l0-manifest.json` — if they differ, it syncs. This catches missed dispatches (token expiry, downtime, new repos).

### Setup

**L0 (source):**
- Add downstream repos to `.github/downstream-repos.json`
- Set `DOWNSTREAM_SYNC_TOKEN` secret (PAT with `repo` scope)

**L1/L2 (downstream):**
- Copy `setup/templates/workflows/l0-auto-sync.yml` to `.github/workflows/`
- Ensure `l0-manifest.json` exists (created by `/setup` wizard)
- For chain: add L2 repos to L1's `.github/downstream-repos.json`

## Cross-references

- Manifest schema: `mcp-server/src/sync/manifest-schema.ts`
- Sync engine: `mcp-server/src/sync/sync-engine.ts`
- Setup wizard: `skills/setup/SKILL.md` (Step 0 topology choice)
- Auto-sync dispatch: `.github/workflows/l0-sync-dispatch.yml`
- Auto-sync downstream: `setup/templates/workflows/l0-auto-sync.yml`
- M003 spec: `.gsd/milestones/M003/M003-CONTEXT.md`
