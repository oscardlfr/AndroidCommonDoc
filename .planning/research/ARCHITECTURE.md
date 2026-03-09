# Architecture Research

**Domain:** Documentation Coherence & Context Management (v1.2 milestone)
**Researched:** 2026-03-14
**Confidence:** HIGH (builds on verified v1.1 architecture; all integration points exist in current codebase)

## Standard Architecture

### System Overview: v1.2 Integration Map

The v1.2 milestone adds three capabilities to the existing MCP server and vault pipeline. Unlike v1.1 (which added parallel modules), v1.2 is about **deepening existing modules** -- adding new processing stages to the collector/transformer pipeline and new MCP tools that operate on CLAUDE.md files.

```
+-----------------------------------------------------------------------+
|                   ANDROID COMMON DOC (v1.2)                            |
|                                                                        |
|  EXISTING (v1.0-v1.1) -- Unchanged                                    |
|  +------------------+  +------------------+  +----------------+        |
|  | docs/*.md        |  | scripts/         |  | detekt-rules/  |        |
|  | (L0 patterns)    |  | (ps1/ + sh/)     |  | (5 lint rules) |        |
|  +------------------+  +------------------+  +----------------+        |
|  +------------------+  +------------------+  +----------------+        |
|  | .claude/agents/  |  | adapters/        |  | build-logic/   |        |
|  | (quality gates)  |  | (skill pipeline) |  | (convention)   |        |
|  +------------------+  +------------------+  +----------------+        |
|  +------------------+  +------------------+  +----------------+        |
|  | skills/          |  | guard-templates/ |  | konsist-tests/ |        |
|  | (16 SKILL.md)    |  | (arch guards)    |  | (internal)     |        |
|  +------------------+  +------------------+  +----------------+        |
|                                                                        |
|  EXISTING (v1.1) -- Modified by v1.2                                   |
|                                                                        |
|  +------------------+                                                  |
|  | mcp-server/      |                                                  |
|  |  src/            |                                                  |
|  |  +-- vault/      | <-- Modified: template engine, CLAUDE.md parser  |
|  |  +-- tools/      | <-- Modified: new coherence tools                |
|  |  +-- registry/   | <-- Modified: template-aware scanning            |
|  +------------------+                                                  |
|                                                                        |
|  NEW (v1.2)                                                            |
|                                                                        |
|  +------------------+  +------------------+  +----------------+        |
|  | templates/       |  | vault/coherence/ |  | tools/         |        |
|  | doc-structure/   |  | (new submodule)  |  | (new tools)    |        |
|  | (standard doc    |  | context-delegate |  | validate-      |        |
|  |  templates per   |  | claude-md-parser |  |  coherence     |        |
|  |  domain section) |  | template-engine  |  | generate-      |        |
|  +------------------+  +------------------+  |  claude-md     |        |
|       |                      |               | audit-docs     |        |
|  Lives as static     Processes CLAUDE.md     +----------------+        |
|  .md files in        files during vault           |                    |
|  mcp-server/src/     sync pipeline           New MCP tool              |
|  templates/                                  registrations             |
+-----------------------------------------------------------------------+
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **templates/** (NEW) | Standard documentation structure templates by domain section (architecture, testing, UI, data, cross-cutting). These are reference templates that define what a well-structured doc looks like at each layer. | Static `.md` template files under `mcp-server/src/templates/`. Loaded by the template engine at runtime. Not compiled TypeScript -- pure markdown with placeholder tokens. |
| **vault/coherence/** (NEW) | Three coherence processing components: (1) CLAUDE.md parser that extracts sections, cross-references, and delegation directives; (2) template comparator that checks doc structure against standard templates; (3) context delegation resolver that validates L0/L1/L2 cross-references. | New TypeScript files in `mcp-server/src/vault/`. Plugs into the existing collector->transformer pipeline. |
| **tools/ (new tools)** (NEW) | Three new MCP tools: `validate-coherence` checks doc structure against templates, `generate-claude-md` scaffolds CLAUDE.md from project analysis, `audit-docs` finds stale/missing/duplicate docs across layers. | New tool registration files following the existing pattern: `registerXxxTool(server, rateLimiter)`. |
| **collector.ts** (MODIFIED) | Extended to collect standard template files as a new source type and to detect CLAUDE.md cross-layer references during collection. | New `collectGlobs` entry for template files. New `classifyFile` case for template source type. Small additions, no structural change. |
| **transformer.ts** (MODIFIED) | Extended to inject cross-layer delegation metadata into CLAUDE.md vault entries. When a CLAUDE.md says "See L0 patterns for..." the transformer annotates the vault entry with those cross-references for MOC generation. | New sourceType handling in `transformSource()`. Cross-reference extraction from content. |

## Recommended Project Structure

### New Files and Modifications

```
mcp-server/
  src/
    templates/                             # NEW: Standard doc structure templates
      doc-structure/                       # Domain-specific templates
        architecture.md                    # Template for architecture docs
        testing.md                         # Template for testing docs
        ui.md                              # Template for UI docs
        data.md                            # Template for data layer docs
        cross-cutting.md                   # Template for cross-cutting docs
        claude-md.md                       # Template for CLAUDE.md structure
      template-registry.ts                 # NEW: Template loading and matching

    vault/
      claude-md-parser.ts                  # NEW: Parse CLAUDE.md structure
      context-delegate.ts                  # NEW: Resolve cross-layer references
      coherence-checker.ts                 # NEW: Compare docs against templates
      collector.ts                         # MODIFIED: template collection support
      transformer.ts                       # MODIFIED: cross-ref injection
      types.ts                             # MODIFIED: new source types + interfaces
      moc-generator.ts                     # MODIFIED: cross-layer reference MOC

    tools/
      validate-coherence.ts                # NEW: MCP tool
      generate-claude-md.ts                # NEW: MCP tool
      audit-docs.ts                        # NEW: MCP tool
      index.ts                             # MODIFIED: register 3 new tools

    registry/
      types.ts                             # MODIFIED: new metadata fields

  tests/
    unit/
      vault/
        claude-md-parser.test.ts           # NEW
        context-delegate.test.ts           # NEW
        coherence-checker.test.ts          # NEW
      tools/
        validate-coherence.test.ts         # NEW
        generate-claude-md.test.ts         # NEW
        audit-docs.test.ts                 # NEW
      templates/
        template-registry.test.ts          # NEW
