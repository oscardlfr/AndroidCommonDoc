---
description: Propagate L0 assets and optionally install the source-referenced runtime in L1/L2 consumers.
---

Synchronize L0 assets (skills, agents, commands) from AndroidCommonDoc into the current project.

## How it works

1. Read `l0-manifest.json` from the current project root.
2. Resolve the single `sources[]` entry whose layer is `L0` relative to the project root.
3. Run: `node {l0_source}/mcp-server/build/sync/sync-l0-cli.js --project-root {current-dir}`
4. Pass supported flags from `$ARGUMENTS`. Runtime mode is explicit and never implies prune or force.

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

### Step 2 — Resolve the L0 source

From `l0-manifest.json`, find exactly one local `sources` entry with `"layer": "L0"` and `"role": "tooling"`, then read its `"path"`. The path is relative to the project root. Runtime mode rejects absent, ambiguous, remote-only, or unresolved sources and never uses an environment fallback.

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

If `$ARGUMENTS` contains `--runtime`, append it without `--prune`, `--force`, `--force-l0-managed`, or `--auto-migrate`:

```bash
node {l0_source}/mcp-server/build/sync/sync-l0-cli.js --project-root {project_root} --runtime
```

`--runtime` requires an existing manifest. It pins the exact toolkit commit/content digest, installs ten byte-identical runtime roles, and registers the closed hook matrix by absolute L0 source path. Toolkit runtime code is not copied into the consumer. Use `--dry-run` for a write-free preflight.

### Step 4 — Report results

Print the CLI output verbatim. The CLI reports added/updated/removed/unchanged counts and updates `l0-manifest.json` automatically.

## Arguments

`$ARGUMENTS`

Supported flags:
- `--prune` — Remove files tracked in the manifest that are no longer in the L0 registry (e.g. deleted or excluded commands).
- `--runtime` — Install or verify the source-referenced runtime in an L1/L2 consumer.
- `--dry-run` — Validate and preview without writes.
