---
name: init-session
description: "Show project context dashboard. Optionally kicks off core subagent dispatch with --orchestrate <slug> flag."
intent: [session, init, context, agents, skills, modules]
copilot: false
---

# Init-Session Skill

Show project context — available agents, skills, modules, and business docs.

## Usage

```
/init-session                              # dashboard-only (read-only, default)
/init-session --orchestrate <slug>         # dispatch core subagents, then dashboard
```

The `<slug>` is required when `--orchestrate` is passed. Example: `/init-session --orchestrate bl-w32-07`.

## Step 0 — Core Subagent Dispatch (when --orchestrate <slug> is passed)

Skip this step if `--orchestrate` flag is absent. Default behavior is read-only dashboard.

When `--orchestrate <slug>` is passed:

1. Validate slug is present: if `--orchestrate` is passed without a slug, emit error: "Usage: /init-session --orchestrate <slug>" and exit.
2. Dispatch 6 core roles as concurrent `Agent` subagents. These may run as background peers (when the runtime supports `run_in_background=true`) or as single-use subagents — both are valid. No `team_name` or `TeamCreate` required:
   - `Agent(subagent_type="context-provider", name="context-provider", run_in_background=true, prompt="...")`
   - `Agent(subagent_type="doc-updater", name="doc-updater", run_in_background=true, prompt="...")`
   - `Agent(subagent_type="arch-platform", name="arch-platform", run_in_background=true, prompt="...")`
   - `Agent(subagent_type="arch-testing", name="arch-testing", run_in_background=true, prompt="...")`
   - `Agent(subagent_type="arch-integration", name="arch-integration", run_in_background=true, prompt="...")`
   - `Agent(subagent_type="quality-gater", name="quality-gater", run_in_background=true, prompt="...")`
3. Consult context-provider: dispatch a context-provider query to get current project state (MEMORY.md, open items). Wait for response.
4. Continue to Step 1 (dashboard render)

> **Note**: The `session-<slug>` wave slug determines the wave artifact directory (`.planning/wave-<slug>/`). The load-bearing contract is disk artifacts — verdicts, stamps, and the QG report — not named-team membership.

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
