# T02: 15-claude-md-ecosystem-alignment 02

**Slice:** S06 — **Milestone:** M004

## Description

Build the validate-claude-md MCP tool that enforces CLAUDE.md structure, canonical rule coverage, delegation direction, override validity, and cross-file consistency.

Purpose: Provide programmatic enforcement of the CLAUDE.md ecosystem structure. This tool is the safety net that ensures rewrites preserve all rules, delegation flows downward, overrides are valid, and files stay within budget.
Output: `validate-claude-md.ts` tool + unit tests + tool registration in index.ts

## Must-Haves

- [ ] "validate-claude-md MCP tool returns structured JSON with errors, warnings, and pass/fail status for any CLAUDE.md file"
- [ ] "Tool detects missing rules vs canonical checklist with per-rule coverage reporting"
- [ ] "Tool validates template structure (identity header, mandatory sections, line count, token budget)"
- [ ] "Tool detects circular/upward references (L0 never references L1/L2, L1 never references L2)"
- [ ] "Tool cross-checks version numbers against versions-manifest.json"
- [ ] "Tool validates override declarations reference valid canonical rule IDs"

## Files

- `mcp-server/src/tools/validate-claude-md.ts`
- `mcp-server/src/tools/index.ts`
- `mcp-server/tests/unit/tools/validate-claude-md.test.ts`
