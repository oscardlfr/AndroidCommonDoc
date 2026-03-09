# Phase 9: Pattern Registry & Discovery - Research

**Researched:** 2026-03-13
**Domain:** Pattern document management, YAML frontmatter, MCP server extension, layered configuration resolution
**Confidence:** HIGH

## Summary

Phase 9 extends the existing MCP server (TypeScript, @modelcontextprotocol/sdk 1.27.1, vitest) with a three-layer pattern registry (L0 base / L1 project / L2 user), a `find-pattern` MCP tool for metadata-based discovery, and a token-aware doc optimization pass. The existing codebase provides strong foundations: `docs.ts` already registers 9 pattern docs with `docs://` URIs, `paths.ts` provides toolkit root resolution, and all tools use Zod schemas with rate limiting. The core technical challenge is evolving from a hardcoded `KNOWN_DOCS` list to a dynamic registry that scans directories, parses YAML frontmatter, resolves layers, and filters by metadata -- all while maintaining backward compatibility with the existing `docs://androidcommondoc/{slug}` URI scheme.

The existing 9 pattern docs (5,512 total lines across 10 files) already have informal metadata in blockquote headers (Status, Last Updated, Platforms, Library Versions). These must be converted to YAML frontmatter. The DawSync `.claude/` directory contains project-specific agents and web-quality skills (accessibility, SEO, etc.) -- NOT generic KMP patterns suitable for L0 promotion. The migration task should focus on identifying any generic patterns buried in DawSync's agent definitions (e.g., test-specialist references to runTest, fake patterns) and deciding what becomes L1 vs what stays in DawSync's own `.claude/` scope.

**Primary recommendation:** Use the `yaml` npm package (v2.8.x, ESM-native, built-in TypeScript types) for frontmatter parsing with a simple split-on-`---` utility function. Avoid `gray-matter` (CJS-only, requires interop hacks). Evolve `docs.ts` from hardcoded KNOWN_DOCS to a `RegistryScanner` that discovers docs with valid frontmatter at startup, then use `ResourceTemplate` for dynamic per-project resolution.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Layer resolution behavior**: Full replacement -- L1 doc completely replaces L0 for that pattern. No partial merge, no section-level mixing.
- **Layer priority**: L1 project > L2 user > L0 base -- project consistency wins over personal taste.
- **L1 location**: Consumer repo `.androidcommondoc/docs/` (e.g., `DawSync/.androidcommondoc/docs/testing-patterns.md`).
- **Project discovery**: Auto-discover consumer projects from existing config (settings.gradle.kts includeBuild paths, `~/.androidcommondoc/projects.yaml` fallback, ANDROID_COMMON_DOC env var for toolkit root).
- **Pattern metadata storage**: YAML frontmatter in each pattern .md file.
- **Required metadata fields**: `scope` (architectural layers/concerns), `sources` (libraries/APIs referenced), `targets` (platforms: android, desktop, ios, jvm).
- **find-pattern matching**: Metadata-based -- queries match against scope, sources, targets fields (fast, deterministic, no full-text indexing).
- **find-pattern project filter**: Optional -- `find-pattern(query, project?)`. No project = L0 only, project name = resolved L0->L1->L2, "all" = cross-project search.
- **MCP integration**: Dynamic -- MCP server reads registry at runtime, auto-discovers docs with valid frontmatter, no code changes needed when docs are split or renamed.
- **Doc restructuring**: Agent/tool should be capable of splitting monolithic pattern files into focused, independently-loadable chunks.
- **Freshness audit**: Validate all 9 existing pattern docs against current official sources before organizing into registry.
- **DawSync doc migration**: Audit DawSync/.claude/ docs -- promote generic KMP/Android patterns to L0, keep project-specific as L1.

### Claude's Discretion
- Additional metadata fields beyond scope/sources/targets
- Excludes mechanism design (doc-level vs section-level filtering)
- find-pattern return format (content vs references)
- Whether existing MCP doc resources become registry-aware or parallel system
- Doc splitting strategy (which docs to split, granularity)
- Token-aware loading approach (context-scoped, summary+drill, composite)
- L2 preferences storage format and exact location
- Registry file format for L1 consumer configuration

