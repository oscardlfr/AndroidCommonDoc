---
scope: l0
sources: CLAUDE.md
targets: l0
category: guides
slug: project-constraints
status: active
layer: L0
description: "Console.log ban, doc size limits, agent template dual-location, vault sync, Git Flow, and agentskills pilot (extracted from CLAUDE.md prep-6)"
---

# Project Constraints

## No console.log in MCP server
- Use `logger` utility (stderr only) — `console.log` corrupts stdio transport

## Agentskills.io spec pilot
- See `docs/skills/agentskills-pilot.md` — WARN-only CI validator, advisory.

## Doc size limits (MUST split, never extend)
- Hub docs **≤100 lines**: navigation + glossary only, zero implementation detail
- Sub-docs **≤300 lines**: one focused topic. At 250+ → plan your split
- Agent templates **≤425 lines** — orchestrators are more complex than docs. Extract domain knowledge into `.claude/docs/` sub-docs if approaching limit (W31.6 bump: arch templates need PREP/EXECUTE blocks + ban reminders)
- Splitting is the design pattern. Never compress content to fit — create hub + sub-docs

## Pattern docs need YAML frontmatter
- Every doc: `scope`, `sources`, `targets`, `category`, `slug`
- Cross-references use relative paths — no absolute paths between subdirectories

## Agent templates: dual-location (MUST keep in sync)
- `setup/agent-templates/` is the SOURCE for agent templates (team-lead, quality-gater, architects, etc.)
- `.claude/agents/` contains COPIES that the registry scans and `/sync-l0` distributes
- When editing a template: ALWAYS update `setup/agent-templates/X.md` first, then copy to `.claude/agents/X.md`
- Regenerate registry after any template change: `node mcp-server/build/cli/generate-registry.js`
- **New agents**: MUST create both `setup/agent-templates/<name>.md` (source) and `.claude/agents/<name>.md` (copy) atomically in the same commit.

## Vault sync is fragile
- Run `validate-vault` before every sync (0 duplicates, 0 homogeneity errors)
- Vault files: `lowercase-kebab-case` — uppercase causes ghost nodes in Obsidian

## Git Flow
- `master` ← releases only — **requires user approval** for any merge to master. `develop` ← integration **via PR only**. `feature/*` ← from develop.
- **Branch protection on develop** (W31.6 enforcement): PR required, CI Gate + Drift Audit + L0 CI must pass, linear history required, no force pushes, no deletions. Direct pushes are MECHANICALLY blocked.
- Agents can autonomously: create feature branches, commit, push feature branches, create PRs, merge feature→develop via PR (CI green required).
- Agents MUST ask before: merging to master, creating releases, tagging, force push, bypassing branch protection.
- ALL changes to develop go through PR — including post-merge metadata (memory, backlog SHIPPED markers, wave history). NO direct commits to develop.
- After pushing, **monitor CI** — check workflow status, fix failures, and re-push until CI is green.
- Every PR must pass `/pre-pr` locally. Conventional Commits enforced.
