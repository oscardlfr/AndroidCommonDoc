<!-- GENERATED from skills/sync-vault/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Sync documentation into Obsidian vault with L0/L1/L2 hierarchy. Use when asked to update, initialize, or clean the knowledge vault."
---

Sync documentation into Obsidian vault with L0/L1/L2 hierarchy. Use when asked to update, initialize, or clean the knowledge vault.

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