### Deferred Ideas (OUT OF SCOPE)
- **Automated doc monitoring** -- Auto-updating from official sources, version change detection, deprecation alerts. Phase 10 scope.
- **Detekt rule generation from patterns** -- Generating custom Detekt rules from verified patterns. Phase 10 scope.
- **Conventional Commits enforcement** -- Git commit-msg hook. Not Phase 9 scope.
- **Gitflow workflow validation** -- Branch naming rules. Not Phase 9 scope.
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | 1.27.1 | MCP server framework | Already in use, Phase 8 foundation |
| yaml | 2.8.x | YAML frontmatter parsing | ESM-native, built-in TS types, no CJS interop needed |
| zod | ^3.24.0 | Schema validation for MCP tools | Already in use for all tool input schemas |
| vitest | ^3.0.0 | Test framework | Already configured with unit + integration test structure |
| typescript | ^5.7.0 | Type checking | Already configured with Node16 module resolution |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| fast-glob | 3.x | File system scanning for registry discovery | If `readdir` recursive + filter becomes unwieldy (optional, may not need) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| yaml (v2.8.x) | gray-matter (v4.0.3) | gray-matter is CJS-only, requires `esModuleInterop` workarounds and `import matter from 'gray-matter'` with Node16 resolution. Works but adds friction. `yaml` is ESM-native, lighter, and only needs a 10-line frontmatter splitter. |
| yaml (v2.8.x) | front-matter (npm) | front-matter is YAML-only, lightweight. But `yaml` is more standard and ESM-native. |
| Custom frontmatter splitter | remark-frontmatter | remark is a full Markdown AST ecosystem -- massive overkill for extracting YAML between `---` delimiters. |

**Installation:**
```bash
cd mcp-server && npm install yaml
```

## Architecture Patterns

### Recommended Project Structure
```
mcp-server/src/
├── registry/                    # NEW: Pattern registry core
│   ├── types.ts                 # PatternMetadata, RegistryEntry, LayerResolution types
│   ├── frontmatter.ts           # YAML frontmatter parser (split + yaml.parse)
│   ├── scanner.ts               # Directory scanner: discovers .md files with valid frontmatter
│   ├── resolver.ts              # L0 -> L1 -> L2 layer resolution logic
│   └── project-discovery.ts     # Auto-discover consumer projects from settings.gradle.kts, projects.yaml
├── resources/
│   └── docs.ts                  # EVOLVED: dynamic registry-aware doc resources (replaces KNOWN_DOCS)
├── tools/
│   └── find-pattern.ts          # NEW: metadata-based pattern search tool
│   └── index.ts                 # MODIFIED: register find-pattern tool
├── utils/
│   └── paths.ts                 # EXTENDED: add getRegistryDirs(), getL1Dir(project), getL2Dir()
└── types/
    └── results.ts               # EXISTING: reuse for find-pattern results
```

### L0/L1/L2 Directory Layout
```
# L0 Base (AndroidCommonDoc repo)
AndroidCommonDoc/
└── docs/
    ├── testing-patterns.md          # Has YAML frontmatter
    ├── kmp-architecture.md          # Has YAML frontmatter
    └── ...

# L1 Project Override (in each consumer repo)
DawSync/
└── .androidcommondoc/
    ├── config.yaml                  # Optional: project-level excludes, preferences
    └── docs/
        └── testing-patterns.md      # Full replacement of L0 testing-patterns

# L2 User Preferences (user home)
~/.androidcommondoc/
├── preferences.yaml                 # Global user excludes, preferences
└── docs/
    └── testing-patterns.md          # Full replacement (lowest priority)
```

### Pattern 1: YAML Frontmatter Schema
**What:** Standard metadata format for all pattern docs
**When to use:** Every .md file in the registry
**Example:**
```markdown
---
scope:
  - testing
  - coroutines
  - quality
sources:
  - kotlinx-coroutines-test
  - mockk
  - kover
  - junit5
targets:
  - android
  - desktop
  - ios
  - jvm
version: 2
last_updated: "2026-03"
description: "Standard patterns for testing in Kotlin Multiplatform projects"
slug: testing-patterns
---
# Testing Patterns for Kotlin Multiplatform
...
```

