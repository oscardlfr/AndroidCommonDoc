# Phase 12: Ecosystem Vault Expansion - Research

**Researched:** 2026-03-14
**Domain:** TypeScript vault pipeline refactoring -- L0/L1/L2 hierarchy-aware collection, configurable project schemas, sub-project support, MOC ecosystem groupings
**Confidence:** HIGH

## Summary

Phase 12 expands the existing Phase 11 Obsidian vault sync pipeline from a flat collector into a layer-aware ecosystem knowledge hub. The codebase is entirely TypeScript (MCP server at `mcp-server/src/vault/`), uses Vitest for testing, and follows established patterns: SHA-256 content hashing, manifest-based orphan detection, forward-slash normalization, zone-based text protection for wikilinks.

The core challenge is **refactoring existing working code** rather than greenfield development. The current `VaultConfig` uses `projects: string[]` and must become `projects: ProjectConfig[]` with rich per-project metadata (layer, collectGlobs, excludeGlobs, features, sub-projects). The collector currently has hardcoded collection functions (`collectPatternDocs`, `collectL1Docs`, `collectSkills`, `collectProjectKnowledge`) that must be generalized into a configurable glob-based collection engine that understands L0/L1/L2 hierarchy. The vault output directory structure changes from flat (`patterns/`, `skills/`, `projects/`) to layer-first (`L0-generic/`, `L1-ecosystem/`, `L2-apps/`). All 7 existing vault unit test files and the integration test must be rewritten for the new structure.

**Primary recommendation:** Start with a doc audit plan (scan DawSync and shared-kmp-libs for layer misplacements), then do the breaking VaultConfig schema change and types, then refactor the collector with glob-based collection, then update the vault writer + transformer for layer-first paths, then update MOC generator for ecosystem-aware groupings, then update MCP tools + find-pattern, then rewrite all tests.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Layer-first vault structure**: Top-level directories organized by L0/L1/L2 (not flat patterns/skills/projects)
- **_vault-meta/ stays at root**: Infrastructure (manifest, README) alongside 00-MOC/ at vault root
- **Auto-generated Home.md**: Root-level entry point with ecosystem overview, MOC links, project count, last sync date
- **Clean slate migration**: First sync with new structure does full clean + rebuild
- **Docs/AI/planning subdivision**: Authored docs (docs/), AI instruction files (ai/), planning files (planning/) in separate subdirectories within each project
- **Override visibility**: Both L0 original AND L1/L2 overrides appear in vault. User wants visual identification of overrides
- **Everything discoverable for L1**: Collect all .md files from shared-kmp-libs root + docs/ + module-level READMEs
- **Configurable per-project layer assignment**: Each project in vault-config.json declares its layer (L1 or L2)
- **Version catalog as reference doc**: Configurable opt-in feature -- parse libs.versions.toml and generate readable reference page
- **Consistent doc format across all layers**: Same structure for L0, L1, L2 docs
- **Configurable per project globs**: Each project declares its own collection globs in vault-config.json
- **Distinct vault_type taxonomy**: reference/docs/architecture types
- **Breaking change to VaultConfig**: projects: string[] -> rich objects. No backward compatibility needed
- **Both auto-detect + config for sub-projects**: Auto-detect nested repos/build files. Config can add/exclude sub-projects
- **Nested under parent in vault**: Sub-projects get sub-projects/ subdirectory under parent
- **Independent collection globs for sub-projects**: Own collectGlobs/excludeGlobs
- **Configurable scan depth**: How deep to scan for nested sub-projects
- **Nested in MOC pages**: Sub-projects listed under parent project headers
- **Descriptive sublabels in By Layer MOC**: L0 = "Generic Patterns", L1 = "Ecosystem (shared-kmp-libs)", L2 = "App-Specific"
- **L2 grouped by project**: App entries under L2 grouped by project with sub-headers
- **Doc audit as first plan**: Phase 12 starts with a doc layer audit
- **Token-efficient, spec-driven format**: All docs optimized for AI context consumption
- **find-pattern ecosystem-aware queries**: Update find-pattern to support "give me all patterns for DawSync" = L0 + L1 + L2-DawSync
- **Rewrite tests**: Clean rewrite of all vault tests for layer-first structure
- **Vault for humans, MCP for agents**: Both systems understand L0/L1/L2 the same way

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

