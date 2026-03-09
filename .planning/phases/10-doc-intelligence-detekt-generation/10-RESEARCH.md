# Phase 10: Doc Intelligence & Detekt Generation - Research

**Researched:** 2026-03-14
**Domain:** Documentation monitoring automation, Detekt custom rule code generation, v1.1 milestone audit
**Confidence:** HIGH

## Summary

Phase 10 is the final functional phase of v1.1, combining three distinct workstreams: (1) automated monitoring of upstream documentation sources to detect version changes and deprecations, (2) Detekt custom rule generation from pattern doc frontmatter, and (3) a v1.1 milestone cleanup/audit pass. The existing codebase provides strong foundations -- the MCP server (TypeScript, Vitest, Zod schemas), the registry system (frontmatter parser, scanner, resolver, L0/L1/L2 layers), and the `detekt-rules/` module (5 hand-written AST-only rules with Detekt 2.0.0-alpha.2 API and full test suite) are all mature and well-tested.

The monitoring system extends the existing MCP tool infrastructure with new tools for source checking, while the Detekt generation builds on the exact same Kotlin PSI patterns already proven in the 5 existing rules. The v1.1 cleanup audits the repository for dead code, stale docs, and consolidation opportunities after 10 phases of evolution.

**Primary recommendation:** Extend existing MCP tools for monitoring (TypeScript + Vitest pattern), extend existing `detekt-rules/` module for generated rules (same Kotlin + detekt-test pattern), and use frontmatter YAML as the single source of truth for both monitoring URLs and rule definitions.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Tiered monitoring levels** with user control -- user decides which tier to run and when
- **Both on-demand + CI scheduled** -- skill/MCP tool for ad-hoc checks, GitHub Actions cron for regular sweeps
- **Deprecation detection** enabled -- when upstream deprecates an API a pattern doc recommends, flag as HIGH severity
- **Update behavior**: Default is suggest-and-approve (generate proposed changes, user reviews). Configurable to auto-apply safe changes (version bumps) while flagging risky ones (API changes) -- controlled by user setting
- **Review state tracking**: Yes -- remember which findings were already reviewed (accepted/rejected/deferred), next run only shows new findings, prevents review fatigue
- **Auto-commit on approval**: Yes, with conventional commit messages (e.g., `docs(patterns): update kotlinx-coroutines refs to 1.9.0`) but always user-approved first
- **Rule definition format**: YAML `rules:` section in pattern doc frontmatter with structured entries (type, prefer/over, message fields). Machine-readable, co-located with the pattern doc
- **Link existing rules to pattern docs**: Yes -- existing 5 hand-written rules get metadata linking them to their source pattern docs. System detects rule-doc drift when patterns change
- **Generate tests alongside rules**: Yes -- each generated rule gets companion test with compliant/violating code samples, mirroring existing hand-written rule test pattern
- **Consumer rule generation**: Yes -- consuming projects with L1 pattern docs containing `rules:` frontmatter can generate project-specific Detekt rules
- **Distribution**: Composite build -- same `includeBuild("../AndroidCommonDoc")` pattern consumers already use. Zero extra config
- **Multi-tool surface**: Not Claude-only -- tooling accessible via MCP + scripts/skills for Copilot and other AI tools
- **L1 monitoring**: Yes -- consumer projects can add monitoring sources to their L1 pattern docs
- **URL validation**: Yes -- validate reachability and parseable content when a user adds a monitor_url
- **Arbitrary content ingestion**: Users can contribute content from any source -- Medium posts, LinkedIn articles, blog posts, conference talks, etc. Accept pasted content when URLs are unfetchable
- **Unsupported URL fallback**: Gracefully degrade -- prompt user to paste content manually instead of failing silently
- **Cleanup and audit included in Phase 10** as the final plans -- Phase 10 is the last phase of v1.1
- **Dead code/scripts audit**, **consolidation opportunities**, **README + docs accuracy**, **convention compliance**, **tool alignment**, **registry/frontmatter hardening**, **v1.1 changelog**
- **Detekt rules must be AST-only** per project constraint (avoid Detekt #8882 performance issue in KMP monorepos)

### Claude's Discretion
- Monitoring tier structure and report format
- CI output format (GitHub issue, artifact, or other)
- Update review UX (interactive skill, batch report, or other)
- Deferred update logging approach (noise-awareness)
- Detekt rule generation approach (generated Kotlin source, template-based, or runtime-interpreted -- must be AST-only)
- Module location for generated rules (extend detekt-rules/ or separate module)
- Initial rule types to support (prefer-API, banned-imports, naming conventions, etc.)
- Rule update handling when pattern docs change
- Source configuration format (frontmatter URLs, central config, or both)
- Supported URL types (GitHub releases, changelogs, Maven Central, doc pages)
- MCP + skill surface design for multi-tool accessibility

### Deferred Ideas (OUT OF SCOPE)
- Full repository architecture optimization (v1.2 initiative)
- Conventional Commits enforcement (git commit-msg hook)
- Gitflow workflow validation (branch naming rules)
- Codex adapter (ADAPT-01)
- Cursor/Windsurf rule adapters (ADAPT-02)
</user_constraints>

## Standard Stack

### Core (Existing -- extend, don't replace)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | 1.27.1 | MCP server for monitoring + generation tools | Already in use, production-proven in Phase 8-9 |
| Zod | ^3.24.0 | MCP tool parameter validation | Established pattern in all existing tools |
| yaml (npm) | ^2.8.2 | YAML frontmatter parsing for new fields | Already used by scanner/frontmatter.ts |
| Vitest | ^3.0.0 | MCP server TypeScript tests | Established test framework from Phase 8 |
| dev.detekt:detekt-api | 2.0.0-alpha.2 | Detekt rule API (compileOnly) | Already pinned in detekt-rules/build.gradle.kts |
| dev.detekt:detekt-test | 2.0.0-alpha.2 | Detekt rule testing (lint helper) | Established test pattern with 5 existing rules |
| JUnit Jupiter | 5.11.4 | Detekt rule test framework | Already in detekt-rules |
| AssertJ | 3.27.3 | Detekt rule test assertions | Already in detekt-rules |

### Supporting (New additions)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:fs/promises | built-in | File I/O for monitoring state, reports | All file operations in MCP tools |
| node:crypto | built-in | Content hashing for change detection | Compare source content between runs |
| Kotlin kotlin("jvm") | 2.3.10 | Generated rule compilation | Inherited from existing build |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Frontmatter YAML for rule defs | Separate rule config file | Co-location with pattern doc is a decision -- YAML frontmatter keeps rules next to the patterns they enforce |
| Extending detekt-rules/ module | Separate generated-rules module | Single module reduces consumer config. Two modules would require two detektPlugins() dependencies. Recommend single module with generated/ subdirectory |
| TypeScript for rule generator | Kotlin KSP/codegen | MCP server already is TypeScript. Generator reads frontmatter (TS), emits Kotlin source files. No extra build tooling needed |

**Installation:**
```bash
# No new npm packages needed -- uses existing dependencies
# No new Gradle dependencies needed -- uses existing detekt-api/detekt-test
```

## Architecture Patterns

### Recommended Project Structure (New additions in Phase 10)

```
mcp-server/src/
  tools/
    monitor-sources.ts        # NEW: Source monitoring MCP tool
    generate-detekt-rules.ts  # NEW: Rule generation MCP tool
    ingest-content.ts         # NEW: Content ingestion MCP tool
  monitoring/
    source-checker.ts         # NEW: Fetch & compare upstream sources
    change-detector.ts        # NEW: Diff detection, deprecation flagging
    report-generator.ts       # NEW: Structured diff reports
    review-state.ts           # NEW: Track reviewed/accepted/rejected/deferred
  generation/
    rule-parser.ts            # NEW: Parse rules: frontmatter YAML
    kotlin-emitter.ts         # NEW: Emit Kotlin rule source code
    test-emitter.ts           # NEW: Emit Kotlin test source code
    config-emitter.ts         # NEW: Emit config.yml entries
  registry/
    types.ts                  # EXTEND: Add monitor_urls, rules to PatternMetadata
    scanner.ts                # EXTEND: Parse new frontmatter fields
    frontmatter.ts            # NO CHANGE (generic YAML parser)

detekt-rules/src/main/kotlin/com/androidcommondoc/detekt/
  rules/
    # 5 existing hand-written rules (KEEP)
    generated/                # NEW: Generated rules output directory
  AndroidCommonDocRuleSetProvider.kt  # EXTEND: Register generated rules

skills/
  monitor-docs/SKILL.md       # NEW: Doc monitoring skill
  generate-rules/SKILL.md     # NEW: Rule generation skill
  ingest-content/SKILL.md     # NEW: Content ingestion skill

.github/workflows/
  doc-monitor.yml              # NEW: Cron workflow for scheduled monitoring

.androidcommondoc/             # In toolkit root (for self-monitoring state)
  monitoring-state.json        # NEW: Review state tracking
```

### Pattern 1: Frontmatter Extension for Rules and Monitoring

**What:** Add `rules:` and `monitor_urls:` sections to existing YAML frontmatter
**When to use:** Every pattern doc that has enforceable rules or trackable upstream sources

```yaml
---
scope: [viewmodel, state, events]
sources: [lifecycle-viewmodel, kotlinx-coroutines]
targets: [android, desktop, ios, jvm]
version: 3
last_updated: "2026-03"
description: "ViewModel state management patterns"
status: active

monitor_urls:
  - url: "https://github.com/Kotlin/kotlinx.coroutines/releases"
    type: github-releases
    tier: 1
  - url: "https://developer.android.com/topic/libraries/architecture/viewmodel"
    type: doc-page
    tier: 2

rules:
  - id: sealed-ui-state
    type: prefer-construct
    message: "UiState must be sealed interface, not data class with boolean flags"
    detect:
      class_suffix: UiState
      must_be: sealed
    hand_written: true  # Links to existing SealedUiStateRule
    source_rule: SealedUiStateRule.kt

  - id: no-channel-events
    type: banned-usage
    message: "Use MutableSharedFlow instead of Channel for UI events in ViewModels"
    detect:
      in_class_extending: ViewModel
      banned_initializer: "Channel<"
      prefer: "MutableSharedFlow"
    hand_written: true
    source_rule: NoChannelForUiEventsRule.kt
---
```

### Pattern 2: Monitoring Tier Structure

**What:** Three monitoring tiers controlling depth and cost of checking
**When to use:** All monitored sources

```
Tier 1 (Critical): GitHub releases, Maven Central version checks
  - Automated version comparison against versions-manifest.json
  - HIGH severity on deprecation, MEDIUM on version drift
  - Frequency: Weekly CI cron + on-demand

Tier 2 (Important): Official documentation pages
  - Content hash comparison for change detection
  - MEDIUM severity on detected changes
  - Frequency: Monthly CI cron + on-demand

Tier 3 (Informational): Blog posts, guides, community content
  - Manual/on-demand only (no CI cron)
  - LOW severity -- informational, requires human review
  - Frequency: On-demand via MCP tool or skill
```

### Pattern 3: Rule Generation via Kotlin Source Emission

**What:** TypeScript code in MCP server reads `rules:` frontmatter, generates Kotlin source files for Detekt rules and their tests
**When to use:** For rules that follow common patterns (banned-import, prefer-API, banned-usage, naming-convention)

```typescript
// Source: MCP server generation/kotlin-emitter.ts
// Generates AST-only Detekt rules from frontmatter rule definitions

interface RuleDefinition {
  id: string;
  type: "banned-import" | "prefer-api" | "banned-usage" | "naming-convention";
  message: string;
  detect: Record<string, unknown>;
}

// Example: banned-import rule generation
function emitBannedImportRule(rule: RuleDefinition): string {
  const className = toPascalCase(rule.id) + "Rule";
  const banned = rule.detect.banned_import as string;
  const prefer = rule.detect.prefer as string;

  return `
package com.androidcommondoc.detekt.rules.generated

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtImportDirective

class ${className}(config: Config) : Rule(
    config,
    "${rule.message}"
) {
    override fun visitImportDirective(importDirective: KtImportDirective) {
        super.visitImportDirective(importDirective)
        val importPath = importDirective.importedFqName?.asString() ?: return
        if (importPath.startsWith("${banned}")) {
            report(
                Finding(
                    Entity.from(importDirective),
                    "${rule.message} Use '${prefer}' instead of '$importPath'."
                )
            )
        }
    }
}
`.trim();
}
```

### Pattern 4: Review State Tracking (Prevents Review Fatigue)

**What:** JSON file tracking which findings have been reviewed
**When to use:** Between monitoring runs

```json
{
  "schema_version": 1,
  "last_run": "2026-03-14T10:30:00Z",
  "findings": {
    "kotlinx-coroutines-version-drift": {
      "status": "accepted",
      "reviewed_at": "2026-03-14T10:35:00Z",
      "finding_hash": "abc123",
      "action": "Updated viewmodel-state-patterns.md"
    },
    "compose-multiplatform-deprecation": {
      "status": "deferred",
      "reviewed_at": "2026-03-14T10:36:00Z",
      "finding_hash": "def456",
      "reason": "Waiting for stable release"
    }
  }
}
```

### Pattern 5: Generated Rule Registration

**What:** Extend `AndroidCommonDocRuleSetProvider` to register generated rules alongside hand-written ones
**When to use:** After rule generation produces new Kotlin files

```kotlin
// AndroidCommonDocRuleSetProvider.kt (extended)
class AndroidCommonDocRuleSetProvider : RuleSetProvider {
    override val ruleSetId = RuleSetId("AndroidCommonDoc")

    override fun instance(): RuleSet = RuleSet(
        ruleSetId,
        listOf(
            // Hand-written rules
            ::SealedUiStateRule,
            ::CancellationExceptionRethrowRule,
            ::NoPlatformDepsInViewModelRule,
            ::WhileSubscribedTimeoutRule,
            ::NoChannelForUiEventsRule,
            // Generated rules (added by generator)
            ::PreferKotlinTimeInstantRule,
            // ... more generated rules
        )
    )
}
```

### Anti-Patterns to Avoid

- **Runtime rule interpretation:** Do NOT build a runtime engine that reads YAML and interprets rules dynamically. Generated Kotlin source code compiled with detekt-api is the correct approach -- it gets full Kotlin PSI access, full type safety, and full detekt-test coverage
- **Type resolution in generated rules:** Do NOT use `requiresTypeResolution` or `RequiresAnalysisApi` -- AST-only is a hard project constraint to avoid Detekt #8882 performance regression in KMP monorepos
- **Separate generated module:** Do NOT create a separate `generated-detekt-rules/` module -- consumers already depend on `detekt-rules/` via composite build. A separate module doubles their config. Keep generated rules in the same module under a `generated/` package
- **Hardcoded monitoring URLs:** Do NOT hardcode URLs in TypeScript source -- they belong in pattern doc frontmatter (`monitor_urls:` field) so they're discoverable and overridable via L1/L2 layers
- **Silent URL failures:** Do NOT fail silently when a URL is unreachable -- the user explicitly decided on graceful degradation with a prompt to paste content manually

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML frontmatter parsing | Custom YAML parser | Existing `parseFrontmatter()` from `registry/frontmatter.ts` | Already handles BOM, CRLF, edge cases |
| Registry scanning with new fields | New scanner | Extend existing `scanner.ts` to extract `rules:` and `monitor_urls:` | Dynamic scanner architecture was designed for extension |
| L0/L1/L2 resolution for monitoring | Custom resolution | Existing `resolver.ts` -- monitoring URLs in L1 docs resolve through same chain | Three-layer resolution is proven and tested |
| Rate limiting for monitoring tools | Custom limiter | Existing `RateLimiter` + `checkRateLimit` | Same pattern as all other MCP tools |
| Project discovery for consumer monitoring | Custom discovery | Existing `discoverProjects()` from `project-discovery.ts` | Already scans sibling dirs, handles fallback |
| Detekt rule structure | Custom AST framework | Kotlin PSI via `dev.detekt:detekt-api` visitor pattern | All 5 existing rules prove the pattern works |
| Detekt rule testing | Custom test harness | `rule.lint(code)` from `dev.detekt:detekt-test` | Established pattern with 5 existing test suites |
| Content hash comparison | Custom hash | `node:crypto` createHash('sha256') | Standard, fast, no dependencies |

**Key insight:** Phase 10 is primarily about extending existing infrastructure, not building new foundations. The MCP server, registry, and detekt-rules module already provide the architecture -- Phase 10 adds capabilities on top.

## Common Pitfalls

### Pitfall 1: AST-Only Constraint Violation in Generated Rules
**What goes wrong:** A generated rule uses type resolution (e.g., resolving fully qualified names through import aliases) and triggers Detekt #8882 performance issue
**Why it happens:** Some rule types (like "prefer API X over Y") seem to need type resolution to distinguish between same-named classes in different packages
**How to avoid:** Limit generated rules to patterns detectable via AST text analysis only -- import path string matching, class name suffix matching, initializer text matching, call expression name matching. These are the same techniques all 5 existing hand-written rules use successfully
**Warning signs:** Rule needs `bindingContext`, `requiresTypeResolution`, or `RequiresAnalysisApi`

### Pitfall 2: Scanner Backward Compatibility Break
**What goes wrong:** Adding `rules:` and `monitor_urls:` to PatternMetadata type breaks existing scanner validation that checks for required fields
**Why it happens:** Scanner currently validates `scope`, `sources`, `targets` as required arrays. New fields must be optional
**How to avoid:** New frontmatter fields MUST be optional in both TypeScript types and scanner validation. Pattern docs without `rules:` or `monitor_urls:` must continue to scan cleanly. Add the new fields as optional properties to `PatternMetadata` interface
**Warning signs:** Existing registry tests fail after type changes

### Pitfall 3: Review State File Corruption
**What goes wrong:** Concurrent monitoring runs (CI cron + manual invocation) corrupt the review state JSON
**Why it happens:** Two processes reading and writing the same file without locking
**How to avoid:** The monitoring state file should use atomic write (write to temp, rename). For CI, generate reports as artifacts without modifying state. State modification happens only in on-demand/interactive flow
**Warning signs:** Duplicate or missing findings between runs

### Pitfall 4: Windows Path Issues in Rule Generation
**What goes wrong:** Generated Kotlin files have wrong path separators on Windows
**Why it happens:** TypeScript `path.join` uses OS-native separators. Kotlin package declarations and import paths must use forward slashes/dots
**How to avoid:** Use `path.posix.join` for generated content, `path.join` only for filesystem operations. All existing MCP code uses `path` correctly -- follow same discipline
**Warning signs:** Generated rules fail to compile on Windows but work on macOS/Linux

### Pitfall 5: Content Ingestion Security
**What goes wrong:** User pastes malicious content that gets incorporated into pattern docs or rules
**Why it happens:** The arbitrary content ingestion feature accepts any text
**How to avoid:** Content analysis should extract patterns/recommendations but NEVER auto-apply. All content ingestion goes through the same suggest-and-approve flow. Generated rule code is Kotlin compiled by detekt, so injection risk is limited to doc content
**Warning signs:** Unreviewed content appearing in pattern docs

### Pitfall 6: Monitoring URL Fetch Failures on CI
**What goes wrong:** CI cron workflow fails because a monitored URL returns 403/429/timeout
**Why it happens:** GitHub rate limits, website changes, temporary outages
**How to avoid:** Monitoring tool should handle HTTP errors gracefully, categorize failures (transient vs permanent), and continue checking remaining URLs. Report fetch failures as WARN, not ERROR. Include retry with exponential backoff for transient failures
**Warning signs:** CI workflow marked as failed due to a single URL timeout

### Pitfall 7: Stale RuleSetProvider After Rule Generation
**What goes wrong:** Generated rules exist as .kt files but aren't registered in `AndroidCommonDocRuleSetProvider`
**Why it happens:** Generator creates rule files but forgets to update the provider registration
**How to avoid:** The generator must update both the rule file, its test file, the config.yml, AND the RuleSetProvider registration. All four artifacts must be generated atomically. Consider generating the entire RuleSetProvider from a manifest
**Warning signs:** Rules compile but detekt never invokes them

## Code Examples

### Existing Rule Pattern (Verified -- from repository)
```kotlin
// Source: detekt-rules/src/main/kotlin/.../rules/SealedUiStateRule.kt
class SealedUiStateRule(config: Config) : Rule(
    config,
    "UiState types must be sealed interfaces or sealed classes"
) {
    override fun visitClass(klass: KtClass) {
        super.visitClass(klass)
        val name = klass.name ?: return
        if (name.endsWith("UiState") && !klass.isSealed()) {
            report(Finding(Entity.from(klass), "...message..."))
        }
    }
}
```

### Existing Test Pattern (Verified -- from repository)
```kotlin
// Source: detekt-rules/src/test/kotlin/.../rules/SealedUiStateRuleTest.kt
class SealedUiStateRuleTest {
    private val rule = SealedUiStateRule(Config.empty)

    @Test
    fun `reports non-sealed UiState`() {
        val code = """
            class HomeUiState(val loading: Boolean)
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `accepts sealed interface UiState`() {
        val code = """
            sealed interface HomeUiState { ... }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}
```

### Existing MCP Tool Pattern (Verified -- from repository)
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
      description: "...",
      inputSchema: z.object({
        projectRoot: z.string().optional().describe("..."),
      }),
    },
    async ({ projectRoot }) => {
      const rateLimitResponse = checkRateLimit(limiter, "check-doc-freshness");
      if (rateLimitResponse) return rateLimitResponse;
      // ... implementation
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
```

### MCP Test Pattern (Verified -- from repository)
```typescript
// Source: mcp-server/tests/unit/tools/find-pattern.test.ts
describe("find-pattern tool", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const server = await createServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
    cleanup = async () => { await client.close(); await server.close(); };
  });

  it("returns matches for query", async () => {
    const result = await client.callTool({
      name: "find-pattern",
      arguments: { query: "testing" },
    });
    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );
    expect(parsed.matches.length).toBeGreaterThan(0);
  });
});
```

### GitHub Actions Cron Workflow Pattern
```yaml
# Source: GitHub Actions documentation (docs.github.com)
name: Doc Source Monitoring
on:
  schedule:
    - cron: '0 9 * * 1'  # Weekly Monday 9am UTC
  workflow_dispatch:        # Manual trigger
    inputs:
      tier:
        description: 'Monitoring tier (1, 2, or all)'
        default: 'all'

