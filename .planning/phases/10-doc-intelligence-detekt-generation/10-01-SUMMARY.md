---
phase: 10-doc-intelligence-detekt-generation
plan: 01
subsystem: monitoring
tags: [typescript, vitest, monitoring, sha256, github-api, maven-central, frontmatter, tdd]

requires:
  - phase: 09-pattern-registry-discovery
    provides: "Registry types, scanner, frontmatter parser, layer resolution"
provides:
  - "Extended PatternMetadata with MonitorUrl and RuleDefinition fields"
  - "MonitoringTier, MonitorUrlType, MonitorUrl types for source configuration"
  - "FindingSeverity, MonitoringFinding types for change detection"
  - "source-checker module: fetch GitHub releases, Maven Central, doc pages"
  - "change-detector module: version drift, deprecation, content change detection"
  - "5 key docs with monitor_urls frontmatter pointing to real upstream sources"
  - "5 existing hand-written Detekt rules linked to pattern docs via rules frontmatter"
affects: [10-02, 10-03, 10-04, 10-05]

tech-stack:
  added: [node:crypto]
  patterns: [tiered-monitoring, deterministic-finding-hash, defensive-frontmatter-extraction]

key-files:
  created:
    - mcp-server/src/monitoring/source-checker.ts
    - mcp-server/src/monitoring/change-detector.ts
    - mcp-server/tests/unit/monitoring/source-checker.test.ts
    - mcp-server/tests/unit/monitoring/change-detector.test.ts
  modified:
    - mcp-server/src/registry/types.ts
    - mcp-server/src/registry/scanner.ts
    - mcp-server/tests/unit/registry/scanner.test.ts
    - docs/viewmodel-state-patterns.md
    - docs/testing-patterns.md
    - docs/kmp-architecture.md
    - docs/gradle-patterns.md
    - docs/error-handling-patterns.md

key-decisions:
  - "URL-to-manifest matching uses normalized comparison (dots/dashes/underscores removed) for fuzzy library name matching"
  - "Deprecation detection breaks after first keyword match per URL to avoid noise"
  - "MonitorUrl and RuleDefinition extraction follows same defensive Array.isArray pattern as excludable_sources"

patterns-established:
  - "Tiered monitoring: tier 1 (version checks), tier 2 (doc pages), tier 3 (community)"
  - "Deterministic finding hash: SHA-256 of slug+url+category+summary for review state tracking"
  - "HTTP error categorization: 404=error (permanent), 429/5xx=unreachable (transient)"

requirements-completed: [DOC-01, DOC-02]

duration: 6min
completed: 2026-03-14
---

# Phase 10 Plan 01: Registry Types & Monitoring Engine Summary

**Extended PatternMetadata with monitoring and rule types, built source-checker (GitHub/Maven/doc-page) and change-detector (version drift + deprecation) with 15 tests**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-13T23:38:16Z
- **Completed:** 2026-03-13T23:44:44Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 12

## Accomplishments
- Extended PatternMetadata with optional monitor_urls and rules fields, backward-compatible with all 23 existing docs
- Built source-checker that fetches GitHub releases (version extraction), Maven Central (latest version), and doc pages (SHA-256 content hash) with graceful error handling
- Built change-detector that compares upstream versions against versions-manifest.json, flags deprecation keywords as HIGH severity, and generates deterministic finding hashes
- Added monitor_urls frontmatter to 5 key pattern docs pointing to real upstream sources
- Linked 5 existing hand-written Detekt rules to their source pattern docs via rules frontmatter

## Task Commits

Each task was committed atomically (TDD: test then implementation):

1. **Task 1: Extend registry types and scanner** - `dd66a8b` (test) + `7b72e20` (feat)
2. **Task 2: Build source-checker and change-detector** - `4319c5d` (test) + `385e43a` (feat)

## Files Created/Modified
- `mcp-server/src/registry/types.ts` - Added MonitoringTier, MonitorUrlType, MonitorUrl, FindingSeverity, MonitoringFinding types; extended PatternMetadata
- `mcp-server/src/registry/scanner.ts` - Extract monitor_urls and rules from frontmatter defensively
- `mcp-server/src/monitoring/source-checker.ts` - HTTP fetcher for GitHub releases, Maven Central, doc pages with AbortController timeout
- `mcp-server/src/monitoring/change-detector.ts` - Version drift, deprecation detection, deterministic finding hashes
- `mcp-server/tests/unit/registry/scanner.test.ts` - 3 new tests for monitor_urls, rules, and backward compatibility
- `mcp-server/tests/unit/monitoring/source-checker.test.ts` - 8 tests for all URL types and error handling
- `mcp-server/tests/unit/monitoring/change-detector.test.ts` - 7 tests for drift, deprecation, hashing, edge cases
- `docs/viewmodel-state-patterns.md` - Added monitor_urls (2 URLs) and rules (3 rules: SealedUiState, NoChannelEvents, WhileSubscribedTimeout)
- `docs/testing-patterns.md` - Added monitor_urls (2 URLs: kotlinx-coroutines, kover)
- `docs/kmp-architecture.md` - Added monitor_urls (1 URL: KMP docs) and rules (1 rule: NoPlatformDepsInViewModel)
- `docs/gradle-patterns.md` - Added monitor_urls (2 URLs: Gradle releases, AGP on Maven)
- `docs/error-handling-patterns.md` - Added monitor_urls (1 URL: kotlinx-coroutines) and rules (1 rule: CancellationExceptionRethrow)

## Decisions Made
- URL-to-manifest key matching normalizes dots/dashes/underscores for fuzzy matching (e.g., kotlinx.coroutines in URL matches kotlinx-coroutines in manifest)
- Deprecation detection reports only first keyword match per URL to avoid duplicate noise
- HTTP 429 and 5xx responses categorized as "unreachable" (transient), 4xx as "error" (permanent)
- AbortController with 15s timeout for all fetch operations

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Registry types ready for consumption by MCP monitoring tools (Plan 03) and rule generation (Plan 02)
- Source-checker and change-detector ready for integration into MCP tool wrapper
- 5 docs with monitor_urls ready for live monitoring when MCP tool is registered
- 5 hand-written rules linked to docs, ready for drift detection in rule generation pipeline

## Self-Check: PASSED

All 6 key files verified present. All 4 commits (dd66a8b, 7b72e20, 4319c5d, 385e43a) verified in git log.

---
*Phase: 10-doc-intelligence-detekt-generation*
*Completed: 2026-03-14*
