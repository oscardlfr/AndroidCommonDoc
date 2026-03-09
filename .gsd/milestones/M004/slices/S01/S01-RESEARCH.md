# Phase 13: Audit & Validate - Research

**Researched:** 2026-03-14
**Domain:** Documentation audit, classification, freshness validation across KMP ecosystem
**Confidence:** HIGH

## Summary

Phase 13 is a pure analysis/report phase -- no code modifications to any project, no doc edits. The goal is to produce a machine-readable audit manifest (JSON) and executive summary covering all markdown files across 4 projects: AndroidCommonDoc (L0, 23 pattern docs), shared-kmp-libs (L1, 32+ markdown files including 14 module READMEs), DawSync (L2, ~291 files excluding worktrees), and WakeTheCave (L2 read-only, 209 files in docs/ + docs2/). Each file gets classified by layer placement, AI-readiness scored (0-5), freshness validated, and cross-project overlaps identified. The existing MCP server infrastructure (scanner, frontmatter parser, monitor-sources CLI, resolver) provides the technical backbone -- most audit logic will be scripted analysis consuming these existing modules or using them as reference patterns.

**Key discovery:** The actual file counts differ from CONTEXT.md estimates. DawSync has ~291 markdown files (excluding worktrees and .planning/), not the stated ~171. shared-kmp-libs has 51 module directories (not 15) with 14 having README.md files and 32+ total markdown files. WakeTheCave confirms at 199 + 10. These revised counts impact task scoping. DawSync's worktree copies (`.claude/worktrees/track-E/`) must be explicitly excluded from the audit to avoid double-counting.

**Primary recommendation:** Structure the audit as project-by-project waves (WakeTheCave first for read-only mining, DawSync second as largest corpus, shared-kmp-libs third for gap analysis, AndroidCommonDoc last as cross-reference against findings) with monitor-sources running as the final step against the full consolidated corpus.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Audit ALL 209 WakeTheCave files equally (docs/ 199 + docs2/ 10) -- no assumption about which directory is newer
- Conservative L0 promotion threshold: only promote if pattern is clearly sourced from official docs (Kotlin, Jetpack, KMP, Gradle)
- WakeTheCave-derived architectural insights stay as L2 candidates for manual review
- Produce full WakeTheCave doc health report (not just extraction) -- includes advisory recommendations
- Uniform AI-readiness scoring applied to WakeTheCave docs (same criteria as all projects, marked advisory-only)
- Preserve source directory structure in report (grouped by WakeTheCave subdirectory)
- Audit ALL DawSync markdown files -- docs/ (132), .claude/agents (11), .claude/commands (20+), .androidcommondoc/, root files -- nothing excluded
- Per-file output: current location, recommended layer (L0/L1/L2), AI-readiness score, action needed
- Classification is about correct layer placement, not just relevance
- Domain-specific knowledge (DAW capture, VST3, session management) stays L2
- Generic patterns that could become templates flagged for L0/L1 promotion
- DawSync patterns that should override shared-kmp-libs flagged explicitly (L2>L1 overrides)
- Agents/commands get full layer classification
- shared-kmp-libs gap analysis per module
- Target documentation level: comprehensive API-level docs for AI spec-driven development
- Check 5 docs/ files for L0 promotion candidates
- Assess CLAUDE.md (57 lines) quality
- AI-readiness scoring on all 22 markdown files
- Machine-readable manifest (JSON/YAML) with per-file entries
- Executive summary (markdown) with layer distribution + action counts
- All deliverables stored in .planning/phases/13-audit-validate/
- AI-readiness scoring criteria (standard 0-5): (1) has YAML frontmatter, (2) section size <=150 lines, (3) proper subdivision by concern, (4) no stale version refs, (5) actionable content
- Run monitor-sources against AndroidCommonDoc 23 pattern docs + shared-kmp-libs 5 docs/ + DawSync L1 pattern doc + all version refs
- Freshness results integrated into the main audit manifest (not separate)
- Report-only -- no auto-fixes. Stale refs reported for collaborative decisions
- monitor-sources runs AFTER all content is discovered
- AI spec-driven optimization is the north star
- DawSync doc audit MUST complete before Phase 14 template design
- Uniform treatment across all 4 projects

