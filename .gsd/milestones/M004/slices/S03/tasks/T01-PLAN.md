# T01: 14.1-docs-subdirectory-reorganization 01

**Slice:** S03 — **Milestone:** M004

## Description

Extend the pattern registry foundation to support subdirectory-based doc organization: add `category` field to PatternMetadata, make scanner recursive (handle docs in subdirectories), and extend find-pattern with --category filter.

Purpose: All downstream plans (L0/L1/L2 file moves, vault optimization) depend on the registry understanding category metadata and discovering docs inside subdirectories. This must be in place before any files are moved.

Output: Updated types.ts, recursive scanner.ts, extended find-pattern.ts, passing unit tests.

## Must-Haves

- [ ] "PatternMetadata includes optional category field"
- [ ] "Scanner discovers .md files in subdirectories (recursive)"
- [ ] "Scanner extracts category field from frontmatter into metadata"
- [ ] "Scanner slug derivation uses basename only (not full path) after recursive scanning"
- [ ] "find-pattern supports --category filter returning only matching entries"

## Files

- `mcp-server/src/registry/types.ts`
- `mcp-server/src/registry/scanner.ts`
- `mcp-server/src/tools/find-pattern.ts`
- `mcp-server/tests/unit/registry/scanner.test.ts`
- `mcp-server/tests/unit/tools/find-pattern.test.ts`
