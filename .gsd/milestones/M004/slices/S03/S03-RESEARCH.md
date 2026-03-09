# Phase 14.1: Docs Subdirectory Reorganization - Research

**Researched:** 2026-03-14
**Domain:** Documentation reorganization, MCP tool development, Obsidian vault optimization
**Confidence:** HIGH

## Summary

Phase 14.1 reorganizes flat docs/ directories across three projects (AndroidCommonDoc L0, shared-kmp-libs L1, DawSync L2) into domain-based subdirectories. The work spans four areas: (1) physical file moves with atomic reference updates, (2) adding a `category` frontmatter field to all docs, (3) building a new `validate-doc-structure` MCP tool and extending `find-pattern` with `--category` filter, and (4) optimizing the Obsidian vault to mirror subdirectory structure with category-grouped MOC pages.

The existing codebase is well-structured for this work. The MCP server uses TypeScript with Vitest, has comprehensive unit and integration tests, and follows consistent patterns (tool registration via McpServer + zod schemas, rate limiting, structured JSON responses). The vault pipeline (collector -> transformer -> MOC generator -> writer) is modular and already supports the L0/L1/L2 hierarchy. The scanner currently reads only flat directories (`readdir` in scanner.ts line 36), which needs updating to handle recursive subdirectory scanning.

**Primary recommendation:** Execute in L0-first order (AndroidCommonDoc -> shared-kmp-libs -> DawSync), building tooling alongside L0 moves so it can validate L1/L2 moves. Keep vault optimization as the final wave after all three projects are reorganized.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Subdirectory categories -- AndroidCommonDoc (L0):** architecture/, testing/, error-handling/, ui/, gradle/, offline-first/, compose/, resources/, di/, navigation/, storage/, guides/, archive/ (13 subdirectories)
- **Subdirectory categories -- shared-kmp-libs (L1):** security/, oauth/, storage/, domain/, firebase/, foundation/, io/, guides/, archive/ (9 subdirectories, maps to module-catalog categories)
- **Subdirectory categories -- DawSync (L2):** architecture/, guides/, legal/, business/, product/, tech/, references/, archive/, images/ (9+ subdirectories, L0 core + L2 extensions)
- **File classification rules:** Content-based via frontmatter `category` field, hub+sub-doc groups never split, cross-domain docs live in primary domain with cross-reference links
- **Category vocabulary:** L0 core (12 categories) + L1 additions (6) + L2 additions (5)
- **Cross-repo adaptation:** L0 recommends, does not mandate; opt-in validation only
- **Auto-generated README.md:** Every project gets docs/README.md from validate-doc-structure --generate-index
- **Reference updates -- atomic moves:** File moves AND all reference updates in single commit per project
- **Legacy file renaming:** CONVENTION_PLUGINS.md -> convention-plugins.md, API_EXPOSURE_PATTERN.md -> api-exposure-pattern.md (in guides/)
- **MCP tooling:** validate-doc-structure (new), find-pattern --category extension, scanner verification, vault wikilinks keep slug-only format
- **Vault optimization:** Mirror source subdirectory structure, category-grouped MOCs, Home.md redesign, archive/ excluded, /doc-reorganize skill
- **One commit per project:** AndroidCommonDoc, shared-kmp-libs, DawSync each get atomic commit
- **Verification:** Full quality gate, validate-doc-structure, vault re-sync, vault-status, manual Obsidian verification

### Claude's Discretion
- Execution order across projects (L0->L1->L2 is natural but planner decides based on dependencies)
- DawSync diagram domain subdirectory names (determined by reading 62 filenames during execution)
- DawSync delegate file path audit scope
- How to handle DawSync docs that do not clearly fit one category
- Exact README.md formatting and description text
- Whether to add skills/agents for broader doc management workflow beyond /doc-reorganize and validate-doc-structure
- Vault MOC redesign details (exact grouping, category count format, Home.md layout)

