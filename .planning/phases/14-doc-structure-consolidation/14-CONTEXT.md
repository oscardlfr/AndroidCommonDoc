# Phase 14: Doc Structure & Consolidation - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Define a standard documentation template informed by Phase 13 audit evidence, then consolidate the entire ecosystem: split oversized L0 docs, promote DawSync L0 candidates, write full shared-kmp-libs module documentation (52 modules), consolidate DawSync docs per audit manifest, create new coverage-gap L0 docs, create an AI agent consumption guide, and re-sync the vault. Scope: AndroidCommonDoc (L0) + shared-kmp-libs (L1) + DawSync (L2). Breaking changes are allowed — no external consumers. Zero content loss is mandatory.

</domain>

<decisions>
## Implementation Decisions

### Standard doc template
- **Strict template enforcement** — mandatory for ALL docs across L0, L1, L2. Same template everywhere for consistent AI consumption
- **YAML frontmatter** — mandatory fields: scope, sources, targets, slug, status, monitor_urls, description, version, last_updated. New fields: `layer: L0|L1|L2`, `parent: hub-slug` (for sub-docs), `project: project-name` (for L1/L2 docs)
- **Hub+sub-doc pattern** — oversized docs split into hub (<100 lines, overview + links) + independently loadable sub-docs (each with full frontmatter, self-contained context, loadable without the hub)
- **Hard limit** — 150 lines per section, 300 lines per standalone doc, 500 lines absolute max per file
- **Section ordering** — Claude's discretion based on MCP server/agent consumption patterns and the model 5/5 docs (testing-patterns, viewmodel-state-patterns, compose-resources-patterns)
- **Anti-pattern format** — Claude's discretion (inline with rules vs dedicated section)
- **Code examples** — platform-split when pattern has platform differences (KMP, Android, iOS, desktop); commonMain-only when no platform divergence. AndroidCommonDoc must be correctly split between platforms — clean, solid
- **Version references** — Claude's discretion (hardcode+monitor vs placeholders)
- **Cross-references** — Claude's discretion (explicit Related Patterns section vs vault wikilinks)
- **Template location** — Claude's discretion (docs/ as living L0 doc or .planning/ as design artifact)

### L0 promotion strategy
- **All 47 DawSync candidates** promoted to L0 — Claude determines optimal enterprise approach for the 8 skills (copy as-is), 6 agents (parameterize), and 32 commands (template system)
- **DawSync originals** — replaced with thin L0 delegates after promotion. User leans towards symlinks but emphasizes zero content loss and enterprise-quality implementation. Claude determines best mechanism considering Windows compatibility
- **L2>L1 overrides** — before any override, validate what's duplicated, keep the most valuable/coherent with official docs. Claude determines the formal override mechanism that works with existing resolver and vault sync
- **API exposure pattern** (shared-kmp-libs) — Claude decides: merge generic rule into gradle-patterns.md or standalone doc. User notes this could also be an internal Detekt rule for shared-kmp-libs
- **12 superseded DawSync docs** — archive to docs/archive/superseded/ (not delete). Zero content loss
- **Enterprise proposal duplicate** — archive Spanish version (propuesta-integracion-enterprise.md) to docs/archive/
- **38 overlapping DawSync docs** — Claude determines during execution: keep as L2 if they add project-specific value, consolidate if pure duplicates
- **Priority/wave ordering** — Claude determines optimal execution order based on dependencies

