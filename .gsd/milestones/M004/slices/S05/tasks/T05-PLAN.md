# T05: 14.3-skill-materialization-registry 05

**Slice:** S05 — **Milestone:** M004

## Description

Execute the big-bang migration: convert all path-based delegate stubs in shared-kmp-libs (9 commands) and DawSync (29 commands + 6 agents + 6 junction skills) to materialized copies using the sync engine. Delete all old delegate infrastructure (install-claude-skills.sh, setup/templates/).

Purpose: This is the critical migration that replaces the fragile delegate pattern with professional registry-based distribution. After this, no project depends on filesystem paths to L0.
Output: Manifests created in both projects, all delegates replaced with full copies, old infrastructure deleted

## Must-Haves

- [ ] "All 9 shared-kmp-libs delegate commands are replaced with materialized copies"
- [ ] "All 29 DawSync delegate commands are replaced with materialized copies"
- [ ] "All 6 DawSync delegate agents are replaced with materialized copies"
- [ ] "All 6 DawSync junction-based delegate skills are replaced with materialized copies"
- [ ] "10 DawSync L2-specific commands are untouched"
- [ ] "5 DawSync L2-specific agents are untouched"
- [ ] "install-claude-skills.sh and setup/templates/ are deleted"
- [ ] "No delegate: true frontmatter remains anywhere in the ecosystem"

## Files

- `shared-kmp-libs/l0-manifest.json`
- `shared-kmp-libs/.claude/commands/auto-cover.md`
- `shared-kmp-libs/.claude/commands/coverage-full.md`
- `shared-kmp-libs/.claude/commands/coverage.md`
- `shared-kmp-libs/.claude/commands/extract-errors.md`
- `shared-kmp-libs/.claude/commands/sync-versions.md`
- `shared-kmp-libs/.claude/commands/test-changed.md`
- `shared-kmp-libs/.claude/commands/test-full.md`
- `shared-kmp-libs/.claude/commands/test.md`
- `shared-kmp-libs/.claude/commands/verify-kmp.md`
- `DawSync/l0-manifest.json`
- `DawSync/.claude/commands/*.md`
- `DawSync/.claude/agents/*.md`
- `DawSync/.claude/skills/*`
- `setup/install-claude-skills.sh`
- `setup/Install-ClaudeSkills.ps1`
- `setup/templates/`