### Deferred Ideas (OUT OF SCOPE)
- LinkedIn content monitoring (Marcin Moskala, Kt. Academy)
- Broader doc management workflow (full lifecycle tools)
- SBOM docx conversion to markdown
- DawSync uppercase filename standardization (lowercase-kebab-case rename)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REORG-01 | AndroidCommonDoc docs/ reorganized into 13 domain-based subdirectories with files matching frontmatter category | File inventory (42 .md files + 1 archive), current flat structure mapped, hub+sub-doc groupings identified |
| REORG-02 | shared-kmp-libs docs/ reorganized into 9 module-category subdirectories with legacy file renames | File inventory (27 docs, 5 legacy uppercase), rename targets identified, archive candidates listed |
| REORG-03 | DawSync docs/ fully restructured using L0 core + L2 extensions pattern | Current mixed structure mapped (flat files + existing subdirs), 10 diagram files in architecture/diagrams/ |
| REORG-04 | All docs have `category` frontmatter field across 3 projects | 42 L0 docs have frontmatter, 22 L1 have it (5 legacy do not), DawSync flat files mostly lack frontmatter |
| REORG-05 | validate-doc-structure MCP tool built with --generate-index mode | Tool registration pattern documented, project-discovery reusable, zod schema patterns established |
| REORG-06 | find-pattern extended with --category filter; scanner handles subdirectories | scanner.ts only reads flat directories (needs recursive), PatternMetadata needs `category` field, find-pattern filter pattern established |
| REORG-07 | Vault optimized: subdirectory mirroring, category-grouped MOCs, Home.md redesign, /doc-reorganize skill | Collector L0 routing uses `L0-generic/patterns/`, MOC generator uses flat lists, transformer uses bare relativePath |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ^5.7.0 | MCP server language | Already in use, mcp-server/tsconfig.json |
| @modelcontextprotocol/sdk | 1.27.1 | MCP protocol implementation | Already in use for all tools |
| zod | ^3.24.0 | Input validation schemas | Already in use for tool schemas |
| yaml | ^2.8.2 | YAML frontmatter parsing | Already in use in frontmatter.ts |
| vitest | ^3.0.0 | Test framework | Already configured with vitest.config.ts |
| Node.js fs/promises | built-in | File operations | Standard, no external deps needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:path | built-in | Cross-platform path handling | All file path operations |
| node:crypto | built-in | Content hashing | Vault sync manifest (already used) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom recursive scanner | glob library | Existing codebase uses readdir; glob-expander.ts already exists for vault collection. Scanner needs targeted update, not replacement |
| New MCP tool module | Extending existing tool | validate-doc-structure is genuinely new functionality, warrants its own file |

**Installation:**
No new dependencies required. All work uses existing stack.

## Architecture Patterns

### Current Project Structure (MCP Server)
```
mcp-server/src/
├── registry/           # Pattern registry (scanner, frontmatter, types, resolver, project-discovery)
├── tools/              # MCP tool implementations (find-pattern, sync-vault, etc.)
├── vault/              # Vault pipeline (collector, transformer, moc-generator, vault-writer, sync-engine)
├── utils/              # Shared utilities (paths, logger, rate-limiter)
├── resources/          # MCP resource handlers
├── prompts/            # MCP prompt templates
├── cli/                # CLI entrypoints
├── generation/         # Detekt rule generation
├── monitoring/         # Source monitoring engine
├── types/              # Shared type definitions
└── server.ts           # Server bootstrap
```

### Pattern 1: MCP Tool Registration
**What:** Each tool is a separate file exporting a `registerXxxTool(server, limiter?)` function
**When to use:** New validate-doc-structure tool
**Example:**
```typescript
// Source: mcp-server/src/tools/find-pattern.ts (existing pattern)
export function registerValidateDocStructureTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "validate-doc-structure",
    {
      title: "Validate Doc Structure",
      description: "...",
      inputSchema: z.object({
        project: z.string().optional(),
        generate_index: z.boolean().optional().default(false),
      }),
    },
    async ({ project, generate_index }) => { /* ... */ },
  );
}
```

### Pattern 2: Scanner with Recursive Subdirectory Support
**What:** Current scanner.ts uses flat `readdir` -- needs recursive scanning for subdirectories
**When to use:** After docs reorganized into subdirectories
**Current code (scanner.ts:35-40):**
```typescript
// CURRENT: only scans top-level .md files
files = await readdir(dirPath);
const mdFiles = files.filter((f) => f.endsWith(".md"));
```
**Required change:** Use `readdir(dirPath, { recursive: true })` (Node.js 18.17+) or implement recursive walk. Must also update slug derivation to handle nested paths.

