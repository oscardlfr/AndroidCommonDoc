# Phase 11: Obsidian Documentation Hub - Research

**Researched:** 2026-03-14
**Domain:** Obsidian vault generation, cross-project documentation sync, MCP tooling
**Confidence:** HIGH

## Summary

Phase 11 builds a Claude Code skill + MCP tool that syncs documentation from across the KMP ecosystem (AndroidCommonDoc, shared-kmp-libs, DawSync, WakeTheCave, OmniSound) into a unified Obsidian vault with auto-generated wikilinks, MOC pages, and tags. The vault is a read-only enriched view -- repos remain the source of truth.

This is fundamentally a **file generation pipeline**: read source files (pattern docs, skills, CLAUDE.md, .planning/ artifacts), extract metadata via the existing frontmatter parser, transform into Obsidian-flavored Markdown with wikilinks and enriched frontmatter, and write to a standalone vault directory. The existing registry infrastructure (scanner, resolver, project-discovery, frontmatter parser) provides 80%+ of the source-reading capability. The new work is the output pipeline (vault writer, MOC generator, wikilink injector) plus the MCP tool and skill wrappers.

**Primary recommendation:** Build the vault sync engine as a new `mcp-server/src/vault/` module that reuses existing registry/scanner infrastructure for source discovery, adds a VaultWriter for Obsidian-flavored output, and exposes two MCP tools (`sync-vault` for full sync and `vault-status` for quick health check). The skill wraps these tools following the established monitor-docs/generate-rules pattern.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **One unified vault** for the entire KMP ecosystem -- not per-project vaults
- **Standalone directory** (e.g., `~/AndroidStudioProjects/kmp-knowledge-vault/`) -- independent of any project repo, no git conflicts
- **Repos are source of truth** -- vault is a read-only enriched view synced FROM project repos
- **Manual skill invocation** -- run when you want to update, no background watchers or automatic triggers
- **Both Claude Code skill + MCP tool** -- skill for human invocation, MCP tool for agent automation. Mirrors monitor-docs/monitor-sources pattern from Phase 10
- **Auto-generate Obsidian [[wikilinks]]** between related docs based on frontmatter metadata (scope, sources, targets). Graph view lights up with cross-project connections
- **Auto-generate MOC (Map of Content) pages** -- index pages like "All Patterns", "By Project", "By Layer", "By Target Platform". Navigation hubs in the graph
- **Auto-generate tags** from frontmatter: scope -> #viewmodel #testing, targets -> #android #desktop, layer -> #L0 #L1
- **Frontmatter compatibility** -- keep existing YAML frontmatter format compatible with both Obsidian and the broader ecosystem (not Obsidian-locked)
- **Content scope -- all types:** Pattern docs, Skills (19 SKILL.md files), Detekt rules, Project decisions (.planning/), AI instruction files (CLAUDE.md, AGENTS.md), plus anything else Claude deems valuable
- **Include shared-kmp-libs** documentation (version catalog, core modules, network/system APIs)
- **Configurable project list** -- leverage existing project-discovery mechanism from Phase 9
- **Runnable from ANY project directory** -- not just AndroidCommonDoc. Finds vault location from shared config
- **Auto-configure recommended Obsidian plugins** during vault initialization

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

### Deferred Ideas (OUT OF SCOPE)
- **NotebookLM API integration** -- requires enterprise license beyond current Google Cloud Pro account
- **Bidirectional editing** -- editing docs in Obsidian and pushing back to repos
- **Automatic file watcher sync** -- background process that detects repo changes
- **Git hook triggered sync** -- post-commit/post-merge hooks
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ^5.7.0 | Implementation language | Already used for MCP server |
| Node.js fs/promises | >=18 | File I/O for vault writing | Built-in, no deps needed |
| yaml | ^2.8.2 | YAML frontmatter parsing + generation | Already a dependency |
| path, os | built-in | Cross-platform path resolution | Windows compatibility proven |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @modelcontextprotocol/sdk | 1.27.1 | MCP tool registration | Already a dependency |
| zod | ^3.24.0 | Input schema validation | Already a dependency |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw fs for vault writing | gray-matter npm | gray-matter adds dependency for something yaml + string concat handles fine |
| Manual wikilink generation | obsidian-export npm | External tool is for exporting FROM Obsidian, not generating TO it |