### Claude's Discretion
- Technical approach for handling docs without monitor_urls frontmatter
- Exact manifest schema (JSON vs YAML, field naming, nesting structure)
- Audit execution order across projects
- How to detect content overlaps between projects
- WakeTheCave docs/ subdirectory structure analysis depth
- shared-kmp-libs per-module doc plan format
- Freshness severity classification (HIGH vs MEDIUM vs LOW)

### Deferred Ideas (OUT OF SCOPE)
- Standard doc template design -- Phase 14 (STRUCT-01, STRUCT-02)
- Auto-fixing stale version refs -- deferred to collaborative decision
- OmniSound audit -- explicitly out of scope per v1.2 requirements
- WakeTheCave doc restructuring -- read-only for Phase 13
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUDIT-01 | Mine WakeTheCave docs/ and docs2/ for reusable KMP patterns sourced from official docs -- extract L0 promotion candidates without modifying WakeTheCave | WakeTheCave has 199 docs/ + 10 docs2/ files. docs/ organized by numbered categories (01-architecture through 08-reference plus archive). docs2/ is a clean Architecture-layer structure (domain, data, presentation, infrastructure, cross-cutting). Some docs (viewmodel-patterns.md) already point to AndroidCommonDoc as canonical. L0 candidates: patterns sourced from official Kotlin/Jetpack/KMP docs. Existing scanner/frontmatter modules can detect frontmatter presence. |
| AUDIT-02 | Audit DawSync markdown files -- classify each as ACTIVE/SUPERSEDED/UNIQUE with consolidation manifest | DawSync has ~291 files (excluding worktrees/.planning): 132 in docs/, 11 agents, 30+ commands, 8 .agents/skills, 2 .androidcommondoc, 3 agent-memory, plus root files. docs/archive/ has 79 files (most dated 2026-01). Worktrees contain duplicated copies that MUST be excluded. CLAUDE.md is 232 lines. |
| AUDIT-03 | Audit shared-kmp-libs modules -- identify documentation gaps, produce per-module doc plan | 51 module directories found (not 15 as stated in CONTEXT.md). 14 modules have README.md files. 5 docs/ files exist. CLAUDE.md is 57 lines. Many modules (error mappers, storage variants, oauth variants) lack any documentation. |
| AUDIT-04 | Review AndroidCommonDoc 8 pattern docs for completeness and accuracy gaps | 23 pattern docs exist (not 8 -- the "8" refers to hub doc groups). All have valid YAML frontmatter. 5 docs have monitor_urls configured. Frontmatter is consistent (scope, sources, targets, version, last_updated, description, slug, status). Version refs need checking against versions-manifest.json. |
| AUDIT-05 | Execute monitor-sources against full consolidated corpus -- validate freshness | monitor-sources CLI built at mcp-server/build/cli/monitor-sources.js. Currently scans only AndroidCommonDoc docs/ for entries with monitor_urls. Only 5 of 23 docs have monitor_urls. versions-manifest.json has 10 version entries (kotlin 2.3.10, compose-multiplatform 1.7.x, etc.). For docs without monitor_urls, freshness must be checked by extracting version references from content and comparing against manifest. |
| AUDIT-06 | Produce structured audit report: consolidation manifest, L0 promotion list, gap inventory, freshness report | All four sub-deliverables merged into single JSON manifest + markdown executive summary. Deliverables go to .planning/phases/13-audit-validate/. |
</phase_requirements>

## Standard Stack

### Core
| Library/Tool | Version | Purpose | Why Standard |
|--------------|---------|---------|--------------|
| Node.js | >=18.0.0 | Runtime for audit scripts | Already used by MCP server |
| TypeScript | ^5.7.0 | Type-safe scripting | Already used by MCP server |
| vitest | ^3.0.0 | Test framework | Already configured in package.json |
| yaml (npm) | ^2.8.2 | YAML frontmatter parsing | Already a dependency |

