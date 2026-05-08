---
slug: tl-release-workflow
category: agents
scope: L0
sources: ['docs/agents/main-agent-orchestration-guide.md']
targets: ['L0', 'L1', 'L2']
status: active
layer: L0
description: "Release workflow, post-change checklist, and findings protocol for main-agent orchestration."
---

# Release Workflow + Post-Change Checklist + Findings Protocol

> Part of [main-agent-orchestration-guide](main-agent-orchestration-guide.md).

## Release Workflow

1. `/bump-version` → version.properties + CHANGELOG.md
2. `/changelog` → release notes from git
3. `/git-flow release v{X.Y.Z}` → merge to master, tag, back-merge

## Post-Change Checklist (automatic)

After ANY changes, BEFORE reporting "done":
1. `/test` on touched modules, `/test-full-parallel` for multi-module
2. `/audit-docs` if docs changed, `/readme-audit` if counts/tables changed
3. Fix stale references before reporting

## Findings Protocol

When summarizing: `## Summary: [title]` + Changed (files) + Verified (tests, guards) + Open (remaining).
