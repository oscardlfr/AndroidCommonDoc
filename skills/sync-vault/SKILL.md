---
name: sync-vault
description: "Sync documentation into Obsidian vault with L0/L1/L2 hierarchy. Use when asked to update, initialize, or clean the knowledge vault."
intent: [sync, vault, obsidian, wikilinks, docs, hierarchy]
allowed-tools: [Bash, Read, Grep, Glob]
disable-model-invocation: true
copilot: true
copilot-template-type: behavioral
---

## Usage Examples

```
/sync-vault --init          # First time: create vault + .obsidian config + initial sync
/sync-vault                 # Update existing vault with latest changes
/sync-vault --status        # Check vault health with per-layer breakdown
/sync-vault --clean         # Remove orphaned files no longer in source repos
/sync-vault --project my-app    # Sync only a specific project's docs
/sync-vault --layer L1          # Sync only L1 (ecosystem) layer docs
```

## Parameters

Uses parameters from `params.json`:
- `project-root` -- Path to the AndroidCommonDoc toolkit root directory.

Additional skill-specific arguments (not in params.json):
- `--init` -- Initialize a new vault (creates directory, .obsidian config, syncs all sources).
- `--status` -- Show vault health info (last sync, file count, orphan warnings, per-layer breakdown).
- `--clean` -- Remove vault files that no longer exist in source repos.
- `--vault-path <path>` -- Override default vault location (`~/AndroidStudioProjects/kmp-knowledge-vault`).
- `--project <name>` -- Only sync a specific project by name (maps to `project_filter` parameter).
- `--layer <L0|L1|L2>` -- Only sync a specific documentation layer (maps to `layer_filter` parameter).

## Behavior

The vault organizes documentation in an L0/L1/L2 hierarchy:
- **L0 (Generic):** AndroidCommonDoc patterns and skills -- cross-project best practices
- **L1 (Ecosystem):** Shared library conventions -- ecosystem-wide standards
- **L2 (App-specific):** Consumer apps -- domain-specific docs

Workflow:
1. If `--init`: call the `sync-vault` MCP tool with mode `init` to create the vault directory, write `.obsidian` config, and perform the initial full sync.
2. If `--status`: call the `vault-status` MCP tool and display health info (configured, last sync, file count, orphan count, projects, per-layer breakdown).
3. If no flags (default): call the `sync-vault` MCP tool with mode `sync` to update the vault incrementally using content hash comparison.
4. If `--clean`: call the `sync-vault` MCP tool with mode `clean` to sync and remove orphaned files no longer present in source repos.
5. Pass `project_filter` and `layer_filter` to scope the sync when `--project` or `--layer` are provided.
6. Display sync results (written, unchanged, removed counts) with per-layer breakdown (L0/L1/L2 file counts).
7. If first run, remind user to open the vault in Obsidian and install recommended community plugins (Dataview).

## Implementation

This skill is an orchestration workflow using the AI agent's built-in tools.

The agent performs the following steps:
1. Call the `sync-vault` or `vault-status` MCP tool with the appropriate mode, optional `vault_path`, `project_filter`, and `layer_filter` overrides.
2. Parse the structured JSON response containing sync results (`{ mode, result, layers, project_filter, layer_filter, message }`) or status info.
3. Present results to the user in a human-readable summary format, including per-layer file counts.
4. If the operation is `--init` and this is the first run, advise the user to:
   - Open Obsidian and select "Open folder as vault" pointing to the vault path.
   - Install the Dataview community plugin for enhanced queries.
   - Open Graph View (Ctrl+G) to visualize the knowledge graph.

## Expected Output

```
Syncing vault...

Sync complete:
  Written: 47 files (new or updated)
  Unchanged: 12 files (content identical)
  Removed: 0 files
  Duration: 1.2s

Layer breakdown:
  L0 (Generic): 20 files
  L1 (Ecosystem): 8 files
  L2 (Apps): 14 files

Vault location: ~/AndroidStudioProjects/kmp-knowledge-vault/
```

Status output:
```
Vault Status: OK
  Configured: yes
  Path: ~/AndroidStudioProjects/kmp-knowledge-vault/
  Last sync: 2026-03-14T01:40:33Z
  Files: 42
  Orphans: 0
  Projects: AndroidCommonDoc, [your-L1-project], [your-L2-apps]
  Layers: L0=20, L1=8, L2=14
```

## Cross-References

- MCP tool: `sync-vault` (init/sync/clean modes with project_filter and layer_filter)
- MCP tool: `vault-status` (read-only health check with per-layer breakdown)
- MCP tool: `find-pattern` (ecosystem-aware pattern search: L0 + project entries)
- Vault config: `~/.androidcommondoc/vault-config.json`
- Vault location: `~/AndroidStudioProjects/kmp-knowledge-vault/` (default)
- Vault meta: `_vault-meta/README.md` (auto-generated vault documentation)
- Vault meta: `_vault-meta/sync-manifest.json` (content hash tracking for incremental sync)
- Related skill: `/monitor-docs` (upstream documentation monitoring)
