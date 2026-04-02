---
description: Propagate L0 skills, agents, and commands to consuming projects.
---

Synchronize L0 assets (skills, agents, commands) from AndroidCommonDoc into the current project.

## How it works

1. Read `l0-manifest.json` from the current project root.
2. Use the `l0_source` path (resolved relative to project root) to locate AndroidCommonDoc.
3. Run: `node {l0_source}/mcp-server/build/sync/sync-l0-cli.js --project-root {current-dir}`
4. Pass through any `--prune` flag from `$ARGUMENTS` if present.

## Step-by-step execution

### Step 1 — Locate the manifest

Read `l0-manifest.json` in the current working directory (the project root where this command was invoked).

If `l0-manifest.json` does not exist, stop and tell the user:

> `l0-manifest.json` not found. Run first-time setup:
> ```bash
> cd <path-to-AndroidCommonDoc>/mcp-server
> node build/sync/sync-l0-cli.js --project-root <this-project-root>
> ```
> Or run `/setup` if the setup skill is available.

### Step 2 — Resolve l0_source

From `l0-manifest.json`, find the `sources` array entry with `"layer": "L0"` and read its `"path"` field. This path is relative to the project root.

Resolve the absolute path: `{project_root}/{sources[0].path}` (normalize `..` segments).

Verify `{l0_source}/mcp-server/build/sync/sync-l0-cli.js` exists. If not, the MCP server needs to be built:

> Build not found. Run:
> ```bash
> cd {l0_source}/mcp-server && npm run build
> ```

### Step 3 — Run the sync CLI

```bash
node {l0_source}/mcp-server/build/sync/sync-l0-cli.js --project-root {project_root}
```

If `$ARGUMENTS` contains `--prune`, append it:

```bash
node {l0_source}/mcp-server/build/sync/sync-l0-cli.js --project-root {project_root} --prune
```

### Step 4 — Report results

Print the CLI output verbatim. The CLI reports added/updated/removed/unchanged counts and updates `l0-manifest.json` automatically.

## Arguments

`$ARGUMENTS`

Supported flags:
- `--prune` — Remove files tracked in the manifest that are no longer in the L0 registry (e.g. deleted or excluded commands).