**Installation:**
```bash
# No new dependencies required -- all libraries already in mcp-server/package.json
```

## Architecture Patterns

### Recommended Project Structure
```
mcp-server/src/
├── vault/                    # NEW: Vault generation engine
│   ├── types.ts              # VaultConfig, VaultEntry, SyncResult types
│   ├── config.ts             # Load/save vault configuration
│   ├── collector.ts          # Gather source files from all repos
│   ├── transformer.ts        # Convert source docs to Obsidian-flavored MD
│   ├── wikilink-generator.ts # Auto-generate [[wikilinks]] from metadata
│   ├── moc-generator.ts      # Generate Map of Content index pages
│   ├── tag-generator.ts      # Extract tags from frontmatter metadata
│   ├── vault-writer.ts       # Write files to vault directory
│   └── sync-engine.ts        # Orchestrate full sync pipeline
├── tools/
│   ├── sync-vault.ts         # NEW: MCP tool for vault sync
│   └── vault-status.ts       # NEW: MCP tool for vault health check
├── registry/                 # EXISTING: Reuse scanner, resolver, project-discovery
└── ...

skills/
└── sync-vault/               # NEW: Claude Code skill
    └── SKILL.md

tests/
├── unit/vault/               # NEW: Unit tests for vault modules
│   ├── collector.test.ts
│   ├── transformer.test.ts
│   ├── wikilink-generator.test.ts
│   ├── moc-generator.test.ts
│   └── vault-writer.test.ts
└── integration/
    └── vault-sync.test.ts    # NEW: End-to-end vault generation test
```

### Recommended Vault Directory Structure (Claude's Discretion Decision)

Use a **hybrid structure** organized by content type at the top level, with project sub-directories where applicable:

```
kmp-knowledge-vault/
├── .obsidian/                 # Obsidian config (auto-generated)
│   ├── app.json
│   ├── community-plugins.json
│   ├── core-plugins.json
│   └── graph.json
├── 00-MOC/                    # Map of Content index pages
│   ├── All Patterns.md
│   ├── By Project.md
│   ├── By Layer.md
│   ├── By Target Platform.md
│   ├── All Skills.md
│   └── All Decisions.md
├── patterns/                  # Pattern docs (L0 base)
│   ├── viewmodel-state-patterns.md
│   ├── testing-patterns.md
│   └── ...
├── patterns-L1/               # Project-level pattern overrides
│   └── DawSync/
│       └── dawsync-domain-patterns.md
├── skills/                    # Skill definitions
│   ├── monitor-docs.md
│   ├── generate-rules.md
│   └── ...
├── projects/                  # Per-project knowledge
│   ├── AndroidCommonDoc/
│   │   ├── CLAUDE.md          # (if exists)
│   │   ├── PROJECT.md
│   │   └── decisions.md       # Extracted from STATE.md
│   ├── shared-kmp-libs/
│   │   ├── CLAUDE.md
│   │   ├── module-catalog.md  # Generated from README
│   │   └── docs/              # shared-kmp-libs/docs/*.md
│   ├── DawSync/
│   │   ├── CLAUDE.md
│   │   ├── PROJECT.md
│   │   └── agents/            # Agent definitions
│   └── WakeTheCave/
│       ├── CLAUDE.md
│       ├── PROJECT.md
│       └── agents/
├── rules/                     # Detekt rule docs (from frontmatter rules:)
│   └── rule-index.md          # Auto-generated from pattern doc rules
├── _templates/                # Obsidian templates (optional)
│   └── new-pattern.md
└── _vault-meta/               # Vault metadata
    ├── sync-manifest.json     # Last sync timestamps, file hashes
    └── README.md              # How this vault works
```

**Rationale:**
- Top-level by content type makes the vault navigable without knowing project structure
- Numbered `00-MOC/` folder sorts first in file explorer
- `patterns/` mirrors `docs/` from AndroidCommonDoc (familiar mapping)
- `projects/` groups per-project knowledge without cluttering pattern docs
- `_vault-meta/` prefixed with underscore to sort last and signal "infrastructure"
- `_templates/` prefixed with underscore per Obsidian convention

