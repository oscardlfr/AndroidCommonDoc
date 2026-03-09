# Phase 17: Documentation Structural Homogeneity - Research

**Researched:** 2026-03-16
**Domain:** Vault sync pipeline, cross-layer documentation validation, structural homogeneity
**Confidence:** HIGH

## Summary

Phase 17 addresses systemic vault quality issues that caused the Phase 16 checkpoint to be rejected. The research identified three root cause categories: (1) a double-write bug in the vault collector's path routing that produces duplicate files from the same source, (2) missing excludeGlobs for `.planning/codebase/` and `.planning/research/` content that leaks UPPERCASE planning files into the vault, and (3) the absence of pre-sync deduplication detection. Additionally, L0 docs lack top-level hub files for most subdirectories, CLAUDE.md files need Boris Cherny-style restructuring, and no cross-layer validation tooling exists for dedup/homogeneity/reference-integrity.

The existing MCP validation infrastructure (validate-doc-structure, validate-claude-md, validate-skills) is mature and extensible. New validation capabilities can follow the same pattern: exported pure functions for logic + MCP tool registration. The test infrastructure uses Vitest with tmpdir-based fixtures and env stubbing.

**Primary recommendation:** Fix the collector double-write bug and excludeGlob gaps first (these are the 64-duplicate root cause), then build validation tooling, then restructure source docs, then resync.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- vault-config.json MUST exclude `.planning/codebase/**` and `.planning/research/**` from DawSync collection -- these leak UPPERCASE duplicates
- Transformer MUST NOT produce both UPPERCASE_SNAKE and lowercase-kebab versions of the same file -- one canonical naming only (lowercase-kebab-case)
- Subproject naming in vault must be normalized (no "DawSyncWeb" vs "web" duplication)
- Deduplication check must run BEFORE vault materialization -- reject sync if duplicates detected
- ALL docs across L0/L1/L2 must follow hub->sub-doc pattern where applicable
- Hub docs: <100 lines, summarize + link to sub-docs
- Sub-docs: <300 lines, focused on single topic
- L0 gaps: compose/ needs hub file, storage/ needs hub file, guides/ needs reorganization
- L1 gaps: 54 scattered module READMEs need consolidation with 31 docs/ files into unified structure
- L2 gaps: archive/ bloat cleanup, .planning/ overlap removal
- Build MCP tools that detect: duplicates across vault, structural homogeneity violations, broken L2->L1->L0 references, missing wikilinks
- Validation must run before vault sync and flag issues
- Each layer must observe the layer below correctly (L2 refs L1, L1 refs L0)
- Follow Boris Cherny's CLAUDE.md style: concise, categorized sections (Workflow, Tasks, Principles), actionable rules, no fluff
- All 4 CLAUDE.md files (L0 global, L0 toolkit, L1, L2) must be restructured
- Context budget: <150 lines per CLAUDE.md
- L0 (AndroidCommonDoc): Fix hub gaps (compose, storage, guides), ensure all 14 categories have consistent hub->sub-doc structure
- L1 (shared-kmp-libs): Consolidate module docs into coherent structure, enforce hub->sub-doc in all 10 categories
- L2 (DawSync): Clean archive (21 root + CODEX_AUDITY + superseded), remove .planning/ content overlap, normalize subproject docs (DawSyncWeb, SessionRecorder-VST3)
- File naming: ALL files must be lowercase-kebab-case across all layers
- Run ALL validation tools before sync
- Vault must have: 0 duplicates, 0 orphans, consistent naming, working wikilinks
- Human checkpoint: user verifies Obsidian graph view, MOC navigation, wikilink connectivity

### Claude's Discretion
- Internal implementation of MCP validation tools (test structure, assertion patterns)
- Specific hub doc content for L0 compose/ and storage/ hubs
- Archive cleanup strategy details (what to keep vs. delete in DawSync archive)
- Wikilink injection heuristics refinement

### Deferred Ideas (OUT OF SCOPE)
- OmniSound documentation (no docs/ directory yet -- too early stage)
- WakeTheCave documentation alignment (not in active scope)
- Command promotion to skills (from Phase 14.2.1 decision -- 11 commands recommended)
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vitest | (project current) | Test framework | Already used in mcp-server/tests/ |
| Zod | (project current) | Schema validation for MCP tools | Already used for all MCP tool input schemas |
| yaml | (project current) | YAML frontmatter stringification | Already used in transformer.ts |
| @modelcontextprotocol/sdk | (project current) | MCP server SDK | Already used for all tool registration |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:crypto | built-in | Content hashing for dedup detection | Vault deduplication pre-check |
| node:fs/promises | built-in | File I/O | All file operations |

No new dependencies are needed. Everything builds on the existing MCP server codebase.

## Architecture Patterns

