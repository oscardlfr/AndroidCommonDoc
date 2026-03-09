# S06: Claude Md Ecosystem Alignment

**Goal:** Extract canonical rule checklist from all 4 existing CLAUDE.
**Demo:** Extract canonical rule checklist from all 4 existing CLAUDE.

## Must-Haves


## Tasks

- [x] **T01: 15-claude-md-ecosystem-alignment 01**
  - Extract canonical rule checklist from all 4 existing CLAUDE.md files and design the standard CLAUDE.md template.

Purpose: Establish the authoritative rule inventory and template before any rewriting or tooling. The canonical checklist becomes the SSOT for smoke tests and validate-claude-md tool. The template provides the structural blueprint for all CLAUDE.md rewrites.
Output: `docs/guides/canonical-rules.json` (machine-readable rule inventory) + `docs/guides/claude-md-template.md` (template reference doc)
- [x] **T02: 15-claude-md-ecosystem-alignment 02**
  - Build the validate-claude-md MCP tool that enforces CLAUDE.md structure, canonical rule coverage, delegation direction, override validity, and cross-file consistency.

Purpose: Provide programmatic enforcement of the CLAUDE.md ecosystem structure. This tool is the safety net that ensures rewrites preserve all rules, delegation flows downward, overrides are valid, and files stay within budget.
Output: `validate-claude-md.ts` tool + unit tests + tool registration in index.ts
- [x] **T03: 15-claude-md-ecosystem-alignment 03**
  - Rewrite all 4 CLAUDE.md files using the standard template from Plan 01, adding identity headers, override sections, and delegation declarations. Validate each rewrite against the canonical rule checklist and validate-claude-md tool from Plan 02.

Purpose: Formalize the CLAUDE.md ecosystem structure with consistent identity headers, explicit delegation chains, and override support. Every file follows the template, stays within budget, and validates cleanly.
Output: Rewritten ~/.claude/CLAUDE.md, AndroidCommonDoc/CLAUDE.md, shared-kmp-libs/CLAUDE.md, DawSync/CLAUDE.md
- [x] **T04: 15-claude-md-ecosystem-alignment 04**
  - Run smoke tests to verify behavioral rules are preserved, build Copilot adapter for CLAUDE.md, and perform final ecosystem validation with human checkpoint.

Purpose: Prove that the CLAUDE.md rewrite preserved every behavioral rule (no silent drops), extend the adapter pipeline to generate Copilot instructions from CLAUDE.md as SSOT, and get human confirmation that the ecosystem is coherent.
Output: Copilot adapter, integration tests, smoke test results, human-verified ecosystem

## Files Likely Touched

- `docs/guides/canonical-rules.json`
- `docs/guides/claude-md-template.md`
- `mcp-server/src/tools/validate-claude-md.ts`
- `mcp-server/src/tools/index.ts`
- `mcp-server/tests/unit/tools/validate-claude-md.test.ts`
- `[object Object]`
- `CLAUDE.md`
- `[object Object]`
- `[object Object]`
- `adapters/claude-md-copilot-adapter.sh`
- `adapters/generate-all.sh`
- `mcp-server/tests/integration/claude-md-validation.test.ts`