### Pattern 1: Collector-Transformer-Writer Pipeline
**What:** Three-stage pipeline: collect source files -> transform to Obsidian format -> write to vault
**When to use:** Every sync operation follows this pipeline
**Example:**
```typescript
// Stage 1: Collect all source files from all configured projects
const sources = await collector.gatherAll(config);
// sources: Array<{ filepath, content, metadata, sourceType, project? }>

// Stage 2: Transform each source into Obsidian-flavored markdown
const vaultEntries = await transformer.transformAll(sources);
// Adds wikilinks, enriched frontmatter, tags

// Stage 3: Generate MOC pages from the full set
const mocs = mocGenerator.generateAll(vaultEntries);

// Stage 4: Write everything to vault directory
const result = await writer.writeAll(config.vaultPath, [...vaultEntries, ...mocs]);
// result: { written: number, unchanged: number, removed: number }
```

### Pattern 2: Frontmatter Enrichment
**What:** Existing YAML frontmatter is preserved and enriched with Obsidian-specific fields
**When to use:** Every source file transformation
**Example:**
```typescript
// Original frontmatter (from pattern doc):
// scope: [viewmodel, state]
// sources: [lifecycle-viewmodel, kotlinx-coroutines]
// targets: [android, desktop, ios]

// Enriched frontmatter (in vault):
// scope: [viewmodel, state]
// sources: [lifecycle-viewmodel, kotlinx-coroutines]
// targets: [android, desktop, ios]
// tags: [viewmodel, state, android, desktop, ios, L0]
// aliases: [viewmodel-state-patterns]
// vault_source: "AndroidCommonDoc/docs/viewmodel-state-patterns.md"
// vault_synced: "2026-03-14"
// vault_type: pattern
```

### Pattern 3: Wikilink Injection
**What:** Auto-insert `[[wikilinks]]` in document body where related pattern slugs are mentioned
**When to use:** All pattern docs and skill docs that reference other docs
**Example:**
```typescript
// In "Related patterns:" sections, transform plain text references to wikilinks:
// Before: "See also: testing-patterns, error-handling-patterns"
// After:  "See also: [[testing-patterns]], [[error-handling-patterns]]"

// In cross-references sections of skills:
// Before: "- MCP tool: `monitor-sources`"
// After:  "- MCP tool: `monitor-sources` ([[monitor-docs]])"

// Frontmatter sources become inline wikilinks in a "Related Libraries" section:
// "Libraries: [[lifecycle-viewmodel]], [[kotlinx-coroutines]]"
```

### Pattern 4: MOC Generation
**What:** Auto-generate index pages that group documents by facets
**When to use:** During sync, after all documents are transformed
**Example:**
```typescript
// "All Patterns.md" MOC:
// ---
// tags: [moc]
// vault_type: moc
// ---
// # All Patterns
//
// ## Active Patterns
// - [[viewmodel-state-patterns]] - Hub doc: ViewModel state management
// - [[testing-patterns]] - Hub doc: Testing patterns
// ...
//
// ## By Scope
// ### viewmodel
// - [[viewmodel-state-patterns]]
// - [[viewmodel-events]]
// - [[viewmodel-navigation]]
```

### Anti-Patterns to Avoid
- **Don't modify source files:** The vault is downstream only. Never write back to repos.
- **Don't embed Obsidian-specific syntax in source frontmatter:** Tags and aliases are vault-side additions. Source frontmatter stays ecosystem-agnostic.
- **Don't hardcode project paths:** Use project-discovery and config for all paths.
- **Don't create deep nesting:** Keep vault 2-3 levels deep max for Obsidian graph readability.
- **Don't generate Dataview queries in docs:** Static wikilinks are more reliable and don't require plugin. Reserve Dataview for MOC pages only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Frontmatter parsing | Custom YAML parser | Existing `parseFrontmatter()` from registry | Proven, handles BOM, CRLF, edge cases |
| Project discovery | Manual path scanning | Existing `discoverProjects()` from registry | Already handles settings.gradle.kts + YAML fallback |
| Doc scanning | Custom file walker | Existing `scanDirectory()` from registry | Returns typed RegistryEntry with parsed metadata |
| Layer resolution | Custom priority logic | Existing `resolveAllPatterns()` from resolver | L1>L2>L0 full replacement semantics proven |
| YAML serialization | String concatenation | `yaml` package `stringify()` | Already a dependency, handles quoting/escaping |
| MCP tool registration | Custom server setup | Existing `registerTool` pattern from tools/index.ts | Rate limiting, Zod schema, error handling established |