### Pattern 2: Registry Scanner (Dynamic Discovery)
**What:** Scans directories for .md files with valid YAML frontmatter, builds in-memory registry
**When to use:** At MCP server startup and on `find-pattern` tool invocations
**Example:**
```typescript
// Source: Custom implementation following existing docs.ts pattern
import { readdir, readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

interface PatternMetadata {
  scope: string[];
  sources: string[];
  targets: string[];
  version?: number;
  last_updated?: string;
  description?: string;
  slug?: string;
}

interface RegistryEntry {
  slug: string;
  filepath: string;
  metadata: PatternMetadata;
  layer: "L0" | "L1" | "L2";
  project?: string;
}

function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } | null {
  if (!content.startsWith("---\n")) return null;
  const end = content.indexOf("\n---\n", 4);
  if (end === -1) return null;
  const yamlStr = content.substring(4, end);
  const body = content.substring(end + 5);
  return { data: parseYaml(yamlStr), body };
}
```

### Pattern 3: Layer Resolution
**What:** Resolves a pattern slug through L0 -> L1 -> L2 with full replacement semantics
**When to use:** When a resource is read or find-pattern is invoked with a project filter
**Example:**
```typescript
// Priority: L1 project > L2 user > L0 base
function resolvePattern(slug: string, project?: string): RegistryEntry | null {
  if (project) {
    const l1 = findInLayer(slug, "L1", project);
    if (l1) return l1;
  }
  const l2 = findInLayer(slug, "L2");
  if (l2) return l2;
  const l0 = findInLayer(slug, "L0");
  return l0;
}
```

### Pattern 4: Project Discovery
**What:** Auto-discovers consumer projects from settings.gradle.kts includeBuild paths
**When to use:** At registry initialization to find L1 directories
**Example:**
```typescript
// Parse settings.gradle.kts for includeBuild("../path") directives
// Fallback: ~/.androidcommondoc/projects.yaml
// Env var: ANDROID_COMMON_DOC for toolkit root
async function discoverProjects(): Promise<ProjectInfo[]> {
  const toolkitRoot = getToolkitRoot();
  const settingsFile = path.join(toolkitRoot, "..", "*/settings.gradle.kts");
  // Scan sibling directories for settings.gradle.kts containing includeBuild to AndroidCommonDoc
  // ...
}
```

### Pattern 5: find-pattern MCP Tool
**What:** Metadata-based pattern search across registry layers
**When to use:** Agent needs to find patterns by scope, source library, or target platform
**Example:**
```typescript
// Zod schema following existing tool patterns
const findPatternSchema = z.object({
  query: z.string().describe("Search term matching scope, sources, or targets"),
  project: z.string().optional().describe('Project name for L1 resolution, or "all" for cross-project'),
  targets: z.array(z.string()).optional().describe("Filter by target platforms"),
});
```

### Anti-Patterns to Avoid
- **Partial merge across layers:** CONTEXT.md explicitly locks "full replacement" -- L1 replaces L0 entirely for a given slug. Never attempt section-level merging.
- **Full-text content indexing:** Use metadata fields only for matching. Content search is out of scope.
- **Eagerly loading all doc content at startup:** Only load metadata at startup. Content is read on-demand when resources are accessed.
- **Breaking existing `docs://` URIs:** The existing `docs://androidcommondoc/{slug}` scheme must continue working. Evolve, don't replace.
- **Hardcoding project paths:** Use discovery (settings.gradle.kts parsing, projects.yaml, env var) not hardcoded paths.
- **Blocking the event loop with sync fs ops:** Use `readFile`/`readdir` (async) consistently, matching existing patterns in docs.ts/skills.ts.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing | Custom key:value parser | `yaml` npm package (v2.8.x) | Handles nested arrays, quoted strings, multiline values -- YAML is deceptively complex |
| Tool input validation | Manual param checking | Zod schemas (already in use) | Consistent with Phase 8 tools, gets free type inference |
| Rate limiting | Per-tool logic | Existing `RateLimiter` + `checkRateLimit()` | Already tested, shared instance at 30/min |
| Glob file matching | Regex on readdir results | `fast-glob` or `node:fs/promises` recursive readdir with filter | Edge cases: symlinks, permissions, case sensitivity on Windows |
| Settings.gradle.kts parsing | Full Kotlin DSL parser | Regex for `includeBuild("...")` patterns | Only need to extract path strings, not parse full Gradle DSL |