### Supporting
| Library/Tool | Purpose | When to Use |
|--------------|---------|-------------|
| mcp-server/src/registry/scanner.ts | File discovery + frontmatter extraction | Reuse for scanning all projects |
| mcp-server/src/registry/frontmatter.ts | YAML frontmatter parsing | Reuse for AI-readiness criterion 1 |
| mcp-server/src/cli/monitor-sources.ts | Freshness validation CLI | Invoke for AUDIT-05 |
| mcp-server/src/registry/resolver.ts | L0/L1/L2 layer model reference | Reference for classification logic |
| versions-manifest.json | Canonical version references | Compare against doc content |
| vault-config.json | Project paths and config | Source for project locations |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| TypeScript scripts | Shell scripts with jq | TS reuses existing scanner/frontmatter modules; shell would duplicate parsing logic |
| JSON manifest | YAML manifest | JSON has native Node.js support (no extra dependency needed for reading); YAML slightly more readable but adds parsing overhead |
| Custom overlap detection | Text similarity libraries (natural, string-similarity) | Simple topic keyword matching + manual cross-reference is sufficient for ~550 docs; full NLP overkill |

## Architecture Patterns

### Recommended Output Structure
```
.planning/phases/13-audit-validate/
  13-CONTEXT.md                    # Already exists
  13-RESEARCH.md                   # This file
  13-PLAN-*.md                     # Plans (created by planner)
  audit-manifest.json              # Machine-readable per-file manifest
  audit-report.md                  # Executive summary markdown
```

### Pattern 1: Audit Manifest Schema (JSON)
**What:** Machine-readable manifest with per-file entries
**When to use:** Primary deliverable for AUDIT-06

```json
{
  "version": 1,
  "generated": "2026-03-14T00:00:00Z",
  "projects": {
    "AndroidCommonDoc": {
      "path": "C:/Users/34645/AndroidStudioProjects/AndroidCommonDoc",
      "layer": "L0",
      "file_count": 23,
      "files": [
        {
          "path": "docs/error-handling-patterns.md",
          "current_layer": "L0",
          "recommended_layer": "L0",
          "ai_readiness_score": 5,
          "ai_readiness_breakdown": {
            "has_frontmatter": true,
            "section_size_ok": true,
            "proper_subdivision": true,
            "no_stale_refs": true,
            "actionable_content": true
          },
          "classification": "ACTIVE",
          "freshness": {
            "status": "current",
            "version_refs_found": ["kotlinx-coroutines 1.10.2"],
            "stale_refs": []
          },
          "action": "keep",
          "overlaps": [],
          "notes": ""
        }
      ]
    },
    "shared-kmp-libs": {},
    "DawSync": {},
    "WakeTheCave": {}
  },
  "summary": {
    "total_files": 555,
    "by_layer": { "L0": 23, "L1": 32, "L2_DawSync": 291, "L2_WakeTheCave": 209 },
    "by_action": { "keep": 200, "promote_L0": 5, "promote_L1": 10, "consolidate": 30, "archive": 79 },
    "by_classification": { "ACTIVE": 300, "SUPERSEDED": 100, "UNIQUE": 155 },
    "freshness": { "current": 400, "stale": 50, "unknown": 105 },
    "ai_readiness_avg": 2.3,
    "l0_promotion_candidates": 5,
    "l2_override_candidates": 3
  }
}
```

### Pattern 2: AI-Readiness Scoring (0-5)
**What:** Standardized scoring criteria applied uniformly across all projects
**When to use:** Every file entry in the manifest

| Score | Criterion | How to Check |
|-------|-----------|--------------|
| +1 | Has YAML frontmatter | parseFrontmatter(raw) !== null |
| +1 | Section size <=150 lines | Split by `## ` headings, count lines per section |
| +1 | Proper subdivision by concern | Multiple `## ` sections, each with focused topic |
| +1 | No stale version references | Extract version patterns, compare against versions-manifest.json |
| +1 | Actionable content (not vague) | Has code examples, specific instructions, or structured tables (not just prose) |

### Pattern 3: Version Reference Extraction
**What:** Regex-based extraction of version references from markdown content
**When to use:** Freshness validation for docs without monitor_urls