### Deferred Ideas (OUT OF SCOPE)
- **WakeTheCave and OmniSound full integration** -- Focus on DawSync + shared-kmp-libs + AndroidCommonDoc
- **Automatic doc generation for shared-kmp-libs modules** -- Audit may create stubs but comprehensive API docs are separate
- **Bidirectional vault editing** -- Still deferred (conflict resolution complexity)
- **Automatic file watcher sync** -- Still deferred (process management complexity)
- **NotebookLM API integration** -- Still deferred (requires enterprise license)
- **Full repository architecture optimization** -- v1.2 initiative
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ECOV-01 | shared-kmp-libs conventions/docs collected as L1 ecosystem layer (separate from L0 generic patterns) | VaultConfig.projects gets layer field; collector uses glob-based scanning of shared-kmp-libs root/docs/module READMEs; L1 output path under L1-ecosystem/ |
| ECOV-02 | App-specific docs (DawSync/docs/, etc.) collected as L2 with domain tagging | ProjectConfig with layer:"L2", collectGlobs for docs/; tag-generator adds domain tags; transformer routes to L2-apps/{project}/ |
| ECOV-03 | Architecture docs (.planning/codebase/) collected per project for cross-project reference | collectGlobs includes `.planning/codebase/**/*.md` by default; new vault_type "architecture"; output under {layer}/{project}/planning/ |
| ECOV-04 | Sub-project support: DawSync/SessionRecorder-VST3 docs appear as nested project in vault | SubProjectConfig type with auto-detect + manual config; nested under parent at L2-apps/DawSync/sub-projects/SessionRecorder-VST3/ |
| ECOV-05 | Vault structure reflects L0/L1/L2 hierarchy visually (not flat) | Top-level L0-generic/, L1-ecosystem/, L2-apps/ directories; vault-writer creates layer-first paths; clean-slate migration removes old structure |
| ECOV-06 | MOC pages updated with ecosystem-aware groupings (By Layer shows L0 generic vs L1 ecosystem vs L2 app-specific) | MOC generator refactored with descriptive sublabels, per-project L2 grouping, sub-project nesting, Home.md generation |
| ECOV-07 | Configurable collection globs per project in vault-config.json (what to collect beyond defaults) | ProjectConfig.collectGlobs/excludeGlobs fields; glob expansion using Node.js fs.glob or manual directory walk; per-project collection pipeline |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ^5.7.0 | Language for all vault pipeline code | Already in use across entire MCP server |
| Vitest | ^3.0.0 | Test framework with globals mode | Already configured in vitest.config.ts |
| yaml | ^2.8.2 | YAML frontmatter parsing and generation | Already used by registry/frontmatter.ts and transformer.ts |
| zod | ^3.24.0 | Schema validation for MCP tool inputs | Already used across all MCP tools |
| node:fs/promises | built-in | Filesystem operations | Already used everywhere, no external deps needed |
| node:crypto | built-in | SHA-256 content hashing | Already used by vault-writer.ts |
| node:path | built-in | Cross-platform path operations | Already used everywhere |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @modelcontextprotocol/sdk | 1.27.1 | MCP tool registration | Updating sync-vault and vault-status tools |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual glob expansion | globby/fast-glob npm | Adds dependency; Node 22+ has `fs.glob` but engine requirement is >=18; manual recursive walk is sufficient for this use case |
| TOML parser for version catalog | @iarna/toml npm | Adds dependency; simple regex/line parsing of libs.versions.toml is sufficient for generating a reference page |

**Installation:**
```bash
# No new dependencies needed -- all libraries are already installed
cd mcp-server && npm install
```

## Architecture Patterns

### Recommended Project Structure (New Vault Output)
```
kmp-knowledge-vault/
├── .obsidian/                    # Obsidian config
├── _vault-meta/                  # Infrastructure (manifest, README)
│   ├── sync-manifest.json
│   └── README.md
├── 00-MOC/                       # Map of Content index pages
│   ├── Home.md                   # NEW: Auto-generated entry point
│   ├── All Patterns.md
│   ├── By Layer.md               # REFACTORED: L0/L1/L2 with sublabels
│   ├── By Project.md             # REFACTORED: ecosystem-aware groupings
│   ├── By Target Platform.md
│   ├── All Skills.md
│   └── All Decisions.md
├── L0-generic/                   # NEW: Layer-first top-level
│   ├── patterns/                 # L0 pattern docs from AndroidCommonDoc/docs/
│   ├── skills/                   # L0 skills from AndroidCommonDoc/skills/
│   └── AndroidCommonDoc/         # AndroidCommonDoc's own project knowledge
│       ├── ai/                   # CLAUDE.md, AGENTS.md
│       ├── docs/                 # Authored docs
│       └── planning/             # PROJECT.md, decisions
├── L1-ecosystem/                 # NEW: shared-kmp-libs layer
│   └── shared-kmp-libs/
│       ├── ai/                   # CLAUDE.md
│       ├── docs/                 # shared-kmp-libs/docs/*.md, module READMEs
│       └── planning/             # Architecture docs if any
├── L2-apps/                      # NEW: App-specific layer
│   ├── DawSync/
│   │   ├── ai/                   # CLAUDE.md, AGENTS.md
│   │   ├── docs/                 # DawSync/docs/ (non-archive)
│   │   ├── planning/             # .planning/codebase/ architecture docs
│   │   └── sub-projects/
│   │       ├── SessionRecorder-VST3/
│   │       │   ├── docs/         # README.md, TESTING.md, etc.
│   │       │   └── ...
│   │       └── DawSyncWeb/       # External sub-project
│   │           ├── docs/
│   │           └── ...
│   └── ...                       # WakeTheCave, OmniSound (future)
```