### shared-kmp-libs documentation
- **Full coverage** — all 52 modules documented (38 new + 14 existing updated to template compliance)
- **Source code reading** — agents MUST read actual Kotlin source files to produce accurate API documentation (public API surface, real function signatures, usage patterns)
- **Error mappers** — Claude determines: group template (1 doc + 9 entries) vs individual docs
- **Security modules** — full depth documentation: algorithms, key derivation, platform crypto providers, threat model considerations, platform specifics. 7 modules, all security-critical
- **Storage docs** — L0 generic KMP storage concepts doc + L1 shared-kmp-libs specific decision tree mapping concepts to modules (core-storage-mmkv, core-storage-datastore, etc.)
- **Firebase modules** — Claude investigates during execution: if dead code, mark deprecated; if active, document fully with status flag
- **Module catalog** — Claude determines whether a single shared-kmp-libs-catalog.md with all 52 modules adds value
- **shared-kmp-libs CLAUDE.md** — Claude determines whether to add doc pointers now or leave entirely for Phase 15
- **Violations discovered during documentation** — log for future phases, don't block documentation work

### Oversized doc splitting
- **All 5 oversized L0 docs** split into hub+sub-doc format — Claude determines the optimal splits:
  - ui-screen-patterns.md (651 lines) — urgent
  - testing-patterns-coroutines.md (497 lines)
  - resource-management-patterns.md (462 lines)
  - error-handling-patterns.md (441 lines)
  - gradle-patterns.md (398 lines)
- **kmp-architecture.md** (341 lines) — Claude determines optimal split
- **monitor_urls** — add to all 18 L0 docs that lack them during template compliance pass
- **versions-manifest.json** — fix as Phase 14 prerequisite (kover 0.9.1→actual, compose-multiplatform clarification) before any doc work

### New L0 coverage gap docs
- **Navigation3 patterns** — new L0 doc covering androidx.navigation3 with @Serializable routes, shared across Android + Desktop Compose, iOS/macOS native NavigationStack
- **DI patterns** — new L0 doc that is DI-framework-agnostic: covers both Koin (personal ecosystem) AND Dagger/Hilt (enterprise). L0 should serve any KMP/Android project, not mandate one framework
- **Additional coverage gaps** (security, data layer, consumer builds, Firebase, billing) — Claude determines how many can fit in Phase 14 scope

### DawSync consolidation
- **62 architecture diagrams** — audit and consolidate: keep current, archive historical, promote any illustrating generic KMP patterns
- **Fix version inconsistency** — Kotlin 2.3.0→2.3.10 in README.md, APPLE_SETUP.md, TECHNOLOGY_CHEATSHEET.md, ANDROID_2026.md. Resolve to 2.3.10 everywhere
- **DawSync archive docs** (21 business context files) — Claude determines whether to add frontmatter tags for vault discoverability

### AI spec-driven optimization
- **Agent consumption guide** — new L0 doc explaining: how docs are layered (L0/L1/L2), when to load which layer, how overrides work, frontmatter fields agents should use. The meta-doc that makes the whole system usable for AI spec-driven development
- **Design for reuse, scope to current** — template and patterns designed to be adoptable by any future L2 project (WakeTheCave, OmniSound). Phase 14 executes only for DawSync + shared-kmp-libs
- **Vault re-sync** — Claude determines timing (one final sync vs incremental). vault-config.json updated to collect new L0 docs (promoted skills, agents, commands)
- **Full quality gate** — run quality-gate-orchestrator after all changes to verify no regressions in MCP server, registry scanner, monitor-sources

### Claude's Discretion
- Optimal section ordering in template (rules-first vs context-first) based on agent consumption patterns
- Anti-pattern format (inline vs dedicated section)
- Version reference approach (hardcode+monitor vs placeholders)
- Cross-reference mechanism (explicit section vs vault wikilinks)
- Template file location (docs/ vs .planning/)
- Command template system design for 32 promoted commands
- Promotion wave ordering and parallelization
- L2>L1 override mechanism details
- Error mapper doc format (group template vs individual)
- Execution order across repos
- Feature branch vs direct-on-main strategy
- Module catalog creation for shared-kmp-libs
- DawSync archive frontmatter tagging
- Additional coverage gap docs beyond Navigation3 and DI
- Vault sync timing (one final vs incremental)

</decisions>

<specifics>
## Specific Ideas

