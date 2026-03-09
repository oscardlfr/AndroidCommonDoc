# Phase 12: Ecosystem Vault Expansion - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend the vault collector to understand the L0/L1/L2 documentation hierarchy and collect comprehensive project documentation (architecture, conventions, app-specific docs, sub-projects). The Obsidian vault becomes a true cross-project knowledge hub. Also includes a doc audit to ensure documentation is properly distributed across layers before collection, MCP tool alignment for ecosystem-aware queries, and test rewrites for the new structure. Focus projects: AndroidCommonDoc, shared-kmp-libs, DawSync. Breaking changes allowed — nobody uses the vault yet.

</domain>

<decisions>
## Implementation Decisions

### Vault directory hierarchy
- **Layer-first structure**: Top-level directories organized by L0/L1/L2 (not flat patterns/skills/projects)
- **_vault-meta/ stays at root**: Infrastructure (manifest, README) alongside 00-MOC/ at vault root
- **Auto-generated Home.md**: Root-level entry point with ecosystem overview, MOC links, project count, last sync date
- **Clean slate migration**: First sync with new structure does a full clean + rebuild. Old flat structure files removed, new layer-first paths created, new manifest written
- **Docs/AI/planning subdivision**: Authored docs (docs/), AI instruction files (ai/), and planning files (planning/) in separate subdirectories within each project — applies to L1 and L2 at minimum
- **Override visibility**: Both L0 original AND L1/L2 overrides appear in the vault. User wants to visually identify when something is overridden

### L1 ecosystem content scope
- **Everything discoverable**: Collect all .md files from shared-kmp-libs root + docs/ + module-level READMEs. Let the collector find what exists
- **Configurable per-project layer assignment**: Each project in vault-config.json declares its layer (L1 or L2). Default: L2 for consumer apps, L1 only if explicitly set
- **Version catalog as reference doc**: Configurable opt-in feature — parse libs.versions.toml and generate a readable reference page. Not forced on all projects
- **Consistent doc format across all layers**: Same structure for L0, L1, L2 docs — optimized for spec-driven / AI consumption and token efficiency

### App doc collection scope
- **Configurable per project**: Each project declares its own collection globs in vault-config.json. Different projects may need different patterns
- **Distinct vault_type taxonomy**: Project-level docs (CLAUDE.md, AGENTS.md, PROJECT.md) = `reference`, feature docs (docs/) = `docs`, architecture docs (.planning/codebase/) = `architecture`
- **Breaking change to VaultConfig**: Projects change from `string[]` to rich objects with name, path, layer, collectGlobs, excludeGlobs, features. No backward compatibility needed — clean break

### Sub-project support
- **Both auto-detect + config**: Auto-detect nested repos/build files within a project. Config can add/exclude sub-projects, including external directories (e.g., DawSyncWeb as sibling of DawSync)
- **Nested under parent in vault**: Sub-projects get a `sub-projects/` subdirectory under their parent project
- **Independent collection globs**: Sub-projects can declare their own collectGlobs/excludeGlobs, independent of parent. Needed for multi-language projects (e.g., C++ VST3 vs Kotlin)
- **Configurable scan depth**: How deep to scan for nested sub-projects is configurable
- **Nested in MOC pages**: Sub-projects listed under parent project headers with sub-headers in MOC pages (not flat)

### MOC evolution
- **Descriptive sublabels in By Layer MOC**: L0 = "Generic Patterns", L1 = "Ecosystem (shared-kmp-libs)", L2 = "App-Specific". Clear descriptions of what each layer means
- **L2 grouped by project**: App entries under L2 grouped by project with sub-headers (DawSync, WakeTheCave, OmniSound)

### Doc audit (Plan 01)
- **Audit as first plan**: Phase 12 starts with a doc layer audit — scan DawSync for patterns that should be L0, check shared-kmp-libs for undocumented conventions, propose doc movements
- **Token-efficient, spec-driven format**: All docs created/reorganized must be optimized for AI context consumption. Follows project core value: "patterns must be accurate, current, and token-efficient"

### MCP tool alignment
- **Vault for humans, MCP for agents**: Both systems understand L0/L1/L2 the same way
- **find-pattern ecosystem-aware queries**: Include in Phase 12 scope — update find-pattern to support "give me all patterns for DawSync" = L0 + L1 + L2-DawSync

### Test strategy
- **Rewrite tests**: Clean rewrite of all vault tests for the new layer-first structure. Fresh test fixtures with layer-aware assertions

### Claude's Discretion
- Exact directory names for L0/L1/L2 top-level folders (L0-generic vs L0 vs other)
- Where AndroidCommonDoc's own project knowledge goes (under L0 or separate)
- Where Detekt rules sit in hierarchy (opt-in tooling, not forced on all projects)
- Override annotation in MOC pages (whether to show "overrides L0 base" annotations)
- .obsidian/ config regeneration strategy (init-only vs merge on sync)
- Source path breadcrumbs in frontmatter (vault_source_path for locating original files)
- Template inclusion/removal (given vault is read-only, are templates useful?)
- Slug disambiguation strategy for cross-layer collisions (layer-prefixed slugs vs directory-qualified links)
- Default collection globs when none are configured (smart defaults for common doc locations)
- Auto-discover layer detection (default L2 vs heuristic L1 detection)
- Module-level docs organization in vault (one page per module vs consolidated)
- Empty section handling (omit vs placeholder)
- Doc audit output format (execute moves directly vs report-then-decide)
- L0 promotion criteria (conservative vs check-all-patterns)
- shared-kmp-libs doc needs (module API docs vs just conventions)
- Non-.md file conversion scope (version catalog, convention plugins)
- Missing doc handling (graceful skip vs warning)
- Sub-project source tracking in manifest (auto vs configured)
- Sub-project auto-detection signals (git repos, build files)
- Multi-tech sub-project handling (tech-aware collection or same treatment)
- Vault-status ecosystem-awareness (per-layer health breakdown)
- Sync skill parameters (project filter, layer filter)
- Vault transformer token optimization (collect as-is vs strip verbose content)
- Registry resolver alignment (single shared model vs vault-specific)
- Docs/AI/planning subdivision consistency across layers (L0 special vs all layers same)
- Scope management (single phase with multiple plans vs split)
- Sync report sub-project section (discovered sub-projects listing)