### Pattern 1: VaultConfig Schema Evolution
**What:** Breaking change from `projects: string[]` to `projects: ProjectConfig[]`
**When to use:** First implementation step -- types drive everything else

```typescript
// New VaultConfig types (in vault/types.ts)

export interface SubProjectConfig {
  /** Display name for vault (e.g., "SessionRecorder-VST3") */
  name: string;
  /** Relative path from parent project root, or absolute path for external sub-projects */
  path: string;
  /** Override collection globs (inherits parent if not set) */
  collectGlobs?: string[];
  /** Override exclusion globs */
  excludeGlobs?: string[];
}

export interface ProjectConfig {
  /** Display name for vault (e.g., "DawSync") */
  name: string;
  /** Absolute path to project root */
  path: string;
  /** Layer assignment: L1 for ecosystem libs, L2 for consumer apps */
  layer: "L1" | "L2";
  /** Glob patterns for files to collect (relative to project root) */
  collectGlobs?: string[];
  /** Glob patterns for files to exclude */
  excludeGlobs?: string[];
  /** Optional sub-project definitions */
  subProjects?: SubProjectConfig[];
  /** Feature flags for this project */
  features?: {
    /** Parse libs.versions.toml and generate reference page */
    versionCatalog?: boolean;
    /** Max depth for auto-detecting nested sub-projects */
    subProjectScanDepth?: number;
  };
}

export interface VaultConfig {
  /** Absolute path to the Obsidian vault directory. */
  vaultPath: string;
  /** Rich project configuration. Empty array = auto-discover. */
  projects: ProjectConfig[];
  /** Whether to remove vault files no longer present in source repos. */
  autoClean: boolean;
  /** ISO 8601 timestamp of the last sync. */
  lastSync?: string;
}
```

### Pattern 2: Glob-Based Collection Pipeline
**What:** Replace hardcoded collection functions with configurable glob-based collection
**When to use:** For each project, apply its collectGlobs to gather .md files

```typescript
// Collector pattern for each project
async function collectProjectDocs(
  project: ProjectConfig,
): Promise<VaultSource[]> {
  const globs = project.collectGlobs ?? getDefaultGlobs(project.layer);
  const excludes = project.excludeGlobs ?? getDefaultExcludes();
  const sources: VaultSource[] = [];

  for (const glob of globs) {
    const files = await expandGlob(project.path, glob, excludes);
    for (const file of files) {
      const vaultType = classifyFile(file, project);
      const relativePath = buildLayerPath(file, project, vaultType);
      sources.push({
        filepath: file.absolutePath,
        content: file.content,
        metadata: file.frontmatter,
        sourceType: vaultType,
        project: project.name,
        layer: project.layer,
        relativePath,
      });
    }
  }

  return sources;
}
```

### Pattern 3: Layer-First Path Builder
**What:** Route files to layer-first vault paths based on project layer and file classification
**When to use:** In the transformer when building VaultEntry.vaultPath

```typescript
// Path construction logic
function buildLayerPath(
  file: CollectedFile,
  project: ProjectConfig,
  vaultType: VaultSourceType,
): string {
  const layerDir = project.layer === "L1" ? "L1-ecosystem" : "L2-apps";
  const subdivision = getSubdivision(vaultType); // "ai" | "docs" | "planning"

  // Example: "L2-apps/DawSync/docs/PRODUCT_SPEC.md"
  return `${layerDir}/${project.name}/${subdivision}/${file.relativeName}`;
}
```

### Pattern 4: Sub-Project Auto-Detection
**What:** Scan project directories for nested sub-projects based on build file signals
**When to use:** When project.features.subProjectScanDepth > 0 or sub-project detection enabled