### Existing Project Structure (mcp-server/)
```
src/
├── tools/           # MCP tool implementations (validate-*, sync-vault, etc.)
├── vault/           # Vault pipeline (collector, transformer, writer, config, types)
├── registry/        # Pattern registry (scanner, frontmatter, resolver, skill-registry)
├── utils/           # Shared utilities (paths, logger, rate-limiter)
├── monitoring/      # Source monitoring engine
└── generation/      # Detekt rule generation
tests/
├── unit/            # Unit tests mirroring src/ structure
│   ├── tools/       # validate-*.test.ts, sync-vault.test.ts
│   ├── vault/       # collector.test.ts, transformer.test.ts, etc.
│   └── registry/    # scanner.test.ts, frontmatter.test.ts
└── integration/     # vault-sync.test.ts, doc-structure.test.ts
```

### Pattern 1: MCP Validation Tool Structure
**What:** Every validation tool follows the same pattern: exported pure functions for logic + registerTool for MCP exposure
**When to use:** All new validation capabilities

```typescript
// Source: existing validate-doc-structure.ts, validate-claude-md.ts, validate-skills.ts

// 1. Export pure validation functions (testable without MCP)
export function validateSomething(input: SomeInput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  // ... validation logic ...
  return { errors, warnings };
}

// 2. Register as MCP tool with Zod schema
export function registerValidateSomethingTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool("validate-something", {
    title: "Validate Something",
    description: "...",
    inputSchema: z.object({ /* ... */ }),
  }, async (params) => {
    const result = await validateSomething(/* ... */);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });
}
```

### Pattern 2: Vault Test Fixtures
**What:** Tests use tmpdir-based fixture directories with env stubbing
**When to use:** All vault pipeline tests

```typescript
// Source: mcp-server/tests/unit/vault/collector.test.ts
let tmpDir: string;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-prefix-"));
  vi.stubEnv("ANDROID_COMMON_DOC", tmpDir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});
```

### Anti-Patterns to Avoid
- **Modifying source docs during sync:** The vault is a read-only enriched view. Never write back to source repos from the sync pipeline.
- **Testing with real filesystem paths:** Always use tmpdir fixtures to avoid flaky tests and accidental modifications.
- **Coupling validation logic to MCP:** Keep validation functions pure and exported; MCP registration is just a thin wrapper.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Glob expansion | Custom regex matcher | Existing `glob-expander.ts` | Already handles `**`, `*`, exclude patterns |
| Frontmatter parsing | Manual YAML parse | Existing `parseFrontmatter()` from registry | Handles edge cases, consistent across codebase |
| File dedup detection | Ad-hoc comparison | Content hash (SHA-256) comparison | Already used in vault-writer.ts `computeHash()` |
| Cross-project discovery | Hardcoded paths | Existing `discoverProjects()` | Already handles includeBuild detection |

## Common Pitfalls

### Pitfall 1: Double-Write Bug in Collector Path Routing
**What goes wrong:** The `collectProjectSources` function in collector.ts produces duplicate vault paths for `.planning/codebase/` files. The `subdivisionIdx` calculation using `indexOf("planning/")` finds a match inside `.planning/` (at index 1 after the dot), but the path routing logic can produce TWO output paths for the same source file.
**Root cause:** The `.planning/codebase/ARCHITECTURE.md` file path contains `planning/` which the subdivision lookup finds, but the routing logic in `collectProjectSources` may create entries under both `planning/codebase/` and `planning/` paths. Investigation shows all 7 `.planning/codebase/` files appear twice in the vault with identical `vault_source` paths.
**How to avoid:** Add deduplication by absolute source path in `collectProjectSources` or `collectAll`. Ensure each source file maps to exactly ONE vault path.
**Warning signs:** `vault_source` field showing same path for two different vault files.

### Pitfall 2: Missing excludeGlobs for .planning/research/
**What goes wrong:** DawSync's `.planning/research/` contains ARCHITECTURE.md, FEATURES.md, PITFALLS.md, STACK.md, SUMMARY.md. DawSyncWeb also has these files. The vault-config.json excludeGlobs do NOT include `.planning/research/**`, allowing these UPPERCASE files to leak into the vault.
**Root cause:** The default `getDefaultExcludes()` function excludes `.planning/phases/**` but NOT `.planning/research/**`. The DawSync vault-config has custom excludeGlobs that also miss `.planning/research/**`.
**How to avoid:** Add `.planning/research/**` to both `getDefaultExcludes()` and the DawSync vault-config excludeGlobs.
**Warning signs:** UPPERCASE filenames in vault output (ARCHITECTURE.md, STACK.md, etc.).

