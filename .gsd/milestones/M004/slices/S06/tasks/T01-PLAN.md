# T01: 15-claude-md-ecosystem-alignment 01

**Slice:** S06 — **Milestone:** M004

## Description

Extract canonical rule checklist from all 4 existing CLAUDE.md files and design the standard CLAUDE.md template.

Purpose: Establish the authoritative rule inventory and template before any rewriting or tooling. The canonical checklist becomes the SSOT for smoke tests and validate-claude-md tool. The template provides the structural blueprint for all CLAUDE.md rewrites.
Output: `docs/guides/canonical-rules.json` (machine-readable rule inventory) + `docs/guides/claude-md-template.md` (template reference doc)

## Must-Haves

- [ ] "Every behavioral rule from all 4 CLAUDE.md files is inventoried with source attribution, category, layer assignment, and overridability flag"
- [ ] "Cross-file consistency validated -- no version contradictions, no stale references, no duplicate rules across layers"
- [ ] "CLAUDE.md template defined with identity header, standard sections, override table, and temporal context support"
- [ ] "Template enforces <150 lines per file and <4000 tokens per project initial load"

## Files

- `docs/guides/canonical-rules.json`
- `docs/guides/claude-md-template.md`