```typescript
// Version patterns to detect in markdown content
const VERSION_PATTERNS = [
  /kotlin\s+(\d+\.\d+\.\d+)/gi,
  /agp\s+(\d+\.\d+\.\d+)/gi,
  /compose[- ]multiplatform\s+(\d+\.\d+\.\d+)/gi,
  /koin\s+(\d+\.\d+\.\d+)/gi,
  /kotlinx[- ]coroutines\s+(\d+\.\d+\.\d+)/gi,
  /kover\s+(\d+\.\d+\.\d+)/gi,
  /detekt\s+(\d+\.\d+\.\d+[-\w.]*)/gi,
  /ktor\s+(\d+\.\d+\.\d+)/gi,
  /okio\s+(\d+\.\d+\.\d+)/gi,
  /navigation3?\s+(\d+\.\d+\.\d+[-\w.]*)/gi,
  /sqldelight\s+(\d+\.\d+\.\d+)/gi,
  /compose[- ]rules\s+(\d+\.\d+\.\d+)/gi,
  /mockk\s+(\d+\.\d+\.\d+)/gi,
];
```

### Pattern 4: Layer Classification Logic
**What:** Rules for determining correct L0/L1/L2 placement
**When to use:** Classifying every file

| Content Type | Layer | Reasoning |
|-------------|-------|-----------|
| Generic Android/KMP patterns from official docs | L0 (AndroidCommonDoc) | Public/enterprise-ready, no personal project knowledge |
| shared-kmp-libs conventions, module APIs, build patterns | L1 (shared-kmp-libs) | Personal ecosystem, consumed by all apps |
| App-specific domain knowledge (DAW, smart home, etc.) | L2 (app) | Irreplaceable domain context |
| AI agent instructions, commands, skills | Depends on genericness | Generic test-specialist -> L0; DawSync-specific daw-guardian -> L2 |
| Legal documents, business strategy, product specs | L2 (app) | Domain-specific, non-transferable |
| Archive/completed plan docs | L2 (app) + SUPERSEDED classification | Historical context, not active guidance |

### Anti-Patterns to Avoid
- **Modifying source files during audit:** This phase is REPORT-ONLY. No edits to any project's files.
- **Double-counting worktree copies:** DawSync `.claude/worktrees/track-E/` contains full copies of all docs/agents/commands. Exclude from audit.
- **Premature template design:** The audit produces data; template design is Phase 14.
- **Running monitor-sources before content discovery:** Per STATE.md decision, freshness check runs AFTER all docs are cataloged.
- **Classifying by relevance instead of layer:** A doc can be highly relevant AND misplaced. Classification is about WHERE it belongs, not IF it matters.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML frontmatter parsing | Custom regex parser | `mcp-server/src/registry/frontmatter.ts` | Handles BOM, CRLF, edge cases already |
| File discovery in docs dirs | Manual find/glob | `mcp-server/src/registry/scanner.ts` | Validated against all project structures |
| Project path resolution | Hardcoded paths | `vault-config.json` at `~/.androidcommondoc/` | Canonical project locations with layer info |
| Version freshness checking | Custom HTTP + version parsing | `monitor-sources` CLI | Full pipeline: fetch, compare, report |
| Layer resolution model | Custom classification logic | Reference `mcp-server/src/registry/resolver.ts` patterns | L0>L1>L2 semantics already defined |

**Key insight:** The audit phase CONSUMES existing infrastructure (scanner, frontmatter parser, monitor-sources) but does NOT modify it. New code is limited to audit-specific analysis scripts that read files, classify content, and produce the manifest/report.

## Common Pitfalls

### Pitfall 1: File Count Mismatch
**What goes wrong:** CONTEXT.md says DawSync has ~171 files but actual count is ~291 (excluding worktrees). Shared-kmp-libs said 15 modules but has 51.
**Why it happens:** Counts were estimated during discussion, not verified.
**How to avoid:** Use actual file system enumeration. The manifest generation script must discover files dynamically, not use hardcoded counts.
**Warning signs:** Plan references specific file counts from CONTEXT.md instead of dynamic discovery.

### Pitfall 2: Worktree Duplicate Inclusion
**What goes wrong:** DawSync has `.claude/worktrees/track-E/` containing full copies of docs, agents, commands. Including these doubles the count and creates spurious overlap detection.
**Why it happens:** Worktrees are working copies for parallel development tracks.
**How to avoid:** Exclude `**/worktrees/**` from all DawSync file discovery. The exclude pattern should be applied before classification, not after.
**Warning signs:** DawSync file count exceeds 400, or duplicate entries appear in manifest.

