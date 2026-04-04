<!-- GENERATED from skills/sync-l0/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Synchronize L0 skills, agents, and commands from AndroidCommonDoc registry to the current project. Reads l0-manifest.json, resolves against skills/registry.json, materializes copies with version tracking."
---

Synchronize L0 skills, agents, and commands from AndroidCommonDoc registry to the current project. Reads l0-manifest.json, resolves against skills/registry.json, materializes copies with version tracking.

## Instructions

## Usage Examples

```
/sync-l0
/sync-l0 --project-root /path/to/my-project
/sync-l0 --l0-root /path/to/AndroidCommonDoc
```

## Parameters

- `--project-root` -- Path to the downstream project root (default: current working directory)
- `--l0-root` -- Path to the L0 source (AndroidCommonDoc). If omitted, resolved from manifest's `l0_source` field relative to project root.

## Behavior

1. **Reads** `l0-manifest.json` from the project root
2. **Resolves** desired assets against the L0 registry using the manifest's selection configuration
3. **Computes diff** comparing manifest checksums to registry hashes (add/update/remove/unchanged)
4. **Materializes** copies with version tracking headers:
   - Skills and agents: `l0_source`, `l0_hash`, `l0_synced` injected into YAML frontmatter
   - Commands: HTML comment header with source, hash, synced date
5. **Updates** manifest checksums and `last_synced` timestamp

## First-Time Setup

For a new project that does not yet have `l0-manifest.json`, the CLI will create a default manifest with `include-all` mode. Run:

```bash
cd <project-root>
npx tsx <path-to-androidcommondoc>/mcp-server/src/sync/sync-l0-cli.ts --project-root .
```

Or from within any project with an existing manifest:

```bash
cd mcp-server && npx tsx src/sync/sync-l0-cli.ts --project-root <path>
```

## Implementation

The sync CLI can be invoked two ways:

**Compiled (recommended — no extra deps):**
```bash
cd <androidcommondoc>/mcp-server && npm run build
node build/sync/sync-l0-cli.js --project-root <target-project>
```

**TypeScript source (requires tsx):**
```bash
cd <androidcommondoc>/mcp-server && npx tsx src/sync/sync-l0-cli.ts --project-root <target-project>
```

**Via npm script:**
```bash
cd <androidcommondoc>/mcp-server && npm run sync-l0 -- --project-root <target-project>
```

## Expected Output

```
Sync L0 -> /path/to/project
L0 source: /path/to/AndroidCommonDoc
Mode: additive (no removes)

  Added:     70
  Updated:   0
  Unchanged: 0
  L0 commit: 616ca21

Sync complete: 70 added, 0 updated, 0 removed, 0 unchanged (70 total)
Manifest updated: l0-manifest.json
```

With `--prune`:
```
  Removed:   3
  Removed files:
    ✗ .claude/skills/old-skill/SKILL.md
    ✗ .claude/commands/deprecated-cmd.md
```

## Selection Configuration

The `l0-manifest.json` controls what gets synced:

- **include-all** (default): Syncs everything except items in `exclude_*` lists and `exclude_categories`
- **explicit**: Only syncs entries already present in `checksums` (opt-in mode)
- **l2_specific**: Lists project-owned files that sync will never touch

## Safety

- Files listed in `l2_specific` are never modified during sync
- Orphaned files (in checksums but not in registry) are only removed if they have L0 version headers
- Each materialized file includes its source hash for audit trail