**Key insight:** The existing registry infrastructure is the foundation. The vault sync engine is essentially a new "output adapter" for the registry -- it reads the same sources the MCP resources/tools read, but writes Obsidian-flavored files instead of returning JSON responses.

## Common Pitfalls

### Pitfall 1: Windows Path Separators in Wikilinks
**What goes wrong:** Backslashes in Windows paths leak into `[[wikilinks]]` and break Obsidian
**Why it happens:** `path.join()` on Windows produces backslashes; vault paths need forward slashes for Obsidian compatibility
**How to avoid:** Normalize all vault-relative paths with `.replace(/\\/g, '/')` before generating wikilinks
**Warning signs:** Tests pass on CI (Linux) but wikilinks break on developer's Windows machine

### Pitfall 2: Frontmatter Clobbering on Re-sync
**What goes wrong:** Re-running sync loses Obsidian-side frontmatter additions (if user manually added properties)
**Why it happens:** Full overwrite replaces the entire file including frontmatter
**How to avoid:** Use content-hash comparison: if source file hash hasn't changed, skip the write. Track hashes in `sync-manifest.json`. Given repos are source of truth and vault is read-only, full overwrite is acceptable for the initial implementation. Document this clearly in the vault README.
**Warning signs:** User complains that manual Obsidian edits disappear after sync

### Pitfall 3: Orphaned Vault Files After Source Deletion
**What goes wrong:** When a source doc is deleted from a repo, its vault copy persists forever
**Why it happens:** Sync only writes/updates files, never deletes
**How to avoid:** Track all expected vault files in sync-manifest. After sync, compare manifest to actual files. Report orphans (or delete with `--clean` flag).
**Warning signs:** Vault accumulates stale files that don't exist in source repos

### Pitfall 4: Circular Wikilinks in MOC Pages
**What goes wrong:** MOC pages link to docs that link back to MOC, creating a dense, unhelpful graph
**Why it happens:** Wikilink injection treats MOC pages as regular docs
**How to avoid:** Exclude MOC pages from wikilink injection. MOC pages link OUT to docs; docs don't need to link back to MOCs (Obsidian backlinks handle this automatically).
**Warning signs:** Graph view shows MOC as an overly-connected hub obscuring real connections

### Pitfall 5: Large File Handling for AGENTS.md
**What goes wrong:** Some AGENTS.md files are 100KB+ (per SKILL.md loading rules). Syncing raw creates oversized vault files.
**Why it happens:** Agent definitions contain full prompt text
**How to avoid:** For large files (>500 lines), generate a summary/index page instead of syncing the full file. Extract agent names, roles, and key responsibilities. Link to the original file path for reference.
**Warning signs:** Obsidian becomes sluggish when opening certain vault files

### Pitfall 6: Plugin Auto-Configuration Requires Manual Download
**What goes wrong:** Auto-configuring `community-plugins.json` tells Obsidian WHICH plugins to use, but doesn't download them
**Why it happens:** Obsidian community plugins are downloaded through the app's plugin browser, not via config files
**How to avoid:** Generate `community-plugins.json` as a "recommended plugins" list AND create a `_vault-meta/SETUP.md` with instructions to install each plugin through Obsidian's UI on first open. The config file ensures plugins are enabled once installed.
**Warning signs:** User opens vault and sees errors about missing plugins

## Code Examples