```typescript
// Sub-project detection signals
const SUB_PROJECT_SIGNALS = [
  "CMakeLists.txt",      // C/C++ projects (SessionRecorder-VST3)
  "build.gradle.kts",    // Kotlin/Android sub-modules
  "package.json",        // Node.js/Web projects (DawSyncWeb)
  "Cargo.toml",          // Rust projects
  ".git",                // Git submodules
];

async function detectSubProjects(
  projectPath: string,
  maxDepth: number = 2,
): Promise<SubProjectConfig[]> {
  // Scan immediate children for build file signals
  // Filter out: build/, .gradle/, node_modules/, etc.
  // Return as SubProjectConfig[] with inferred names and paths
}
```

### Pattern 5: Clean-Slate Migration
**What:** First sync with new structure does full clean + rebuild
**When to use:** initVault detects old structure (presence of `patterns/` or `projects/` at vault root without `L0-generic/`)

```typescript
async function migrateToLayerFirst(vaultPath: string): Promise<void> {
  // 1. Detect old structure: check for patterns/, skills/, projects/ at root
  // 2. Remove all old content files (preserve .obsidian/ user customizations)
  // 3. Clear manifest (force full rebuild)
  // 4. Proceed with normal init pipeline
}
```

### Anti-Patterns to Avoid
- **Merging old and new structures:** Do NOT try to migrate individual files from flat to layer-first. Clean slate is cleaner and nobody uses the vault yet.
- **Hardcoded project paths in collector:** Do NOT add `if (project === "shared-kmp-libs")` branches. Use the configurable glob system for all projects.
- **Nested module scanning without depth limits:** shared-kmp-libs has 30+ modules. Without scan depth limits, you recursively scan build directories.
- **Slug collisions across layers:** Two layers may have a `testing.md`. Use layer-qualified slugs or directory-qualified wikilinks to prevent collisions.
- **Importing from registry resolver in collector:** The vault collector and registry resolver serve different purposes. Keep them separate; align the L0/L1/L2 mental model but don't couple the implementations.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Glob pattern matching | Custom regex-based file scanner | `node:fs` recursive readdir + minimatch-style filtering | Glob patterns have edge cases (negation, brace expansion) that are tricky to implement correctly |
| TOML parsing for version catalog | Full TOML parser | Line-by-line parsing of `[versions]`/`[libraries]` sections | libs.versions.toml is structured simply; a full parser is overkill for extracting version info |
| YAML frontmatter | Custom frontmatter extractor | Existing `parseFrontmatter` from registry/frontmatter.ts | Already battle-tested in Phase 9-11 |
| SHA-256 hashing | Custom implementation | Existing `computeHash` from vault-writer.ts | Already working, uses node:crypto |
| Project discovery | New discovery system | Extend existing `discoverProjects` from registry/project-discovery.ts | Proven infrastructure from Phase 9; extend with layer detection |
| Wikilink injection | Layer-specific wikilink logic | Extend existing `injectWikilinks` with layer-qualified slug pool | Zone-based protection already handles edge cases |

**Key insight:** Phase 12 is primarily a REFACTOR of Phase 11 code, not greenfield. The existing vault pipeline works end-to-end. The refactoring adds layer awareness, configurable collection, and sub-project nesting while preserving the proven SHA-256 hashing, manifest tracking, and zone-based wikilink protection.

## Common Pitfalls

### Pitfall 1: Slug Collisions Across Layers
**What goes wrong:** Both L0 and L1 have a `testing.md`. Wikilinks to `[[testing]]` become ambiguous. Obsidian picks whichever file it finds first.
**Why it happens:** Current slug derivation is `path.basename(relativePath, ".md")` without layer qualification.
**How to avoid:** For files in L0-generic/patterns/, use the existing slug. For L1/L2 files, prefix with project name: `shared-kmp-libs-TESTING_STRATEGY` or use full path-based slugs. Alternatively, use `[[L1-ecosystem/shared-kmp-libs/docs/TESTING_STRATEGY|TESTING_STRATEGY]]` display-text wikilinks.
**Warning signs:** Two vault entries with the same slug value in different layers.

### Pitfall 2: Windows Path Separators in Glob Matching
**What goes wrong:** Glob patterns like `docs/**/*.md` don't match on Windows because `fs.readdir` returns backslash separators.
**Why it happens:** Node.js on Windows uses native path separators. Glob patterns expect forward slashes.
**How to avoid:** Normalize all paths to forward slashes before glob matching (already established in Phase 11 with `normalizePath`). Apply normalization at the earliest point in the pipeline.
**Warning signs:** Tests pass on CI (Linux) but fail locally (Windows).

