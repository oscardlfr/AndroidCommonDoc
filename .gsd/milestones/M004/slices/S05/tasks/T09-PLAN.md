# T09: 14.3-skill-materialization-registry 09

**Slice:** S05 — **Milestone:** M004

## Description

Close the DawSync category consolidation gap identified in 14.3-VERIFICATION.md (Truth 8, MATL-08 partial).

DawSync currently uses only 4 of 9 approved categories (product, guides, architecture, build). Nine DawSync docs are semantically misaligned -- testing guides are tagged `guides` instead of `testing`, UI/accessibility docs are tagged `architecture`/`guides` instead of `ui`, an offline-first doc is tagged `architecture` instead of `data`, and an SBOM doc is tagged `build` instead of `security`. The SUBDIR_TO_CATEGORIES workaround in validate-doc-structure.ts needs updating to accept the new category values in their existing subdirectories (per the Plan 07 decision: "category consolidation changes frontmatter only, not physical subdirectory structure").

Purpose: Achieve proper category coverage so the Obsidian graph shows meaningful color grouping for DawSync docs and the 9-category unified vocabulary is actually used.
Output: 9 DawSync docs re-categorized, SUBDIR_TO_CATEGORIES mapping updated, validator passes with 0 errors.

## Must-Haves

- [ ] "DawSync docs covering testing topics use category testing, not guides"
- [ ] "DawSync docs covering UI topics use category ui, not architecture"
- [ ] "DawSync docs covering data/offline-first topics use category data, not architecture"
- [ ] "DawSync docs covering security topics use category security, not build"
- [ ] "SUBDIR_TO_CATEGORIES mapping updated to accept re-categorized values without moving files"
- [ ] "validate-doc-structure reports 0 errors for DawSync after re-categorization"
- [ ] "DawSync uses at least 7 of 9 approved categories (was 4)"

## Files

- `DawSync/docs/guides/testing.md`
- `DawSync/docs/guides/testing-advanced.md`
- `DawSync/docs/guides/testing-e2e.md`
- `DawSync/docs/guides/testing-fakes.md`
- `DawSync/docs/guides/testing-patterns.md`
- `DawSync/docs/guides/accessibility.md`
- `DawSync/docs/architecture/patterns-offline-first.md`
- `DawSync/docs/architecture/patterns-ui-viewmodel.md`
- `DawSync/docs/tech/sbom.md`
- `mcp-server/src/tools/validate-doc-structure.ts`
