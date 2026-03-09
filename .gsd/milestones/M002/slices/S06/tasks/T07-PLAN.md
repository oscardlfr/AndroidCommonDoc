# T07: 10-doc-intelligence-detekt-generation 07

**Slice:** S06 — **Milestone:** M002

## Description

v1.1 milestone audit and cleanup: consolidate overlapping tools, remove dead code, update all documentation to reflect current state, verify convention compliance, and generate CHANGELOG.md.

Purpose: Phase 10 is the last functional phase of v1.1. This plan ensures the repository is professional, consistent, and fully documented before milestone closure. No stale references, no dead code, no drift between docs and reality.
Output: Clean repository, accurate docs, CHANGELOG.md, end-to-end verification.

## Must-Haves

- [ ] "check-freshness tool consolidated into monitor-sources with backward-compatible alias"
- [ ] "No dead code, orphaned scripts, or stale references remain from v1.0-v1.1 evolution"
- [ ] "README accurately reflects all v1.1 capabilities (Konsist, guards, MCP, registry, doc intelligence, rules)"
- [ ] "AGENTS.md accurately reflects current tool and agent inventory"
- [ ] "CHANGELOG.md summarizes all v1.1 capabilities"
- [ ] "Generated and hand-written rules compile together and tests pass end-to-end"
- [ ] "All frontmatter is complete and consistent across 23 docs"
- [ ] "Toolkit follows its own conventions (naming, file structure, error handling)"

## Files

- `mcp-server/src/tools/check-freshness.ts`
- `mcp-server/src/tools/index.ts`
- `README.md`
- `AGENTS.md`
- `CHANGELOG.md`
- `mcp-server/tests/integration/server.test.ts`
