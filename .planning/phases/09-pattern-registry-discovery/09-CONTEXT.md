# Phase 9: Pattern Registry & Discovery - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Pattern docs organized in a layered registry (L0 base / L1 project / L2 user) with cross-project discovery, scoped loading, and MCP integration. Agents load only relevant patterns, users can override/extend per project. Includes initial doc freshness audit and DawSync doc migration. Does NOT include automated monitoring of official sources or Detekt rule generation (Phase 10).

</domain>

<decisions>
## Implementation Decisions

### Layer resolution behavior
- **Full replacement**: L1 doc completely replaces L0 for that pattern — no partial merge, no section-level mixing
- **L2 = personal preferences**: Global user preferences stored in user home (~/.androidcommondoc/ or similar), applies across all projects
- **Priority order**: L1 project > L2 user > L0 base — project consistency wins over personal taste
- **L1 location**: In each consumer repo under `.androidcommondoc/docs/` (e.g., `DawSync/.androidcommondoc/docs/testing-patterns.md`)
- **Project discovery**: Auto-discover consumer projects from existing config (settings.gradle.kts includeBuild paths, ~/.androidcommondoc/projects.yaml fallback, ANDROID_COMMON_DOC env var for toolkit root)

### Pattern metadata schema
- **Storage**: YAML frontmatter in each pattern .md file — metadata travels with the doc, single file, grep-friendly
- **Required fields**: `scope` (architectural layers/concerns), `sources` (libraries/APIs referenced), `targets` (platforms: android, desktop, ios, jvm)
- **Additional fields**: Claude's discretion on what else is needed for a professional, solid implementation (version tracking, description, etc.)

### Cross-project discovery (find-pattern MCP tool)
- **Matching**: Metadata-based — queries match against scope, sources, targets fields (fast, deterministic, no full-text indexing)
- **Project filter**: Optional — `find-pattern(query, project?)`. No project = L0 only, project name = resolved L0→L1→L2, "all" = cross-project search
- **Return format**: Claude's discretion on whether to return resolved content directly or references (balance token efficiency with usability)
- **MCP resource evolution**: Claude's discretion on whether existing `docs://androidcommondoc/{slug}` resources become registry-aware or a parallel system is added

### Token-aware doc optimization
- **Doc restructuring**: Agent/tool should be capable of splitting monolithic pattern files into focused, independently-loadable chunks for better context consumption
- **MCP integration**: Dynamic — MCP server reads registry at runtime, auto-discovers docs with valid frontmatter, no code changes needed when docs are split or renamed
- **Scoped loading**: Claude's discretion on loading strategy (context-scoped, summary+drill, composite docs) — optimize for agents consuming minimal tokens

### Initial doc audit (included in Phase 9)
- **Freshness audit**: Validate all 9 existing pattern docs against current official sources (KMP docs, library changelogs, version catalog). Fix stale version refs, deprecated APIs, incorrect patterns before organizing into registry
- **DawSync doc migration**: Audit DawSync/.claude/ docs — promote generic KMP/Android patterns to AndroidCommonDoc L0, keep project-specific patterns as L1 in DawSync/.androidcommondoc/
- **Result**: Registry launches with verified, current, complete content

### Excludes mechanism
- Claude's discretion on how user excludes (e.g., "no Turbine") filter patterns — whether by sources field matching, section-level filtering, or hybrid approach

### Claude's Discretion
- Additional metadata fields beyond scope/sources/targets
- Excludes mechanism design (doc-level vs section-level filtering)
- find-pattern return format (content vs references)
- Whether existing MCP doc resources become registry-aware or parallel system
- Doc splitting strategy (which docs to split, granularity)
- Token-aware loading approach (context-scoped, summary+drill, composite)
- L2 preferences storage format and exact location
- Registry file format for L1 consumer configuration

</decisions>

<specifics>
## Specific Ideas

- User consistently wants "the cleanest, most professional, solid, clean, maintainable enterprise approach" — same direction as all prior phases
- Doc optimization is about making docs inherently context-efficient for agents — not just about loading strategy but about restructuring content so agents spend tokens on logic, not loading irrelevant patterns
- DawSync's .claude/ directory may contain generic patterns that benefit all projects — promote those to L0 base
- The agent that reorganizes docs should be able to split files, restructure content, add frontmatter metadata — a one-time optimization pass
- Validate against official documentation patterns as part of the initial audit before registry launch

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `mcp-server/src/resources/docs.ts`: Current doc resource registration with `KNOWN_DOCS` list and `docs://androidcommondoc/{slug}` URI scheme — needs evolution to registry-aware dynamic discovery
- `mcp-server/src/utils/paths.ts`: `getToolkitRoot()`, `getDocsDir()`, `getSkillsDir()` — extend with registry path resolution
- `mcp-server/src/server.ts`: Server factory with `registerResources/Tools/Prompts` — add registry initialization
- `mcp-server/src/utils/rate-limiter.ts` + `rate-limit-guard.ts`: Rate limiting for agent loop protection — reuse for find-pattern tool
- `docs/` directory: 9 pattern docs (current L0 base content) — target for frontmatter addition and potential restructuring
- `mcp-server/src/tools/check-freshness.ts`: Existing freshness check tool — informs the audit approach

### Established Patterns
- MCP server is TypeScript + stdio transport + ESLint/Prettier (Phase 8)
- Resources registered eagerly at startup with async read handlers (docs.ts pattern)
- Tools use Zod schemas for parameter validation (Phase 8 tools pattern)
- ANDROID_COMMON_DOC env var for toolkit root resolution
- Composite build: consumers use `includeBuild("../AndroidCommonDoc")`

### Integration Points
- `mcp-server/src/resources/docs.ts` — primary file to evolve from hardcoded KNOWN_DOCS to dynamic registry scan
- `mcp-server/src/tools/index.ts` — add find-pattern tool registration
- `docs/*.md` — add YAML frontmatter to all existing pattern docs
- Consumer repos (DawSync, OmniSound) — create `.androidcommondoc/` directory structure for L1
- `~/.androidcommondoc/` — create user home directory for L2 preferences
- DawSync/.claude/ — source for generic pattern migration to L0

</code_context>

<deferred>
## Deferred Ideas

- **Automated doc monitoring** — Auto-updating from official sources, version change detection, deprecation alerts. Phase 10 scope (Doc Intelligence).
- **Detekt rule generation from patterns** — Generating custom Detekt rules from verified patterns. Phase 10 scope.
- **Conventional Commits enforcement** — Git commit-msg hook. Noted in Phase 6 deferred, not Phase 9 scope.
- **Gitflow workflow validation** — Branch naming rules. Noted in Phase 6 deferred, not Phase 9 scope.

</deferred>

---

*Phase: 09-pattern-registry-discovery*
*Context gathered: 2026-03-13*