### Source Collection from Multiple Projects
```typescript
// Source: Based on existing project-discovery.ts and scanner.ts patterns
import { discoverProjects } from "../registry/project-discovery.js";
import { scanDirectory } from "../registry/scanner.js";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface VaultSource {
  filepath: string;
  content: string;
  metadata: Record<string, unknown> | null;
  sourceType: "pattern" | "skill" | "planning" | "claude-md" | "agents" | "docs";
  project?: string;
  layer?: "L0" | "L1" | "L2";
  relativePath: string; // Path relative to source root
}

export async function collectPatternDocs(toolkitRoot: string): Promise<VaultSource[]> {
  const docsDir = path.join(toolkitRoot, "docs");
  const entries = await scanDirectory(docsDir, "L0");
  const sources: VaultSource[] = [];

  for (const entry of entries) {
    const content = await readFile(entry.filepath, "utf-8");
    sources.push({
      filepath: entry.filepath,
      content,
      metadata: entry.metadata as unknown as Record<string, unknown>,
      sourceType: "pattern",
      layer: "L0",
      relativePath: `patterns/${entry.slug}.md`,
    });
  }
  return sources;
}

export async function collectSkills(toolkitRoot: string): Promise<VaultSource[]> {
  const skillsDir = path.join(toolkitRoot, "skills");
  const entries = await readdir(skillsDir);
  const sources: VaultSource[] = [];

  for (const entry of entries) {
    const skillMd = path.join(skillsDir, entry, "SKILL.md");
    try {
      const content = await readFile(skillMd, "utf-8");
      sources.push({
        filepath: skillMd,
        content,
        metadata: null, // Skills have their own frontmatter format
        sourceType: "skill",
        relativePath: `skills/${entry}.md`,
      });
    } catch {
      // Not a skill directory (e.g., params.json)
    }
  }
  return sources;
}
```