```

### Structure Rationale

- **templates/ inside mcp-server/src/**: Templates are runtime data consumed by the MCP server's coherence tools. They ship with the server, not as standalone files. This avoids a separate build step and keeps templates versioned with the tool that uses them.
- **vault/ gets new files, not a subdirectory**: The existing vault/ module has flat organization (collector, transformer, types, etc.). Adding 3 new files maintains consistency. A `coherence/` subdirectory would only be warranted if the files grew beyond 6-7 modules, which is unlikely.
- **tools/ follows existing pattern**: Each new tool gets its own file with the `registerXxxTool(server, rateLimiter)` signature. This matches all 12 existing tools and keeps the index.ts registration aggregator clean.

## Architectural Patterns

### Pattern 1: Pipeline Extension (Collector -> Transformer -> Writer)

**What:** The existing vault sync pipeline is a linear data pipeline. v1.2 extends it by adding new processing stages without changing the pipeline structure.

**When to use:** Adding new capabilities that process source files through the same collect->transform->write flow.

**Trade-offs:**
- (+) No structural change to existing code
- (+) New processing is additive, not invasive
- (-) Must respect existing type contracts (VaultSource, VaultEntry)
- (-) Pipeline stages run sequentially, adding stages adds latency

**Integration points for v1.2:**

```
collectAll()                    transformAll()              generateAllMOCs()
    |                               |                           |
    v                               v                           v
[L0 sources]    ---------->   [VaultEntry[]   ---------->  [MOC pages]
[L1 sources]    (existing)     with enriched   (existing)   (existing +
[L2 sources]                   frontmatter)                  new cross-
[templates]     <-- NEW                                      layer MOC)
                               [cross-layer    <-- NEW
                                refs injected]
