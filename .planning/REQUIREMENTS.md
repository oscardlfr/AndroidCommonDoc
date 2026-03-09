# Requirements: AndroidCommonDoc

**Defined:** 2026-03-13
**Core Value:** Patterns and skills must be accurate, current, and token-efficient -- if a developer follows these patterns and uses these skills, their code is correct by construction and their AI agent spends tokens on logic, not boilerplate.

## v1.1 Requirements

Requirements for v1.1 Hardening & Intelligence. Each maps to roadmap phases.

### Tech Debt

- [x] **DEBT-01**: Setup scripts fail fast with clear instructions when ANDROID_COMMON_DOC env var is missing
- [x] **DEBT-02**: install-copilot-prompts.sh delivers generated Copilot instructions to consuming project
- [x] **DEBT-03**: Quality-gate-orchestrator delegates to individual agent files instead of inlining logic
- [x] **DEBT-04**: Orphaned validate-phase01-*.sh scripts removed from repository

### Konsist Architecture Tests

- [x] **KONS-01**: Konsist 0.17.3 compatibility validated in isolated JVM module alongside Kotlin 2.3.10
- [x] **KONS-02**: Layer dependency checks enforce 5-layer architecture (UI -> ViewModel -> Domain <- Data, Model -> nothing)
- [x] **KONS-03**: Naming convention checks enforce ViewModel/UseCase/Repository class suffixes and package placement
- [x] **KONS-04**: Cross-file structural checks complement Detekt (layer boundary imports, package-based enforcement)
- [x] **KONS-05**: Konsist tests run via `./gradlew test` with UP-TO-DATE bypass configured

### Consumer Guard Tests

- [x] **GUARD-01**: Parameterized guard test templates accept consumer root package and enforce architecture rules
- [x] **GUARD-02**: Guard test install script copies and configures templates for consuming projects
- [x] **GUARD-03**: Guard tests validated against consuming projects (DawSync full scan, OmniSound canary)

### MCP Server

- [x] **MCP-01**: MCP server skeleton with stdio transport runs as Claude Code subprocess
- [x] **MCP-02**: 8 pattern docs exposed as MCP resources with docs:// URI scheme
- [x] **MCP-03**: Top 5 validation commands exposed as MCP tools with structured JSON results
- [x] **MCP-04**: Architecture review prompt templates exposed as MCP prompts
- [x] **MCP-05**: MCP server tested on Windows with no stdio corruption

### Pattern Registry & Discovery

- [x] **REG-01**: All pattern docs have YAML frontmatter with required fields (scope, sources, targets) and are discoverable by scanning the docs directory
- [x] **REG-02**: Large pattern docs (>400 lines) split into focused sub-docs with independent frontmatter for token-efficient loading
- [x] **REG-03**: Three-layer resolution (L0 base > L1 project > L2 user) with full replacement semantics resolves patterns correctly
- [x] **REG-04**: Consumer projects auto-discovered from settings.gradle.kts includeBuild paths with projects.yaml fallback
- [x] **REG-05**: docs.ts evolved from hardcoded KNOWN_DOCS to dynamic registry scan while preserving backward-compatible docs://androidcommondoc/{slug} URIs
- [x] **REG-06**: find-pattern MCP tool provides metadata-based search across registry layers with optional project filter
- [x] **REG-07**: Pattern docs validated against current official sources (freshness audit) before registry launch

### Doc Intelligence & Detekt Generation

- [x] **DOC-01**: PatternMetadata extended with optional `monitor_urls` and `rules` fields; scanner extracts them from frontmatter without breaking existing docs
- [x] **DOC-02**: Source monitoring engine fetches upstream URLs (GitHub releases, Maven Central, doc pages), detects version changes and deprecations via content hashing and version comparison
- [x] **DOC-03**: Review state tracking persists accepted/rejected/deferred findings between runs, with TTL-based re-surfacing of stale deferrals
- [x] **DOC-04**: Content ingestion accepts pasted text from arbitrary sources (Medium, LinkedIn, blogs), extracts patterns, and routes insights to appropriate pattern docs
- [x] **DOC-05**: Detekt rule generator reads `rules:` frontmatter YAML and emits AST-only Kotlin rule source + companion test files matching existing hand-written rule patterns
- [x] **DOC-06**: Existing 5 hand-written rules linked to source pattern docs via `rules:` frontmatter metadata; system detects rule-doc drift when patterns change
- [x] **DOC-07**: Three MCP tools (monitor-sources, generate-detekt-rules, ingest-content) and three skills (monitor-docs, generate-rules, ingest-content) expose Phase 10 capabilities to AI agents
- [x] **DOC-08**: GitHub Actions cron workflow runs tiered source monitoring on schedule with artifact-based reporting
- [x] **DOC-09**: v1.1 milestone audit: dead code removal, tool consolidation (check-freshness into monitor-sources), docs accuracy, convention compliance, frontmatter hardening, CHANGELOG.md

