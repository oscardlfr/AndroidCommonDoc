# T06: 09-pattern-registry-discovery 06

**Slice:** S05 — **Milestone:** M002

## Description

Audit DawSync/.claude/ agent docs for generic KMP/Android patterns, promote reusable patterns to AndroidCommonDoc L0 docs with YAML frontmatter, and set up DawSync/.androidcommondoc/docs/ for project-specific L1 overrides.

Purpose: This fulfills the locked "DawSync doc migration" decision from CONTEXT.md. DawSync's .claude/ agents contain patterns that benefit all KMP projects (e.g., error handling, data layer, testing). Generic patterns become L0 base docs; DawSync-specific patterns stay as L1 overrides. This ensures the registry launches with comprehensive, complete content.

Output: New L0 pattern docs in docs/ (with frontmatter), DawSync/.androidcommondoc/docs/ directory with L1 override docs.

## Must-Haves

- [ ] "Generic KMP/Android patterns from DawSync/.claude/ agents are promoted to AndroidCommonDoc docs/ as L0 patterns with frontmatter"
- [ ] "DawSync-specific patterns remain as L1 overrides in DawSync/.androidcommondoc/docs/"
- [ ] "DawSync/.androidcommondoc/docs/ directory structure exists with at least one L1 pattern doc"

## Files

- `docs/error-handling-patterns.md`