### Pitfall 3: Running monitor-sources Too Early
**What goes wrong:** Freshness report based on incomplete corpus misses stale refs in docs discovered later.
**Why it happens:** Natural impulse to run tooling early.
**How to avoid:** Per STATE.md decision: monitor-sources executes AFTER all content is discovered and cataloged. The audit must complete file discovery for all 4 projects before running freshness checks.
**Warning signs:** Freshness step appears before all project audits in the plan.

### Pitfall 4: Conflating WakeTheCave docs/ and docs2/
**What goes wrong:** Assuming docs/ is old and docs2/ is current, or vice versa.
**Why it happens:** Natural assumption that numbered docs2 replaces docs.
**How to avoid:** Per user decision: audit ALL 209 files equally. docs/ has 199 files (01-architecture through archive with ~90 archived docs). docs2/ has 10 files with clean-Architecture structure. Some docs/ files (viewmodel-patterns.md) are already deprecated and point to AndroidCommonDoc. The audit must flag these relationships, not assume direction.
**Warning signs:** Treating docs2/ as authoritative without evidence.

### Pitfall 5: Version Reference False Positives
**What goes wrong:** Detecting version strings that are not technology references (e.g., "Version 1" as a document version, or version numbers in URLs/paths).
**Why it happens:** Naive regex matching.
**How to avoid:** Use context-aware version extraction: match technology name + version together (e.g., "Kotlin 2.3.10"), not bare version numbers. Cross-reference against versions-manifest.json keys.
**Warning signs:** Large number of "stale version refs" that are actually doc version numbers.

### Pitfall 6: DawSync Archive Classification Ambiguity
**What goes wrong:** Not distinguishing between docs/archive/ (79 files, most dated 2026-01, clearly superseded) and active docs that may overlap with other projects.
**Why it happens:** Treating all docs/archive/ as automatically SUPERSEDED without checking for unique content.
**How to avoid:** docs/archive/ files default to SUPERSEDED classification but each must be checked for UNIQUE content that does not exist elsewhere. Some archive docs may contain irreplaceable context.
**Warning signs:** All 79 archive files classified identically without content analysis.

### Pitfall 7: shared-kmp-libs Module Count Confusion
**What goes wrong:** Planning for 15 module gap analyses when there are 51 module directories.
**Why it happens:** CONTEXT.md estimate was low.
**How to avoid:** Group modules by category (Foundation: 5, I/O & Network: 6 dirs, Storage: 10 dirs, Security & Auth: 7 dirs, Error Mappers: 8 dirs, Domain-specific: 8 dirs, Others: 7 dirs). Many error-mapper modules follow the same pattern and can be assessed as a group.
**Warning signs:** Plan allocates time for 15 individual module assessments.

## Code Examples

### Reusing the Scanner for Cross-Project Auditing
```typescript
// The existing scanner works for any directory with .md files
import { scanDirectory } from "../registry/scanner.js";

// Scan AndroidCommonDoc L0 docs
const l0Entries = await scanDirectory("C:/Users/.../AndroidCommonDoc/docs", "L0");
// Returns entries with full frontmatter metadata for files that have valid frontmatter

// For files WITHOUT frontmatter (majority of WakeTheCave/DawSync docs),
// the scanner returns empty [] -- need a raw file reader instead
```

### Raw File Inventory (for docs without frontmatter)
```typescript
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "../registry/frontmatter.js";

interface AuditEntry {
  path: string;
  relativePath: string;
  project: string;
  currentLayer: "L0" | "L1" | "L2";
  recommendedLayer: "L0" | "L1" | "L2";
  hasFrontmatter: boolean;
  lineCount: number;
  sectionCount: number;
  aiReadinessScore: number;
  classification: "ACTIVE" | "SUPERSEDED" | "UNIQUE";
  action: "keep" | "promote_L0" | "promote_L1" | "consolidate" | "archive";
  versionRefs: { tech: string; found: string; current: string; stale: boolean }[];
  overlaps: string[];
  notes: string;
}
```

### Invoking monitor-sources CLI
```bash
# From AndroidCommonDoc root, run freshness check
node mcp-server/build/cli/monitor-sources.js \
  --tier all \
  --project-root . \
  --output .planning/phases/13-audit-validate/freshness-report.json
```

