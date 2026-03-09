# Phase 11: Obsidian Documentation Hub - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning

**Note:** Phase pivoted from "NotebookLM Integration Skill" to "Obsidian Documentation Hub". NotebookLM Enterprise API (Discovery Engine v1alpha) exists and is capable (CRUD notebooks, sources, audio), but requires a separate enterprise license beyond the user's Google Cloud Pro account (20€/month). Obsidian is free, local-first, and serves the same documentation coordination goal.

<domain>
## Phase Boundary

Claude Code skill + MCP tool that syncs AndroidCommonDoc pattern docs, skills, rules, and project knowledge into a unified Obsidian vault with auto-generated cross-references, MOC pages, and tags. Covers the entire KMP ecosystem: AndroidCommonDoc, shared-kmp-libs, and configurable consumer projects (DawSync, OmniSound, WakeTheCave). Repos are source of truth — vault is a read-only enriched view.

</domain>

<decisions>
## Implementation Decisions

### Vault structure
- **One unified vault** for the entire KMP ecosystem — not per-project vaults
- **Standalone directory** (e.g., `~/AndroidStudioProjects/kmp-knowledge-vault/`) — independent of any project repo, no git conflicts
- **Internal organization**: Claude's discretion — pick the most professional structure based on Obsidian best practices and the L0/L1/L2 registry model
- **Vault versioning**: Claude's discretion — decide whether the vault should be its own git repo or regenerated on demand
- **Content scope — all types:**
  - Pattern docs (L0 base + L1 project-specific)
  - Skills (19 SKILL.md files) and Detekt rules
  - Project decisions (.planning/ directories — CONTEXT.md, PROJECT.md, key decisions)
  - AI instruction files (CLAUDE.md, AGENTS.md from each project)
  - Plus anything else Claude deems valuable for a professional, maintainable vault
- **Include shared-kmp-libs** documentation (version catalog, core modules, network/system APIs)
- **Configurable project list** — user has many projects in workspace, vault focuses only on shared-kmp-libs consumers. Leverage existing project-discovery mechanism from Phase 9

### Sync model
- **Repos are source of truth** — vault is a read-only enriched view synced FROM project repos
- **Manual skill invocation** — run when you want to update, no background watchers or automatic triggers
- **Change handling on sync**: Claude's discretion — overwrite vs smart merge of Obsidian-side additions
- **Sync report**: Claude's discretion — whether to show a diff summary after sync

### Cross-referencing & linking
- **Auto-generate Obsidian [[wikilinks]]** between related docs based on frontmatter metadata (scope, sources, targets). Graph view lights up with cross-project connections
- **Auto-generate MOC (Map of Content) pages** — index pages like "All Patterns", "By Project", "By Layer", "By Target Platform". Navigation hubs in the graph
- **Frontmatter compatibility** — keep existing YAML frontmatter format compatible with both Obsidian and the broader ecosystem (not Obsidian-locked). Obsidian already reads standard YAML natively
- **Auto-generate tags** from frontmatter: scope → #viewmodel #testing, targets → #android #desktop, layer → #L0 #L1. Enables Obsidian tag-based filtering

### Skill & tooling design
- **Both Claude Code skill + MCP tool** — skill for human invocation, MCP tool for agent automation. Mirrors monitor-docs/monitor-sources pattern from Phase 10
- **Operations**: Claude's discretion — decide which verbs (init-vault, sync-vault, vault-status, open-vault, etc.) based on best practices
- **Auto-configure recommended Obsidian plugins** during vault initialization — Dataview, Graph Analysis, etc. Claude picks which plugins add value without bloat
- **Runnable from ANY project directory** — the skill works from DawSync, OmniSound, etc., not just AndroidCommonDoc. Finds vault location from shared config
- **Config storage**: Claude's discretion — extend existing projects.yaml, central config, or per-project markers
- **Obsidian templates**: Claude's discretion — whether to include templates for drafting new docs in Obsidian (given read-only sync model)
- **Vault query MCP tool**: Claude's discretion — whether to add a vault-specific query tool or reuse existing find-pattern