### Pitfall 3: Collecting Binary/Generated Files from Project Directories
**What goes wrong:** Without proper excludeGlobs, the collector picks up files in `build/`, `node_modules/`, `.gradle/`, `dist/` directories.
**Why it happens:** A naive `**/*.md` glob matches generated documentation in build outputs.
**How to avoid:** Default excludeGlobs must include: `**/build/**`, `**/node_modules/**`, `**/.gradle/**`, `**/dist/**`, `**/archive/**` (DawSync has docs/archive/ with 20+ stale docs).
**Warning signs:** Vault suddenly has 200+ files from build directories.

### Pitfall 4: Breaking Existing Integration Tests
**What goes wrong:** The integration test at `tests/integration/vault-sync.test.ts` imports directly from `vault/sync-engine.ts` and asserts specific vault paths (`patterns/test-pattern.md`). Changing the output structure breaks these without a clean rewrite.
**Why it happens:** Tests were written for the flat structure.
**How to avoid:** Context decision says "rewrite tests". Plan this as a dedicated task. Write new fixtures that exercise the layer-first structure. Do not try to incrementally update old tests.
**Warning signs:** Trying to "update" existing test assertions leads to partial coverage and fragile tests.

### Pitfall 5: VaultConfig Migration Backward Compatibility
**What goes wrong:** Attempting to support both old `projects: string[]` and new `projects: ProjectConfig[]` creates complex branching logic.
**Why it happens:** Defensive programming instinct to not break existing configs.
**How to avoid:** Context explicitly says "no backward compatibility needed -- clean break." The current vault-config.json in production points to a temp directory from testing. Just overwrite with the new schema. Add a version field to VaultConfig for future migrations.
**Warning signs:** `typeof config.projects[0] === "string" ? ... : ...` branches in code.

### Pitfall 6: Over-Collecting from shared-kmp-libs
**What goes wrong:** shared-kmp-libs has 30+ module directories. Collecting all READMEs produces 30+ small files with similar boilerplate structure.
**Why it happens:** Context says "everything discoverable" for L1.
**How to avoid:** Collect all, but apply smart organization. Consider consolidating module READMEs into a single "Module Index" page if individual files are too granular. Also ensure excludeGlobs filters build artifacts. Coverage report files like `coverage-full-report.md` should be excluded.
**Warning signs:** Vault has 30+ nearly-identical "Module X: provides Y" pages.

### Pitfall 7: Sub-Project Detection False Positives
**What goes wrong:** Auto-detection finds `build.gradle.kts` inside `DawSync/core/` or `DawSync/feature/` and treats each as a "sub-project."
**Why it happens:** Android apps have dozens of Gradle modules that are NOT sub-projects in the vault sense.
**How to avoid:** Sub-project detection should only trigger for directories that look like independent projects (have their own docs, README, or are a different technology stack). Gradle sub-modules are NOT sub-projects. Detection signals should require EITHER a `.git` directory, a different build system (CMakeLists.txt in a Gradle project), or explicit config.
**Warning signs:** DawSync shows 20+ "sub-projects" that are actually just Gradle modules.

## Code Examples

### Current VaultConfig (to be replaced)
```typescript
// Source: mcp-server/src/vault/types.ts (current)
export interface VaultConfig {
  vaultPath: string;
  projects: string[];        // <-- This becomes ProjectConfig[]
  autoClean: boolean;
  includeTemplates: boolean;  // <-- Remove (templates not useful for read-only vault)
  lastSync?: string;
}
```

### New VaultConfig (target)
```typescript
// Target: mcp-server/src/vault/types.ts
export interface VaultConfig {
  /** Schema version for future migrations. */
  version: 1;
  /** Absolute path to the Obsidian vault directory. */
  vaultPath: string;
  /** Rich project configuration. Empty array = auto-discover. */
  projects: ProjectConfig[];
  /** Whether to remove vault files no longer present in source repos. */
  autoClean: boolean;
  /** ISO 8601 timestamp of the last sync. */
  lastSync?: string;
}
```

### Default Collection Globs (Claude's Discretion)
```typescript
// Recommended defaults when no collectGlobs configured
function getDefaultGlobs(layer: "L1" | "L2"): string[] {
  return [
    "CLAUDE.md",
    "AGENTS.md",
    "README.md",
    "docs/**/*.md",
    ".planning/PROJECT.md",
    ".planning/STATE.md",
    ".planning/codebase/**/*.md",
  ];
}

function getDefaultExcludes(): string[] {
  return [
    "**/build/**",
    "**/node_modules/**",
    "**/.gradle/**",
    "**/dist/**",
    "**/archive/**",
    "**/.androidcommondoc/**",   // L1 pattern overrides handled separately
    "**/coverage-*.md",          // Coverage report files
  ];
}
```

