---
scope: [agents, workflow, claude-code, codex]
sources: [androidcommondoc, anthropic-claude-code, openai-codex]
targets: [all]
slug: claude-md-template
status: active
layer: L0
category: agents
description: "Portable repository instructions with thin runtime adapters and path-scoped detail"
version: 3
last_updated: "2026-09-28"
---
# Portable instruction template

Every repository owns one portable contract. Runtime-specific files adapt that contract; they do not replace or silently contradict it.

## Required files

| File | Responsibility |
|---|---|
| `AGENTS.md` | Concise repository authority: scope, safety, workflow, commands and architectural boundaries |
| `CLAUDE.md` | Thin Claude Code adapter containing `@AGENTS.md` plus only Claude-specific launch guidance |
| `.claude/rules/*.md` | Conditional detail with explicit `paths:` frontmatter |
| `skills/*/SKILL.md` | Multi-step, on-demand procedures and their supporting resources |
| hooks and permissions | Mechanical enforcement for security and write boundaries |

`~/.claude/CLAUDE.md`, Codex personal defaults and auto-memory are user context. Builds, generated adapters, CI and repository validation must not depend on their contents.

## Minimal Claude adapter

```markdown
# Project Claude Code adapter

@AGENTS.md

Use `/init-session --orchestrate` for managed orchestration. Do not launch a separate `team-lead` or `project-manager` agent.
```

Keep the adapter small. Project architecture, test policy and Git rules belong in `AGENTS.md`; file-specific detail belongs in path-scoped rules. Do not embed a static agent roster, current PR state, branch hashes, CI results or active-wave status.

## Layer identity

Declare layer identity in `AGENTS.md`:

```markdown
> **Layer:** L0
```

Consumers use `L1` or `L2`. Validators classify the bundle from this portable authority, never from a thin runtime adapter.

## Memory contract

Memory is advisory and durable-only. It may retain stable preferences, recurring corrections and accepted architecture decisions. It must not become authority for current branches, PRs, CI, agent rosters, certificates, hashes, live waves or temporary workarounds. See [instruction-memory-contract](instruction-memory-contract.md).

## Validation

Run the generator check and instruction validator from a clean environment:

```bash
bash adapters/generate-all.sh --check
cd mcp-server && npm test -- --run tests/integration/claude-md-validation.test.ts tests/unit/tools/validate-claude-md.test.ts
```

The integration suite poisons personal-home instructions deliberately. A passing result proves that checked-in repository files are sufficient.
