---
name: sync-gsd-agents
description: "Sync .claude/agents/ to GSD subagent system and verify parity. Use when GSD subagent can't find an agent that exists in .claude/agents/, or after adding/modifying agents."
intent: [sync, gsd, agents, parity, subagent]
user-invocable: true
allowed-tools: [Bash, Read]
category: ecosystem
copilot: false
---

## Usage Examples

```
/sync-gsd-agents                  # Sync agents to ~/.gsd/agent/agents/
/sync-gsd-agents --check          # Check parity only (no changes)
/sync-gsd-agents --target project # Sync to .gsd/agents/ (project-level)
/sync-gsd-agents --fix            # Check + auto-fix if out of sync
/sync-gsd-agents --dry-run        # Preview what would change
```

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--check` | false | Only check parity, don't sync |
| `--fix` | false | Check parity and auto-fix violations |
| `--target user\|project` | `user` | Where to write GSD agents |
| `--dry-run` | false | Preview changes without writing |
| `--verbose` | false | Show per-agent details |

## Background

GSD `subagent` resolves agents from `~/.gsd/agent/agents/` (user) and `.gsd/agents/` (project).
Claude Code resolves agents from `.claude/agents/`. These are separate systems.

The `sync-gsd-skills` script copies `.claude/agents/` into `~/.gsd/agent/skills/l0-agents/` as **skills** (read-only reference). But skills are not invocable by `subagent`.

This skill bridges the gap: it generates GSD-compatible agent wrappers from `.claude/agents/` so that `subagent` can invoke them directly.

## What Gets Adapted

| .claude/agents/ field | GSD agent field | Transformation |
|---|---|---|
| `name:` | `name:` | Preserved |
| `description:` | `description:` | Preserved |
| `tools: Read, Grep, Glob` | `tools: read, bash` | Lowercased, Grep/Glob→bash |
| `model:` | (dropped) | GSD uses its own model selection |
| `memory:` | (dropped) | GSD manages context independently |
| Body content | Body content | Preserved verbatim |

## Execution

### Mode: Sync (default)

```bash
bash scripts/sh/sync-gsd-agents.sh \
  --project-root "$(pwd)" \
  ${TARGET:+--target "$TARGET"} \
  ${DRY_RUN:+--dry-run} \
  ${VERBOSE:+--verbose}
```

### Mode: Check (`--check`)

```bash
bash scripts/sh/check-agent-parity.sh \
  --project-root "$(pwd)" \
  ${TARGET:+--target "$TARGET"}
```

### Mode: Fix (`--fix`)

```bash
bash scripts/sh/check-agent-parity.sh \
  --project-root "$(pwd)" \
  ${TARGET:+--target "$TARGET"} \
  --fix
```

## Output

Sync mode:
```
{"generated":15,"new":15,"updated":0,"unchanged":0,"target":"~/.gsd/agent/agents/"}
```

Check mode:
```
Agent Parity Check
  Source: .claude/agents/
  Target: ~/.gsd/agent/agents/

  [OK]      api-rate-limit-auditor
  [OK]      beta-readiness-agent
  [MISSING] new-agent-just-added
  [STALE]   quality-gate-orchestrator

RESULT: FAIL — 2 issues found
```

## Parity Rules

1. Every `.claude/agents/*.md` MUST have a corresponding GSD agent
2. GSD agent body content must match the `.claude source` (not stale)
3. Deleted `.claude agents` with orphaned GSD wrappers are flagged

## CI Integration

Use `check-agent-parity.sh` in pre-commit or CI:

```yaml
# .github/workflows/reusable-agent-parity.yml
- run: bash scripts/sh/check-agent-parity.sh --target project --project-root .
```

## Cross-References

- Scripts: `scripts/sh/sync-gsd-agents.sh`, `scripts/sh/check-agent-parity.sh`
- Related: `/sync-gsd-skills` (syncs skills, not agents)
- Related: `/set-model-profile` (controls model tier for .claude agents)