jobs:
  monitor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: "npm"
          cache-dependency-path: mcp-server/package-lock.json
      - run: npm ci
        working-directory: mcp-server
      - run: npm run build
        working-directory: mcp-server
      - run: node build/cli/monitor-sources.js --tier ${{ inputs.tier || 'all' }}
        working-directory: mcp-server
        env:
          ANDROID_COMMON_DOC: ${{ github.workspace }}
      - uses: actions/upload-artifact@v4
        with:
          name: monitoring-report
          path: mcp-server/reports/
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Detekt 1.x `io.gitlab.arturbosch.detekt.api` | Detekt 2.0 `dev.detekt.api` | 2.0.0-alpha series | Package renamed; existing rules already use new API |
| `MultiRule` (multiple rules in one class) | Separate Rule classes | Detekt 2.0 | Deprecated MultiRule; use individual Rule classes (project already does this) |
| `Entity.from(element)` | `Entity.atName(element)` for named declarations | Detekt 2.0 | New helper for better baseline support; `Entity.from()` still works |
| Hardcoded KNOWN_DOCS list | Dynamic registry scan | Phase 9 | Scanner-based discovery -- new frontmatter fields auto-discovered |
| Manual doc freshness checking | `check-doc-freshness` MCP tool | Phase 8/9 | Wraps script; Phase 10 evolves to true source monitoring |