```

The key insight: templates are collected as VaultSources (new sourceType `"template"`), transformed into VaultEntries, and written to the vault. The coherence checker reads templates at check-time, not sync-time. This separation keeps the pipeline clean.

### Pattern 2: CLAUDE.md as Structured Document

**What:** Treat CLAUDE.md files not as opaque markdown blobs but as structured documents with parseable sections, cross-layer references, and machine-readable delegation directives.

**When to use:** When building tools that need to understand, validate, or generate CLAUDE.md files across the ecosystem.

**Trade-offs:**
- (+) Enables programmatic validation and generation
- (+) Makes cross-layer references discoverable
- (-) Requires a parser that handles markdown section structure
- (-) CLAUDE.md format is not standardized by Anthropic; our structure is a convention

**Structure convention for CLAUDE.md files:**

```markdown
# [Project Name]

[1-2 line project description]

## Critical Rules              <-- Required section
[Non-negotiable rules]

## Build Commands              <-- Required section
[How to build/test]

## Architecture                <-- Required for L2 apps
[Module structure, patterns]

## Context Delegation          <-- NEW: Required for L1/L2
### From L0 (AndroidCommonDoc)
- Pattern docs: See ~/.claude/docs/ for [specific patterns]
- Skills: Available via MCP server

### From L1 (shared-kmp-libs)  <-- Only in L2 CLAUDE.md
- Module catalog: [reference to L1 CLAUDE.md]
- Version authority: shared-kmp-libs

## [Domain-Specific Sections]  <-- Project-specific
```

**Parser output type:**

```typescript
interface ClaudeMdStructure {
  projectName: string;
  sections: Map<string, string>;        // section heading -> content
  requiredSections: string[];           // which sections are present
  crossReferences: CrossLayerRef[];     // parsed delegation directives
  layer: Layer;                         // inferred from content/config
}

interface CrossLayerRef {
  fromLayer: Layer;
  toLayer: Layer;
  targetProject: string;
  referenceType: "pattern" | "module" | "convention" | "skill";
  description: string;
}
```

### Pattern 3: Template-Based Validation (Not Generation)

**What:** Templates define the expected structure of documentation. The coherence checker compares actual docs against templates and reports deviations. Templates do NOT auto-generate docs -- they inform validation.

**When to use:** Checking whether existing documentation follows the standard structure, identifying missing sections, detecting structural drift.

**Trade-offs:**
- (+) Non-destructive: never modifies existing docs
- (+) Templates are version-controlled and evolve with the toolkit
- (+) Validation results are actionable by humans or agents
- (-) Templates must be maintained as a separate artifact
- (-) Overly rigid templates discourage documentation creativity

**Validation flow:**

```
Template Registry                  Project Docs
+------------------+              +------------------+
| architecture.md  |   compare    | DawSync/docs/    |
| testing.md       | ----------> | architecture.md  |
| ui.md            |              | testing.md       |
| data.md          |              | (missing!)       |
| cross-cutting.md |              |                  |
| claude-md.md     |              | CLAUDE.md        |
+------------------+              +------------------+
                                         |
                                         v
                                  CoherenceReport {
                                    missingDocs: ["data"],
                                    missingSections: [...],
                                    structureDeviations: [...],
                                    crossRefIssues: [...]
                                  }
```

## Data Flow

### Coherence Validation Flow (New)

```
[Agent calls validate-coherence tool]
    |
    v
[Load template registry]
    |
    v
[Discover project docs via existing project-discovery]
    |
    v
[Parse CLAUDE.md files via claude-md-parser]
    |
    v
