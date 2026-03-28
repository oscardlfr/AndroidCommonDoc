---
name: init-session
description: "Show project context — available agents, skills, modules, and business docs."
copilot: false
---

# Init-Session Skill

Show project context — available agents, skills, modules, and business docs.

## Usage

```
/init-session
```

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