### Wikilink Generation from Metadata
```typescript
// Generate [[wikilinks]] based on shared metadata values
export function generateWikilinks(
  allSlugs: Set<string>,
  content: string,
): string {
  let result = content;

  for (const slug of allSlugs) {
    // Match slug as a standalone word (not already in a wikilink)
    // Avoid matching inside existing [[...]] or `...` blocks
    const regex = new RegExp(
      `(?<!\\[\\[)(?<!\`)\\b(${escapeRegex(slug)})\\b(?!\\]\\])(?!\`)`,
      "g",
    );
    result = result.replace(regex, "[[$1]]");
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

### MOC Page Generation
```typescript
// Generate a "By Project" MOC page
export function generateByProjectMOC(entries: VaultSource[]): string {
  const byProject = new Map<string, VaultSource[]>();

  for (const entry of entries) {
    const project = entry.project ?? "AndroidCommonDoc";
    if (!byProject.has(project)) {
      byProject.set(project, []);
    }
    byProject.get(project)!.push(entry);
  }

  const lines: string[] = [
    "---",
    "tags: [moc, index]",
    "vault_type: moc",
    `vault_synced: "${new Date().toISOString().slice(0, 10)}"`,
    "---",
    "",
    "# By Project",
    "",
    "Navigate documentation organized by source project.",
    "",
  ];

  for (const [project, sources] of byProject) {
    lines.push(`## ${project}`);
    lines.push("");
    for (const source of sources) {
      const name = path.basename(source.relativePath, ".md");
      lines.push(`- [[${name}]]`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
```

### Vault Config Management
```typescript
// Vault configuration stored at ~/.androidcommondoc/vault-config.json
export interface VaultConfig {
  vaultPath: string;           // Absolute path to vault root
  projects: string[];          // Project names to include (from project-discovery)
  autoClean: boolean;          // Remove orphaned files on sync
  includeTemplates: boolean;   // Generate Obsidian templates
  lastSync?: string;           // ISO timestamp of last sync
}

const DEFAULT_CONFIG: VaultConfig = {
  vaultPath: path.join(
    process.env.USERPROFILE ?? process.env.HOME ?? "",
    "AndroidStudioProjects",
    "kmp-knowledge-vault",
  ),
  projects: [], // Empty = auto-discover
  autoClean: false,
  includeTemplates: true,
};
```

### Obsidian Config Generation
```typescript
// Generate .obsidian/ configuration files
export function generateObsidianConfig(): Record<string, string> {
  return {
    "app.json": JSON.stringify({
      useMarkdownLinks: false,  // Use [[wikilinks]] not markdown links
      newFileLocation: "folder",
      newFileFolderPath: "_templates",
      attachmentFolderPath: "_attachments",
      showFrontmatter: true,
      readableLineLength: true,
    }, null, 2),

    "community-plugins.json": JSON.stringify([
      "dataview",          // Dynamic queries for MOC pages
    ], null, 2),

    "core-plugins.json": JSON.stringify({
      "file-explorer": true,
      "global-search": true,
      "graph": true,       // Core graph view for cross-project visualization
      "backlink": true,    // See which docs reference each other
      "outgoing-link": true,
      "tag-pane": true,    // Tag-based filtering
      "page-preview": true,
      "templates": true,
      "note-composer": false,
      "command-palette": true,
      "editor-status": true,
      "starred": true,
    }, null, 2),

    "graph.json": JSON.stringify({
      collapse: {
        search: false,
        attachments: true,
        orphans: false,
      },
      search: "",
      showTags: true,
      showAttachments: false,
      hideUnresolved: false,
      showOrphans: true,
      collapse: false,
      textFadeMultiplier: 0,
      nodeSizeMultiplier: 1,
      lineSizeMultiplier: 1,
      colorGroups: [
        { query: "path:00-MOC", color: { a: 1, rgb: 14701138 } },       // MOC = gold
        { query: "path:patterns", color: { a: 1, rgb: 5431378 } },      // patterns = green
        { query: "path:skills", color: { a: 1, rgb: 2201331 } },        // skills = blue
        { query: "path:projects", color: { a: 1, rgb: 14364210 } },     // projects = orange
      ],
    }, null, 2),
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| NotebookLM Enterprise API | Local Obsidian vault | Phase 11 pivot (2026-03-14) | No enterprise license needed, free, local-first |
| Bidirectional sync | Unidirectional repo->vault | Phase 11 context | Avoids conflict resolution complexity |
| Obsidian Dataview for everything | Static wikilinks + minimal Dataview | Current best practice | Reduces plugin dependency, improves portability |
| Global plugin install | Per-vault community-plugins.json | Obsidian convention | Each vault declares its own plugin needs |

**Deprecated/outdated:**
- NotebookLM Enterprise API approach: too expensive for solo dev, requires separate enterprise license beyond Google Cloud Pro (20 EUR/month)
- Obsidian Graph Analysis plugin: last updated ~2023, Extended Graph plugin is the current alternative for enhanced graph views
- Zoottelkeeper plugin (auto-generate folder indices): last active 2023, manual MOC generation is more reliable and customizable

## Open Questions

1. **Vault git tracking decision**
   - What we know: Vault can be regenerated on demand (deterministic from source repos). Git tracking adds version history but is redundant if sources are already tracked.
   - What's unclear: Whether the user wants to track vault evolution over time (e.g., seeing how cross-references grow)
   - Recommendation: Default to NOT git-tracked (regenerated on demand). Add `--init-git` flag to vault init for users who want version history. This keeps things simple and avoids a separate git repo to maintain.

2. **Handling non-Markdown source files (shared-kmp-libs docs include .docx)**
   - What we know: `shared-kmp-libs/docs/SBOM Best Practices KMP.docx` exists
   - What's unclear: Whether to convert .docx to .md or skip it
   - Recommendation: Skip non-.md files with a warning in the sync report. Converting .docx requires additional dependencies (pandoc or mammoth) and adds complexity for a single file.

3. **Dataview plugin: install vs recommend**
   - What we know: Dataview enables dynamic queries in MOC pages. It requires manual installation through Obsidian's plugin browser.
   - What's unclear: Whether to generate MOC pages with Dataview queries (dynamic, requires plugin) or static wikilinks (no plugin dependency)
   - Recommendation: Generate MOC pages with static wikilinks (no plugin required). Add Dataview to `community-plugins.json` as recommended but not required. Document in SETUP.md that installing Dataview enables dynamic filtering.

## Vault Operations (Claude's Discretion Decision)

Based on the established monitor-docs/generate-rules skill patterns:

| Operation | MCP Tool | Skill Verb | Purpose |
|-----------|----------|------------|---------|
| Initialize vault | `sync-vault` (mode: init) | `/sync-vault --init` | Create vault directory, .obsidian config, initial sync |
| Full sync | `sync-vault` (mode: sync) | `/sync-vault` | Sync all sources to vault |
| Status check | `vault-status` | `/sync-vault --status` | Show last sync time, file counts, orphan warnings |
| Clean orphans | `sync-vault` (mode: clean) | `/sync-vault --clean` | Remove vault files no longer in source repos |

**Rationale:** Two MCP tools (not four) keeps it minimal. `sync-vault` handles init/sync/clean via mode parameter. `vault-status` is separate because it's read-only and cheap (no sync needed).

## Config Storage (Claude's Discretion Decision)

Store vault configuration at `~/.androidcommondoc/vault-config.json`:

```json
{
  "vaultPath": "C:/Users/34645/AndroidStudioProjects/kmp-knowledge-vault",
  "projects": [],
  "autoClean": false,
  "includeTemplates": true
}
```

**Rationale:**
- `~/.androidcommondoc/` already exists for monitoring state and projects.yaml
- Central location enables "runnable from ANY project directory" requirement
- Empty `projects` array means auto-discover (leverage project-discovery)
- Extends existing config ecosystem, doesn't create a new one

## Obsidian Plugins (Claude's Discretion Decision)

### Auto-configure (in community-plugins.json)
| Plugin | Why |
|--------|-----|
| Dataview | Dynamic queries if user installs it; MOC pages work without it (static links) |

### Do NOT include
| Plugin | Why Not |
|--------|---------|
| Graph Analysis | Stale (last updated 2023), core graph view is sufficient |
| Extended Graph | Nice-to-have but not essential; adds setup complexity |
| Templater | Vault is read-only sync; templates aren't the primary use case |
| Calendar | No temporal content to visualize |

**Rationale:** Minimal plugin footprint. One optional plugin (Dataview) that enhances but isn't required. Core Obsidian features (graph view, backlinks, tags, search) handle 90% of the use case.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^3.0.0 |
| Config file | `mcp-server/vitest.config.ts` (existing) |
| Quick run command | `cd mcp-server && npx vitest run tests/unit/vault/` |
| Full suite command | `cd mcp-server && npx vitest run` |

### Phase Requirements -> Test Map

Phase 11 requirements are TBD per REQUIREMENTS.md. Based on CONTEXT.md decisions, the following behaviors need verification:

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VAULT-01 | Collect pattern docs from AndroidCommonDoc/docs/ | unit | `npx vitest run tests/unit/vault/collector.test.ts -t "pattern docs"` | No - Wave 0 |
| VAULT-02 | Collect skills from AndroidCommonDoc/skills/ | unit | `npx vitest run tests/unit/vault/collector.test.ts -t "skills"` | No - Wave 0 |
| VAULT-03 | Collect project knowledge (.planning/, CLAUDE.md) from consumer repos | unit | `npx vitest run tests/unit/vault/collector.test.ts -t "projects"` | No - Wave 0 |
| VAULT-04 | Transform docs to Obsidian-flavored MD with enriched frontmatter | unit | `npx vitest run tests/unit/vault/transformer.test.ts` | No - Wave 0 |
| VAULT-05 | Auto-generate [[wikilinks]] from frontmatter metadata | unit | `npx vitest run tests/unit/vault/wikilink-generator.test.ts` | No - Wave 0 |
| VAULT-06 | Auto-generate MOC pages (All Patterns, By Project, By Layer, By Platform) | unit | `npx vitest run tests/unit/vault/moc-generator.test.ts` | No - Wave 0 |
| VAULT-07 | Auto-generate tags from scope/targets/layer | unit | `npx vitest run tests/unit/vault/tag-generator.test.ts` | No - Wave 0 |
| VAULT-08 | Write vault files to standalone directory | unit | `npx vitest run tests/unit/vault/vault-writer.test.ts` | No - Wave 0 |
| VAULT-09 | Generate .obsidian/ config with recommended plugins | unit | `npx vitest run tests/unit/vault/vault-writer.test.ts -t "obsidian config"` | No - Wave 0 |
| VAULT-10 | sync-vault MCP tool with init/sync/clean modes | unit | `npx vitest run tests/unit/tools/sync-vault.test.ts` | No - Wave 0 |
| VAULT-11 | vault-status MCP tool returns health info | unit | `npx vitest run tests/unit/tools/vault-status.test.ts` | No - Wave 0 |
| VAULT-12 | Full sync e2e: source repos -> vault directory | integration | `npx vitest run tests/integration/vault-sync.test.ts` | No - Wave 0 |
| VAULT-13 | Vault config stored at ~/.androidcommondoc/vault-config.json | unit | `npx vitest run tests/unit/vault/config.test.ts` | No - Wave 0 |
| VAULT-14 | Sync manifest tracks file hashes for change detection | unit | `npx vitest run tests/unit/vault/vault-writer.test.ts -t "manifest"` | No - Wave 0 |
| VAULT-15 | Orphan detection and reporting | unit | `npx vitest run tests/unit/vault/vault-writer.test.ts -t "orphan"` | No - Wave 0 |
| VAULT-16 | Skill SKILL.md follows established pattern | manual-only | Manual review of SKILL.md format | No - Wave 0 |
| VAULT-17 | Runnable from any project directory | integration | `npx vitest run tests/integration/vault-sync.test.ts -t "any directory"` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `cd mcp-server && npx vitest run tests/unit/vault/`
- **Per wave merge:** `cd mcp-server && npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/vault/collector.test.ts` -- covers VAULT-01, VAULT-02, VAULT-03
- [ ] `tests/unit/vault/transformer.test.ts` -- covers VAULT-04
- [ ] `tests/unit/vault/wikilink-generator.test.ts` -- covers VAULT-05
- [ ] `tests/unit/vault/moc-generator.test.ts` -- covers VAULT-06
- [ ] `tests/unit/vault/tag-generator.test.ts` -- covers VAULT-07
- [ ] `tests/unit/vault/vault-writer.test.ts` -- covers VAULT-08, VAULT-09, VAULT-14, VAULT-15
- [ ] `tests/unit/vault/config.test.ts` -- covers VAULT-13
- [ ] `tests/unit/tools/sync-vault.test.ts` -- covers VAULT-10
- [ ] `tests/unit/tools/vault-status.test.ts` -- covers VAULT-11
- [ ] `tests/integration/vault-sync.test.ts` -- covers VAULT-12, VAULT-17
- [ ] Framework install: none needed (Vitest already configured)

## Sources

### Primary (HIGH confidence)
- Existing codebase: `mcp-server/src/registry/scanner.ts`, `resolver.ts`, `project-discovery.ts`, `frontmatter.ts` -- verified reusable infrastructure
- Existing codebase: `mcp-server/src/tools/index.ts` -- verified MCP tool registration pattern
- Existing codebase: `skills/monitor-docs/SKILL.md`, `skills/generate-rules/SKILL.md` -- verified skill definition patterns
- Existing codebase: `docs/*.md` (23 files), `skills/*/SKILL.md` (19 dirs) -- verified source content scope
- Existing codebase: `mcp-server/package.json` -- verified no new dependencies needed
- Consumer repos: DawSync (has .planning/, .claude/, .androidcommondoc/docs/), WakeTheCave (has .planning/, .claude/), shared-kmp-libs (has docs/, CLAUDE.md) -- verified content locations

### Secondary (MEDIUM confidence)
- [Obsidian Help - How Obsidian stores data](https://help.obsidian.md/data-storage) -- `.obsidian/` configuration structure verified
- [Obsidian Help - Create a vault](https://help.obsidian.md/vault) -- vault is just a folder with `.obsidian/` inside
- [Obsidian Plugin Catalog](https://obsidian.md/plugins) -- community plugin availability verified
- [Dataview GitHub](https://github.com/blacksmithgu/obsidian-dataview) -- Dataview query capabilities verified
- [Steph Ango - How I use Obsidian](https://stephango.com/vault) -- vault organization patterns (from Obsidian CEO)

### Tertiary (LOW confidence)
- WebSearch on MOC auto-generation patterns -- multiple community approaches, no single standard
- WebSearch on Graph Analysis plugin status -- appears stale, Extended Graph is successor

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, all existing libraries
- Architecture: HIGH - follows established MCP server patterns, pipeline design is straightforward file-to-file transformation
- Vault structure: MEDIUM - based on Obsidian community practices, will need user feedback on first run
- Pitfalls: HIGH - Windows path issues and sync manifest are well-understood from prior phases

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable domain, no fast-moving dependencies)
