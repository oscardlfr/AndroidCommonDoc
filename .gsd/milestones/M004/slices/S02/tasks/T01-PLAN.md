# T01: 14-doc-structure-consolidation 01

**Slice:** S02 — **Milestone:** M004

## Description

Define the standard documentation template, extend MCP types for new frontmatter fields, fix versions-manifest.json, and create verification tooling.

Purpose: Everything else in Phase 14 depends on the template definition and type extensions. This plan establishes the contracts that all subsequent doc work implements against.
Output: doc-template.md (living L0 reference), extended PatternMetadata types, corrected versions-manifest.json, verification script

## Must-Haves

- [ ] "Standard doc template exists with all mandatory frontmatter fields and section structure"
- [ ] "PatternMetadata type includes layer, parent, and project optional fields"
- [ ] "MCP server builds successfully with extended types"
- [ ] "versions-manifest.json has correct kover and compose-multiplatform values"
- [ ] "Verification script can check any doc for template compliance"

## Files

- `versions-manifest.json`
- `mcp-server/src/registry/types.ts`
- `mcp-server/src/registry/scanner.ts`
- `docs/doc-template.md`
- `.planning/phases/14-doc-structure-consolidation/verify-doc-compliance.cjs`
