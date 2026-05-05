# Wave Quality Gate — BL-W42 PR3

**Wave:** BL-W42 Topology Hardening Pack — PR3
**Branch:** feature/bl-w42-pr3
**Base SHA:** 023acae (PR2 #136 — verdict pre-execute checklist)
**Created:** 2026-05-05
**Status:** IN PROGRESS — PREP verdict authoring

Closes: FIND-15 (HIGH, BL-W41 — toolkit-specialist unauthorized `git --amend`) + 3 PR2 retro items (rehash command guidance, cross-file scan non-version strings, quality-gater FULL bats suite directive)

Defers: FIND-06 (LOW), FIND-07 (LOW), FIND-10 (MEDIUM), FIND-13 (LOW)

Atomic deliverables:
- toolkit-specialist.md AMEND POLICY block + mirror + template_version bump (Item 1)
- New `.claude/hooks/git-amend-gate.js` PreToolUse Bash hook (FIND-15 mechanical enforcement, env marker `CLAUDE_AMEND_AUTHORIZED=1` bypass)
- `.claude/settings.json` registration of git-amend-gate.js
- New `scripts/tests/manifest-sha-parity.bats` (defence-in-depth for template SHA ↔ manifest)
- doc-updater.md rehash command guidance + mirror + template_version bump (Item 2)
- docs/agents/arch-platform-prep-authoring-checklist.md Check 1 non-version-string scan extension (Item 3)
- quality-gater.md FULL bats suite directive Phase 3 Step 3 + mirror + template_version bump (Item 4)
- .claude/registry/agents.manifest.yaml rehash via `generate-template.js --update-manifest-hash` for 3 templates

**Eat-own-dogfood:** PR3 is the first wave authoring a PREP verdict after PR2's `verdict-pre-execute-check.sh` lint script shipped. The PREP verdict file MUST pass the lint script exit 0 BEFORE APPROVED-PREP, BEFORE Phase 3 LOCAL gate, AND BEFORE push. Phase 3 LOCAL gate re-runs lint on the verdict post-EXECUTE.

**No `git --amend`:** PR3 implements FIND-15 mitigation; recursive dogfood means zero amends in this PR. CI fix-forward = NEW commit only.