### File Classification (Claude's Discretion)
```typescript
// Route files to correct vault_type and subdivision
function classifyFile(
  relativePath: string,
  project: ProjectConfig,
): { vaultType: VaultSourceType; subdivision: "ai" | "docs" | "planning" } {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();

  // AI instruction files
  if (normalized === "claude.md" || normalized === "agents.md") {
    return { vaultType: "reference", subdivision: "ai" };
  }

  // Planning/architecture files
  if (normalized.startsWith(".planning/")) {
    return { vaultType: normalized.includes("codebase/") ? "architecture" : "planning", subdivision: "planning" };
  }

  // Everything else is docs
  return { vaultType: "docs", subdivision: "docs" };
}
```

### Home.md Generation (new)
```typescript
// Auto-generated vault entry point
function generateHomeMOC(
  entries: VaultEntry[],
  config: VaultConfig,
): VaultEntry {
  const l0Count = entries.filter(e => e.tags.includes("l0")).length;
  const l1Count = entries.filter(e => e.tags.includes("l1")).length;
  const l2Count = entries.filter(e => e.tags.includes("l2")).length;
  const projectCount = new Set(entries.map(e => e.project).filter(Boolean)).size;

  let content = `# KMP Knowledge Vault\n\n`;
  content += `> Ecosystem documentation hub for Android/KMP development.\n\n`;
  content += `## Overview\n\n`;
  content += `| Layer | Count | Description |\n`;
  content += `|-------|-------|-------------|\n`;
  content += `| L0 Generic | ${l0Count} | Cross-project patterns and skills |\n`;
  content += `| L1 Ecosystem | ${l1Count} | shared-kmp-libs conventions |\n`;
  content += `| L2 Apps | ${l2Count} | App-specific docs across ${projectCount} projects |\n\n`;
  content += `## Navigate\n\n`;
  content += `- [[All Patterns]] - Pattern documents by scope\n`;
  content += `- [[By Layer]] - L0 / L1 / L2 organization\n`;
  content += `- [[By Project]] - Documents grouped by source project\n`;
  content += `- [[All Skills]] - Claude Code skill definitions\n`;
  content += `- [[All Decisions]] - Project planning and decisions\n\n`;
  content += `*Last sync: ${new Date().toISOString().split("T")[0]}*\n`;

  return buildMOC("Home", "Home.md", content);
}
```

## Discretion Recommendations

Based on research of the codebase, project conventions, and the user's stated goals, here are recommendations for Claude's Discretion items:

| Item | Recommendation | Rationale |
|------|---------------|-----------|
| Directory names | `L0-generic/`, `L1-ecosystem/`, `L2-apps/` | Descriptive, sortable, matches CONTEXT.md sublabels |
| AndroidCommonDoc knowledge | Under `L0-generic/AndroidCommonDoc/` | It IS the L0 toolkit; its project knowledge belongs with L0 |
| Detekt rules | Under `L0-generic/tooling/` | Detekt rules are generic tooling from AndroidCommonDoc |
| Override annotation in MOC | Yes, show annotations | User explicitly wants "visual identification of overrides" |
| .obsidian/ config | Init-only, never overwrite on sync | User may customize Obsidian settings; respect their changes |
| Source path breadcrumbs | Add `vault_source_path` to frontmatter | Enables "open in editor" workflows; low cost to add |
| Templates | Remove `includeTemplates` flag | Vault is read-only; templates serve no purpose |
| Slug disambiguation | Layer-prefixed slugs for L1/L2 files, bare slugs for L0 | L0 slugs are the "canonical" names; L1/L2 qualify with project prefix to avoid collisions |
| Default globs | `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/**/*.md`, `.planning/PROJECT.md`, `.planning/codebase/**/*.md` | Covers the key doc locations across all projects |
| Layer detection | Default L2, explicit config for L1 | Only shared-kmp-libs is L1; everything else is L2 by default |
| Module docs | One page per module README (not consolidated) | Each module has distinct content; consolidation loses detail |
| Empty sections | Omit (do not create placeholder files) | Token-efficient, less noise |
| Doc audit format | Generate a report, then execute with user approval | Aligns with "clean, professional, enterprise" preference |
| L0 promotion criteria | Conservative -- only promote patterns confirmed in 2+ projects | Prevents L0 pollution |
| Non-.md conversion | Version catalog only (configurable feature flag) | Convention plugins are too complex; version catalog is simple key-value |
| Missing doc handling | Log warning, skip gracefully | Consistent with existing safeReadFile pattern |
| Sub-project detection | `.git` OR different-build-system (CMakeLists.txt in Gradle project, package.json in Gradle project) | Prevents false positives from Gradle sub-modules |
| Multi-tech sub-projects | Same collection treatment, tech-agnostic | Simpler implementation; user can customize via collectGlobs if needed |
| Vault-status | Add per-layer breakdown | Low effort, high value for ecosystem awareness |
| Sync skill parameters | Add optional `--project` and `--layer` filters | Enables targeted syncs without full rebuild |
| Transformer optimization | Collect as-is, no stripping | User wants "consistent doc format"; transforming content risks losing structure |
| Docs/AI/planning subdivision | Apply to all layers consistently, including L0 | Uniformity is cleaner than special-casing |

## State of the Art

| Old Approach (Phase 11) | New Approach (Phase 12) | Impact |
|--------------------------|-------------------------|--------|
| `projects: string[]` | `projects: ProjectConfig[]` | Rich per-project configuration with layer, globs, sub-projects |
| Flat `patterns/`, `skills/`, `projects/` | Layer-first `L0-generic/`, `L1-ecosystem/`, `L2-apps/` | Visual hierarchy in Obsidian file explorer |
| Hardcoded collection functions | Configurable glob-based collection | Any project can define what gets collected |
| No sub-project support | Auto-detect + config sub-projects | SessionRecorder-VST3, DawSyncWeb appear nested |
| Basic By Layer MOC (L0/L1/L2 list) | Ecosystem-aware MOC with sublabels and groupings | Professional navigation experience |
| No Home.md | Auto-generated entry point | First thing users see when opening the vault |
| Only pattern docs had layer tags | All docs get layer + project + domain tags | Full tag-based filtering in Obsidian |
| Single vault_type map | Extended taxonomy (reference/docs/architecture) | More granular classification for filtering |

## Existing Code Impact Analysis

### Files to Modify

| File | Change Type | Scope |
|------|-------------|-------|
| `vault/types.ts` | **Rewrite** | New VaultConfig, ProjectConfig, SubProjectConfig, extended VaultSourceType, updated VaultSource |
| `vault/config.ts` | **Major refactor** | New defaults, schema validation, auto-discover integration |
| `vault/collector.ts` | **Major refactor** | Glob-based collection, L0/L1/L2 routing, sub-project collection |
| `vault/transformer.ts` | **Moderate refactor** | Layer-first path building, slug disambiguation, new vault_type mapping |
| `vault/moc-generator.ts` | **Major refactor** | Home.md, ecosystem-aware By Layer, project groupings, sub-project nesting |
| `vault/tag-generator.ts` | **Minor update** | Add domain tags, architecture tag |
| `vault/wikilink-generator.ts` | **Minor update** | Layer-qualified slug pool |
| `vault/vault-writer.ts` | **Moderate refactor** | Clean-slate migration, new directory structure |
| `vault/sync-engine.ts` | **Moderate refactor** | Migration detection, new config plumbing, optional project/layer filters |
| `tools/sync-vault.ts` | **Minor update** | New parameters for project/layer filter |
| `tools/vault-status.ts` | **Minor update** | Per-layer breakdown |
| `tools/find-pattern.ts` | **Moderate update** | Ecosystem-aware queries (L0+L1+L2 for a project) |
| `registry/project-discovery.ts` | **Minor update** | Layer detection, sub-project detection |

### Files to Rewrite (Tests)
All 7 unit test files + 1 integration test in `tests/unit/vault/` and `tests/integration/vault-sync.test.ts`.

### New Files to Create
| File | Purpose |
|------|---------|
| `vault/glob-expander.ts` | Glob pattern matching + file discovery utility |
| `vault/sub-project-detector.ts` | Auto-detect nested sub-projects |
| `vault/version-catalog-parser.ts` | Parse libs.versions.toml for reference page generation |
| `vault/home-generator.ts` | Generate Home.md entry point (or integrate into moc-generator) |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^3.0.0 |
| Config file | `mcp-server/vitest.config.ts` |
| Quick run command | `cd mcp-server && npx vitest run tests/unit/vault/` |
| Full suite command | `cd mcp-server && npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ECOV-01 | L1 collection from shared-kmp-libs | unit + integration | `cd mcp-server && npx vitest run tests/unit/vault/collector.test.ts -t "L1"` | Rewrite needed (Wave 0) |
| ECOV-02 | L2 collection with domain tagging | unit | `cd mcp-server && npx vitest run tests/unit/vault/collector.test.ts -t "L2"` | Rewrite needed (Wave 0) |
| ECOV-03 | Architecture docs collection | unit | `cd mcp-server && npx vitest run tests/unit/vault/collector.test.ts -t "architecture"` | Rewrite needed (Wave 0) |
| ECOV-04 | Sub-project detection and nesting | unit | `cd mcp-server && npx vitest run tests/unit/vault/sub-project-detector.test.ts` | New file (Wave 0) |
| ECOV-05 | Layer-first vault output | integration | `cd mcp-server && npx vitest run tests/integration/vault-sync.test.ts -t "layer-first"` | Rewrite needed (Wave 0) |
| ECOV-06 | Ecosystem-aware MOC pages | unit | `cd mcp-server && npx vitest run tests/unit/vault/moc-generator.test.ts` | Rewrite needed (Wave 0) |
| ECOV-07 | Configurable collection globs | unit | `cd mcp-server && npx vitest run tests/unit/vault/collector.test.ts -t "glob"` | Rewrite needed (Wave 0) |