- "Breaking changes are fine — no external consumers. The important thing is zero content loss"
- "Abstract and reuse across L2 — maximize L0/L1 coverage so L2 projects get value by delegation"
- "Clean, solid, private, professional, enterprise solution" — quality bar for all implementations
- "L0/L1/L2 should be fully aligned and updated by the end of this phase or the next one"
- "AndroidCommonDoc should be correctly split between KMP, Android, iOS, etc. — clean and solid"
- "Koin is not mandatory — company uses Dagger. DI doc should be framework-agnostic"
- "API exposure pattern could be a Detekt rule for shared-kmp-libs, not just documentation"
- "Before overriding L2>L1, validate what's duplicated and keep the most valuable/coherent with official docs"
- "Violations discovered during shared-kmp-libs documentation → plan for future phases, don't block"
- Model docs that score 5/5 AI-readiness: testing-patterns.md, viewmodel-state-patterns.md, compose-resources-patterns.md — use as template reference

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `docs/testing-patterns.md`, `docs/viewmodel-state-patterns.md`, `docs/compose-resources-patterns.md`: Model 5/5 AI-readiness docs — use as template reference for strict template design
- `mcp-server/src/registry/scanner.ts`: Dynamic directory scanner with frontmatter parsing — must handle new frontmatter fields (layer, parent, project)
- `mcp-server/src/registry/resolver.ts`: L0/L1/L2 layer resolution — reference for override mechanism design
- `mcp-server/src/registry/frontmatter.ts`: YAML frontmatter parser — extend for new fields
- `mcp-server/src/tools/sync-vault.ts`: Vault sync tool — will need updated vault-config.json
- `mcp-server/src/tools/vault-status.ts`: Vault health — verify after re-sync
- `mcp-server/src/tools/monitor-sources.ts`: Source monitoring — run against expanded corpus with new monitor_urls
- `mcp-server/src/registry/project-discovery.ts`: Auto-discover consumer projects — use to locate shared-kmp-libs and DawSync

### Established Patterns
- Hub+sub-doc format: `testing-patterns.md` → `testing-patterns-coroutines.md`, `testing-patterns-fakes.md`, `testing-patterns-coverage.md`
- YAML frontmatter with scope/sources/targets/slug/status/monitor_urls/rules fields
- L0>L1>L2 full replacement semantics in resolver (Phase 9)
- Dynamic registry scan, no hardcoded lists (Phase 9)
- SHA-256 content hashing for sync manifests (Phase 11)
- Layer-first vault structure: L0-generic/, L1-ecosystem/, L2-apps/ (Phase 12)
- Configurable collection globs per project in vault-config.json (Phase 12)

### Integration Points
- `docs/*.md` (23 files): L0 pattern docs — split oversized, add frontmatter, add monitor_urls
- `C:/Users/34645/AndroidStudioProjects/shared-kmp-libs/`: 52 modules to document, 5 existing docs/ files
- `C:/Users/34645/AndroidStudioProjects/DawSync/`: 47 L0 promotion candidates, 12 superseded to archive, 62 architecture diagrams, stale version refs
- `~/.androidcommondoc/vault-config.json`: Update collection globs for new L0 docs
- `versions-manifest.json`: Fix kover and compose-multiplatform versions as prerequisite
- `.planning/phases/13-audit-validate/audit-manifest.json`: Machine-readable audit data for all consolidation decisions

</code_context>

<deferred>
## Deferred Ideas

- **API exposure Detekt rule** — User suggested api()/implementation() visibility could be enforced as a Detekt rule in shared-kmp-libs, not just documented. Plan for future phase if audit validates the pattern
- **WakeTheCave/OmniSound adoption** — Template designed for reuse, but adoption of these projects is a future milestone
- **NotebookLM API integration** — Out of scope per REQUIREMENTS.md
- **Violations found during shared-kmp-libs documentation** — Any code issues, missing tests, incorrect implementations discovered while reading source code for documentation → captured and planned for future phases

</deferred>

---

*Phase: 14-doc-structure-consolidation*
*Context gathered: 2026-03-14*
