# T07: 14.3-skill-materialization-registry 07

**Slice:** S05 — **Milestone:** M004

## Description

Rename all ~84 active UPPERCASE DawSync docs to lowercase-kebab-case at source, update every cross-reference (frontmatter parent, wikilinks, hub Sub-documents, l0_refs, README), consolidate 23 category tags to 9 unified categories, and add naming validation to prevent regression.

Purpose: Consistent lowercase-kebab-case naming is the convention standard. Category consolidation makes the Obsidian graph readable. This is the vault hygiene that MATL-08 requires.
Output: Renamed docs, updated cross-references, consolidated categories, naming validation

## Must-Haves

- [ ] "All ~84 active non-diagram UPPERCASE DawSync docs renamed to lowercase-kebab-case"
- [ ] "All cross-references updated: parent fields, wikilinks, hub Sub-documents sections, l0_refs, README"
- [ ] "Category tags consolidated from 23 to 9 unified categories across all layers"
- [ ] "Naming validation added to vault sync pipeline to prevent regression"
- [ ] "Archive files keep original names (not renamed)"
- [ ] "Diagram files keep their A01-H format (already lowercase-kebab-case with valid prefix)"

## Files

- `DawSync/docs/**/*.md`
- `mcp-server/src/vault/transformer.ts`
- `mcp-server/src/tools/validate-doc-structure.ts`
