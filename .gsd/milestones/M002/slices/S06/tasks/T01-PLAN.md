# T01: 10-doc-intelligence-detekt-generation 01

**Slice:** S06 — **Milestone:** M002

## Description

Extend the pattern registry schema with monitoring and rule definition types, then build the core monitoring engine that fetches upstream sources and detects changes.

Purpose: Establishes the data model and engine that all downstream plans depend on -- types for monitor_urls and rules in frontmatter, plus the HTTP fetching and diff detection logic.
Output: Extended registry types, updated scanner, monitoring engine (source-checker + change-detector), frontmatter additions on key docs.

## Must-Haves

- [ ] "PatternMetadata accepts optional monitor_urls and rules fields without breaking existing docs"
- [ ] "Scanner extracts monitor_urls and rules from frontmatter when present"
- [ ] "Source checker can fetch GitHub releases and detect version changes"
- [ ] "Source checker can fetch doc pages and detect content changes via SHA-256 hash"
- [ ] "Change detector categorizes findings by severity (HIGH for deprecation, MEDIUM for version drift)"

## Files

- `mcp-server/src/registry/types.ts`
- `mcp-server/src/registry/scanner.ts`
- `mcp-server/src/monitoring/source-checker.ts`
- `mcp-server/src/monitoring/change-detector.ts`
- `mcp-server/tests/unit/registry/scanner.test.ts`
- `mcp-server/tests/unit/monitoring/source-checker.test.ts`
- `mcp-server/tests/unit/monitoring/change-detector.test.ts`
- `docs/viewmodel-state-patterns.md`
- `docs/testing-patterns.md`
- `docs/kmp-architecture.md`
- `docs/gradle-patterns.md`
- `docs/error-handling-patterns.md`