### Obsidian Documentation Hub

- [x] **VAULT-01**: Collector gathers pattern docs from AndroidCommonDoc/docs/ directory with frontmatter metadata preserved
- [x] **VAULT-02**: Collector gathers skill definitions from AndroidCommonDoc/skills/ subdirectories
- [x] **VAULT-03**: Collector gathers project knowledge (.planning/, CLAUDE.md, AGENTS.md) from consumer repos discovered via project-discovery
- [x] **VAULT-04**: Transformer converts source docs to Obsidian-flavored Markdown with enriched frontmatter (tags, aliases, vault_source, vault_synced, vault_type)
- [x] **VAULT-05**: Wikilinks auto-injected between related docs where known slugs appear as standalone words, avoiding code blocks and existing links
- [x] **VAULT-06**: MOC (Map of Content) pages auto-generated: All Patterns, By Project, By Layer, By Target Platform, All Skills, All Decisions
- [x] **VAULT-07**: Tags auto-generated from frontmatter scope, targets, and layer fields for Obsidian tag-based filtering
- [x] **VAULT-08**: Vault writer creates directory structure and writes all files to standalone vault directory
- [x] **VAULT-09**: .obsidian/ config generated with core plugins enabled and Dataview recommended
- [x] **VAULT-10**: sync-vault MCP tool supports init/sync/clean modes with structured JSON results
- [x] **VAULT-11**: vault-status MCP tool returns vault health info (last sync, file count, orphan count, projects) without modifying vault
- [x] **VAULT-12**: Full e2e sync pipeline works: source repos -> collect -> transform -> MOC -> write -> vault directory
- [x] **VAULT-13**: Vault config stored at ~/.androidcommondoc/vault-config.json with sensible defaults and auto-discover support
- [x] **VAULT-14**: Sync manifest tracks file content hashes for incremental sync (skip unchanged files)
- [x] **VAULT-15**: Orphan detection identifies and optionally removes vault files no longer present in source repos
- [x] **VAULT-16**: Claude Code skill (SKILL.md) follows established format with Usage, Parameters, Behavior, Implementation, Expected Output, Cross-References
- [x] **VAULT-17**: Vault sync runnable from any project directory (not just AndroidCommonDoc) via centralized config

### Ecosystem Vault Expansion

- [x] **ECOV-01**: shared-kmp-libs conventions and documentation collected as L1 ecosystem layer, stored under L1-ecosystem/ in the vault separately from L0 generic patterns
- [x] **ECOV-02**: App-specific docs (DawSync/docs/, architecture docs, AI instructions) collected as L2 with domain tagging, stored under L2-apps/{project}/ with docs/ai/planning subdivision
- [x] **ECOV-03**: Architecture docs (.planning/codebase/) collected per project with vault_type "architecture" for cross-project reference
- [x] **ECOV-04**: Sub-project support (auto-detect + config) enables nested projects (e.g., DawSync/SessionRecorder-VST3) to appear as sub-projects/ under their parent in the vault
- [x] **ECOV-05**: Vault output structure uses layer-first top-level directories (L0-generic/, L1-ecosystem/, L2-apps/) with clean-slate migration from the flat structure
- [x] **ECOV-06**: MOC pages updated with ecosystem-aware groupings: descriptive sublabels per layer, L2 grouped by project, sub-project nesting, auto-generated Home.md entry point
- [x] **ECOV-07**: Configurable collection globs per project in vault-config.json via rich ProjectConfig objects (name, path, layer, collectGlobs, excludeGlobs, features, subProjects)

## v1.2 Requirements

