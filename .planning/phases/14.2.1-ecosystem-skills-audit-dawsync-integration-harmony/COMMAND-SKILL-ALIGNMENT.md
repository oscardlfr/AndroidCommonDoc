# Command-Skill Alignment Analysis

**Phase:** 14.2.1 - Ecosystem Skills Audit & DawSync Integration Harmony
**Generated:** 2026-03-15
**Scope:** L0 (AndroidCommonDoc) -- 32 commands, 27 skills

---

## Section 1: Commands WITH Matching Skills (16 matches)

These 16 L0 commands have a matching skill in `skills/`. All are auto-generated skill adapter commands -- the command file invokes the skill's underlying workflow.

| # | Command | Skill | Content Relationship | Recommendation |
|---|---------|-------|---------------------|----------------|
| 1 | android-test | android-test | Auto-generated adapter -- command invokes skill | **Keep both** -- command as simple alias |
| 2 | auto-cover | auto-cover | Auto-generated adapter -- command invokes skill | **Keep both** -- command as simple alias |
| 3 | coverage | coverage | Auto-generated adapter -- command invokes skill | **Keep both** -- command as simple alias |
| 4 | coverage-full | coverage-full | Auto-generated adapter -- command invokes skill | **Keep both** -- command as simple alias |
| 5 | extract-errors | extract-errors | Auto-generated adapter -- command invokes skill | **Keep both** -- command as simple alias |
| 6 | run | run | Auto-generated adapter -- command invokes skill | **Keep both** -- command as simple alias |
| 7 | sbom | sbom | Auto-generated adapter -- command invokes skill | **Keep both** -- command as simple alias |
| 8 | sbom-analyze | sbom-analyze | Auto-generated adapter -- command invokes skill | **Keep both** -- command as simple alias |
| 9 | sbom-scan | sbom-scan | Auto-generated adapter -- command invokes skill | **Keep both** -- command as simple alias |
| 10 | sync-versions | sync-versions | Auto-generated adapter -- command invokes skill | **Keep both** -- command as simple alias |
| 11 | test | test | Auto-generated adapter -- command invokes skill | **Keep both** -- command as simple alias |
| 12 | test-changed | test-changed | Auto-generated adapter -- command invokes skill | **Keep both** -- command as simple alias |
| 13 | test-full | test-full | Auto-generated adapter -- command invokes skill | **Keep both** -- command as simple alias |
| 14 | test-full-parallel | test-full-parallel | Auto-generated adapter -- command invokes skill | **Keep both** -- command as simple alias |
| 15 | validate-patterns | validate-patterns | Auto-generated adapter -- command invokes skill | **Keep both** -- command as simple alias |
| 16 | verify-kmp | verify-kmp | Auto-generated adapter -- command invokes skill | **Keep both** -- command as simple alias |

**Note:** Per Claude Code 2026 behavior, when a skill and command share the same name, the skill takes precedence. The command adapter files are effectively dormant -- Claude uses the skill definition. These command files serve as backward-compatibility aliases and for consumers that don't have skill discovery configured.

**Recommendation for all 16:** Keep both. The skill is the canonical definition. The command adapter ensures backward compatibility for delegate consumers (L1/L2 projects that reference `.claude/commands/`). No content duplication concern since adapters are thin wrappers.

---

## Section 2: Commands WITHOUT Matching Skills (16 commands)

These 16 L0 commands exist only as `.claude/commands/` files with no corresponding skill in `skills/`.

### Promotion Candidates (11 commands)

Commands with sufficient complexity that would benefit from the skill format (supporting files, tool restrictions, subagent execution).

| # | Command | Complexity | Lines | Side-Effect | Recommendation | Rationale |
|---|---------|-----------|-------|:-----------:|----------------|-----------|
| 1 | brainstorm | High | 102 | Yes (writes docs) | **Promote to skill** | Multi-step orchestration with approval gate, classification logic, routing rules. Benefits from `disable-model-invocation: true` and `allowed-tools` restrictions. |
| 2 | bump-version | Medium | 48 | Yes (modifies files) | **Promote to skill** | Side-effect command that modifies `gradle.properties`. Benefits from `disable-model-invocation: true` to prevent accidental version bumps. |
| 3 | changelog | Medium | 56 | No (read-only default) | **Promote to skill** | Multi-step workflow with format options and commit classification. Benefits from tool restrictions (Read, Grep, Glob, Bash). |
| 4 | doc-check | Medium | 60 | Optional (--fix) | **Promote to skill** | Cross-validates multiple documentation sources. Benefits from `allowed-tools` and could use supporting reference files for validation rules. |
| 5 | doc-update | Medium | 54 | Yes (modifies docs) | **Promote to skill** | Side-effect command with approval gate. Benefits from `disable-model-invocation: true`. |
| 6 | feature-audit | Medium | 50 | No (read-only) | **Promote to skill** | Multi-step analysis with risk classification. Benefits from `allowed-tools: Read, Grep, Glob` (no Bash needed). |
| 7 | merge-track | High | 62 | Yes (git operations) | **Promote to skill** | Lead-only workflow with destructive git operations. Strongly benefits from `disable-model-invocation: true` and `allowed-tools` restrictions. |
| 8 | metrics | Medium | 87 | No (read-only) | **Promote to skill** | Multi-section dashboard with structured output. Benefits from `allowed-tools: Read, Grep, Glob` (no Bash to prevent accidental execution). |
| 9 | package | Medium | 48 | Yes (builds artifacts) | **Promote to skill** | Side-effect command that runs Gradle builds. Benefits from `disable-model-invocation: true`. |
| 10 | pre-release | High | 73 | No (read-only) | **Promote to skill** | Orchestrator that runs 7 checks in sequence. Benefits from tool restrictions and could reference other skills. |
| 11 | prioritize | Medium | 60 | Yes (modifies roadmap) | **Promote to skill** | Side-effect command with approval gate. Benefits from `disable-model-invocation: true`. |

