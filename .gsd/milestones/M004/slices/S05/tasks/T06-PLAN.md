# T06: 14.3-skill-materialization-registry 06

**Slice:** S05 — **Milestone:** M004

## Description

De-duplicate CLAUDE.md files across the ecosystem. Claude Code auto-loads `~/.claude/CLAUDE.md` + `{project}/CLAUDE.md`, so project files should contain ONLY project-specific rules. Remove all duplicated KMP rules from project CLAUDE.md files.

Purpose: Eliminate the 245-line DawSync CLAUDE.md bloat and the exact duplication between ~/.claude/ and AndroidCommonDoc. Every rule still accessible, zero duplication.
Output: Three slimmed CLAUDE.md files with clear separation of concerns

## Must-Haves

- [ ] "~/.claude/CLAUDE.md stays as-is (101 lines) providing shared KMP rules for all projects"
- [ ] "AndroidCommonDoc/CLAUDE.md contains only toolkit-specific rules, no duplicated KMP rules"
- [ ] "DawSync/CLAUDE.md slimmed to project-specific rules only, under 120 lines"
- [ ] "shared-kmp-libs/CLAUDE.md stays module-focused, no duplicated KMP rules"
- [ ] "No behavioral rule is lost -- every rule in the ecosystem is accessible via ~/.claude/ + project combo"

## Files

- `CLAUDE.md`
- `DawSync/CLAUDE.md`
- `shared-kmp-libs/CLAUDE.md`