Requirements for v1.2 Documentation Coherence & Context Management.
Scope: AndroidCommonDoc + shared-kmp-libs + DawSync (WakeTheCave read-only mining, OmniSound deferred).

### Audit & Validate

- [x] **AUDIT-01**: Mine WakeTheCave docs/ and docs2/ for reusable KMP patterns sourced from official documentation -- extract L0 promotion candidates without modifying WakeTheCave
- [x] **AUDIT-02**: Audit DawSync 132 markdown files -- classify each as ACTIVE (still relevant), SUPERSEDED (content exists elsewhere), or UNIQUE (irreplaceable context) with consolidation manifest
- [x] **AUDIT-03**: Audit shared-kmp-libs modules -- identify documentation gaps, produce per-module documentation plan (currently 57-line CLAUDE.md + short READMEs)
- [x] **AUDIT-04**: Review AndroidCommonDoc 8 pattern docs for completeness, accuracy, and gap coverage against consolidated corpus
- [x] **AUDIT-05**: Execute monitor-sources against full consolidated corpus (all 4 projects) and official URLs -- validate freshness of all pattern docs and version references
- [x] **AUDIT-06**: Produce structured audit report: consolidation manifest, L0 promotion list, gap inventory, freshness report

### Doc Structure & Consolidation

- [x] **STRUCT-01**: Define standard documentation template with domain sections (architecture, testing, UI, data, cross-cutting) -- informed by audit findings, not abstract design
- [x] **STRUCT-02**: Template optimized for dual consumption: human-readable navigation AND AI agent context-window-aware loading (<150 lines per section, frontmatter with scope metadata)
- [x] **STRUCT-03**: Consolidate DawSync docs/ based on audit manifest -- merge/archive/promote per classification, zero content loss
- [x] **STRUCT-04**: Promote validated L0 candidates from WakeTheCave and DawSync to AndroidCommonDoc pattern docs
- [x] **STRUCT-05**: Write missing documentation for shared-kmp-libs modules following standard template
- [x] **STRUCT-06**: Update vault-config.json and re-sync vault to reflect consolidated structure

### Docs Subdirectory Reorganization

- [x] **REORG-01**: AndroidCommonDoc docs/ reorganized into domain-based subdirectories (architecture/, testing/, error-handling/, ui/, gradle/, offline-first/, compose/, resources/, di/, navigation/, storage/, guides/, archive/) with all files in correct subdirectory matching their frontmatter category field
- [x] **REORG-02**: shared-kmp-libs docs/ reorganized into module-category subdirectories (security/, oauth/, storage/, domain/, firebase/, foundation/, io/, guides/, archive/) with legacy uppercase files renamed to lowercase-kebab-case or archived
- [x] **REORG-03**: DawSync docs/ fully restructured using L0 core + L2 extensions pattern (architecture/, guides/, legal/, business/, product/, tech/, references/, archive/) with diagrams organized by domain inside architecture/diagrams/
- [x] **REORG-04**: All docs across 3 projects have `category` frontmatter field added; category vocabulary follows shared-core + layer-extras model (L0 core categories + L1/L2 additions)
- [x] **REORG-05**: validate-doc-structure MCP tool built: validates category-subdir alignment, cross-project discovery, --generate-index mode produces auto-generated docs/README.md with subdirectory table and classification legend
- [x] **REORG-06**: find-pattern MCP tool extended with --category filter; PatternMetadata includes category field; MCP scanner verified against new subdirectory structure
- [x] **REORG-07**: Vault optimized: source subdirectory structure mirrored, MOC pages category-grouped (not flat), Home.md redesigned as entry point, archive/ excluded, /doc-reorganize skill created for reuse

### Docs Content Quality & Cross-Layer References