**Deprecated/outdated:**
- `io.gitlab.arturbosch.detekt.api` package: Renamed to `dev.detekt.api` in 2.0 (project already migrated)
- `MultiRule`: Deprecated in Detekt 2.0, replaced by individual Rule classes (project already uses individual rules)
- Static KNOWN_DOCS: Removed in Phase 9, replaced by dynamic scanner (no regression risk)

## Rule Types Supportable via AST-Only Analysis

Based on analysis of the 5 existing hand-written rules and Kotlin PSI capabilities:

| Rule Type | AST Technique | Example | Confidence |
|-----------|--------------|---------|------------|
| **banned-import** | `visitImportDirective` + path string match | "Don't import kotlinx.datetime.Instant, use kotlin.time" | HIGH |
| **prefer-construct** | `visitClass` + modifier/keyword check | "UiState must be sealed interface" | HIGH |
| **banned-usage** | `visitClass` + property initializer text match | "No Channel in ViewModel, use SharedFlow" | HIGH |
| **required-call-arg** | `visitCallExpression` + args inspection | "WhileSubscribed must have timeout" | HIGH |
| **banned-supertype** | `visitClass` + superTypeListEntries check | "Don't extend Activity directly" | HIGH |
| **naming-convention** | `visitClass` + name pattern match | "Repository classes must end with Repository" | HIGH |
| **banned-annotation** | `visitAnnotationEntry` + name match | "Don't use @Suppress for specific warnings" | MEDIUM |
| **required-rethrow** | `visitCatchSection` + descendant check | "CancellationException must be rethrown" | HIGH |

