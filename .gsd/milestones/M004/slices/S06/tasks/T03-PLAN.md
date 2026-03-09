# T03: 15-claude-md-ecosystem-alignment 03

**Slice:** S06 — **Milestone:** M004

## Description

Rewrite all 4 CLAUDE.md files using the standard template from Plan 01, adding identity headers, override sections, and delegation declarations. Validate each rewrite against the canonical rule checklist and validate-claude-md tool from Plan 02.

Purpose: Formalize the CLAUDE.md ecosystem structure with consistent identity headers, explicit delegation chains, and override support. Every file follows the template, stays within budget, and validates cleanly.
Output: Rewritten ~/.claude/CLAUDE.md, AndroidCommonDoc/CLAUDE.md, shared-kmp-libs/CLAUDE.md, DawSync/CLAUDE.md

## Must-Haves

- [ ] "Every CLAUDE.md file has the mandatory identity header with Layer, Inherits, and Purpose"
- [ ] "L0 global (~/.claude/CLAUDE.md) contains zero project name references in generic rule sections"
- [ ] "L1 (shared-kmp-libs) and L2 (DawSync) CLAUDE.md files contain zero duplicated L0 rules"
- [ ] "DawSync Wave 1 parallel tracks section is preserved in the L2 rewrite"
- [ ] "All files stay under 150 lines and under 4000 tokens initial load"
- [ ] "validate-claude-md tool reports zero errors when run against all rewritten files"
- [ ] "Context delegation flows correctly: L0 auto-loads, L1 adds ecosystem specifics, L2 adds application specifics"

## Files

- `[object Object]`
- `CLAUDE.md`
- `[object Object]`
- `[object Object]`