### Claude's Discretion
- Vault internal directory structure (by layer, by project, by content type, or hybrid)
- Whether vault is git-tracked or regenerated
- Change handling strategy (overwrite vs smart merge)
- Sync report format and verbosity
- Which Obsidian community plugins to auto-configure
- Vault operations / skill verbs
- Config file location and format
- Whether to include Obsidian templates
- Whether vault query is separate tool or reuses find-pattern
- Multi-tool surface: Copilot adapter generation for vault skill

</decisions>

<specifics>
## Specific Ideas

- User consistently wants "the cleanest, most professional, solid, clean, maintainable enterprise approach" — same direction as all prior phases (5-10)
- The vault should serve as the single place to see how ALL KMP ecosystem projects relate to each other — patterns, decisions, and AI instructions all cross-referenced
- User wants the vault focused only on shared-kmp-libs consumers, not all projects in their workspace — configurable scope
- User has Obsidian already installed — during execution, can create the vault directly
- Existing frontmatter format should remain ecosystem-agnostic (not Obsidian-locked) — compatible with any tool that reads YAML frontmatter
- The project-discovery mechanism from Phase 9 (settings.gradle.kts includeBuild scanning, projects.yaml fallback) is the natural basis for vault project configuration

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `mcp-server/src/registry/scanner.ts`: Dynamic directory scanner with frontmatter parsing — basis for discovering docs to sync
- `mcp-server/src/registry/resolver.ts`: L0/L1/L2 layer resolution — informs vault organization and cross-project pattern resolution
- `mcp-server/src/registry/project-discovery.ts`: Auto-discover consumer projects from settings.gradle.kts — reuse for vault project configuration
- `mcp-server/src/registry/frontmatter.ts`: YAML frontmatter parser — reuse for extracting metadata to generate wikilinks/tags
- `mcp-server/src/tools/find-pattern.ts`: Metadata-based search across registry layers — potential basis for vault query tool
- `skills/monitor-docs/SKILL.md`: Example of skill wrapping MCP tool (monitor-docs wraps monitor-sources) — pattern for vault skill
- `docs/*.md`: 23 pattern docs with YAML frontmatter — primary sync source
- `skills/*/SKILL.md`: 19 skill definitions — secondary sync source

### Established Patterns
- MCP server: TypeScript + stdio transport + ESLint/Prettier (Phase 8)
- Skill + MCP tool dual surface: skill for humans, MCP tool for agents (Phase 10)
- SKILL.md → multi-tool generation: Claude Code + Copilot adapters (existing pipeline)
- Project discovery: settings.gradle.kts includeBuild scanning + projects.yaml fallback (Phase 9)
- Frontmatter: YAML with scope, sources, targets, version, monitor_urls, rules fields (Phase 9-10)
- Dynamic registry scan — no hardcoded lists (Phase 9)

### Integration Points
- `mcp-server/src/tools/index.ts`: Register new vault sync/query MCP tools
- `skills/`: Add vault skill SKILL.md for multi-tool generation
- `docs/*.md`: Source files scanned and synced to vault
- Consumer repos (DawSync, OmniSound, WakeTheCave): .planning/ and .claude/ directories scanned for vault content
- shared-kmp-libs repo: Documentation synced to vault
- `~/.androidcommondoc/` or similar: Vault config file location

</code_context>

<deferred>
## Deferred Ideas

- **NotebookLM API integration** — NotebookLM Enterprise API (Discovery Engine v1alpha) is capable but requires enterprise license. Revisit when pricing becomes accessible or user gets enterprise access. API endpoints documented at docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/
- **Bidirectional editing** — Edit docs in Obsidian and push back to repos. Adds conflict resolution complexity. Phase 11 uses repos as source of truth; bidirectional could be a future enhancement
- **Automatic file watcher sync** — Background process that detects repo changes and auto-syncs to vault. Adds process management complexity. Manual invocation is simpler and sufficient for now
- **Git hook triggered sync** — Post-commit/post-merge hooks that auto-sync. More automated but less controlled than manual invocation

</deferred>

---

*Phase: 11-notebooklm-integration-skill*
*Context gathered: 2026-03-14*
