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

Downstream projects sync automatically — no manual `git pull` or `/sync-l0` needed. Two complementary mechanisms ensure changes propagate reliably.

### How it works

```
L0 push to master
  │
  ├─ l0-sync-dispatch.yml (L0 repo)
  │  reads .github/downstream-repos.json
  │  sends repository_dispatch to each repo
  │
  ▼
L1 l0-auto-sync.yml (L1 repo)
  │  triggered by dispatch event
  │  clones L0 → builds sync CLI → runs syncL0()
  │  creates branch auto-sync/l0-update
  │  opens PR with changes (26 files updated, etc.)
  │
  ├─ (if chain) cascades dispatch to L2
  │
  ▼
L2 l0-auto-sync.yml (L2 repo)
     same flow → PR with L0+L1 merged changes
```

### 1. Dispatch (instant)

When L0 pushes to master, `l0-sync-dispatch.yml` fires. It reads `.github/downstream-repos.json` and sends a `repository_dispatch` event to each listed repo. The downstream `l0-auto-sync.yml` workflow receives the event, clones L0, builds the sync CLI, runs `syncL0()`, and creates a PR.

**Path filter:** Only triggers when relevant files change (`skills/`, `agents/`, `scripts/`, `docs/`, `detekt-rules/`, `mcp-server/src/`, `.claude/commands/`, `versions-manifest.json`).

### 2. Scheduled (safety net)

`l0-auto-sync.yml` runs daily at 06:00 UTC via cron. It compares upstream HEAD against the `l0Commit` in `l0-manifest.json`. If they differ, it syncs. This catches missed dispatches (token expiry, downtime, new repos not yet in the dispatch list).

### 3. Manual (always available)

```bash
/sync-l0              # additive sync (new + updated, never removes)
/sync-l0 --prune      # also removes orphaned files
/sync-l0 --dry-run    # preview changes without writing
```

### Setup guide

#### Step 1: L0 — Configure dispatch target list

Add downstream repos to `.github/downstream-repos.json`:

```json
[
  "your-org/shared-kmp-libs",
  "your-org/my-app"
]
```

#### Step 2: L0 — Create DOWNSTREAM_SYNC_TOKEN secret

The dispatch needs a token with permission to trigger workflows in downstream repos.

1. Go to **github.com → Settings → Developer settings → Fine-grained tokens → Generate new token**
2. Name: `L0 Auto-Sync Dispatch`
3. Expiration: 90 days (or your org policy)
4. Repository access → **Only select repositories** → select all downstream repos
5. Permissions → Repository permissions → **Contents: Read and write**
6. Generate token → copy the value
7. Go to **L0 repo → Settings → Secrets and variables → Actions → New repository secret**
8. Name: `DOWNSTREAM_SYNC_TOKEN`, paste the token value

#### Step 3: L1/L2 — Install auto-sync workflow

Copy the template to each downstream repo:

```bash
cp <L0>/setup/templates/workflows/l0-auto-sync.yml .github/workflows/
```

Or use `/setup` wizard (W5 installs it automatically).

#### Step 4: L1/L2 — Enable Actions PR creation

GitHub Actions cannot create PRs by default. Enable it:

1. Go to **downstream repo → Settings → Actions → General**
2. Scroll to **Workflow permissions**
3. Check ✅ **Allow GitHub Actions to create and approve pull requests**
4. Save

#### Step 5 (chain only): L1 — Configure cascade dispatch

If L1 has its own downstream repos (L2), add:

- `.github/downstream-repos.json` in L1 (listing L2 repos)
- `DOWNSTREAM_SYNC_TOKEN` secret in L1 (with access to L2 repos)

### What the PR looks like

The auto-sync creates a PR with:
- Title: `chore(sync): auto-sync from L0`
- Branch: `auto-sync/l0-update`
- Body: table with added/updated counts, source commit, trigger type
- Changes: updated skills, agents, commands, manifest checksums

The PR is force-pushed on subsequent syncs (single PR, always up to date).

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No dispatch fires | `downstream-repos.json` missing or empty | Create the file with repo list |
| Dispatch fires but L1 no run | `l0-auto-sync.yml` not in L1 `.github/workflows/` | Copy the template |
| Sync runs but PR fails: "not permitted to create pull requests" | Actions PR permission disabled | Settings → Actions → General → enable checkbox |
| Sync runs but PR fails: "'sync' not found" | Label doesn't exist (fixed in latest template) | Update `l0-auto-sync.yml` to latest |
| Cron runs but skips | Upstream HEAD matches `l0Commit` in manifest | Expected — no changes to sync |
| DOWNSTREAM_SYNC_TOKEN expired | Fine-grained PAT has expiration | Regenerate and update secret |

## Cross-references

- Manifest schema: `mcp-server/src/sync/manifest-schema.ts`
- Sync engine: `mcp-server/src/sync/sync-engine.ts`
- Setup wizard: `skills/setup/SKILL.md` (Step 0 topology choice)
- Auto-sync dispatch: `.github/workflows/l0-sync-dispatch.yml`
- Auto-sync downstream: `setup/templates/workflows/l0-auto-sync.yml`
- M003 spec: `.gsd/milestones/M003/M003-CONTEXT.md`