- [x] **QUAL-01**: MCP tooling extended -- PatternMetadata gains `l0_refs` field, scanner extracts it, validate-doc-structure checks size limits (hub <100, sub-doc <300, absolute <500 lines), l0_refs resolution, and frontmatter completeness scoring
- [x] **QUAL-02**: All oversized L0 standalone and sub-docs split into hub+sub-doc format -- all hubs under 100 lines, all sub-docs under 300 lines, doc-template.md preserved as reference exception
- [x] **QUAL-03**: L1 shared-kmp-libs oversized docs split (convention-plugins 514, api-exposure-pattern 333), all 24 active L1 docs have complete 10-field frontmatter, l0_refs cross-references added where L1 references L0 patterns
- [x] **QUAL-04**: All 33 active non-diagram DawSync docs have full 10-field YAML frontmatter (scope, sources, targets, slug, status, layer, category, description, version, last_updated) with domain-appropriate values for business/legal/product docs
- [x] **QUAL-05**: All 62 DawSync architecture diagram docs have full 10-field YAML frontmatter with consistent template (scope: [architecture, diagrams], sources: [dawsync], layer: L2)
- [x] **QUAL-06**: All oversized L2 DawSync docs (18 docs over 300 lines) split into hub+sub-doc format; duplicated L0 content replaced with l0_refs frontmatter and inline L0 reference blocks -- zero content loss
- [x] **QUAL-07**: DawSync subproject docs (DawSyncWeb 1 file, SessionRecorder-VST3 8 files) have full domain-appropriate frontmatter with delegation to parent project for shared concerns (legal, business, product)
- [x] **QUAL-08**: Quality gate passed -- validate-doc-structure reports 0 errors across all 3 projects, no active doc exceeds 500 lines, all l0_refs resolve to valid L0 slugs, vault re-synced, human-approved Obsidian navigation

### Ecosystem Skills Audit & DawSync Integration Harmony

- [x] **SKILL-01**: Full ecosystem inventory produced -- every skill, agent, and command across L0 (AndroidCommonDoc), L1 (shared-kmp-libs), L2 (DawSync) cataloged with type, location, delegation status, and modernization needs
- [x] **SKILL-02**: `.agents/skills/` (6 web skills) consolidated into `skills/` at L0; `.agents/` directory eliminated; all skills in single canonical location
- [x] **SKILL-03**: All L0 skills (21 existing + 6 merged) rewritten to current Claude Code 2026 frontmatter best practices (name, description, allowed-tools, disable-model-invocation where appropriate)
- [x] **SKILL-04**: All L0 agents (11) audited and modernized to current Claude Code 2026 subagent patterns (tools, model, memory, skills preloading where beneficial)
- [x] **SKILL-05**: L0 command-skill alignment verified -- commands that overlap with skills documented, commands-only items assessed for skill promotion, 5 skills without commands assessed for command wrappers
- [x] **SKILL-06**: shared-kmp-libs 9 commands converted to delegate stubs pointing to L0 equivalents; L1 skill needs assessed and addressed
- [x] **SKILL-07**: DawSync 6 broken skill delegates fixed to point to new `skills/` path (not `.agents/skills/`); DawSync 6 agent delegates and 32 command delegates verified; 7 L2-specific commands validated as still correct
- [x] **SKILL-08**: DawSyncWeb minimal `.claude/` setup established for multi-console workflow; web-specific skill discovery verified
- [x] **SKILL-09**: GSD workflow integration verified across all 3 projects -- config.json correct, GSD skills don't conflict with L0 skills, worktree branch templates functional
- [x] **SKILL-10**: Sub-document pattern uniformity validated and fixed across all 3 projects -- hub+sub-doc cross-references correct, validate-doc-structure extended with sub-doc orphan and parent-hub checks
- [x] **SKILL-11**: Quality gate passed -- all validators (validate-doc-structure, script-parity, skill-script-alignment, template-sync) pass across all 3 projects; vault re-synced with updated skills; human-approved

### Skill Materialization & Registry

