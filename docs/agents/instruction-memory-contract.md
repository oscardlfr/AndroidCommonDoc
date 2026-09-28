---
scope: [agents, claude-code, codex, memory, instructions]
sources: [androidcommondoc, anthropic-claude-code, openai-codex]
targets: [all]
slug: instruction-memory-contract
status: active
layer: L0
parent: agents-hub
category: agents
description: "Portable ownership model for AGENTS.md, Claude adapters, path-scoped rules, skills, hooks, and durable memory."
version: 1
last_updated: "2026-09-28"
---

# Instruction and memory contract

## One authority per concern

| Surface | Owns | Must not own |
|---|---|---|
| `AGENTS.md` | Small, portable repository contract shared by coding runtimes | Inventories, transient branch/PR state, long procedures |
| `CLAUDE.md` | Claude-specific adapter that explicitly imports `@AGENTS.md` | A second copy of repository rules |
| `.claude/rules/*.md` | Path-scoped Claude guidance with precise `paths` frontmatter | Rules for unrelated paths or whole-repository history |
| `skills/*/SKILL.md` | Repeatable, multi-step operating procedures | Always-loaded background prose |
| hooks and permissions | Enforceable safety, write, lifecycle, and authorization boundaries | Preferences that need no enforcement |
| project memory | Durable corrections, architectural decisions, and short indexes to evidence | Current HEAD, active PRs, CI status, live waves, certificates, or authorization |

Codex consumes `AGENTS.md` directly. Claude Code consumes the same contract
through the explicit `@AGENTS.md` import. Generated Copilot adapters use only
checked-in inputs; a maintainer's `~/.claude/CLAUDE.md` is never a build input.

## Layering

- L0 supplies portable behavior and synchronized runtime artifacts.
- L1 adds shared-library constraints without rewriting the L0 contract.
- L2 owns product rules, domain agents, and private project context.
- A consumer may extend a generic rule, but must not silently weaken a
  security or evidence boundary synchronized from L0.
- Repository instructions take precedence over personal defaults for repository
  work. Personal configuration must remain generic and must not name private
  projects or persist model-version pins.

## Memory hygiene

Memory is advisory context, never runtime or merge authority. Keep only facts
that are likely to remain true after a branch is deleted and a month has passed.
Link detailed evidence instead of copying it into a permanently loaded index.
Delete or archive stale operational state once the owning PR or wave closes.

Examples of durable memory:

- a recurring failure pattern and the rule that prevents it;
- an accepted architecture decision and its ADR;
- an environment limitation that still applies, with a verification date.

Examples that do not belong in durable memory:

- current branch names, commit hashes, check counts, or review status;
- live agent rosters, mailbox state, current wave phase, or pending approvals;
- a host executable digest used only by one completed diagnostic.

## Change and verification procedure

1. Change the narrowest canonical surface.
2. Regenerate checked-in adapters from repository inputs.
3. Validate that Claude resolves `@AGENTS.md` and the applicable path rule.
4. Validate that Codex reads the same repository contract.
5. Add a negative check for retired roles, duplicated authority, temporal state,
   personal paths, or host-global generation inputs.
6. Exercise a clean L1 and L2 consumer when the synchronized contract changes.

Instruction prose does not prove enforcement. When a requirement protects
filesystem scope, authorization, publication, or lifecycle integrity, implement
and test the corresponding hook, permission, or validated artifact contract.