**Not supportable (AST-only constraint):**
- Cross-file type resolution (cannot resolve import aliases across files)
- Generic type parameter checking (requires full type analysis)
- Overridden method detection (requires semantic analysis)

## Discretion Recommendations

### Monitoring Tier Structure
**Recommendation:** Three tiers as described in Architecture Patterns section above. Tier 1 (version checks) is automated and fast. Tier 2 (doc pages) uses content hashing. Tier 3 (community) is manual-only.

### CI Output Format
**Recommendation:** GitHub Actions artifact (JSON report file). Avoid GitHub Issues -- they create noise. Artifact is downloadable, parseable, and doesn't pollute the issue tracker. Workflow summary annotation for quick glance.

### Update Review UX
**Recommendation:** Batch report via MCP tool + skill. The MCP tool `monitor-sources` returns structured JSON with all findings. A `monitor-docs` skill provides the interactive review UX where the user can accept/reject/defer each finding. This separates the machine-readable tool from the human-friendly workflow.

### Deferred Update Logging
**Recommendation:** Deferred findings stored in `monitoring-state.json` with TTL. After 90 days, deferred findings re-surface as "stale deferral" with reduced severity. Configurable TTL per finding.

### Detekt Rule Generation Approach
**Recommendation:** Template-based Kotlin source emission. The TypeScript generator reads `rules:` frontmatter, selects a template based on `type` field, fills in the template variables (class name, message, detection parameters), and writes `.kt` files. This is simpler and more debuggable than string concatenation. Templates live as string constants in the emitter module.