**Key insight:** The YAML frontmatter format is standardized (three dashes, YAML, three dashes) but has edge cases (content containing `---`, empty frontmatter, BOM markers). Using the `yaml` package for the YAML portion and a robust split function handles these correctly.

## Common Pitfalls

### Pitfall 1: Windows Path Handling
**What goes wrong:** Path separators, case sensitivity, and `~` expansion behave differently on Windows.
**Why it happens:** `~/.androidcommondoc/` does not resolve automatically on Windows. `os.homedir()` returns `C:\Users\username`, and path.join handles separators, but tests must account for this.
**How to avoid:** Use `os.homedir()` (already done implicitly via Node.js), `path.join()` everywhere, never hardcode `/`. The existing `paths.ts` uses `fileURLToPath` correctly for Windows.
**Warning signs:** Tests pass on CI (Linux) but fail locally (Windows). The project already handles this -- follow the `paths.ts` patterns.

### Pitfall 2: Frontmatter Parsing Edge Cases
**What goes wrong:** Files without frontmatter, files with `---` in code blocks, empty frontmatter, BOM markers at file start.
**Why it happens:** Not all .md files will have frontmatter (e.g., `propuesta-integracion-enterprise.md` is the Spanish original). Files with YAML code examples may have `---` delimiters inside fenced code blocks.
**How to avoid:** Only split on `---` at the very start of the file (`content.startsWith("---\n")` or `content.startsWith("---\r\n")` for Windows). The second `---` must be on its own line. Files without valid frontmatter are silently skipped (not errors).
**Warning signs:** Registry shows more or fewer docs than expected. Add debug logging for skipped files.

### Pitfall 3: Layer Resolution Cache Invalidation
**What goes wrong:** Registry shows stale data after docs are edited while MCP server is running.
**Why it happens:** If metadata is cached at startup and never refreshed, edits to L1/L2 docs won't take effect until server restart.
**How to avoid:** For Phase 9, scan-on-demand is acceptable (scan registry dirs on each `find-pattern` call or resource list). The MCP server is a subprocess that restarts between Claude sessions. If performance becomes an issue, add a `registry-refresh` tool in a later phase.
**Warning signs:** find-pattern returns outdated results. Agent sees wrong pattern version.

### Pitfall 4: Circular Discovery
**What goes wrong:** Project discovery scans sibling directories, which may include the toolkit itself, creating circular references.
**Why it happens:** `ANDROID_COMMON_DOC` env var points to the toolkit root. Sibling scanning may re-discover it.
**How to avoid:** Exclude the toolkit root directory from project discovery results. Only include directories that have `.androidcommondoc/` subdirectories or `settings.gradle.kts` with `includeBuild` to the toolkit.
**Warning signs:** Toolkit docs appear twice in registry (once as L0, once as L1).

### Pitfall 5: Breaking Existing doc Resource URIs
**What goes wrong:** Evolving `docs.ts` to be registry-aware breaks the `docs://androidcommondoc/{slug}` URIs that Phase 8 established.
**Why it happens:** Changing from static resource registration to ResourceTemplate changes the URI structure or list behavior.
**How to avoid:** Keep the same URI scheme. The evolution should be: scan L0 docs with frontmatter at startup, register each as before. The `KNOWN_DOCS` constant is replaced by the scan results, but the URI pattern and read handler remain identical. Test with existing `docs.test.ts` to verify backward compatibility.
**Warning signs:** Existing unit tests in `tests/unit/resources/docs.test.ts` fail.

### Pitfall 6: Large File Scanning on Windows
**What goes wrong:** Scanning multiple directories recursively with `readdir` is slow or times out.
**Why it happens:** Windows filesystem is slower than Linux for directory traversal. L1 scanning requires reaching into consumer project directories.
**How to avoid:** Only scan known directories (L0: `docs/`, L1: discovered project `.androidcommondoc/docs/`, L2: `~/.androidcommondoc/docs/`). No recursive scanning needed -- all docs are flat in their respective `docs/` directories.
**Warning signs:** MCP server startup takes >5 seconds. find-pattern tool times out.

## Code Examples

Verified patterns from the existing codebase:

