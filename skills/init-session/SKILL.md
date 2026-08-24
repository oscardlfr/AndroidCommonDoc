---
name: init-session
description: "Show project context dashboard. Optionally ensures the persistent support plane with --orchestrate <slug> flag."
intent: [session, init, context, agents, skills, modules]
copilot: false
---

# Init-Session Skill

Show project context — available agents, skills, modules, and business docs.

## Usage

```
/init-session                              # dashboard-only (read-only, default)
/init-session --orchestrate <slug>         # ensure core support plane, then dashboard
```

The `<slug>` is required when `--orchestrate` is passed. Example: `/init-session --orchestrate bl-w32-07`.

## Step 0 — Core Support-Plane Dispatch (when --orchestrate <slug> is passed)

Skip this step if `--orchestrate` flag is absent. Default behavior is read-only dashboard.

When `--orchestrate <slug>` is passed:

1. Validate slug is present: if `--orchestrate` is passed without a slug, emit error: "Usage: /init-session --orchestrate <slug>" and exit.
2. Ensure the persistent support plane through the shared role-lifecycle manager — never raw `Agent()`/`SendMessage()` calls and never a hard-coded roster:
   - `probe(profile)` reads the active `runtime-collaboration-policy.json` profile (`auto|persistent|ephemeral|disk-only`) and connector capabilities.
   - `ensureRoles(profile, roles)` over exactly the default support plane — `arch-platform`, `arch-testing`, `arch-integration`, `context-provider`, `doc-updater`. **Never add `quality-gater`** — it stays phase-scoped and is dispatched fresh per wave, never parked in the persistent plane.
   - `waitReady` for the resulting bindings, bounded by the policy's `ready_timeout_seconds`.
   - This is idempotent: a second `--orchestrate` call in the same session reuses the existing healthy bindings instead of respawning. `auto|persistent` launches at most one retained connector (Claude Agent Teams peer or Codex supervisor) per role; `ephemeral`/`disk-only` fall back per policy without a false READY claim.
3. Once the support plane is READY, context-provider is addressable for the rest of the session — no separate mandatory "consult and wait" step is required here. An optional light consult may accelerate loading current project state before the dashboard, but rendering never blocks on it.
4. Continue to Step 1 (dashboard render)

> **Note**: The `<slug>` wave slug determines the wave artifact directory (`.planning/wave-<slug>/`). The load-bearing contract is disk artifacts — verdicts, stamps, and the QG report — not named-team membership or a live message.

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
- Session naming: the wave slug names the wave artifact directory (`.planning/wave-<slug>/`). Pick descriptive slugs (e.g., `feature-auth`) — they serve as wave identifiers. The load-bearing contract is the disk artifacts in that directory, not named-team membership.
