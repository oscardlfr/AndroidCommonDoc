---
scope: [guides, permissions, agent-tools, android-cli]
sources: [androidcommondoc, claude-code, android-cli]
targets: [android, desktop, ios, jvm]
slug: agent-tool-permissions
status: active
layer: L0
category: guides
version: 1
last_updated: "2026-04-17"
description: "Which android CLI subcommands agents invoke directly via Bash (read-only, permission-scoped) and which go through the narrow android-cli-bridge MCP tool (stateful, validated)."
---

# Agent Tool Permissions — Android CLI

Agents interact with Google's Android CLI v0.7+ through **two** distinct channels. The split is a safety boundary, not an ergonomic choice.

## Channel 1: Bash (read-only, permission-scoped)

Every **non-destructive** Android CLI subcommand is runnable via the Bash tool directly. Claude Code's permission system in `.claude/settings.json` scopes exactly which subcommands are allowed.

### Allowed via Bash

| Subcommand | Permission rule | Purpose |
|---|---|---|
| `android --version` | `Bash(android --version)` | Version probe |
| `android --help` / `-h` | `Bash(android --help)` / `Bash(android -h)` | Help discovery |
| `android info` | `Bash(android info)` | SDK/CLI paths |
| `android docs search <q>` | `Bash(android docs search *)` | KB search |
| `android docs fetch <kb://...>` | `Bash(android docs fetch *)` | KB content retrieval (used by `validate-upstream`) |
| `android screen capture ...` | `Bash(android screen capture *)` | Screenshots + annotated captures |
| `android screen resolve ...` | `Bash(android screen resolve *)` | `#N` → (x,y) translation |
| `android layout ...` | `Bash(android layout *)` | Full layout tree (used by `android-layout-diff`) |
| `android skills list` / `find` | `Bash(android skills list *)` / `Bash(android skills find *)` | Skill discovery |
| `android sdk list` | `Bash(android sdk list *)` | Installed SDK packages |

Agents can invoke these through the Bash tool without any MCP intermediary. Output parsing is the agent's responsibility (see `android-layout-diff` MCP tool for an example of parsing `android layout --pretty`).

### Denied via Bash

The following subcommands are explicitly denied in `.claude/settings.json` — they must be invoked through the MCP bridge (see Channel 2) or not at all:

| Subcommand | Denied because | Go through |
|---|---|---|
| `android run ...` | Deploys an APK to a device — mis-typed target = broken build on real hardware | `android-cli-bridge` MCP tool, `operation: "run"` |
| `android create ...` | Writes new files from templates — path traversal / AGP 9 naming invariants | `android-cli-bridge` MCP tool, `operation: "create"` |
| `android sdk install ...` | Mutates the SDK — version mismatches across team | User-driven only (via `/setup` wizard W9 or manual) |
| `android sdk remove ...` | Destructive | User-driven only |
| `android sdk update ...` | Mutates versions | User-driven only |
| `android skills add ...` | Installs external skills into the agent directory — user's choice | User-driven only |
| `android skills remove ...` | Destructive to external skills | User-driven only |
| `android init` | Writes the `android-cli` skill into 7+ agent directories | User-driven only (one-time setup) |
| `android update` | Updates the CLI binary itself | User-driven only |
| `android emulator *` | Disabled on Windows anyway; on other hosts mutates AVDs | User-driven only |

## Channel 2: `android-cli-bridge` MCP tool (stateful, validated)

Two commands — `android run` and `android create` — materially change state (on-device deploy, on-filesystem scaffold). They go through the `android-cli-bridge` MCP tool where arguments are type-checked and validated:

### `operation: "run"` validates

- At least one APK path provided
- Each APK path resolves to an existing file
- `device_serial` is explicit (prevents deploy to unintended device on multi-device hosts)
- APK basenames matching `release|prod|production` require `confirm_production: true`

### `operation: "create"` validates

- Non-empty `template` and `name`
- `name` contains no colons (AGP 9 flat-naming invariant)
- `project_root` exists
- `output_dir` resolves inside `project_root` (path traversal guard)

Failed validation returns a structured error with `kind: "validation"` and an actionable hint — the tool never silently mutates state.

## Why this split

| Concern | Bash + permissions | MCP bridge |
|---|---|---|
| Read-only operations | ✅ zero code overhead | ❌ duplicates CLI surface |
| Arg validation | ❌ Bash allowlist is coarse | ✅ Zod schemas + custom checks |
| Destructive operations | ❌ no per-arg guard | ✅ explicit denials + confirmations |
| Evolution as CLI updates | ✅ new subcommand = one allow rule | ❌ requires code change |

New read-only subcommands in future CLI versions only require a one-line update to `.claude/settings.json`. New destructive subcommands require a code change to the bridge, which is correct — that friction prevents accidental exposure.

## Claude Code permission rule syntax

Claude Code's `.claude/settings.json` allow/deny rules use glob patterns:

- `Bash(android docs fetch *)` — any `android docs fetch <...>` invocation
- `Bash(android layout *)` — any `android layout` invocation (including flags)
- `Bash(android run *)` — denied; bridge handles it

Order of evaluation: deny wins over allow. Bash commands not matched by either list fall back to the standard interactive prompt.

## Consumer projects

Consumer projects that sync from L0 inherit these rules when their `.claude/settings.json` is updated to match. `/sync-l0` does NOT overwrite `.claude/settings.json` (it is project-local configuration); consumers copy the allow/deny blocks manually during setup or use the Phase 19-03 Wizard W9 to verify the CLI is available.

## Cross-references

- `mcp-server/src/tools/android-cli-bridge.ts` — narrow bridge implementation
- `mcp-server/src/tools/android-layout-diff.ts` — example of Bash + parse for layout
- `docs/guides/getting-started/09-android-cli-windows.md` — CLI install
- `skills/android-skills-consume/SKILL.md` — ecosystem integration (Option C)
- Plan 19-04A in `.planning/phases/19-android-cli-integration/19-04-PLAN.md`