### Existing Tool Registration Pattern (from tools/index.ts)
```typescript
// Source: mcp-server/src/tools/check-freshness.ts
export function registerCheckFreshnessTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "check-doc-freshness",
    {
      title: "Check Doc Freshness",
      description: "Compare version references in pattern docs against versions-manifest.json",
      inputSchema: z.object({
        projectRoot: z.string().optional().describe("Path to AndroidCommonDoc root"),
      }),
    },
    async ({ projectRoot }) => {
      const rateLimitResponse = checkRateLimit(limiter, "check-doc-freshness");
      if (rateLimitResponse) return rateLimitResponse;
      // ... handler logic
    },
  );
}
```

### Existing Resource Template Pattern (from resources/skills.ts)
```typescript
// Source: mcp-server/src/resources/skills.ts
server.registerResource(
  "skill",
  new ResourceTemplate("skills://androidcommondoc/{skillName}", {
    list: async () => {
      const skills = await discoverSkills();
      return {
        resources: skills.map((name) => ({
          uri: `skills://androidcommondoc/${name}`,
          name: name,
          title: name.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
          description: `Skill definition: ${name}`,
          mimeType: "text/markdown",
        })),
      };
    },
  }),
  { description: "Skill definition", mimeType: "text/markdown" },
  async (uri, { skillName }) => {
    // ... read handler
  },
);
```

### Frontmatter Parse + yaml Package
```typescript
// Recommended implementation for Phase 9
import { parse as parseYaml } from "yaml";

interface FrontmatterResult {
  data: Record<string, unknown>;
  content: string;
}