### Pitfall 3: Subproject Naming Collision
**What goes wrong:** DawSyncWeb appears both as a configured subproject (external path) and potentially as an auto-detected subproject via `subProjectScanDepth: 1`. The `collectAll` function deduplicates by name, but naming must be consistent.
**Root cause:** The DawSyncWeb subproject path in vault-config is external (`C:\Users\...\DawSyncWeb`) while auto-detected subprojects use relative paths from the parent.
**How to avoid:** The existing dedup by `configuredNames` set should handle this, but verify the names match exactly.

### Pitfall 4: Windows Path Separator Issues
**What goes wrong:** Glob matching and path comparison fail when Windows backslashes are mixed with forward slashes.
**Root cause:** `path.join()` on Windows produces backslash separators; the vault pipeline normalizes to forward slashes but not consistently at every boundary.
**How to avoid:** The `normalizePath()` function exists but ensure it's applied to ALL path comparisons, especially in the new dedup checking logic.

### Pitfall 5: Hub File Line Count Budget
**What goes wrong:** Hub files grow beyond 100 lines when adding sub-doc links, making them lose their navigation-only purpose.
**Root cause:** Adding too much content alongside the sub-document links.
**How to avoid:** Hub = title + 1-paragraph summary + sub-doc links table. NOTHING else.

## Code Examples

### Dedup Detection (New Capability Needed)
```typescript
// Add to vault pipeline BEFORE materialization
export function detectDuplicates(entries: VaultEntry[]): string[] {
  const errors: string[] = [];
  const seenPaths = new Map<string, string>(); // vaultPath -> slug

  for (const entry of entries) {
    const normalized = entry.vaultPath.toLowerCase();
    if (seenPaths.has(normalized)) {
      errors.push(
        `Duplicate vault path: "${entry.vaultPath}" (slug: ${entry.slug}) ` +
        `collides with slug: ${seenPaths.get(normalized)}`
      );
    }
    seenPaths.set(normalized, entry.slug);
  }

  // Also check for same source file -> multiple vault paths
  const sourceToVaultPaths = new Map<string, string[]>();
  for (const entry of entries) {
    const source = entry.frontmatter.vault_source as string;
    if (!source) continue;
    const existing = sourceToVaultPaths.get(source) ?? [];
    existing.push(entry.vaultPath);
    sourceToVaultPaths.set(source, existing);
  }

  for (const [source, paths] of sourceToVaultPaths) {
    if (paths.length > 1) {
      errors.push(
        `Source file "${source}" mapped to ${paths.length} vault paths: ${paths.join(", ")}`
      );
    }
  }

  return errors;
}
```

### Structural Homogeneity Check (New Capability Needed)
```typescript
// Check that each docs/ subdirectory has a hub file
export async function checkHubPresence(docsDir: string): Promise<string[]> {
  const warnings: string[] = [];
  const subdirs = await readdir(docsDir, { withFileTypes: true });

  for (const subdir of subdirs) {
    if (!subdir.isDirectory()) continue;
    if (SKIP_DIRS.has(subdir.name)) continue;

    const subdirPath = path.join(docsDir, subdir.name);
    const files = await readdir(subdirPath);
    const mdFiles = files.filter(f => f.endsWith(".md"));

    // A hub file should contain "## Sub-documents" section
    let hasHub = false;
    for (const file of mdFiles) {
      const content = await readFile(path.join(subdirPath, file), "utf-8");
      if (content.includes("## Sub-documents")) {
        hasHub = true;
        break;
      }
    }

    if (!hasHub && mdFiles.length > 1) {
      warnings.push(
        `${subdir.name}/: ${mdFiles.length} files but no hub doc (missing "## Sub-documents" section)`
      );
    }
  }

  return warnings;
}
```