### Version Manifest Cross-Reference
```typescript
// Load versions-manifest.json
const manifest = JSON.parse(await readFile("versions-manifest.json", "utf-8"));
// manifest.versions = { kotlin: "2.3.10", agp: "9.0.0", ... }

// Extract version refs from doc content and compare
function extractVersionRefs(
  content: string,
  manifest: Record<string, string>
): { tech: string; version: string; stale: boolean }[] {
  const refs: { tech: string; version: string; stale: boolean }[] = [];
  for (const [tech, currentVersion] of Object.entries(manifest)) {
    const regex = new RegExp(`${tech}[\\s:]+([\\d.]+[-\\w.]*)`, "gi");
    let match;
    while ((match = regex.exec(content)) !== null) {
      const found = match[1];
      const cleanCurrent = currentVersion.replace(/\.x$/, "");
      const stale = found !== currentVersion && !found.startsWith(cleanCurrent);
      refs.push({ tech, version: found, stale });
    }
  }
  return refs;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Flat L0-only docs | L0/L1/L2 three-layer hierarchy with resolver | Phase 9 (v1.1) | Classification must account for layers |
| Hardcoded doc lists | Dynamic scanner with frontmatter | Phase 9 (v1.1) | Audit should use scanner, not hardcode |
| Manual freshness check | monitor-sources with tiered monitoring | Phase 10 (v1.1) | Reuse for AUDIT-05 |
| Single-project focus | Vault with ecosystem collection (L0+L1+L2) | Phase 11-12 (v1.1) | Audit spans all 4 projects |
| check-freshness tool | Consolidated into monitor-sources | Phase 10 DOC-09 | Only monitor-sources exists now |

**Key version refs in versions-manifest.json:**
- kotlin: 2.3.10
- agp: 9.0.0
- compose-multiplatform: 1.7.x (NOTE: DawSync CLAUDE.md says 1.10.0 -- possible manifest staleness)
- koin: 4.1.1
- kotlinx-coroutines: 1.10.2
- kover: 0.9.1 (NOTE: shared-kmp-libs TESTING_STRATEGY.md says 0.9.4 -- manifest may be stale)
- detekt: 2.0.0-alpha.2

**Potential manifest staleness detected:** versions-manifest.json shows compose-multiplatform at 1.7.x but DawSync CLAUDE.md references 1.10.0. Similarly, kover shows 0.9.1 in manifest but 0.9.4 in shared-kmp-libs docs. This is exactly the kind of finding the audit should surface.

## Open Questions

1. **DawSync file count: 291 vs stated ~171**
   - What we know: Actual filesystem enumeration yields ~291 files excluding worktrees and .planning/
   - What is unclear: Whether the CONTEXT.md estimate of ~171 was based on docs/ only (132) + agents (11) + commands (~28) = ~171, and additional files (.agents/skills, root files, agent-memory, .androidcommondoc) were not counted
   - Recommendation: Use dynamic discovery; the manifest should reflect actual files found. The discrepancy is informational, not blocking.

2. **shared-kmp-libs module count: 51 vs stated 15**
   - What we know: 51 directories exist. The "15 modules" in CONTEXT.md likely refers to the modules listed in CLAUDE.md tables (Foundation 5 + I/O & Network 3 groups + others)
   - What is unclear: Whether all 51 dirs need individual gap analysis or can be grouped
   - Recommendation: Group by category. Error mappers (8) follow identical patterns. Storage variants (10) share common API patterns. Gap analysis should be per-group with per-module README presence check.

3. **monitor-sources scope expansion**
   - What we know: CLI currently scans only AndroidCommonDoc/docs/ for entries with monitor_urls (only 5 of 23 docs have them)
   - What is unclear: How to handle the ~550 docs across all projects that lack monitor_urls -- should a version-reference extraction approach complement monitor-sources?
   - Recommendation: Run monitor-sources for docs that have monitor_urls. For all other docs, use regex-based version reference extraction against versions-manifest.json. Both results integrate into the same freshness column in the manifest.

4. **versions-manifest.json staleness**
   - What we know: compose-multiplatform shows 1.7.x but DawSync uses 1.10.0; kover shows 0.9.1 but docs reference 0.9.4
   - What is unclear: Whether manifest needs updating before or during the audit
   - Recommendation: The audit REPORTS staleness; do not update the manifest during Phase 13. Flag discrepancies in the freshness report for collaborative resolution.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^3.0.0 |
| Config file | mcp-server/package.json (scripts.test = "vitest run") |
| Quick run command | `cd mcp-server && npx vitest run --reporter=verbose` |
| Full suite command | `cd mcp-server && npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUDIT-01 | WakeTheCave mining produces L0 candidates list | manual-only | Manual review of audit-manifest.json WakeTheCave section | N/A -- output verification |
| AUDIT-02 | DawSync files classified as ACTIVE/SUPERSEDED/UNIQUE | manual-only | Manual review of audit-manifest.json DawSync section | N/A -- output verification |
| AUDIT-03 | shared-kmp-libs module gaps identified | manual-only | Manual review of audit-manifest.json shared-kmp-libs section | N/A -- output verification |
| AUDIT-04 | AndroidCommonDoc pattern docs reviewed for gaps | manual-only | Manual review of audit-manifest.json AndroidCommonDoc section | N/A -- output verification |
| AUDIT-05 | monitor-sources executed, freshness validated | smoke | `cd mcp-server && node build/cli/monitor-sources.js --tier all --output ../reports/test-report.json` | N/A -- CLI already tested |
| AUDIT-06 | Structured audit report with all sub-deliverables | manual-only | Verify audit-manifest.json + audit-report.md exist and contain required sections | N/A -- output verification |