[Compare each project's docs against templates via coherence-checker]
    |
    v
[Resolve cross-layer references via context-delegate]
    |
    v
[Return CoherenceReport as structured JSON]
```

### CLAUDE.md Generation Flow (New)

```
[Agent calls generate-claude-md tool with project path]
    |
    v
[Scan project structure (build files, source dirs, existing docs)]
    |
    v
[Load claude-md.md template]
    |
    v
[Populate template sections from project analysis]
    |
    v
[Insert context delegation section based on project layer]
    |
    v
[Return generated CLAUDE.md content (agent writes to file)]
```

### Vault Sync with Cross-Layer References (Modified Flow)

```
[collectAll() -- existing pipeline]
    |
    v
[collector classifies CLAUDE.md files (existing, no change)]
    |
    v
[transformAll() -- existing pipeline, extended]
    |
    | For claude-md sources:
    |   parse with claude-md-parser
    |   extract cross-layer references
    |   inject into frontmatter as vault_cross_refs
    v
[generateAllMOCs() -- existing pipeline, extended]
    |
    | New MOC page: "Cross-Layer References"
    |   Groups by from-layer -> to-layer
    |   Shows which L2 apps reference which L0 patterns
    v
[writeVault() -- unchanged]
```

### Key Data Flows

1. **Template loading:** Templates are loaded from disk at tool invocation time (not cached globally). The template registry resolves template paths relative to the MCP server's build output directory. Templates are NOT collected into the vault -- they are tooling assets, not documentation.

2. **Cross-layer reference resolution:** When the context-delegate module finds a reference like "See L0 patterns for testing," it resolves the reference against the pattern registry (existing `resolveAllPatterns()`) and reports whether the referenced pattern exists, is current, and matches expectations.

3. **Coherence report aggregation:** Each project produces its own `ProjectCoherenceReport`. The `validate-coherence` tool aggregates these into an `EcosystemCoherenceReport` that shows cross-project issues (e.g., L1 defines a convention that L2 CLAUDE.md files don't reference).

## Integration Points with Existing Modules

### Internal Boundaries

| Boundary | Communication | Changes Required |
|----------|---------------|------------------|
| **New tools -> vault/coherence modules** | Direct function calls (same process) | New imports in tool files; functions exported from coherence modules |
| **claude-md-parser -> registry/resolver** | `resolveAllPatterns()` to validate cross-refs | No change to resolver; parser calls existing API |
| **coherence-checker -> template-registry** | `loadTemplate(domain)` returns template content | New module; no existing dependency |
| **collector -> templates/** | `classifyFile()` extended for template paths | Small switch case addition in collector.ts |
| **transformer -> claude-md-parser** | `parseClaudeMdStructure()` for cross-ref extraction | New import; new branch in transformSource() |
| **moc-generator -> context-delegate** | Cross-layer ref data passed as VaultEntry metadata | MOC reads from entry.frontmatter.vault_cross_refs |
| **tools/index.ts -> new tool modules** | `registerXxxTool()` calls in registerTools() | 3 new import + registration lines |
| **vault/types.ts** | New types: ClaudeMdStructure, CrossLayerRef, CoherenceReport | Additive type definitions, no breaking changes |

### External Service Integration

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| **Filesystem (CLAUDE.md files)** | Read via `readFile()` from project paths resolved by `discoverProjects()` | Existing pattern; no new FS access patterns needed |
| **~/.androidcommondoc/vault-config.json** | Read via existing `loadVaultConfig()` | No changes to config schema required for v1.2 |
| **~/.claude/CLAUDE.md** | Read as the shared root CLAUDE.md | New read target, but uses standard `readFile()` |

## Detailed Component Design

### 1. claude-md-parser.ts

**Purpose:** Parse a CLAUDE.md file into a structured representation.

**Input:** Raw markdown string (content of a CLAUDE.md file).

**Output:** `ClaudeMdStructure` with sections, cross-references, and layer inference.

**Key design decisions:**
- Uses regex-based heading extraction (not a full markdown AST parser). CLAUDE.md files are simple markdown with `##` sections. A full AST parser (remark, unified) would add dependencies for minimal benefit.
- Cross-layer references are detected by scanning for patterns like "See L0", "From L1", "shared-kmp-libs", "AndroidCommonDoc patterns". These are heuristic but sufficient because CLAUDE.md files are authored by the developer (us) with known conventions.
- Layer inference: if a project is in vault-config.json, use its layer. Otherwise infer from content (mentions of "shared-kmp-libs" conventions -> L1, app-specific content -> L2).

**Dependencies:** None on existing modules (pure parsing function). Optionally takes layer hint from caller.

### 2. context-delegate.ts

**Purpose:** Validate that cross-layer references in CLAUDE.md files resolve correctly.

**Input:** Array of `CrossLayerRef` objects from parsed CLAUDE.md files.

**Output:** `DelegationReport` listing valid refs, broken refs (target pattern/module not found), and stale refs (target exists but has changed significantly).

**Key design decisions:**
- Calls `resolveAllPatterns()` from the existing registry to check L0 pattern references.
- Calls `discoverProjects()` to resolve L1/L2 project references.
- Does NOT modify any files. Reports issues that the agent or developer acts on.
- Stale detection: if a referenced pattern's `last_updated` is newer than the referencing CLAUDE.md's git commit date, flag as potentially stale. This is approximate but useful.

**Dependencies:** `registry/resolver.ts`, `registry/project-discovery.ts`, `vault/config.ts`.

### 3. coherence-checker.ts

**Purpose:** Compare a project's documentation against standard templates to find structural gaps.

**Input:** Project path + template registry.

**Output:** `CoherenceReport` listing missing docs, missing sections within existing docs, and structural deviations.

**Key design decisions:**
- Templates define required and optional sections. A "required" section missing from a project's doc is a finding. An "optional" section missing is informational.
- Section matching is heading-based (e.g., template says `## Architecture` -> check if project doc has `## Architecture`). Content within sections is NOT validated (that would require semantic understanding beyond this tool's scope).
- Layer-aware: different templates apply to different layers. L0 templates check pattern doc structure. L1 templates check ecosystem convention docs. L2 templates check app-specific docs.

**Dependencies:** `templates/template-registry.ts`, filesystem access to project docs.

### 4. template-registry.ts

**Purpose:** Load and serve standard doc structure templates.

**Input:** Domain name (e.g., "architecture", "testing", "claude-md").

**Output:** Parsed template with section definitions.

**Key design decisions:**
- Templates are markdown files with a YAML frontmatter block that declares required_sections, optional_sections, and applies_to_layers.
- Loaded at tool invocation time (not cached across invocations). The MCP server is a short-lived subprocess; caching adds complexity without benefit.
- Template path resolution uses the same `getToolkitRoot()` pattern as other modules. Templates live at `<toolkit>/mcp-server/src/templates/doc-structure/`.
- Templates compiled into the build output directory by `tsc` (they are `.md` files, so they need to be copied separately or loaded from the source directory). **Decision: Load from source directory using path resolution relative to toolkit root, not build output.** This avoids a copy step in the build process.

**Dependencies:** `utils/paths.ts` for toolkit root resolution.

### 5. New MCP Tools

#### validate-coherence

**Purpose:** Check documentation structure across the ecosystem against standard templates.

**Input parameters:**
- `project` (optional): Specific project name, or "all" for ecosystem-wide check
- `include_templates` (optional, default false): Include template content in response for agent comparison
- `check_cross_refs` (optional, default true): Validate cross-layer references

**Output:** Structured JSON with `CoherenceReport` for each project.

**Design:** Follows the existing tool pattern. Calls `discoverProjects()` to find projects, `coherence-checker` per project, `context-delegate` for cross-ref validation. Returns aggregated report.

#### generate-claude-md

**Purpose:** Generate a CLAUDE.md scaffold for a project based on analysis and templates.

**Input parameters:**
- `project_path`: Absolute path to the project root
- `layer` (optional): Override layer detection
- `include_delegation` (optional, default true): Include context delegation section

**Output:** Generated CLAUDE.md content as a string. The tool does NOT write the file -- the agent writes it after review. This matches the existing `ingest-content` tool's "never auto-apply" pattern.

**Design:** Scans project for build files (settings.gradle.kts, build.gradle.kts), source directories, existing docs. Populates the claude-md template with discovered information. Inserts context delegation references based on layer.

#### audit-docs

**Purpose:** Find documentation quality issues: stale docs, missing docs at specific layers, duplicate content across layers, orphaned references.

**Input parameters:**
- `project` (optional): Specific project or "all"
- `check_type` (optional): "stale" | "missing" | "duplicate" | "all" (default: "all")

**Output:** Structured JSON with findings categorized by severity.

**Design:** Combines coherence checking with freshness detection (reusing existing `monitor-sources` infrastructure for staleness detection). For duplicate detection, compares doc section content across layers using keyword overlap (similar to `ingest-content`'s `extractKeywords()`).

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 3 projects (current) | Current architecture handles this trivially. Template loading, project scanning, and coherence checking complete in milliseconds. |
| 10-20 projects | Still fine. Project discovery scans sibling directories. Coherence checking is O(projects * templates) which remains fast. |
| 50+ projects | Would need to reconsider project-discovery.ts. Currently scans all siblings of toolkit root. At scale, vault-config.json becomes mandatory (no auto-discover). Template caching might help. Not a concern for current solo developer use case. |

### Scaling Priorities

1. **First bottleneck:** Not performance -- it is template maintenance. As patterns evolve, templates must evolve too. A stale template generates false coherence findings. **Mitigation:** Templates reference pattern doc versions. When patterns update, templates are flagged for review.
2. **Second bottleneck:** Cross-layer reference resolution for many projects. Each project's CLAUDE.md references are resolved independently. For many projects, this means many calls to `resolveAllPatterns()`. **Mitigation:** Cache pattern resolution results within a single tool invocation (already the natural behavior since resolution scans directories and returns arrays).

## Anti-Patterns

### Anti-Pattern 1: Auto-Generating CLAUDE.md Without Review

**What people do:** The generate-claude-md tool writes directly to the project's CLAUDE.md file.
**Why it's wrong:** CLAUDE.md is a critical developer-authored document. Auto-writing risks overwriting manual customizations, injecting incorrect build commands, or producing a file that looks correct but has wrong instructions.
**Do this instead:** Generate content and return it as tool output. The agent or developer reviews and writes the file manually. This is the same pattern used by `ingest-content` ("All suggestions require user review").

### Anti-Pattern 2: Embedding Template Logic in the Transformer

**What people do:** Making the transformer generate coherence reports during vault sync.
**Why it's wrong:** The transformer's job is to convert VaultSource -> VaultEntry. Adding coherence validation makes it a side-effect-heavy operation that slows down sync and produces unexpected output.
**Do this instead:** Keep coherence checking in its own tool (`validate-coherence`). The transformer only extracts cross-layer references for vault frontmatter enrichment -- a lightweight, data-transformation operation.

### Anti-Pattern 3: Templates as Compiled TypeScript

**What people do:** Define templates as TypeScript string literals or template literal functions.
**Why it's wrong:** Templates should be readable markdown that a developer can edit without TypeScript knowledge. Embedding them in code makes maintenance harder and testing messier.
**Do this instead:** Templates are `.md` files loaded at runtime. The template-registry.ts handles loading and parsing. Changes to templates don't require recompilation.

### Anti-Pattern 4: Modifying vault-config.json Schema

**What people do:** Adding v1.2-specific fields (template paths, coherence settings) to vault-config.json.
**Why it's wrong:** vault-config.json is for vault sync configuration (projects, paths, features). Coherence checking is a tooling concern, not a sync concern. Polluting the config schema breaks the single-responsibility principle.
**Do this instead:** Templates are resolved from the toolkit root (fixed location). Coherence tool settings are passed as tool parameters. No config schema changes needed.

## Build Order (Dependency-Aware)

The following build order respects code dependencies. Each phase can be implemented and tested independently.

### Phase 1: Foundation Types and Templates

**What:** New type definitions + static template files.
**Dependencies:** None (additive types in types.ts, new template files).
**Deliverables:**
- `vault/types.ts` additions: `ClaudeMdStructure`, `CrossLayerRef`, `CoherenceReport`, new `VaultSourceType` value `"template"`
- `registry/types.ts` additions: optional cross-ref metadata fields
- `templates/doc-structure/*.md` files (6 templates)
- `templates/template-registry.ts` with `loadTemplate()` and `listTemplates()`
- Tests for template-registry

### Phase 2: CLAUDE.md Parser and Coherence Checker

**What:** Core processing modules.
**Dependencies:** Phase 1 types.
**Deliverables:**
- `vault/claude-md-parser.ts` with `parseClaudeMdStructure()`
- `vault/coherence-checker.ts` with `checkCoherence()`
- Unit tests for both

### Phase 3: Context Delegation Resolver

**What:** Cross-layer reference validation.
**Dependencies:** Phase 2 parser (produces CrossLayerRef[]), existing registry/resolver.
**Deliverables:**
- `vault/context-delegate.ts` with `resolveDelegation()`
- Unit tests

### Phase 4: MCP Tool Registration

**What:** Three new MCP tools wired to Phase 2-3 modules.
**Dependencies:** Phases 1-3 modules.
**Deliverables:**
- `tools/validate-coherence.ts`
- `tools/generate-claude-md.ts`
- `tools/audit-docs.ts`
- `tools/index.ts` updated with 3 new registrations
- Tool-level tests

### Phase 5: Vault Pipeline Integration (Optional)

**What:** Extend collector/transformer/MOC to surface cross-layer refs in the vault.
**Dependencies:** Phases 1-3 modules, existing vault pipeline.
**Deliverables:**
- `collector.ts` small modification (template source type classification)
- `transformer.ts` extended for cross-ref frontmatter injection
- `moc-generator.ts` new "Cross-Layer References" MOC page
- Integration tests

**Note:** Phase 5 is optional for the v1.2 milestone. The MCP tools (Phases 1-4) deliver the primary value. Vault integration enriches the Obsidian experience but is not blocking.

## Files Changed vs Files Created

### New Files (11 source + 13 test)

| File | Purpose |
|------|---------|
| `src/templates/doc-structure/architecture.md` | Standard architecture doc template |
| `src/templates/doc-structure/testing.md` | Standard testing doc template |
| `src/templates/doc-structure/ui.md` | Standard UI doc template |
| `src/templates/doc-structure/data.md` | Standard data layer doc template |
| `src/templates/doc-structure/cross-cutting.md` | Standard cross-cutting doc template |
| `src/templates/doc-structure/claude-md.md` | Standard CLAUDE.md structure template |
| `src/templates/template-registry.ts` | Template loading and matching |
| `src/vault/claude-md-parser.ts` | CLAUDE.md structural parser |
| `src/vault/context-delegate.ts` | Cross-layer reference resolver |
| `src/vault/coherence-checker.ts` | Doc structure vs template comparator |
| `src/tools/validate-coherence.ts` | MCP tool: coherence validation |
| `src/tools/generate-claude-md.ts` | MCP tool: CLAUDE.md scaffolding |
| `src/tools/audit-docs.ts` | MCP tool: doc quality audit |

### Modified Files (5 source)

| File | Change | Scope |
|------|--------|-------|
| `src/vault/types.ts` | Add `ClaudeMdStructure`, `CrossLayerRef`, `CoherenceReport` interfaces; add `"template"` to `VaultSourceType` | Additive only, ~40 lines |
| `src/tools/index.ts` | Import and register 3 new tools | 6 lines (3 imports + 3 registerTool calls) |
| `src/vault/collector.ts` | Add `"template"` case to `classifyFile()` | ~5 lines |
| `src/vault/transformer.ts` | Extract cross-refs for claude-md sources, inject into frontmatter | ~20 lines in transformSource() |
| `src/vault/moc-generator.ts` | Add `generateCrossLayerRefMOC()` to `generateAllMOCs()` | ~40 lines new function + 1 line in array |

### Unchanged Files (All Other Existing Files)

All existing tools, registry modules, resources, prompts, utilities, and test files remain unchanged. The v1.2 changes are strictly additive.

## Sources

- Existing codebase analysis (HIGH confidence): All integration points verified by reading current source files
- v1.1 architecture research (`.planning/research/ARCHITECTURE.md` from v1.1): Confirmed module boundaries and patterns
- MCP SDK documentation (verified via current `package.json` dependency: `@modelcontextprotocol/sdk: 1.27.1`): Tool registration patterns confirmed
- Vault pipeline architecture (verified via source): `collectAll() -> transformAll() -> generateAllMOCs() -> writeVault()` pipeline structure confirmed
- CLAUDE.md format conventions (verified via `~/.claude/CLAUDE.md`, `shared-kmp-libs/CLAUDE.md`, `DawSync/CLAUDE.md`): Current structure documented and used as basis for template design

---
*Architecture research for: Documentation Coherence & Context Management (v1.2)*
*Researched: 2026-03-14*
