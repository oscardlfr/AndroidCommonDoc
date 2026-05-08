---
slug: tl-git-workflow
category: agents
scope: L0
sources: ['docs/agents/main-agent-orchestration-guide.md']
targets: ['L0', 'L1', 'L2']
status: active
layer: L0
description: "Mandatory git workflow for main-agent orchestration: branching, commits, RTK prefix, script invocation."
---

# Git Workflow (MANDATORY)

> Part of [main-agent-orchestration-guide](main-agent-orchestration-guide.md).

- `develop` is branch-protected — PR required, no direct push
- ALL implementation MUST happen on `feature/*` branches from `develop`
- Flow: `git checkout -b feature/{sprint-slug} develop` → implement → PR to develop (squash) → merge
- NEVER commit directly to develop — if push is rejected, create a PR
- The main agent creates the feature branch at Phase 2 start before any specialist work begins

The main agent manages branching. All development follows Git Flow.
- **Autonomous**: create branches, push feature/develop, merge feature→develop, create PRs
- **Commits**: The main agent instructs architects to commit via SendMessage — The main agent does NOT run `git add/commit` directly
- **Requires user approval**: merge to master, releases, tags, force push
- **After push**: monitor CI, delegate fixes if needed, re-push until green

## Script Invocation (MANDATORY)

Always use `bash scripts/sh/X.sh` — NEVER invoke `scripts/ps1/X.ps1` directly in Bash tool. Even on Windows, Claude Code runs in `/usr/bin/bash`.

## RTK Prefix Rule (MANDATORY)

ALL git, gh, docker, and curl commands in agent templates and Bash tool calls MUST be prefixed with `rtk`:
- ✅ `rtk git status`, `rtk gh pr view`, `rtk git commit`
- ❌ `git status`, `gh pr view` (no rtk prefix)
Note: `rtk` passes through unfiltered — safe when rtk is not installed (no-op). Mandatory for token savings in CI and agent shells.
Note: verify that .claude/settings.json deny rules match `rtk git push --force *` in addition to `git push --force *`.
