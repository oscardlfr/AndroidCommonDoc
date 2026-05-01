---
name: init-session
description: "Show project context dashboard. Optionally orchestrates session-team setup with --orchestrate <slug> flag (BL-W32-07)."
intent: [session, init, context, agents, skills, modules]
copilot: false
---

# Init-Session Skill

Show project context — available agents, skills, modules, and business docs.

## Usage

```
/init-session                              # dashboard-only (read-only, default)
/init-session --orchestrate <slug>         # orchestrate session-{slug} team setup, then dashboard
```

The `<slug>` is required when `--orchestrate` is passed. Example: `/init-session --orchestrate bl-w32-07`.

## Step 0 — Session Orchestration (when --orchestrate <slug> is passed)

Skip this step if `--orchestrate` flag is absent. Default behavior is read-only dashboard.

When `--orchestrate <slug>` is passed:

1. Validate slug is present: if `--orchestrate` is passed without a slug, emit error: "Usage: /init-session --orchestrate <slug>" and exit.
2. Check idempotency: if `~/.claude/teams/session-<slug>/config.json` exists:
   - Read the config
   - If all 6 core peers (context-provider, doc-updater, arch-platform, arch-testing, arch-integration, quality-gater) are listed as alive → skip orchestration, proceed to Step 1 (dashboard render)
   - Else → continue with orchestration
3. `TeamCreate("session-<slug>")` — creates the session team
4. Spawn 6 core peers as Agent peer-spawns:
   - `Agent(subagent_type="context-provider", team_name="session-<slug>", name="context-provider")`
   - `Agent(subagent_type="doc-updater", team_name="session-<slug>", name="doc-updater")`
   - `Agent(subagent_type="arch-platform", team_name="session-<slug>", name="arch-platform")`
   - `Agent(subagent_type="arch-testing", team_name="session-<slug>", name="arch-testing")`
   - `Agent(subagent_type="arch-integration", team_name="session-<slug>", name="arch-integration")`
   - `Agent(subagent_type="quality-gater", team_name="session-<slug>", name="quality-gater")`
5. Verify each peer responds (idle notification or ack message) — proceed when all 6 alive
6. Continue to Step 1 (dashboard render)

> **Note**: The `session-<slug>` convention is shared with `/work` peer-detection logic (BL-W32-07). If you run `/work` after `/init-session --orchestrate <slug>`, /work will detect the team via mtime-based slug detection.

## Steps

1. **Read project manifest**: Load `l0-manifest.json` if it exists. Extract `layer`, `topology`, and `selection` fields.
2. **Read module map**: Load `MODULE_MAP.md` if it exists. Count modules and list key ones.
3. **Scan agents**: Read all `.claude/agents/*.md` files. Count agents and group them by `domain:` frontmatter field.
4. **Scan skills**: Read all `.claude/commands/*.md` files. Count available skills.
5. **Check business docs**: List all files in `docs/business/` if the directory exists.
6. **Output dashboard**:

```
## Project: {name} ({layer})

### Agents ({count})
  Development: debugger, verifier, advisor, researcher, codebase-mapper
  Testing: test-specialist
  Business: product-strategist, content-creator
  Audit: full-audit-orchestrator, quality-gate-orchestrator
  ...

### Skills ({count})
  /work /debug /verify /pre-pr /test /research /decide /note /review-pr ...

### Modules (from MODULE_MAP.md)
  {count} modules — run /map-codebase to refresh

### Business Docs
  {list of docs/business/*.md if any}

### Quick Start
  /work <task>     — smart routing
  /resume          — load last session context
  /debug <bug>     — systematic debugging
  /pre-pr          — validate before merge
```

## Notes

- This skill is read-only — it gathers and displays context, it does not modify anything
- If `l0-manifest.json` is missing, infer the project name from the directory name
- If `MODULE_MAP.md` is missing, suggest running `/map-codebase` to generate it
- Agent grouping uses the `domain:` frontmatter field; agents without it go under "Ungrouped"
- Run this at the start of a new session to orient yourself
- Session naming: `session-<slug>` is the canonical convention used by `/work` peer-detection (BL-W32-07). Pick descriptive slugs (e.g., `bl-w32-07`, `feature-auth`) — they serve as wave identifiers.
