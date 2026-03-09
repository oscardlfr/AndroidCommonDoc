# T01: 14.2-docs-content-quality 01

**Slice:** S04 — **Milestone:** M004

## Description

Extend MCP tooling with l0_refs cross-layer reference support and quality validation checks.

Purpose: Provide automated validation tools that subsequent plans use to verify their doc quality work. MCP tooling must be ready before any doc content changes begin.
Output: Extended PatternMetadata type, scanner l0_refs extraction, validate-doc-structure with size limits + l0_refs validation + frontmatter completeness scoring.

## Must-Haves

- [ ] "PatternMetadata includes optional l0_refs string array field"
- [ ] "Scanner extracts l0_refs from frontmatter when present, ignores when absent"
- [ ] "validate-doc-structure reports docs over 500 lines as errors"
- [ ] "validate-doc-structure reports hub docs over 100 lines as errors"
- [ ] "validate-doc-structure reports sections over 150 lines as warnings"
- [ ] "validate-doc-structure validates l0_refs resolve to valid L0 slugs"
- [ ] "validate-doc-structure reports frontmatter completeness score"
- [ ] "All existing tests remain green after extensions"

## Files

- `mcp-server/src/registry/types.ts`
- `mcp-server/src/registry/scanner.ts`
- `mcp-server/src/tools/validate-doc-structure.ts`
- `mcp-server/tests/unit/registry/scanner.test.ts`
- `mcp-server/tests/unit/tools/validate-doc-structure.test.ts`
- `mcp-server/tests/integration/doc-structure.test.ts`