### Vault Config Fix
```json
{
  "name": "DawSync",
  "path": "C:\\Users\\34645\\AndroidStudioProjects\\DawSync",
  "layer": "L2",
  "excludeGlobs": [
    "**/build/**",
    "**/node_modules/**",
    "**/.gradle/**",
    "**/dist/**",
    "**/archive/**",
    "**/.androidcommondoc/**",
    "**/coverage-*.md",
    "**/.planning/phases/**",
    "**/.planning/research/**",
    "**/.planning/codebase/**",
    "docs/archive/**"
  ]
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Flat vault structure | Layer-first (L0/L1/L2) | Phase 12 | Better hierarchy, but introduced path routing bugs |
| Manual vault sync | Automated sync-vault MCP tool | Phase 11 | Faster syncs, but bugs propagate faster |
| No doc validation | validate-doc-structure tool | Phase 14.1 | Catches category mismatches, but no dedup check |
| No CLAUDE.md validation | validate-claude-md tool | Phase 15 | Checks structure, coverage, but no Boris Cherny enforcement |

**Key observations from vault inspection:**
- 605 total .md files in vault
- 61 duplicate README.md basenames (from 52 module READMEs + other READMEs)
- 7 `.planning/codebase/` files appear TWICE (once at planning/ root, once at planning/codebase/)
- DawSyncWeb `.planning/codebase/` files appear in vault despite being infrastructure, not docs
- UPPERCASE filenames throughout planning/ subdirectories (ARCHITECTURE.md, TESTING.md, etc.)

## Open Questions

1. **Exact double-write mechanism**
   - What we know: Same source file produces two vault entries with different paths
   - What's unclear: Whether this is a bug in collectProjectSources path routing or in the sync engine merging sources
   - Recommendation: Add debug logging to trace vault path assignment per source file; add dedup detection as pre-sync gate

2. **DawSync archive cleanup scope**
   - What we know: 38 files in docs/archive/
   - What's unclear: Which are truly superseded vs. still valuable historical context
   - Recommendation: Claude's discretion per CONTEXT.md; default to keeping but excluding from vault

3. **L1 module README consolidation with docs/**
   - What we know: 52 module READMEs + ~31 docs/ files = separate collections
   - What's unclear: Whether module READMEs should be linked from docs/ hub files or remain standalone
   - Recommendation: Create docs/ category hub files that link to module READMEs as sub-docs

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (current project version) |
| Config file | mcp-server/vitest.config.ts |
| Quick run command | `cd mcp-server && npx vitest run --reporter=verbose` |
| Full suite command | `cd mcp-server && npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| P17-BUG | Collector double-write fix | unit | `cd mcp-server && npx vitest run tests/unit/vault/collector.test.ts -x` | Needs update |
| P17-DEDUP | Pre-sync dedup detection | unit | `cd mcp-server && npx vitest run tests/unit/vault/dedup.test.ts -x` | Wave 0 |
| P17-EXCLUDE | ExcludeGlob fix for .planning/research | unit | `cd mcp-server && npx vitest run tests/unit/vault/config.test.ts -x` | Needs update |
| P17-VALIDATE | Vault validation MCP tool | unit | `cd mcp-server && npx vitest run tests/unit/tools/validate-vault.test.ts -x` | Wave 0 |
| P17-HOMOG | Structural homogeneity check | unit | `cd mcp-server && npx vitest run tests/unit/tools/validate-doc-structure.test.ts -x` | Needs update |
| P17-NAMING | UPPERCASE -> lowercase-kebab transform | unit | `cd mcp-server && npx vitest run tests/unit/vault/transformer.test.ts -x` | Needs update |
| P17-SYNC | Final vault resync passes all checks | integration | `cd mcp-server && npx vitest run tests/integration/vault-sync.test.ts -x` | Needs update |

### Sampling Rate
- **Per task commit:** `cd mcp-server && npx vitest run --reporter=verbose`
- **Per wave merge:** `cd mcp-server && npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/vault/dedup.test.ts` -- covers P17-DEDUP (duplicate detection logic)
- [ ] `tests/unit/tools/validate-vault.test.ts` -- covers P17-VALIDATE (new MCP tool)
- [ ] Update `tests/unit/vault/collector.test.ts` -- test case for double-write prevention
- [ ] Update `tests/unit/vault/config.test.ts` -- test that .planning/research/ is excluded by default

## Sources

### Primary (HIGH confidence)
- `mcp-server/src/vault/collector.ts` -- full collector pipeline read, identified double-write path routing
- `mcp-server/src/vault/transformer.ts` -- slug derivation and naming convention logic
- `mcp-server/src/vault/config.ts` -- default globs and excludes (missing .planning/research/)
- `mcp-server/src/vault/glob-expander.ts` -- glob-to-regex expansion logic
- `mcp-server/src/vault/wikilink-generator.ts` -- wikilink injection algorithm
- `mcp-server/src/vault/types.ts` -- VaultSource, VaultEntry, VaultConfig types
- `mcp-server/src/tools/validate-doc-structure.ts` -- existing validation patterns
- `mcp-server/src/tools/validate-claude-md.ts` -- existing CLAUDE.md validation
- `mcp-server/src/tools/validate-skills.ts` -- existing skills validation
- `~/.androidcommondoc/vault-config.json` -- current vault configuration
- Vault output at `kmp-knowledge-vault/` -- direct inspection of 605 files

### Secondary (MEDIUM confidence)
- `17-CONTEXT.md` -- user decisions and specific requirements from conversation
- DawSync `.planning/codebase/` and `.planning/research/` -- confirmed UPPERCASE file leak source
- DawSyncWeb `.planning/codebase/` -- confirmed additional UPPERCASE leak source

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all existing project infrastructure, no new deps
- Architecture: HIGH -- patterns directly observed from existing codebase
- Pitfalls: HIGH -- bugs confirmed by vault output inspection with vault_source tracing
- Validation: HIGH -- existing test infrastructure well-established

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (stable internal tooling, no external dependency changes)
