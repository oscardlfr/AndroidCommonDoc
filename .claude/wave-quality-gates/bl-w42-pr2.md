# Wave Quality Gate — BL-W42 PR2

**Wave:** BL-W42 Topology Hardening Pack — PR2
**Branch:** feature/bl-w42-pr2
**Created:** 2026-05-05
**Status:** IN PROGRESS — quality-gater LOCAL verify pending before push

Closes: FIND-08 (cap escalation), FIND-09 (frontmatter completeness), FIND-11 (amendment count), FIND-12 (cross-file pin scan), FIND-16 (commitlint scope ref), FIND-19 (commit-scope recurrence)

Atomic deliverables:
- arch-platform template extraction (425 → ≤400) + 1-line pointer to new sub-doc
- New sub-doc: docs/agents/arch-platform-prep-authoring-checklist.md (6-check checklist)
- New lint script: scripts/sh/verdict-pre-execute-check.sh (programmatic 6-check pass)
- New bats: scripts/tests/verdict-pre-execute-check.bats (≥12 cases)
- .claude/agents/arch-platform.md byte-identical mirror
- .claude/registry/agents.manifest.yaml rehash