### Sampling Rate
- **Per task commit:** `cd mcp-server && npx vitest run tests/unit/vault/`
- **Per wave merge:** `cd mcp-server && npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/vault/collector.test.ts` -- full rewrite with layer-aware fixtures
- [ ] `tests/unit/vault/config.test.ts` -- rewrite for ProjectConfig schema
- [ ] `tests/unit/vault/transformer.test.ts` -- rewrite for layer-first paths
- [ ] `tests/unit/vault/moc-generator.test.ts` -- rewrite for ecosystem MOCs + Home.md
- [ ] `tests/unit/vault/vault-writer.test.ts` -- rewrite for new directory structure
- [ ] `tests/unit/vault/tag-generator.test.ts` -- update for new tag types
- [ ] `tests/unit/vault/wikilink-generator.test.ts` -- update for layer-qualified slugs
- [ ] `tests/unit/vault/sub-project-detector.test.ts` -- NEW test file
- [ ] `tests/unit/vault/glob-expander.test.ts` -- NEW test file
- [ ] `tests/integration/vault-sync.test.ts` -- full rewrite for layer-first e2e

## Open Questions

1. **ECOV requirements not formally defined in REQUIREMENTS.md**
   - What we know: ROADMAP.md references ECOV-01 through ECOV-07 with success criteria
   - What's unclear: Whether formal requirement definitions should be added to REQUIREMENTS.md first
   - Recommendation: Planner should add ECOV requirements to REQUIREMENTS.md as part of Plan 01 or treat the ROADMAP success criteria as sufficient

