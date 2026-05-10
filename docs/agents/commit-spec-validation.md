---
scope: L0
category: agents
slug: commit-spec-validation
sources: ["arch-platform-verdict-wave-b", "BL-bump-ktr-02", ".github/workflows/reusable-commit-lint.yml:25", ".github/workflows/l0-ci.yml:22"]
targets: [arch-platform, arch-testing, arch-integration]
version: 0.1.0
description: "Commit type/scope cheat-sheet. Source-of-truth from CI config."
---

# Commit Spec Validation

## Valid Types (reusable-commit-lint.yml L25)
feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert

## Valid Scopes -- L0 (l0-ci.yml L22)
core, data, ui, feature, ci, deps, release, docs, detekt, mcp, skills, scripts,
agents, archive, di, guides, tests, tools

## Usage Rule
Before every SendMessage dispatching a commit, verify scope appears above.
Recurring violation: FIND-19 (BL-W40 PR4 + BL-W41 PR3/PR4, memory feedback_commit_scope_validation).
Invalid scope = commitlint CI gate block with no recovery path.