### Keep as Command-Only (5 commands)

Simple utility commands that don't benefit from skill infrastructure.

| # | Command | Complexity | Lines | Recommendation | Rationale |
|---|---------|-----------|-------|----------------|-----------|
| 1 | start-track | Low-Medium | 60 | **Keep command-only** | Project-specific worktree setup. Simple sequential steps. L2 projects customize track mappings. Skill format adds no value. |
| 2 | sync-roadmap | Low | 63 | **Keep command-only** | GSD utility that syncs directories to ROADMAP.md. Simple, idempotent, no complex logic. |
| 3 | sync-tech-versions | Low | 47 | **Keep command-only** | Simple version comparison between `libs.versions.toml` and docs. Single-purpose utility. |
| 4 | unlock-tests | Low | 61 | **Keep command-only** | Platform-specific process management utility. Simple kill-and-clean logic. |
| 5 | verify-migrations | Low | 43 | **Keep command-only** | Simple wrapper around project migration validator. Minimal orchestration. |

---

## Section 3: Skills WITHOUT Matching Commands (5 skills)

These 5 L0 skills exist in `skills/` but have no corresponding command in `.claude/commands/`.

| # | Skill | Description | Has Command Wrapper | Recommendation | Rationale |
|---|-------|-------------|:-------------------:|----------------|-----------|
| 1 | doc-reorganize | Reorganize docs/ into domain-based subdirectories | No | **Leave skill-only** | MCP tool orchestration workflow. Users invoke via `/doc-reorganize`. Adding a command wrapper would create dead code since skills take precedence on name collision. |
| 2 | generate-rules | Generate Detekt custom rules from pattern doc frontmatter | No | **Leave skill-only** | Specialized code generation workflow. Low invocation frequency. Skill format is the correct home. |
| 3 | ingest-content | Analyze content from any source and extract patterns | No | **Leave skill-only** | Content analysis workflow. Benefits from skill's supporting files capability. |
| 4 | monitor-docs | Monitor upstream documentation sources for changes | No | **Leave skill-only** | MCP tool orchestration workflow. Reads `monitor_urls` from frontmatter and checks upstream sources. |
| 5 | sync-vault | Sync documentation into unified Obsidian vault | No | **Leave skill-only** | Side-effect operation. Already has `disable-model-invocation` intent (not yet in frontmatter -- Plan 02 modernization). Skill is the correct format. |

**Rationale for all 5:** These skills are already in the preferred format. Claude Code treats skills and commands identically for `/slash-command` invocation. Adding command wrapper files would be dead code since skills take precedence when names collide. No action needed.

---

## Section 4: Summary Table

### Full Alignment Matrix

