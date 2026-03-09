# S05: Skill Materialization Registry

**Goal:** Build the L0 skill registry generator that scans all skills, agents, and commands, computes SHA-256 content hashes, extracts metadata from frontmatter, and outputs `skills/registry.
**Demo:** Build the L0 skill registry generator that scans all skills, agents, and commands, computes SHA-256 content hashes, extracts metadata from frontmatter, and outputs `skills/registry.

## Must-Haves


## Tasks

- [x] **T01: 14.3-skill-materialization-registry 01**
  - Build the L0 skill registry generator that scans all skills, agents, and commands, computes SHA-256 content hashes, extracts metadata from frontmatter, and outputs `skills/registry.json` as the single source of truth for downstream discovery.

Purpose: Registry is the foundation for the entire materialization system. Manifest resolution, sync engine, and validation all depend on this catalog.
Output: `skill-registry.ts` module + `registry.json` generated file + unit tests
- [x] **T02: 14.3-skill-materialization-registry 02**
  - Define the `l0-manifest.json` schema that downstream L1/L2 projects use to declare which L0 skills, agents, and commands they adopt. Includes Zod-based validation, default manifest generation, and type exports.

Purpose: The manifest is the declaration layer between the L0 registry and downstream projects. The sync engine reads this to know what to materialize.
Output: `manifest-schema.ts` module + unit tests
- [x] **T03: 14.3-skill-materialization-registry 03**
  - Build the sync engine that reads a project's l0-manifest.json, resolves desired assets against the L0 registry, computes a diff (new/updated/removed/unchanged), materializes full copies with version headers, and updates checksums. Also create the `/sync-l0` skill definition.