### Module Location for Generated Rules
**Recommendation:** Extend existing `detekt-rules/` module. Place generated rules in `com.androidcommondoc.detekt.rules.generated` package (under `rules/generated/` directory). Same RuleSetProvider, same JAR, same composite build distribution. Zero consumer config change.

### Initial Rule Types
**Recommendation:** Start with `banned-import` and `prefer-construct` -- these cover the most common patterns and are the simplest to generate correctly with AST-only analysis. `banned-usage` (like Channel in ViewModel) is a good third type.

### Rule Update Handling
**Recommendation:** When a pattern doc's `rules:` section changes, the generator detects stale generated rules by comparing frontmatter rule IDs against existing generated files. It regenerates changed rules and removes orphaned ones. Hand-written rules (marked `hand_written: true`) are never modified by the generator -- only a drift warning is emitted if the frontmatter changes.

### Source Configuration Format
**Recommendation:** Frontmatter `monitor_urls:` in pattern docs (co-located with the patterns they verify). Central `versions-manifest.json` for version-only checks (already exists). No separate config file -- use what exists.

### Supported URL Types
**Recommendation:** Start with: `github-releases` (GitHub API), `maven-central` (search.maven.org API), `doc-page` (HTTP GET + content hash). Future: `changelog` (parse CHANGELOG.md from GitHub).