### Sampling Rate
- **Per task commit:** Verify output files exist and have expected structure
- **Per wave merge:** Verify audit-manifest.json is valid JSON with all 4 project sections
- **Phase gate:** audit-manifest.json + audit-report.md present; all 4 projects represented; no empty sections

### Wave 0 Gaps
None -- this phase produces documentation artifacts (JSON manifest + markdown report), not code. Existing test infrastructure for the MCP server is already in place. The audit scripts are one-off analysis tools whose correctness is validated by reviewing their output.

## Sources

### Primary (HIGH confidence)
- Direct filesystem enumeration of all 4 project directories -- actual file counts and structures
- mcp-server/src/registry/scanner.ts -- scanner API and capabilities (code review)
- mcp-server/src/registry/frontmatter.ts -- frontmatter parsing capabilities (code review)
- mcp-server/src/cli/monitor-sources.ts -- CLI interface and options (code review)
- mcp-server/src/monitoring/change-detector.ts -- version drift detection logic (code review)
- mcp-server/src/monitoring/source-checker.ts -- upstream source checking (code review)
- mcp-server/src/registry/types.ts -- type definitions for registry/monitoring (code review)
- mcp-server/src/registry/resolver.ts -- L0/L1/L2 resolution semantics (code review)
- mcp-server/src/registry/project-discovery.ts -- project auto-discovery (code review)
- versions-manifest.json -- canonical version references (file review)
- vault-config.json -- project paths and configuration (file review)
- shared-kmp-libs/CLAUDE.md -- module catalog (57 lines, code review)
- shared-kmp-libs/docs/ERROR_HANDLING_PATTERN.md -- L1 doc example (code review)
- shared-kmp-libs/docs/TESTING_STRATEGY.md -- L1 doc example with coverage data (code review)
- DawSync/CLAUDE.md -- project structure and conventions (232 lines, code review)
- WakeTheCave/docs2/README.md -- docs2 structure overview (code review)
- WakeTheCave/docs/01-architecture/patterns/viewmodel-patterns.md -- example of deprecated doc pointing to AndroidCommonDoc (code review)
- .planning/phases/13-audit-validate/13-CONTEXT.md -- locked decisions (file review)
- .planning/REQUIREMENTS.md -- requirement definitions (file review)
- .planning/STATE.md -- project state and decisions (file review)
- Memory: project_ecosystem_architecture.md -- L0/L1/L2 hierarchy definition
- Memory: project_doc_consolidation_needed.md -- known consolidation issues

### Secondary (MEDIUM confidence)
- None needed -- all findings from direct code/file review

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All tools already exist and are built in the MCP server; no new libraries needed
- Architecture: HIGH -- Manifest schema is well-defined by locked decisions; output structure is clear
- Pitfalls: HIGH -- All pitfalls discovered from actual filesystem discrepancies and code review

**Research date:** 2026-03-14
**Valid until:** Stable -- file counts may change as DawSync development continues, but the approach and tooling remain valid