- [x] **MATL-01**: Skill Registry -- `skills/registry.json` in L0 catalogs all available skills and agents with paths, categories, and tiers as the discovery mechanism for downstream projects
- [x] **MATL-02**: Project Manifest Schema -- `l0-manifest.json` schema for L1/L2 projects declaring L0 source, version, included/excluded skills/agents, integrity checksums with selective opt-in support
- [x] **MATL-03**: Materialization Engine -- `/sync-l0` skill reads manifest, resolves against registry, copies selected skills/agents with version headers, updates checksums, shows diffs; replaces `install-claude-skills.sh`
- [x] **MATL-04**: Adapter Pipeline Simplification -- Evaluate and simplify adapter pipeline; SKILL.md materializes directly without intermediate generated commands; keep Copilot adapter for enterprise Microsoft support but simplify Claude Code path
- [x] **MATL-05**: Migrate Existing Delegates -- Convert all current path-based delegate stubs in shared-kmp-libs (9 commands) and DawSync (40+ commands, 6 skills, 6 agents) to materialized copies with manifests; verify nothing breaks
- [x] **MATL-06**: Skill Validation Tool -- Validation tool parses all SKILL.md files, verifies frontmatter completeness, checks referenced scripts exist, validates registry is in sync; safety net against broken skills
- [x] **MATL-07**: CLAUDE.md Layering -- Clean separation: `~/.claude/CLAUDE.md` = developer preferences, `{project}/CLAUDE.md` = project rules (can reference/inherit from L0 patterns); no more full duplication
- [x] **MATL-08**: Vault Naming Normalization & Category Consolidation -- Enforce `lowercase-kebab-case` naming across all vault sections (rename ~200 UPPERCASE_UNDERSCORE and numeric-prefixed files in DawSync docs, update all cross-references); consolidate 23 category tags to ~8 unified categories for readable graph view; add naming validation to vault sync pipeline

### CLAUDE.md Ecosystem Alignment

- [x] **CLAUDE-01**: Extract canonical rule checklist from all existing CLAUDE.md files (root ~/.claude/, AndroidCommonDoc, shared-kmp-libs, DawSync) -- every behavioral rule inventoried before any rewrite
- [x] **CLAUDE-02**: Design CLAUDE.md template with standard sections, context budget constraint (<150 lines per file, <4000 tokens initial load per project)
- [x] **CLAUDE-03**: Rewrite CLAUDE.md for AndroidCommonDoc (L0) -- aligned with current roadmap, project state, and standard template
- [x] **CLAUDE-04**: Rewrite CLAUDE.md for shared-kmp-libs (L1) -- module-aware, references L0 patterns
- [x] **CLAUDE-05**: Rewrite CLAUDE.md for DawSync (L2) -- domain-specific, references L0 patterns and L1 ecosystem conventions
- [x] **CLAUDE-06**: Implement L0->L1->L2 context delegation via @import directives -- L2 loads L1 conventions, L1 loads L0 patterns, no circular references
- [x] **CLAUDE-07**: Smoke test each rewritten CLAUDE.md -- generate ViewModel, UseCase, and test in each project; verify all behavioral rules preserved
- [x] **CLAUDE-08**: MCP tool `validate-claude-md` checks CLAUDE.md structure against template, detects missing rules vs canonical checklist, validates @import references resolve

### Ecosystem Documentation Completeness & Vault Harmony

- [x] **P16-README**: Write 38 new per-module READMEs for shared-kmp-libs by reading actual Kotlin source code, with 10-field frontmatter and l0_refs
- [x] **P16-UPGRADE**: Upgrade 14 existing module READMEs with full frontmatter and l0_refs cross-references
- [x] **P16-VALIDATE**: Extend validate-doc-structure MCP tool to validate module READMEs (frontmatter completeness, 300-line limit, l0_refs)
- [x] **P16-CATEGORY**: Fix DawSync category alignment -- all docs use 9-category unified vocabulary; cross-layer audit passes
- [x] **P16-SUBPROJ**: Assess DawSync subproject documentation gaps (DawSyncWeb, SessionRecorder-VST3) and address
- [x] **P16-VAULT**: Update vault-config.json, resync vault with MOC improvements, wikilink refresh -- sync code working correctly
- [x] **P16-CATALOG**: Update module-catalog.md with links to all 52 module READMEs
- [ ] **P16-HUMAN**: Human-verified Obsidian graph view, MOC navigation, and wikilink coverage -- checkpoint NOT approved, systemic vault quality issues deferred to phase 17

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Adapters

- **ADAPT-01**: Codex adapter generates Codex-compatible skill files
- **ADAPT-02**: Cursor/Windsurf rule adapters when formats stabilize

### Apple Patterns

- **APPLE-01**: SwiftUI navigation patterns documentation
- **APPLE-02**: KMP <-> SwiftUI interop patterns
- **APPLE-03**: appleMain/iosMain/macosMain source set guidance

### MCP Extended