### MCP + Skill Surface Design
**Recommendation:** Three new MCP tools: `monitor-sources`, `generate-detekt-rules`, `ingest-content`. Three new skills: `monitor-docs`, `generate-rules`, `ingest-content`. Skills follow existing SKILL.md format with orchestration workflow (like `validate-patterns`). Adapters auto-generate via existing `copilot-adapter.sh`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (TS) | Vitest ^3.0.0 |
| Framework (Kotlin) | JUnit Jupiter 5.11.4 + detekt-test 2.0.0-alpha.2 |
| Config file (TS) | `mcp-server/vitest.config.ts` (exists) |
| Config file (Kotlin) | `detekt-rules/build.gradle.kts` (exists, JUnit Platform configured) |
| Quick run (TS) | `cd mcp-server && npm test` |
| Quick run (Kotlin) | `./gradlew :detekt-rules:test` |
| Full suite | `cd mcp-server && npm test && cd .. && ./gradlew :detekt-rules:test` |

### Phase Requirements -> Test Map

Phase 10 requirements are TBD per ROADMAP.md. Based on CONTEXT.md scope, the following behaviors need testing:

| Behavior | Test Type | Automated Command | Location |
|----------|-----------|-------------------|----------|
| Frontmatter rules: field parsing | unit | `cd mcp-server && npx vitest run tests/unit/registry/scanner.test.ts` | Extend existing scanner tests |
| Frontmatter monitor_urls: field parsing | unit | `cd mcp-server && npx vitest run tests/unit/registry/scanner.test.ts` | Extend existing scanner tests |
| Source monitoring detects version changes | unit | `cd mcp-server && npx vitest run tests/unit/monitoring/` | New test directory |
| Review state tracking persistence | unit | `cd mcp-server && npx vitest run tests/unit/monitoring/review-state.test.ts` | New test |
| Kotlin rule emission produces valid syntax | unit | `cd mcp-server && npx vitest run tests/unit/generation/` | New test directory |
| Generated Detekt rules compile | unit/integration | `./gradlew :detekt-rules:test` | Extends existing Kotlin tests |
| Generated rule tests pass (lint violations) | unit | `./gradlew :detekt-rules:test` | Generated test files |
| MCP monitor-sources tool returns results | unit | `cd mcp-server && npx vitest run tests/unit/tools/monitor-sources.test.ts` | New test |
| MCP generate-detekt-rules tool works | unit | `cd mcp-server && npx vitest run tests/unit/tools/generate-detekt-rules.test.ts` | New test |
| Content ingestion routes to correct docs | unit | `cd mcp-server && npx vitest run tests/unit/tools/ingest-content.test.ts` | New test |
| CI cron workflow valid YAML | smoke | `yamllint .github/workflows/doc-monitor.yml` | Manual/CI |
| Hand-written rule metadata links to docs | unit | `cd mcp-server && npx vitest run tests/unit/generation/rule-doc-link.test.ts` | New test |
| End-to-end: frontmatter -> generated rule -> passing test | integration | `cd mcp-server && npm test && ./gradlew :detekt-rules:test` | Cross-stack integration |