### Pattern 3: Vault Collector L0 Routing
**What:** Collector routes L0 patterns to `L0-generic/patterns/{slug}.md` (flat)
**When to use:** Must update to include category subdirectory
**Current code (collector.ts:177):**
```typescript
relativePath: normalizePath(`L0-generic/patterns/${entry.slug}.md`),
```
**Required change:** Read category from frontmatter, route to `L0-generic/patterns/{category}/{slug}.md`

### Pattern 4: MOC Generator Grouping
**What:** Current MOC pages list entries in flat lists per scope/project/layer
**When to use:** Must refactor to group by category within each section
**Current code (moc-generator.ts:334):**
```typescript
// L0 section: flat list
for (const entry of l0Entries) {
  content += `- ${formatWikilink(entry)}\n`;
}
```
**Required change:** Group entries by category within each layer section

### Pattern 5: Skill Definition Structure
**What:** Skills follow SKILL.md format with Usage/Parameters/Behavior/Implementation
**When to use:** New /doc-reorganize skill
**Source:** skills/sync-vault/SKILL.md (existing reference)

### Anti-Patterns to Avoid
- **Hardcoding file lists:** The codebase uses dynamic scanning everywhere. Never hardcode which docs go where -- read the `category` frontmatter field
- **Breaking existing slug-based references:** Vault wikilinks use `[[slug]]` format. Obsidian resolves by unique filename regardless of directory. Changing filenames would break links; moving to subdirectories does not
- **Modifying scanner to require category:** Category field should be optional in PatternMetadata to avoid breaking existing docs that have not yet been tagged
- **Non-atomic file operations:** File moves AND reference updates must happen together, not in separate commits

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-project discovery | Custom project finder | `project-discovery.ts` `discoverProjects()` | Already handles settings.gradle.kts scanning and projects.yaml fallback |
| Frontmatter parsing | Custom YAML parser | `frontmatter.ts` `parseFrontmatter()` | Handles BOM, CRLF, edge cases already |
| Glob expansion | Custom file walker | `glob-expander.ts` `expandGlobs()` | Already supports include/exclude patterns for vault collection |
| Vault file writing | Direct fs.writeFile | `vault-writer.ts` `writeVault()` | Handles manifest tracking, hash comparison, orphan detection |
| Rate limiting | Per-tool throttling | `rate-limiter.ts` shared instance | 30/min limit already configured for all tools |

**Key insight:** Nearly every building block needed for this phase already exists in the codebase. The work is extending existing modules (adding `category` to types, making scanner recursive, updating collector routing) rather than building from scratch.

## Common Pitfalls