Purpose: This is the core distribution mechanism replacing install-claude-skills.sh and the delegate pattern. It makes skill distribution declarative, reproducible, and auditable.
Output: `sync-engine.ts` module + `/sync-l0` SKILL.md + unit tests
- [x] **T04: 14.3-skill-materialization-registry 04**
  - Build the skill validation MCP tool (MATL-06) and simplify the Claude Code adapter pipeline by removing the 16 redundant adapter-generated commands from L0 (MATL-04). Claude Code discovers skills/*/SKILL.md directly -- no intermediate command generation needed.

Purpose: Validation tool provides a safety net against broken skills. Adapter simplification removes redundant intermediaries.
Output: `validate-skills.ts` MCP tool + 16 generated commands deleted from L0 + updated adapter
- [x] **T05: 14.3-skill-materialization-registry 05**
  - Execute the big-bang migration: convert all path-based delegate stubs in shared-kmp-libs (9 commands) and DawSync (29 commands + 6 agents + 6 junction skills) to materialized copies using the sync engine. Delete all old delegate infrastructure (install-claude-skills.sh, setup/templates/).

Purpose: This is the critical migration that replaces the fragile delegate pattern with professional registry-based distribution. After this, no project depends on filesystem paths to L0.
Output: Manifests created in both projects, all delegates replaced with full copies, old infrastructure deleted
- [x] **T06: 14.3-skill-materialization-registry 06**
  - De-duplicate CLAUDE.md files across the ecosystem. Claude Code auto-loads `~/.claude/CLAUDE.md` + `{project}/CLAUDE.md`, so project files should contain ONLY project-specific rules. Remove all duplicated KMP rules from project CLAUDE.md files.

Purpose: Eliminate the 245-line DawSync CLAUDE.md bloat and the exact duplication between ~/.claude/ and AndroidCommonDoc. Every rule still accessible, zero duplication.
Output: Three slimmed CLAUDE.md files with clear separation of concerns
- [x] **T07: 14.3-skill-materialization-registry 07**
  - Rename all ~84 active UPPERCASE DawSync docs to lowercase-kebab-case at source, update every cross-reference (frontmatter parent, wikilinks, hub Sub-documents, l0_refs, README), consolidate 23 category tags to 9 unified categories, and add naming validation to prevent regression.

Purpose: Consistent lowercase-kebab-case naming is the convention standard. Category consolidation makes the Obsidian graph readable. This is the vault hygiene that MATL-08 requires.
Output: Renamed docs, updated cross-references, consolidated categories, naming validation
- [x] **T08: 14.3-skill-materialization-registry 08**
  - Final comprehensive ecosystem validation. Verify the entire materialization system is in harmony: registry matches filesystem, manifests match registry, no orphaned delegates, vault reflects all changes, CLAUDE.md is clean, and all validators pass. This is the mandatory final wave per user decision.

Purpose: Without this validation, the phase is not complete. This ensures every change from Plans 01-07 works together as a coherent system.
Output: Clean validation report, updated READMEs, re-synced vault, human-verified Obsidian graph
- [x] **T09: 14.3-skill-materialization-registry 09**
  - Close the DawSync category consolidation gap identified in 14.3-VERIFICATION.md (Truth 8, MATL-08 partial).

DawSync currently uses only 4 of 9 approved categories (product, guides, architecture, build). Nine DawSync docs are semantically misaligned -- testing guides are tagged `guides` instead of `testing`, UI/accessibility docs are tagged `architecture`/`guides` instead of `ui`, an offline-first doc is tagged `architecture` instead of `data`, and an SBOM doc is tagged `build` instead of `security`. The SUBDIR_TO_CATEGORIES workaround in validate-doc-structure.ts needs updating to accept the new category values in their existing subdirectories (per the Plan 07 decision: "category consolidation changes frontmatter only, not physical subdirectory structure").

Purpose: Achieve proper category coverage so the Obsidian graph shows meaningful color grouping for DawSync docs and the 9-category unified vocabulary is actually used.
Output: 9 DawSync docs re-categorized, SUBDIR_TO_CATEGORIES mapping updated, validator passes with 0 errors.

## Files Likely Touched

- `mcp-server/src/registry/skill-registry.ts`
- `mcp-server/tests/unit/registry/skill-registry.test.ts`
- `skills/registry.json`
- `mcp-server/src/sync/manifest-schema.ts`
- `mcp-server/tests/unit/sync/manifest-schema.test.ts`
- `mcp-server/src/sync/sync-engine.ts`
- `mcp-server/tests/unit/sync/sync-engine.test.ts`
- `skills/sync-l0/SKILL.md`
- `mcp-server/src/tools/validate-skills.ts`
- `mcp-server/tests/unit/tools/validate-skills.test.ts`
- `mcp-server/src/tools/index.ts`
- `.claude/commands/android-test.md`
- `.claude/commands/auto-cover.md`
- `.claude/commands/coverage.md`
- `.claude/commands/coverage-full.md`
- `.claude/commands/extract-errors.md`
- `.claude/commands/run.md`
- `.claude/commands/sbom.md`
- `.claude/commands/sbom-analyze.md`
- `.claude/commands/sbom-scan.md`
- `.claude/commands/sync-versions.md`
- `.claude/commands/test.md`
- `.claude/commands/test-changed.md`
- `.claude/commands/test-full.md`
- `.claude/commands/test-full-parallel.md`
- `.claude/commands/validate-patterns.md`
- `.claude/commands/verify-kmp.md`
- `adapters/claude-adapter.sh`
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
- `CLAUDE.md`
- `DawSync/CLAUDE.md`
- `shared-kmp-libs/CLAUDE.md`
- `DawSync/docs/**/*.md`
- `mcp-server/src/vault/transformer.ts`
- `mcp-server/src/tools/validate-doc-structure.ts`
- `skills/registry.json`
- `setup/README.md`
- `README.md`
- `DawSync/docs/guides/testing.md`
- `DawSync/docs/guides/testing-advanced.md`
- `DawSync/docs/guides/testing-e2e.md`
- `DawSync/docs/guides/testing-fakes.md`
- `DawSync/docs/guides/testing-patterns.md`
- `DawSync/docs/guides/accessibility.md`
- `DawSync/docs/architecture/patterns-offline-first.md`
- `DawSync/docs/architecture/patterns-ui-viewmodel.md`
- `DawSync/docs/tech/sbom.md`
- `mcp-server/src/tools/validate-doc-structure.ts`