- **MCPX-01**: MCP Streamable HTTP transport for broader agent compatibility
- **MCPX-02**: Consumer guard test convention plugin integration (`konsistGuard { rootPackage = "..." }` DSL)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Konsist tests duplicating existing Detekt rules | Maintenance burden doubles; assign each concern to exactly one tool |
| MCP server with write capabilities (file edits, git ops) | Toolkit is advisory, not autonomous; security and trust concerns |
| Runtime Konsist checks on every build | 10-30s overhead on incremental builds; run as test suite instead |
| Consumer guard tests enforcing specific package names | Hard-coding names makes guards useless outside one project; use parameterized approach |
| MCP server as cloud-deployed service | Adds infrastructure management to a solo-dev toolkit; stdio for local use |
| Konsist tests for consuming project business logic | Violates "no business logic from consuming apps" constraint |
| Custom Konsist rule DSL / framework | Konsist's API is already fluent; abstraction adds indirection without value |
| Konsist Compose-specific checks | compose-rules 0.5.6 already covers Compose via Detekt |
| Full repository architecture optimization | v1.2 initiative per CONTEXT.md deferred items |
| NotebookLM API integration | Requires enterprise license beyond current Google Cloud Pro account |
| Bidirectional vault editing | Conflict resolution complexity; repos are source of truth |
| Automatic file watcher sync | Process management complexity; manual invocation sufficient |
| Git hook triggered sync | Less controlled than manual invocation |
| Coordinated DawSync agent system | Deferred to future phase per user request -- specialized agents for each DawSync domain area |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DEBT-01 | Phase 5 | Complete |
| DEBT-02 | Phase 5 | Complete |
| DEBT-03 | Phase 5 | Complete |
| DEBT-04 | Phase 5 | Complete |
| KONS-01 | Phase 6 | Complete |
| KONS-02 | Phase 6 | Complete |
| KONS-03 | Phase 6 | Complete |
| KONS-04 | Phase 6 | Complete |
| KONS-05 | Phase 6 | Complete |
| GUARD-01 | Phase 7 | Complete |
| GUARD-02 | Phase 7 | Complete |
| GUARD-03 | Phase 7 | Complete |
| MCP-01 | Phase 8 | Complete |
| MCP-02 | Phase 8 | Complete |
| MCP-03 | Phase 8 | Complete |
| MCP-04 | Phase 8 | Complete |
| MCP-05 | Phase 8 | Complete |
| REG-01 | Phase 9 | Complete |
| REG-02 | Phase 9 | Complete |
| REG-03 | Phase 9 | Complete |
| REG-04 | Phase 9 | Complete |
| REG-05 | Phase 9 | Complete |
| REG-06 | Phase 9 | Complete |
| REG-07 | Phase 9 | Complete |
| DOC-01 | Phase 10 | Complete |
| DOC-02 | Phase 10 | Complete |
| DOC-03 | Phase 10 | Complete |
| DOC-04 | Phase 10 | Complete |
| DOC-05 | Phase 10 | Complete |
| DOC-06 | Phase 10 | Complete |
| DOC-07 | Phase 10 | Complete |
| DOC-08 | Phase 10 | Complete |
| DOC-09 | Phase 10 | Complete |
| VAULT-01 | Phase 11 | Complete |
| VAULT-02 | Phase 11 | Complete |
| VAULT-03 | Phase 11 | Complete |
| VAULT-04 | Phase 11 | Complete |
| VAULT-05 | Phase 11 | Complete |
| VAULT-06 | Phase 11 | Complete |
| VAULT-07 | Phase 11 | Complete |
| VAULT-08 | Phase 11 | Complete |
| VAULT-09 | Phase 11 | Complete |
| VAULT-10 | Phase 11 | Complete |
| VAULT-11 | Phase 11 | Complete |
| VAULT-12 | Phase 11 | Complete |
| VAULT-13 | Phase 11 | Complete |
| VAULT-14 | Phase 11 | Complete |
| VAULT-15 | Phase 11 | Complete |
| VAULT-16 | Phase 11 | Complete |
| VAULT-17 | Phase 11 | Complete |
| ECOV-01 | Phase 12 | Complete |
| ECOV-02 | Phase 12 | Complete |
| ECOV-03 | Phase 12 | Complete |
| ECOV-04 | Phase 12 | Complete |
| ECOV-05 | Phase 12 | Complete |
| ECOV-06 | Phase 12 | Complete |
| ECOV-07 | Phase 12 | Complete |
| AUDIT-01 | Phase 13 | Complete |
| AUDIT-02 | Phase 13 | Complete |
| AUDIT-03 | Phase 13 | Complete |
| AUDIT-04 | Phase 13 | Complete |
| AUDIT-05 | Phase 13 | Complete |
| AUDIT-06 | Phase 13 | Complete |
| STRUCT-01 | Phase 14 | Complete |
| STRUCT-02 | Phase 14 | Complete |
| STRUCT-03 | Phase 14 | Complete |
| STRUCT-04 | Phase 14 | Complete |
| STRUCT-05 | Phase 14 | Complete |
| STRUCT-06 | Phase 14 | Complete |
| REORG-01 | Phase 14.1 | Complete |
| REORG-02 | Phase 14.1 | Complete |
| REORG-03 | Phase 14.1 | Complete |
| REORG-04 | Phase 14.1 | Complete |
| REORG-05 | Phase 14.1 | Complete |
| REORG-06 | Phase 14.1 | Complete |
| REORG-07 | Phase 14.1 | Complete |
| QUAL-01 | Phase 14.2 | Complete |
| QUAL-02 | Phase 14.2 | Complete |
| QUAL-03 | Phase 14.2 | Complete |
| QUAL-04 | Phase 14.2 | Complete |
| QUAL-05 | Phase 14.2 | Complete |
| QUAL-06 | Phase 14.2 | Complete |
| QUAL-07 | Phase 14.2 | Complete |
| QUAL-08 | Phase 14.2 | Complete |
| SKILL-01 | Phase 14.2.1 | Complete |
| SKILL-02 | Phase 14.2.1 | Complete |
| SKILL-03 | Phase 14.2.1 | Complete |
| SKILL-04 | Phase 14.2.1 | Complete |
| SKILL-05 | Phase 14.2.1 | Complete |
| SKILL-06 | Phase 14.2.1 | Complete |
| SKILL-07 | Phase 14.2.1 | Complete |
| SKILL-08 | Phase 14.2.1 | Complete |
| SKILL-09 | Phase 14.2.1 | Complete |
| SKILL-10 | Phase 14.2.1 | Complete |
| SKILL-11 | Phase 14.2.1 | Complete |
| MATL-01 | Phase 14.3 | Complete |
| MATL-02 | Phase 14.3 | Complete |
| MATL-03 | Phase 14.3 | Complete |
| MATL-04 | Phase 14.3 | Complete |
| MATL-05 | Phase 14.3 | Complete |
| MATL-06 | Phase 14.3 | Complete |
| MATL-07 | Phase 14.3 | Complete |
| MATL-08 | Phase 14.3 | Complete |
| CLAUDE-01 | Phase 15 | Complete |
| CLAUDE-02 | Phase 15 | Complete |
| CLAUDE-03 | Phase 15 | Complete |
| CLAUDE-04 | Phase 15 | Complete |
| CLAUDE-05 | Phase 15 | Complete |
| CLAUDE-06 | Phase 15 | Complete |
| CLAUDE-07 | Phase 15 | Complete |
| CLAUDE-08 | Phase 15 | Complete |
| P16-README | Phase 16 | Complete |
| P16-UPGRADE | Phase 16 | Complete |
| P16-VALIDATE | Phase 16 | Complete |
| P16-CATEGORY | Phase 16 | Complete |
| P16-SUBPROJ | Phase 16 | Complete |
| P16-VAULT | Phase 16 | Complete |
| P16-CATALOG | Phase 16 | Complete |
| P16-HUMAN | Phase 16 | Not Approved |

**Coverage:**
- v1.1 requirements: 57 total (all complete)
- v1.2 requirements: 54 total (AUDIT 6 + STRUCT 6 + REORG 7 + QUAL 8 + SKILL 11 + MATL 8 + CLAUDE 8) -- all complete
- Phase 16 requirements: 8 total (7 complete, 1 not approved -- P16-HUMAN deferred to phase 17)
- Mapped to phases: 54
- Unmapped: 0

---
*Requirements defined: 2026-03-13*
*Last updated: 2026-03-16 after Phase 16 (Ecosystem Doc Completeness & Vault Harmony) completed*