### Pitfall 1: Scanner Slug Derivation Breaking After Subdirectories
**What goes wrong:** Current scanner derives slug from `filename.replace(/\.md$/, "")`. After moving to subdirectories, the scanner needs to handle nested paths without changing slug values (slugs must remain stable for vault wikilinks, docs:// URIs, and cross-references).
**Why it happens:** Scanner uses `readdir` which returns filenames only. Recursive scanning returns relative paths.
**How to avoid:** Keep slug derivation from basename only (not full path). The `category` metadata comes from frontmatter, not directory structure.
**Warning signs:** Vault wikilinks breaking, docs:// URIs 404ing, find-pattern returning empty results.

### Pitfall 2: Reference Updates Missing Cross-Project Paths
**What goes wrong:** Moving `docs/testing-patterns.md` to `docs/testing/testing-patterns.md` but missing references in versions-manifest.json, vault-config.json excludeGlobs, or other projects' cross-reference links.
**Why it happens:** References to docs paths exist in multiple locations across multiple repos.
**How to avoid:** Systematic grep for old paths before committing. Check: (a) markdown cross-references in other docs, (b) versions-manifest.json, (c) review-state.json (does not exist -- skip), (d) vault-config.json excludeGlobs, (e) DawSync delegate files (confirmed: delegates reference AndroidCommonDoc/.claude/commands/ not docs/).
**Warning signs:** Broken links in markdown, vault sync errors, monitor-sources finding stale paths.

### Pitfall 3: DawSync Mixed Structure
**What goes wrong:** DawSync already has SOME subdirectories (architecture/, guides/, legal/, archive/, references/, images/) but also has flat files at docs/ root. Moving files from flat to subdirs while preserving existing subdirectory contents is error-prone.
**Why it happens:** Phase 14 partially restructured DawSync but left some files flat.
**How to avoid:** Map current DawSync structure completely before moves. Current state: 10 flat files + 1 pdf + 1 drawio + 1 dir (CODEX_AUDITY) at root, plus existing subdirs (architecture, archive, guides, images, legal, references).
**Warning signs:** Files ending up in wrong directories, losing existing subdirectory structure.

### Pitfall 4: L1 Legacy Files Without Frontmatter
**What goes wrong:** 5 shared-kmp-libs docs (CONVENTION_PLUGINS.md, API_EXPOSURE_PATTERN.md, GRADLE_SETUP.md, ERROR_HANDLING_PATTERN.md, TESTING_STRATEGY.md) have NO frontmatter. They need category fields added before or during the move. 2 of these get renamed + moved to guides/, 3 go to archive/.
**Why it happens:** These are legacy docs predating the frontmatter standard.
**How to avoid:** For archive files: add minimal archived frontmatter (status: archived, category: archive). For guides files being renamed: add full frontmatter with category: guides during the rename operation.
**Warning signs:** Scanner skipping files, validate-doc-structure reporting missing category fields.

### Pitfall 5: Vault Collector Routing Mismatch
**What goes wrong:** After updating collector to include category subdirectories in vault paths, existing vault entries at old paths become orphans. If autoClean is false, both old and new paths exist.
**Why it happens:** vault-writer tracks paths in sync-manifest.json. Path change = new file + orphan old file.
**How to avoid:** Run vault sync with `--clean` mode after reorganization to remove orphans. Or run `--init` to reset the vault completely.
**Warning signs:** Duplicate entries in vault, orphan count growing in vault-status.

### Pitfall 6: DawSync Docs Without Frontmatter
**What goes wrong:** Most DawSync flat docs (BUSINESS_STRATEGY.md, FEATURE_INVENTORY.md, etc.) have no frontmatter at all. Adding category field requires adding full frontmatter blocks.
**Why it happens:** DawSync docs were written before the L0 template standard.
**How to avoid:** For DawSync L2 docs, add minimal frontmatter with at least `category` field. Full frontmatter is ideal but not required for REORG-04 compliance -- the requirement says "category frontmatter field added" not "full L0-standard frontmatter."
**Warning signs:** validate-doc-structure failing on DawSync docs that still lack category field.

## Code Examples

### Adding `category` to PatternMetadata
```typescript
// Source: mcp-server/src/registry/types.ts (extend existing)
export interface PatternMetadata {
  // ... existing fields ...
  category?: string;  // NEW: domain category (e.g., "testing", "architecture")
}
```

### Scanner Recursive Directory Support
```typescript
// Source: mcp-server/src/registry/scanner.ts (required update)
// Use recursive readdir to find .md files in subdirectories
import { readdir } from "node:fs/promises";

async function findMdFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const mdFiles: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory() && entry.name !== "archive") {
      // Recurse into subdirectories (skip archive/)
      const nested = await findMdFiles(fullPath);
      mdFiles.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      mdFiles.push(fullPath);
    }
  }
  return mdFiles;
}
```

### Extracting Category from Frontmatter in Scanner
```typescript
// Source: mcp-server/src/registry/scanner.ts (extend metadata extraction)
const metadata: PatternMetadata = {
  // ... existing fields ...
  category: typeof data.category === "string" ? data.category : undefined,
};
```

### validate-doc-structure Tool Skeleton
```typescript
// Source: mcp-server/src/tools/validate-doc-structure.ts (new file)
export function registerValidateDocStructureTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "validate-doc-structure",
    {
      title: "Validate Doc Structure",
      description:
        "Validate that docs have category frontmatter and are in correct subdirectories. " +
        "Cross-project: discovers all projects via project-discovery. " +
        "Use --generate-index to produce docs/README.md.",
      inputSchema: z.object({
        project: z.string().optional().describe("Specific project name, or omit for all"),
        generate_index: z.boolean().optional().default(false)
          .describe("Generate/update docs/README.md index file"),
      }),
    },
    async ({ project, generate_index }) => {
      // 1. Discover projects (reuse project-discovery.ts)
      // 2. For each project: scan docs/ recursively
      // 3. For each .md file: check category field exists, verify subdir matches category
      // 4. Check cross-references resolve
      // 5. If generate_index: write docs/README.md
      // 6. Return structured JSON result
    },
  );
}
```

### find-pattern --category Filter Extension
```typescript
// Source: mcp-server/src/tools/find-pattern.ts (extend existing)
// Add to inputSchema:
category: z
  .string()
  .optional()
  .describe("Filter results by category (e.g., 'testing', 'architecture')"),

// Add to filter logic (after token matching):
if (category) {
  matches = matches.filter((e) =>
    e.metadata.category?.toLowerCase() === category.toLowerCase()
  );
}
```

### Collector L0 Routing with Category Subdirectory
```typescript
// Source: mcp-server/src/vault/collector.ts (update L0 pattern routing)
// BEFORE:
relativePath: normalizePath(`L0-generic/patterns/${entry.slug}.md`),

// AFTER:
const category = entry.metadata.category ?? "uncategorized";
relativePath: normalizePath(`L0-generic/patterns/${category}/${entry.slug}.md`),
```

### Category-Grouped MOC Content
```typescript
// Source: mcp-server/src/vault/moc-generator.ts (refactor pattern)
// Group entries by category within layer sections
function groupByCategory(entries: VaultEntry[]): Map<string, VaultEntry[]> {
  const byCategory = new Map<string, VaultEntry[]>();
  for (const entry of entries) {
    const category = (entry.frontmatter.category as string) ?? "uncategorized";
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category)!.push(entry);
  }
  return byCategory;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Flat docs/ with 42+ files | Domain-based subdirectories | Phase 14.1 (this phase) | AI agent loads specific domain, not full flat listing |
| Scope-based search only | Category + scope search | Phase 14.1 (this phase) | Precise domain filtering via --category |
| Flat vault patterns/ dir | Category-mirrored vault dirs | Phase 14.1 (this phase) | Obsidian reflects source organization |
| Flat link MOC pages | Category-grouped MOC pages | Phase 14.1 (this phase) | Reduced visual noise, better navigation |
| `readdir` flat scan | Recursive directory scan | Phase 14.1 (this phase) | Scanner handles subdirectory structure |

**Deprecated/outdated:**
- Flat docs/ structure: Being replaced by this phase
- Flat vault routing (`L0-generic/patterns/{slug}.md`): Being replaced with category-based routing

## File Inventory Analysis

### AndroidCommonDoc (L0) -- 42 docs + 1 archive
Current flat structure. All files have YAML frontmatter.

| Target Subdirectory | Files | Hub+Sub-doc Groups |
|---------------------|-------|-------------------|
| architecture/ | 3 | kmp-architecture + 2 sub-docs |
| testing/ | 5 | testing-patterns + 4 sub-docs |
| error-handling/ | 4 | error-handling-patterns + 3 sub-docs |
| ui/ | 4 | ui-screen-patterns + 3 sub-docs (viewmodel-* are separate from ui-screen-*) |
| gradle/ | 4 | gradle-patterns + 3 sub-docs |
| offline-first/ | 4 | offline-first-patterns + 3 sub-docs |
| compose/ | 4 | compose-resources-patterns + 3 sub-docs |
| resources/ | 3 | resource-management-patterns + 2 sub-docs |
| di/ | 1 | di-patterns.md (standalone) |
| navigation/ | 1 | navigation3-patterns.md (standalone) |
| storage/ | 1 | storage-patterns.md (standalone) |
| guides/ | 3 | doc-template.md, agent-consumption-guide.md, claude-code-workflow.md |
| archive/ | 1 | enterprise-integration-proposal.md (already archived) |

**NOTE on ui/ classification:** CONTEXT.md specifies ui/ gets `ui-screen-components, ui-screen-navigation (2 files)`. The viewmodel-* docs (viewmodel-state-patterns + 3 sub-docs = 4 files) and ui-screen-patterns + ui-screen-structure are separate. Need to verify: does `ui/` get all ui-screen-* AND viewmodel-* files (8 total) or only the 2 files stated? The CONTEXT.md listing shows 2 files for ui/ which seems incomplete -- the hub ui-screen-patterns and viewmodel-state-patterns hubs should be checked. Research finding: ui-screen-patterns.md is a hub with sub-docs (ui-screen-components, ui-screen-navigation, ui-screen-structure). The viewmodel docs (viewmodel-state-patterns + viewmodel-events, viewmodel-navigation, viewmodel-state-management) form another group. The CONTEXT.md ui/ listing of "2 files" likely refers to the non-hub files or is incomplete. The planner should clarify whether viewmodel-* docs go to a `viewmodel/` subdirectory or to `ui/`.

### shared-kmp-libs (L1) -- 27 files + 1 .docx
22 files have frontmatter; 5 legacy uppercase files do not.

| Target Subdirectory | Files | Notes |
|---------------------|-------|-------|
| security/ | 3 | security-encryption.md, security-keys.md, auth-biometric.md |
| oauth/ | 4 | oauth-api.md, oauth-browser.md, oauth-native.md, oauth-1a.md |
| storage/ | 7 | storage-guide.md, storage-mmkv.md, storage-datastore.md, storage-secure.md, storage-sql.md, storage-sql-cipher.md, storage-thin-modules.md |
| domain/ | 3 | domain-billing.md, domain-gdpr.md, domain-misc.md |
| firebase/ | 1 | firebase-modules.md |
| foundation/ | 1 | foundation-modules.md |
| io/ | 2 | io-network-modules.md, error-mappers.md |
| guides/ | 2 | module-catalog.md + 2 renamed: CONVENTION_PLUGINS.md -> convention-plugins.md, API_EXPOSURE_PATTERN.md -> api-exposure-pattern.md |
| archive/ | 4 | GRADLE_SETUP.md, ERROR_HANDLING_PATTERN.md, TESTING_STRATEGY.md, SBOM Best Practices KMP.docx |

### DawSync (L2) -- Mixed structure
Already has subdirectories: architecture/ (3 files + diagrams/), guides/ (6 files), legal/ (12 files including README), archive/ (many), references/ (3 files), images/ (flat).
Flat files at root: 10 .md + 1 .pdf + 1 .drawio + 1 dir (CODEX_AUDITY).

| Target Subdirectory | Current Location | Files |
|---------------------|-----------------|-------|
| architecture/ | Already there | PATTERNS.md, PRODUCER_CONSUMER.md, SYSTEM_ARCHITECTURE.md, diagrams/ |
| guides/ | Already there | NAVIGATION.md, TESTING.md, CAPTURE_SYSTEM.md, MEDIA_SESSION.md, KMP_RESOURCES.md, ACCESSIBILITY.md |
| legal/ | Already there | All privacy/terms/cookies docs (12 files) |
| business/ | Flat root -> move | BUSINESS_STRATEGY.md, DawSync_Business_Plan.pdf, VIABILITY_AUDIT.md, SCALING_PLAN.md, DAWSYNC_PARA_ARTISTAS.md |
| product/ | Flat root -> move | PRODUCT_SPEC.md, FEATURE_INVENTORY.md, RISKS_RULES.md |
| tech/ | Flat root -> move | TECHNOLOGY_CHEATSHEET.md, CLAUDE_CODE_WORKFLOW.md, SBOM.md |
| references/ | Already there | ABLETON_TEST_DATA.md, ANDROID_2026.md, VST3_SPEC.yaml |
| archive/ | Already there + move | Existing archive/ content + CODEX_AUDITY/ moves here |
| images/ | Already there | Keep flat |

**sync engine web.drawio:** Moves to architecture/diagrams/ per CONTEXT.md.

## Cross-Reference Update Analysis

### Files that Reference docs/ Paths
The following reference types need updating after file moves:

1. **Markdown cross-references** (e.g., `[See testing](testing-patterns.md)`) -- within docs themselves. After move, relative paths change.
2. **versions-manifest.json** -- does NOT contain docs/ paths (verified: contains version numbers only). No update needed.
3. **review-state.json** -- does NOT exist (verified). No update needed.
4. **vault-config.json** -- excludeGlobs already has `"docs/archive/**"` for DawSync. After reorganization, archive/ is a docs subdirectory in all projects. The glob `"**/archive/**"` in getDefaultExcludes() already handles this. DawSync-specific `"docs/archive/**"` is redundant but harmless.
5. **DawSync delegate files** -- Reference `AndroidCommonDoc/.claude/commands/` not docs/ paths (verified). No update needed.
6. **Scanner/collector code** -- Uses `readdir(docsDir)` which needs recursive support. Code change, not path reference update.
7. **Markdown internal links** -- Hub docs reference sub-docs with relative links like `[Coroutines](testing-patterns-coroutines.md)`. After move to same subdirectory, these links still work (same directory). No update needed if hub+sub-docs stay together (which they do per locked decision).

**Key insight:** Most cross-references are self-contained within hub+sub-doc groups that move together. The main reference update work is for docs that cross-reference OTHER docs (e.g., agent-consumption-guide.md references multiple pattern docs by slug).

## Open Questions

1. **ui/ subdirectory scope**
   - What we know: CONTEXT.md lists "ui/ -- ui-screen-components, ui-screen-navigation (2 files)". But ui-screen-patterns.md is a hub with 3 sub-docs (components, navigation, structure), and viewmodel-state-patterns.md is a hub with 3 sub-docs (events, navigation, state-management).
   - What's unclear: Do viewmodel-* docs go to ui/ or to a separate viewmodel/ subdirectory? Where does ui-screen-patterns.md (the hub) go?
   - Recommendation: All ui-screen-* and viewmodel-* docs should go to ui/ since CONTEXT.md does not list a viewmodel/ subdirectory. The "2 files" listing was likely shorthand. The planner should place all 8 files in ui/.

2. **DawSync diagram subdirectory naming**
   - What we know: 10 files in architecture/diagrams/, CONTEXT.md says "exact subdirectories determined during execution by reading filenames"
   - What's unclear: Whether to organize by domain inside diagrams/ or keep flat
   - Recommendation: Read filenames during execution, group by prefix if natural grouping emerges (planner's discretion per CONTEXT.md)

3. **DawSync CODEX_AUDITY/ handling**
   - What we know: CODEX_AUDITY is a directory at docs/ root, CONTEXT.md says it moves to archive/
   - What's unclear: Whether to preserve internal structure or flatten
   - Recommendation: Move as-is to archive/CODEX_AUDITY/ preserving internal structure

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^3.0.0 |
| Config file | mcp-server/vitest.config.ts |
| Quick run command | `cd mcp-server && npx vitest run tests/unit` |
| Full suite command | `cd mcp-server && npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REORG-01 | L0 files in correct subdirs with category frontmatter | integration | `cd mcp-server && npx vitest run tests/integration/doc-structure.test.ts -x` | Wave 0 |
| REORG-02 | L1 files in correct subdirs, renames verified | integration | `cd mcp-server && npx vitest run tests/integration/doc-structure.test.ts -x` | Wave 0 |
| REORG-03 | L2 files restructured correctly | integration | `cd mcp-server && npx vitest run tests/integration/doc-structure.test.ts -x` | Wave 0 |
| REORG-04 | category field present in all docs | unit | `cd mcp-server && npx vitest run tests/unit/registry/scanner.test.ts -x` | Exists (extend) |
| REORG-05 | validate-doc-structure tool works | unit | `cd mcp-server && npx vitest run tests/unit/tools/validate-doc-structure.test.ts -x` | Wave 0 |
| REORG-06 | find-pattern --category filter works, scanner recursive | unit | `cd mcp-server && npx vitest run tests/unit/tools/find-pattern.test.ts tests/unit/registry/scanner.test.ts -x` | Exists (extend) |
| REORG-07 | Vault mirroring, category MOCs, skill created | unit+integration | `cd mcp-server && npx vitest run tests/unit/vault/moc-generator.test.ts tests/unit/vault/collector.test.ts -x` | Exists (extend) |

### Sampling Rate
- **Per task commit:** `cd mcp-server && npx vitest run tests/unit --reporter=verbose`
- **Per wave merge:** `cd mcp-server && npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/tools/validate-doc-structure.test.ts` -- covers REORG-05
- [ ] `tests/integration/doc-structure.test.ts` -- covers REORG-01, REORG-02, REORG-03 (validates files are in correct subdirs after moves)
- [ ] Extend `tests/unit/registry/scanner.test.ts` -- recursive scanning + category extraction
- [ ] Extend `tests/unit/tools/find-pattern.test.ts` -- --category filter
- [ ] Extend `tests/unit/vault/moc-generator.test.ts` -- category-grouped output
- [ ] Extend `tests/unit/vault/collector.test.ts` -- category-based routing

## Execution Order Recommendation

Based on dependency analysis:

**Wave 1: Foundation (Tooling + L0 prep)**
- Add `category` to PatternMetadata type
- Make scanner recursive (handle subdirectories)
- Add category to frontmatter extraction in scanner
- Update find-pattern with --category filter
- Write tests for all above

**Wave 2: L0 Reorganization**
- Add `category` frontmatter field to all 42 L0 docs
- Move files to subdirectories (13 subdirs)
- Update any cross-references between docs
- Build validate-doc-structure tool (validates L0 first)
- Generate docs/README.md for L0
- Atomic commit

**Wave 3: L1 Reorganization**
- Add `category` frontmatter to 22 L1 docs with frontmatter
- Add frontmatter + archive metadata to 5 legacy docs
- Rename CONVENTION_PLUGINS.md -> convention-plugins.md, API_EXPOSURE_PATTERN.md -> api-exposure-pattern.md
- Move files to 9 subdirectories
- Generate docs/README.md for L1
- Atomic commit

**Wave 4: L2 Reorganization**
- Add `category` frontmatter to DawSync flat docs
- Move flat files to target subdirectories
- Move CODEX_AUDITY/ to archive/
- Move sync engine web.drawio to architecture/diagrams/
- Generate docs/README.md for L2
- Atomic commit

**Wave 5: Vault Optimization**
- Update collector L0 routing for category subdirectories
- Update collector L1/L2 routing for category subdirectories
- Refactor MOC generator for category-grouped output
- Redesign Home.md as category navigation tree
- Update vault-config.json excludeGlobs
- Create /doc-reorganize skill
- Run vault sync with --init (clean slate for new paths)
- Verify in Obsidian

**Wave 6: Verification**
- Run validate-doc-structure across all 3 projects
- Run full quality gate
- Run vault-status health check
- Manual Obsidian verification

## Sources

### Primary (HIGH confidence)
- mcp-server/src/registry/types.ts -- PatternMetadata type definition, current fields
- mcp-server/src/registry/scanner.ts -- Current flat scanning implementation
- mcp-server/src/registry/frontmatter.ts -- YAML frontmatter parser
- mcp-server/src/tools/find-pattern.ts -- Current tool schema and filter logic
- mcp-server/src/vault/collector.ts -- L0/L1/L2 collection routing
- mcp-server/src/vault/moc-generator.ts -- Current MOC generation (flat lists)
- mcp-server/src/vault/transformer.ts -- Source-to-vault transformation
- mcp-server/src/vault/vault-writer.ts -- Write + manifest + orphan detection
- mcp-server/src/vault/config.ts -- Default globs and excludes
- mcp-server/src/tools/index.ts -- Tool registration aggregator
- docs/ directory listing -- All 42 L0 files verified
- shared-kmp-libs/docs/ listing -- All 27 L1 files verified
- DawSync/docs/ listing -- Current mixed structure verified
- vault-config.json -- Current project configurations
- versions-manifest.json -- Confirmed no docs/ path references
- DawSync delegate files -- Confirmed no docs/ path references

### Secondary (MEDIUM confidence)
- Node.js fs/promises readdir recursive option -- Available since Node.js 18.17; MCP server targets Node.js 22+

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All existing stack, no new dependencies
- Architecture: HIGH -- All source files read and analyzed, patterns verified
- Pitfalls: HIGH -- Based on direct code analysis, not training data
- File inventory: HIGH -- All directories listed and counted from filesystem
- Execution order: MEDIUM -- Logical based on dependencies, but planner may optimize differently

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable -- no external dependencies changing)