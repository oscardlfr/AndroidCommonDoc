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

Downstream projects sync automatically — no manual `git pull` or `/sync-l0` needed.

### Distribution models

| Model | Who knows whom | Latency | Scale |
|-------|---------------|---------|-------|
| **Managed (dispatch)** | L0 lists downstream repos | Instant (~30s) | Your repos |
| **Open (cron-only)** | Each consumer knows L0 | ≤24h | Unlimited |

**Managed** is for your own ecosystem — repos you control. L0 pushes dispatch events to known downstream repos. Use for internal teams, your L1/L2 projects.

**Open** is for external consumers (other teams, open-source users). They install `l0-auto-sync.yml` and point their `l0-manifest.json` at L0. The daily cron does the rest. L0 doesn't need to know they exist.

Both models can coexist: managed repos get instant sync, open consumers get daily cron.

### How it works

```
L0 push to master
  │
  ├─ l0-sync-dispatch.yml (L0 repo)              ← managed
  │  reads .github/downstream-repos.json
  │  sends repository_dispatch to each repo
  │
  ▼
L1 l0-auto-sync.yml (L1 repo)
  │  triggered by: dispatch (instant) OR cron (daily)
  │  clones L0 → builds sync CLI → runs syncL0()
  │  creates branch auto-sync/l0-update
  │  opens PR "chore(sync): auto-sync from L0"
  │
  ├─ (chain) cascades dispatch to L2
  │
  ▼
L2 l0-auto-sync.yml (L2 repo)
     same flow → PR with changes
```

### Post-merge workflow

After merging the auto-sync PR:

```bash
git checkout develop      # or your working branch
git pull origin develop   # get the merged sync changes
```

That's it. Skills, agents, and commands are updated in `.claude/`. Restart Claude Code to pick up changes.

**No scripts to run.** The sync engine updates `.claude/skills/`, `.claude/agents/`, `.claude/commands/`, and `l0-manifest.json`. These are static files — `git pull` is sufficient.

> **Note:** `sync-gsd-agents` and `sync-gsd-skills` are L0-only scripts (they live in `scripts/sh/`). Downstream projects don't need them — the sync engine handles materialization. GSD integration is done once during `/setup` (W7).

### 1. Dispatch — managed repos (instant)

When L0 pushes to master, `l0-sync-dispatch.yml` fires. It reads `.github/downstream-repos.json` and sends a `repository_dispatch` event to each listed repo.

**Path filter:** Only triggers when relevant files change (`skills/`, `agents/`, `scripts/`, `docs/`, `detekt-rules/`, `mcp-server/src/`, `.claude/commands/`, `versions-manifest.json`).

### 2. Cron — open consumers (daily)

`l0-auto-sync.yml` runs daily at 06:00 UTC. It compares upstream HEAD against the `l0Commit` in `l0-manifest.json`. If they differ, it syncs. No tokens needed in L0 — the consumer only needs read access to L0.

### 3. Manual (always available)

```bash
/sync-l0              # additive sync (new + updated, never removes)
/sync-l0 --prune      # also removes orphaned files
/sync-l0 --dry-run    # preview changes without writing
```

### Setup guide — managed repos

#### Step 1: L0 — Configure dispatch target list

Add downstream repos to `.github/downstream-repos.json`:

```json
[
  "your-org/shared-kmp-libs",
  "your-org/my-app"
]
```

#### Step 2: L0 — Create DOWNSTREAM_SYNC_TOKEN secret

1. **github.com → Settings → Developer settings → Fine-grained tokens → Generate new token**
2. Name: `L0 Auto-Sync Dispatch` | Expiration: 90 days
3. Repository access → **Only select repositories** → select all downstream repos
4. Permissions → **Contents: Read and write**
5. **L0 repo → Settings → Secrets → Actions → New secret**: `DOWNSTREAM_SYNC_TOKEN`

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

### Setup guide — open consumers

1. Copy `setup/templates/workflows/l0-auto-sync.yml` → `.github/workflows/`
2. Ensure `l0-manifest.json` exists with the L0 source path (created by `/setup`)

The cron checks upstream daily. No L0 configuration needed.

### What the PR contains

- **Title:** `chore(sync): auto-sync from L0`
- **Branch:** `auto-sync/l0-update` (force-pushed on subsequent syncs)
- **Body:** table with added/updated counts, source commit, trigger type
- **Files:** `.claude/skills/`, `.claude/agents/`, `.claude/commands/`, `l0-manifest.json`

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No dispatch fires | `downstream-repos.json` missing or empty | Create the file with repo list |
| Dispatch fires but L1 no run | `l0-auto-sync.yml` not in L1 `.github/workflows/` | Copy the template |
| PR fails: "not permitted to create pull requests" | Actions PR permission disabled | Settings → Actions → General → enable checkbox |
| PR fails: "'sync' not found" | Label doesn't exist | Update to latest `l0-auto-sync.yml` template |
| Cron runs but skips | Upstream HEAD matches `l0Commit` | Expected — no changes to sync |
| DOWNSTREAM_SYNC_TOKEN expired | Fine-grained PAT has expiration | Regenerate and update secret |
| Sync runs, 0 added, 0 updated | PR was already merged with latest | Expected — nothing to sync |
| `sync-gsd-agents.sh: not found` in L1 | Script only exists in L0 | Not needed — sync engine handles it |

## Cross-references

- Manifest schema: `mcp-server/src/sync/manifest-schema.ts`
- Sync engine: `mcp-server/src/sync/sync-engine.ts`
- Setup wizard: `skills/setup/SKILL.md` (Step 0 topology choice)
- Auto-sync dispatch: `.github/workflows/l0-sync-dispatch.yml`
- Auto-sync downstream: `setup/templates/workflows/l0-auto-sync.yml`
- M003 spec: `.gsd/milestones/M003/M003-CONTEXT.md`
