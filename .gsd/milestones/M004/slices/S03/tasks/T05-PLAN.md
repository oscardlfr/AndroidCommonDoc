# T05: 14.1-docs-subdirectory-reorganization 05

**Slice:** S03 — **Milestone:** M004

## Description

Optimize the Obsidian vault pipeline to mirror the new subdirectory structure: update collector routing for category-based paths, refactor MOC generator for category-grouped output, redesign Home.md, exclude archive/ from collection, create the /doc-reorganize skill, and update the doc template.

Purpose: The vault must reflect the reorganized source structure with category-grouped MOCs to reduce visual noise (user complaint about flat link walls). The /doc-reorganize skill makes this reorganization pattern reusable for future projects.

Output: Updated vault pipeline code, category-grouped MOCs, /doc-reorganize skill, updated doc-template.md.

## Must-Haves

- [ ] "Vault collector routes L0 patterns to L0-generic/patterns/{category}/{slug}.md"
- [ ] "Vault collector preserves L1/L2 subdirectory structure in vault paths"
- [ ] "MOC pages group entries by category instead of flat listing"
- [ ] "Home.md redesigned as category-based navigation tree"
- [ ] "archive/ excluded from vault collection"
- [ ] "/doc-reorganize skill created with SKILL.md"

## Files

- `mcp-server/src/vault/collector.ts`
- `mcp-server/src/vault/moc-generator.ts`
- `mcp-server/src/vault/transformer.ts`
- `mcp-server/tests/unit/vault/collector.test.ts`
- `mcp-server/tests/unit/vault/moc-generator.test.ts`
- `mcp-server/tests/unit/vault/transformer.test.ts`
- `skills/doc-reorganize/SKILL.md`
- `docs/guides/doc-template.md`