</decisions>

<specifics>
## Specific Ideas

- User consistently wants "the cleanest, most professional, solid, clean, maintainable enterprise approach" — same direction as all prior phases
- All documentation must be oriented towards spec-driven / AI use — token-efficient, concise, structured for agent consumption
- Focus on DawSync, shared-kmp-libs, and AndroidCommonDoc for now — other apps (WakeTheCave, OmniSound) are secondary
- DawSyncWeb (C:\Users\34645\AndroidStudioProjects\DawSyncWeb) is part of the DawSync product but in a separate directory — example of external sub-project
- User concerned about alignment: existing doc intelligence pipeline (monitor-sources, pattern registry, find-pattern) must work consistently with the expanded L0/L1/L2 model
- User concerned that shared-kmp-libs may have no documentation yet — audit should surface this gap
- User concerned that some DawSync docs may actually belong in AndroidCommonDoc L0 — audit should check this
- The vault should enable spec-driven development by layers: an agent working on DawSync should get L0 + L1 + L2-DawSync patterns automatically
- Configurable features per project (version catalog generation, scan depth, etc.) — "should be configurable" is a recurring theme
- Nobody uses the vault yet — breaking changes are welcome for a clean, professional result

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `mcp-server/src/vault/collector.ts`: Current collector with collectPatternDocs (L0), collectL1Docs, collectSkills, collectProjectKnowledge — needs major refactor for layer-first structure and configurable globs
- `mcp-server/src/vault/config.ts`: VaultConfig loader/saver at ~/.androidcommondoc/vault-config.json — needs schema rewrite (projects: string[] -> ProjectConfig[])
- `mcp-server/src/vault/types.ts`: VaultSource, VaultEntry, SyncManifest, VaultConfig types — need expansion for layers, sub-projects, new vault_types
- `mcp-server/src/vault/moc-generator.ts`: 6 MOC generators — need ecosystem-aware groupings, sub-project nesting, Home.md generation
- `mcp-server/src/vault/transformer.ts`: Doc transformer — may need layer-aware slug disambiguation
- `mcp-server/src/vault/sync-engine.ts`: Sync engine with runPipeline — needs clean-slate migration support
- `mcp-server/src/vault/vault-writer.ts`: File writer — needs new directory structure paths
- `mcp-server/src/vault/wikilink-generator.ts`: Cross-reference generator — needs sub-project slug pool
- `mcp-server/src/vault/tag-generator.ts`: Auto-tag generator — needs layer tags, domain tags
- `mcp-server/src/registry/scanner.ts`: Dynamic directory scanner with frontmatter parsing — reuse for expanded collection
- `mcp-server/src/registry/resolver.ts`: L0/L1/L2 layer resolution — alignment target for vault layer model
- `mcp-server/src/registry/project-discovery.ts`: Auto-discover consumer projects — extend for sub-project detection
- `mcp-server/src/tools/find-pattern.ts`: Metadata search across layers — needs ecosystem-aware query support

### Established Patterns
- TypeScript + stdio MCP server (Phase 8)
- Skill + MCP tool dual surface (Phase 10)
- Dynamic registry scan, no hardcoded lists (Phase 9)
- YAML frontmatter with scope/sources/targets (Phase 9-10)
- L0>L1>L2 full replacement semantics in resolver (Phase 9)
- SHA-256 content hashing for incremental sync (Phase 11)
- Manifest-based orphan detection (Phase 11)
- Forward-slash normalization for Windows (Phase 11)
- Zone-based text protection for wikilinks (Phase 11)

### Integration Points
- `mcp-server/src/tools/index.ts`: sync-vault and vault-status tool registrations — update for ecosystem-aware responses
- `mcp-server/src/tools/find-pattern.ts`: Add ecosystem-aware query support (L0+L1+L2 for project)
- `skills/sync-vault/SKILL.md`: Update skill definition for new parameters if needed
- `~/.androidcommondoc/vault-config.json`: Config schema rewrite
- Consumer repos: DawSync, shared-kmp-libs — doc audit targets
- Existing vault tests: `mcp-server/tests/unit/vault/*.test.ts` — full rewrite needed

</code_context>

<deferred>
## Deferred Ideas

- **WakeTheCave and OmniSound full integration** — Focus is on DawSync + shared-kmp-libs + AndroidCommonDoc for Phase 12. Other apps can be added later via config
- **Automatic doc generation for shared-kmp-libs modules** — If shared-kmp-libs lacks docs, Phase 12 audit may create stubs but comprehensive API docs are a separate initiative
- **Bidirectional vault editing** — Still deferred from Phase 11 (conflict resolution complexity)
- **Automatic file watcher sync** — Still deferred from Phase 11 (process management complexity)
- **NotebookLM API integration** — Still deferred from Phase 11 (requires enterprise license)
- **Full repository architecture optimization** — v1.2 initiative per Phase 11 deferred items

</deferred>

---

*Phase: 12-ecosystem-vault-expansion*
*Context gathered: 2026-03-14*