export function parseFrontmatter(raw: string): FrontmatterResult | null {
  const normalized = raw.replace(/^\uFEFF/, ""); // Strip BOM
  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) {
    return null;
  }
  const endMarker = normalized.indexOf("\n---\n", 4);
  const endMarkerCrlf = normalized.indexOf("\r\n---\r\n", 5);
  const end = endMarker !== -1 ? endMarker : endMarkerCrlf;
  if (end === -1) return null;

  const yamlStr = normalized.substring(
    normalized.indexOf("\n") + 1,
    end,
  );
  const content = normalized.substring(
    end + (endMarkerCrlf !== -1 && endMarkerCrlf === end ? 7 : 5),
  );

  try {
    const data = parseYaml(yamlStr) as Record<string, unknown>;
    return { data, content };
  } catch {
    return null; // Invalid YAML -- skip this file
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded `KNOWN_DOCS` array in docs.ts | Dynamic registry scan with frontmatter metadata | Phase 9 | No code changes needed when docs added/removed/split |
| Informal blockquote metadata (`> **Platforms**: ...`) | YAML frontmatter with structured fields | Phase 9 | Machine-parseable, queryable by find-pattern tool |
| Single doc directory (L0 only) | Three-layer resolution (L0/L1/L2) | Phase 9 | Per-project customization without forking |
| User docs in `~/.claude/docs/` (stale copies) | L2 preferences in `~/.androidcommondoc/` with registry resolution | Phase 9 | Single source of truth, no stale copies |
| gray-matter (CJS) for YAML parsing | `yaml` v2.8.x (ESM-native) + custom splitter | Phase 9 | Clean ESM imports, no interop hacks |

**Deprecated/outdated:**
- `~/.claude/docs/*.md` copies: Currently stale (v1 vs repo's v2/v3). Phase 9 registry makes these redundant. DawSync agents reference `~/.claude/docs/` -- those references should be updated to use MCP resources or the new registry paths.
- `KNOWN_DOCS` constant in `docs.ts`: Replaced by dynamic frontmatter scanning.

## Discretion Recommendations

### Additional Metadata Fields (beyond required scope/sources/targets)
**Recommendation:** Add these fields:
- `version: number` -- doc version for tracking updates (already informally tracked as "v2", "v3")
- `last_updated: string` -- ISO month ("2026-03") for freshness tracking
- `description: string` -- one-line summary for find-pattern results
- `slug: string` -- explicit slug (defaults to filename without .md if omitted)
- `status: string` -- "active" | "draft" | "deprecated" (future-proofing)
- `excludable_sources: string[]` -- optional, lists sources that can be individually excluded (for section-level filtering)

### Excludes Mechanism
**Recommendation:** Doc-level filtering by `sources` field. If a user configures `excludes: ["turbine"]` in preferences.yaml, any doc whose `sources` array contains "turbine" is excluded from results. This is simpler than section-level filtering and aligns with the "full replacement" layer semantics. If a user wants a testing-patterns doc without Turbine, they create an L2 override that is the full doc minus Turbine sections.

### find-pattern Return Format
**Recommendation:** Return references (metadata + slug + URI) by default, with an optional `include_content: boolean` parameter. This optimizes for token efficiency -- agents see a summary list and can then load specific docs via the existing `docs://` resource URIs. For cross-project search ("all"), content loading would be excessive.

### Existing MCP doc Resources Evolution
**Recommendation:** Evolve in-place. Replace `KNOWN_DOCS` with registry scan results. The `docs://androidcommondoc/{slug}` URI scheme stays. For project-specific docs, add a parallel `docs://androidcommondoc/{project}/{slug}` template. This gives backward compatibility + project-scoped access.

### Doc Splitting Strategy
**Recommendation:** Split docs over ~400 lines into focused sub-docs. Current candidates:
- `compose-resources-patterns.md` (763 lines) -> split into configuration vs usage vs troubleshooting
- `offline-first-patterns.md` (850 lines) -> split into architecture vs sync patterns vs caching
- `viewmodel-state-patterns.md` (733 lines) -> split into state management vs navigation vs events
- `testing-patterns.md` (700 lines) -> split into coroutines vs fakes vs coverage

Each sub-doc gets its own frontmatter and can be independently loaded. Original slugs remain as composite entry points.

### Token-Aware Loading Approach
**Recommendation:** Summary + drill-down. The `find-pattern` tool returns metadata summaries (slug, description, scope, ~50 tokens each). Agents then load specific docs via `docs://` resources. For composite loading, add a `get-pattern-summary` tool that returns only the first section (## Overview) of a doc -- typically 5-15 lines, sufficient for an agent to decide if the full doc is needed.

### L2 Preferences Storage
**Recommendation:** `~/.androidcommondoc/preferences.yaml` with this schema:
```yaml
excludes:
  sources: ["turbine", "mockk"]
  scopes: []
defaults:
  targets: ["android", "desktop"]
```

### L1 Consumer Configuration
**Recommendation:** `{project}/.androidcommondoc/config.yaml`:
```yaml
project_name: DawSync
excludes:
  sources: []
# L1 docs are simply .md files in .androidcommondoc/docs/ with frontmatter
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^3.0.0 |
| Config file | mcp-server/vitest.config.ts |
| Quick run command | `cd mcp-server && npm test` |
| Full suite command | `cd mcp-server && npm test` |

### Phase Requirements -> Test Map

Since requirements are TBD, mapping is based on functional areas from the phase scope:

| Req Area | Behavior | Test Type | Automated Command | File Exists? |
|----------|----------|-----------|-------------------|-------------|
| Frontmatter | Parse YAML frontmatter from .md files | unit | `cd mcp-server && npx vitest run tests/unit/registry/frontmatter.test.ts` | Wave 0 |
| Scanner | Discover .md files with valid frontmatter in a directory | unit | `cd mcp-server && npx vitest run tests/unit/registry/scanner.test.ts` | Wave 0 |
| Resolver | L0/L1/L2 layer resolution with full replacement | unit | `cd mcp-server && npx vitest run tests/unit/registry/resolver.test.ts` | Wave 0 |
| Project Discovery | Parse settings.gradle.kts for includeBuild paths | unit | `cd mcp-server && npx vitest run tests/unit/registry/project-discovery.test.ts` | Wave 0 |
| find-pattern tool | Metadata-based search with project filter | unit | `cd mcp-server && npx vitest run tests/unit/tools/find-pattern.test.ts` | Wave 0 |
| docs.ts evolution | Dynamic registry scan replaces KNOWN_DOCS | unit | `cd mcp-server && npx vitest run tests/unit/resources/docs.test.ts` | Existing (update) |
| Backward compat | Existing docs:// URIs still work | integration | `cd mcp-server && npx vitest run tests/integration/` | Existing (verify) |
| Frontmatter on docs | All 9 pattern docs have valid YAML frontmatter | smoke | Manual verification or custom test | Wave 0 |
| Doc freshness | All docs validated against current official sources | manual-only | Run check-doc-freshness tool | N/A |

### Sampling Rate
- **Per task commit:** `cd mcp-server && npm test`
- **Per wave merge:** `cd mcp-server && npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/registry/frontmatter.test.ts` -- parse valid frontmatter, handle missing/invalid/BOM cases
- [ ] `tests/unit/registry/scanner.test.ts` -- scan directory, skip files without frontmatter
- [ ] `tests/unit/registry/resolver.test.ts` -- L0/L1/L2 resolution priority, full replacement semantics
- [ ] `tests/unit/registry/project-discovery.test.ts` -- parse settings.gradle.kts, fallback to projects.yaml
- [ ] `tests/unit/tools/find-pattern.test.ts` -- query matching, project filter, excludes
- [ ] `yaml` package installation: `cd mcp-server && npm install yaml`

## Open Questions

1. **DawSync doc migration scope**
   - What we know: DawSync's `.claude/` contains project-specific agents (data-layer-specialist, test-specialist, etc.) and web-quality skills (accessibility, SEO). The agents reference `~/.claude/docs/` patterns. The skills are DawSync-Web-specific, not generic KMP.
   - What's unclear: Whether any content from DawSync agent definitions should be extracted as standalone L1 patterns (e.g., test-specialist's "no Turbine" rule, data-layer-specialist's "producer/consumer" patterns are DawSync-specific but could inform L1 docs).
   - Recommendation: Keep DawSync agents as-is (they are project-specific by nature). The migration task should create a `DawSync/.androidcommondoc/docs/` directory with any project-specific pattern overrides, and update agent references from `~/.claude/docs/` to use the registry.

2. **Enterprise integration doc classification**
   - What we know: `enterprise-integration-proposal.md` and `propuesta-integracion-enterprise.md` are not pattern docs -- they're proposals. They currently have different metadata format (Author/Date/Objective vs Status/Platforms/Library Versions).
   - What's unclear: Should these get frontmatter and be in the registry, or should they be excluded?
   - Recommendation: Exclude from the pattern registry. They are proposals, not patterns. The Spanish version is already excluded from KNOWN_DOCS. Both should be moved to a separate `docs/proposals/` directory or simply excluded by lacking frontmatter (the scanner will skip them).

3. **Concurrency: multiple Claude Code instances**
   - What we know: The MCP server runs as a subprocess per Claude Code session. Multiple instances could be running simultaneously.
   - What's unclear: Whether concurrent writes to L2 preferences could conflict.
   - Recommendation: For Phase 9, L2 preferences are read-only from the MCP server's perspective (user edits them manually). No concurrency concern.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `mcp-server/src/resources/docs.ts`, `mcp-server/src/resources/skills.ts`, `mcp-server/src/tools/index.ts`, `mcp-server/src/utils/paths.ts` -- direct code inspection
- Existing docs: All 10 files in `docs/` -- structure, metadata format, line counts measured
- Existing tests: `mcp-server/tests/unit/resources/docs.test.ts` -- backward compatibility baseline
- MCP SDK: `@modelcontextprotocol/sdk` 1.27.1 -- `McpServer`, `ResourceTemplate`, Zod schemas
- DawSync `.claude/`: agents, skills, settings.json -- audited for migration candidates

### Secondary (MEDIUM confidence)
- [yaml npm package](https://www.npmjs.com/package/yaml) v2.8.x -- ESM-native YAML parser, TypeScript built-in types, confirmed compatible with Node16 module resolution
- [gray-matter](https://github.com/jonschlinkert/gray-matter) v4.0.3 -- CJS-only frontmatter parser, viable but ESM interop adds friction
- [MCP TypeScript SDK docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) -- ResourceTemplate API for dynamic resource discovery

### Tertiary (LOW confidence)
- DawSync doc migration scope: Based on file inspection only, not tested. Actual migration may reveal additional patterns worth promoting or retaining.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified, existing codebase patterns well-understood
- Architecture: HIGH -- extends well-documented Phase 8 foundation with clear patterns
- Pitfalls: HIGH -- based on direct codebase inspection and Windows development experience
- DawSync migration: MEDIUM -- file audit complete but content analysis is surface-level
- Doc splitting: MEDIUM -- line counts measured but optimal split points need content review

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (stable domain, no fast-moving dependencies)