| # | Name | Type | Has Command | Has Skill | Recommendation | Priority |
|---|------|------|:-----------:|:---------:|----------------|:--------:|
| 1 | accessibility | Skill | N | Y | Leave skill-only | -- |
| 2 | android-test | Both | Y | Y | Keep both | -- |
| 3 | auto-cover | Both | Y | Y | Keep both | -- |
| 4 | best-practices | Skill | N | Y | Leave skill-only | -- |
| 5 | brainstorm | Command | Y | N | **Promote to skill** | P2 |
| 6 | bump-version | Command | Y | N | **Promote to skill** | P2 |
| 7 | changelog | Command | Y | N | **Promote to skill** | P3 |
| 8 | core-web-vitals | Skill | N | Y | Leave skill-only | -- |
| 9 | coverage | Both | Y | Y | Keep both | -- |
| 10 | coverage-full | Both | Y | Y | Keep both | -- |
| 11 | doc-check | Command | Y | N | **Promote to skill** | P2 |
| 12 | doc-reorganize | Skill | N | Y | Leave skill-only | -- |
| 13 | doc-update | Command | Y | N | **Promote to skill** | P2 |
| 14 | extract-errors | Both | Y | Y | Keep both | -- |
| 15 | feature-audit | Command | Y | N | **Promote to skill** | P3 |
| 16 | generate-rules | Skill | N | Y | Leave skill-only | -- |
| 17 | ingest-content | Skill | N | Y | Leave skill-only | -- |
| 18 | merge-track | Command | Y | N | **Promote to skill** | P1 |
| 19 | metrics | Command | Y | N | **Promote to skill** | P3 |
| 20 | monitor-docs | Skill | N | Y | Leave skill-only | -- |
| 21 | package | Command | Y | N | **Promote to skill** | P2 |
| 22 | performance | Skill | N | Y | Leave skill-only | -- |
| 23 | pre-release | Command | Y | N | **Promote to skill** | P1 |
| 24 | prioritize | Command | Y | N | **Promote to skill** | P2 |
| 25 | run | Both | Y | Y | Keep both | -- |
| 26 | sbom | Both | Y | Y | Keep both | -- |
| 27 | sbom-analyze | Both | Y | Y | Keep both | -- |
| 28 | sbom-scan | Both | Y | Y | Keep both | -- |
| 29 | seo | Skill | N | Y | Leave skill-only | -- |
| 30 | start-track | Command | Y | N | Keep command-only | -- |
| 31 | sync-roadmap | Command | Y | N | Keep command-only | -- |
| 32 | sync-tech-versions | Command | Y | N | Keep command-only | -- |
| 33 | sync-vault | Skill | N | Y | Leave skill-only | -- |
| 34 | sync-versions | Both | Y | Y | Keep both | -- |
| 35 | test | Both | Y | Y | Keep both | -- |
| 36 | test-changed | Both | Y | Y | Keep both | -- |
| 37 | test-full | Both | Y | Y | Keep both | -- |
| 38 | test-full-parallel | Both | Y | Y | Keep both | -- |
| 39 | unlock-tests | Command | Y | N | Keep command-only | -- |
| 40 | validate-patterns | Both | Y | Y | Keep both | -- |
| 41 | verify-kmp | Both | Y | Y | Keep both | -- |
| 42 | verify-migrations | Command | Y | N | Keep command-only | -- |
| 43 | web-quality-audit | Skill | N | Y | Leave skill-only | -- |

### Action Summary

| Action | Count | Items |
|--------|:-----:|-------|
| Keep both (command + skill aligned) | 16 | android-test, auto-cover, coverage, coverage-full, extract-errors, run, sbom, sbom-analyze, sbom-scan, sync-versions, test, test-changed, test-full, test-full-parallel, validate-patterns, verify-kmp |
| **Promote to skill** | 11 | brainstorm, bump-version, changelog, doc-check, doc-update, feature-audit, merge-track, metrics, package, pre-release, prioritize |
| Keep command-only | 5 | start-track, sync-roadmap, sync-tech-versions, unlock-tests, verify-migrations |
| Leave skill-only | 11 | accessibility, best-practices, core-web-vitals, doc-reorganize, generate-rules, ingest-content, monitor-docs, performance, seo, sync-vault, web-quality-audit |

### Promotion Priority

| Priority | Commands | When |
|----------|---------|------|
| **P1** (safety-critical) | merge-track, pre-release | Next phase -- these have destructive side-effects that benefit most from `disable-model-invocation` and `allowed-tools` |
| **P2** (high-value) | brainstorm, bump-version, doc-check, doc-update, package, prioritize | Next phase -- side-effect commands that benefit from tool restrictions |
| **P3** (nice-to-have) | changelog, feature-audit, metrics | Future -- read-only commands that work fine as commands |

### Key Decision: No Strict 1:1 Mapping Required

Per user discretion guidance:
- **Complex behaviors** get skills (11 promotions recommended)
- **Simple prompts** stay command-only (5 commands)
- **Skills without commands** are correct as-is (11 skills) -- Claude Code unified invocation means `/skill-name` works regardless of whether a command file exists
- **Matched pairs** stay as-is (16 pairs) -- skill is canonical, command is backward-compatibility alias

### Modernization Note

All 11 promotion candidates should include in their SKILL.md frontmatter:
- `allowed-tools` -- restrict tool access (e.g., no Bash for read-only commands)
- `disable-model-invocation: true` -- for side-effect commands (bump-version, merge-track, package, doc-update, brainstorm, prioritize)
- Supporting reference files where beneficial (e.g., pre-release could reference a checklist template)

This promotion work is OUT OF SCOPE for Phase 14.2.1 and should be tracked as a deferred item for a future phase.

---

*Phase: 14.2.1-ecosystem-skills-audit-dawsync-integration-harmony*
*Generated: 2026-03-15*