2. **shared-kmp-libs has no `.planning/` directory**
   - What we know: shared-kmp-libs has CLAUDE.md, README.md, docs/ with 5 files, and 14+ module READMEs
   - What's unclear: Whether the doc audit should create a `.planning/codebase/` structure for shared-kmp-libs
   - Recommendation: Audit surfaces the gap; creating architecture docs for shared-kmp-libs is a deferred initiative

3. **DawSync docs/archive/ contains 20+ stale documents**
   - What we know: `DawSync/docs/archive/` has GRADLE_PATTERNS.md, ARCHITECTURE.md, etc. that may duplicate L0 patterns
   - What's unclear: Whether archive docs should ever be collected
   - Recommendation: Exclude `archive/` by default via excludeGlobs. Doc audit may flag specific files for promotion.

4. **DawSync's L1 docs directory**
   - What we know: `DawSync/.androidcommondoc/docs/dawsync-domain-patterns.md` already exists as a Phase 9 L1 override
   - What's unclear: Whether existing L1 pattern overrides should appear in the vault alongside the L0 originals
   - Recommendation: Yes -- CONTEXT.md says "both L0 original AND L1/L2 overrides appear in the vault"

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of all 13 vault-related source files in `mcp-server/src/vault/`
- Direct codebase analysis of all 7 vault unit tests + 1 integration test
- Direct analysis of `mcp-server/src/registry/` infrastructure (types, scanner, resolver, project-discovery)
- Direct analysis of `mcp-server/src/tools/` (find-pattern, sync-vault, vault-status)
- Direct filesystem analysis of target projects: shared-kmp-libs (32+ markdown files), DawSync (40+ non-archive docs, 7 architecture docs, SessionRecorder-VST3), DawSyncWeb
- Phase 12 CONTEXT.md decisions gathered 2026-03-14

### Secondary (MEDIUM confidence)
- Project memory: `project_ecosystem_architecture.md` describing L0/L1/L2 model
- STATE.md accumulated decisions from Phases 9-11 about vault patterns

### Tertiary (LOW confidence)
- None. All findings are based on direct codebase analysis.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies; all existing libraries verified in package.json
- Architecture: HIGH - All patterns derived from existing working code + explicit CONTEXT.md decisions
- Pitfalls: HIGH - All pitfalls identified from direct analysis of codebase and target project structures

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable -- internal refactoring, no external dependency changes)