### Sampling Rate
- **Per task commit:** `cd mcp-server && npm test` or `./gradlew :detekt-rules:test` (whichever is relevant)
- **Per wave merge:** Full suite: `cd mcp-server && npm test && cd .. && ./gradlew :detekt-rules:test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `mcp-server/tests/unit/monitoring/` directory -- monitoring test infrastructure
- [ ] `mcp-server/tests/unit/generation/` directory -- generation test infrastructure
- [ ] `mcp-server/tests/unit/tools/monitor-sources.test.ts` -- monitoring tool tests
- [ ] `mcp-server/tests/unit/tools/generate-detekt-rules.test.ts` -- generation tool tests
- [ ] `mcp-server/tests/unit/tools/ingest-content.test.ts` -- ingestion tool tests
- [ ] `mcp-server/src/monitoring/` directory -- monitoring source modules
- [ ] `mcp-server/src/generation/` directory -- generation source modules
- [ ] `detekt-rules/src/main/kotlin/.../rules/generated/` directory -- generated rules output
- [ ] `detekt-rules/src/test/kotlin/.../rules/generated/` directory -- generated rule tests

## Open Questions

1. **Versions-manifest.json vs frontmatter as version source of truth**
   - What we know: `versions-manifest.json` already tracks canonical versions. Frontmatter `monitor_urls:` tracks where to check for updates
   - What's unclear: Should monitoring compare against `versions-manifest.json` or should frontmatter contain the expected version?
   - Recommendation: Use `versions-manifest.json` as the version truth. Monitoring checks upstream sources against manifest. When a change is detected and approved, both the manifest and the relevant docs get updated

2. **Generated rule rebuild trigger**
   - What we know: Rules are generated from frontmatter. Frontmatter lives in docs/*.md
   - What's unclear: Should rule generation be a manual step, a Gradle task, or automatic on build?
   - Recommendation: Manual via MCP tool/skill. Generated .kt files are committed to the repository (not generated at build time). This avoids build complexity and keeps generated code reviewable

3. **Consumer rule generation output location**
   - What we know: Consumers can have L1 pattern docs with `rules:` frontmatter. They need generated rules in their project
   - What's unclear: Where should consumer-generated rules be written? Their own `detekt-rules/` module? A `.androidcommondoc/rules/` directory?
   - Recommendation: Generate into a configurable output directory (default: `<consumer>/.androidcommondoc/detekt-rules/`). Consumer must add this to their Gradle detektPlugins configuration

4. **v1.1 cleanup scope boundary**
   - What we know: Cleanup includes dead code audit, consolidation, docs accuracy, convention compliance, tool alignment, frontmatter hardening, changelog
   - What's unclear: How deep should the consolidation go? (e.g., should `check-freshness` MCP tool be merged into the new `monitor-sources` tool?)
   - Recommendation: Yes, consolidate `check-freshness` into `monitor-sources` with backward-compatible alias. The old tool was a script wrapper; the new tool is a proper implementation. Keep the alias to avoid breaking existing agent prompts

## Sources

### Primary (HIGH confidence)
- Repository codebase: `detekt-rules/` module with 5 rules, `mcp-server/` with registry, tools, tests -- directly inspected all source files
- Repository codebase: Pattern doc frontmatter structure -- directly read from `docs/*.md`
- Repository codebase: MCP server architecture (tools, registry, types, utils) -- directly inspected
- Phase 10 CONTEXT.md -- user decisions and scope from `/gsd:discuss-phase`

### Secondary (MEDIUM confidence)
- [Detekt Extensions Documentation](https://detekt.dev/docs/introduction/extensions/) -- Custom rule API, RuleSetProvider, testing with detekt-test
- [Detekt Custom Rule Template](https://github.com/detekt/detekt-custom-rule-template) -- Official template repository for custom rules
- [Detekt Changelog](https://detekt.dev/changelog/) -- 2.0 migration changes (package rename, MultiRule deprecation)
- [GitHub Actions Workflow Syntax](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions) -- Cron schedule syntax, workflow_dispatch

### Tertiary (LOW confidence)
- [Detekt #8882 performance issue](https://github.com/detekt/detekt/issues/8043) -- Type resolution performance in KMP (referenced in project decisions, not directly verified in current alpha)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- 100% existing libraries, zero new dependencies
- Architecture: HIGH -- extends proven MCP tool and Detekt rule patterns already in the codebase
- Pitfalls: HIGH -- derived from actual codebase analysis (Windows paths, scanner compatibility, AST constraints)
- Rule generation: HIGH -- all 5 existing rules prove the AST patterns, generation is template-filling over proven structures
- Monitoring: MEDIUM -- source checking and change detection are new capabilities, but built on proven infrastructure
- Cleanup/audit: HIGH -- scope clearly defined in CONTEXT.md, mostly inspection and documentation work

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable stack, no fast-moving dependencies)
