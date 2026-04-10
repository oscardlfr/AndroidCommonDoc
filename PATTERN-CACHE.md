> Wave 16 note: For semantic pattern search, use `search-patterns` MCP tool (Chroma vector cache).
> This file remains as a session notepad — not replaced, serves a different purpose.

# Session Pattern Cache — Wave 9.3
# Written by context-provider. Do NOT edit manually.
# Last updated: 2026-04-05

## Template Version Map (as of ae3c34a / Wave 9.2)

| Template | Current Version | Next version (Wave 9.3) |
|---|---|---|
| test-specialist.md | 1.4.0 | 1.5.0 |
| ui-specialist.md | 1.4.0 | 1.5.0 |
| data-layer-specialist.md | 1.3.0 | 1.4.0 |
| domain-model-specialist.md | 1.3.0 | 1.4.0 |
| arch-testing.md | 1.11.0 | 1.12.0 |
| arch-platform.md | 1.9.0 | (TBD — Wave 9.3 may touch) |
| arch-integration.md | 1.9.0 | (TBD) |
| project-manager.md | 5.1.0 | (TBD) |
| quality-gater.md | 2.2.0 | (TBD) |
| context-provider.md | 2.4.0 | (no change planned) |
| planner.md | 1.4.0 | (no change planned) |
| doc-updater.md | 2.1.0 | (no change planned) |

## Integration Test Version Assertions (session-team-peers.test.ts)

Tests at mcp-server/tests/integration/session-team-peers.test.ts assert EXACT versions:
- test-specialist.md: "1.4.0" (line 39)
- ui-specialist.md: "1.4.0" (line 40)
- data-layer-specialist.md: "1.3.0" (line 41)
- domain-model-specialist.md: "1.3.0" (line 42)

⚠️ WAVE 9.3 MUST UPDATE these assertions when bumping versions.

## Integration Test Version Assertions (three-phase-architecture.test.ts)

- arch-testing.md: "1.11.0" (line 229)
- arch-platform.md: "1.9.0" (line 272)
- arch-integration.md: "1.9.0" (line 276)
- quality-gater.md: "2.2.0" (line 400)
- context-provider.md: "2.4.0" (line 779)
- planner.md: "1.4.0" (line 825)
- project-manager.md: "5.1.0" (line 143)

⚠️ Update assertions ONLY for templates that change in Wave 9.3.

## Wave 9.3 Target Changes (from L0-TEMPLATE-FEEDBACK-V2.md)

### Dev Templates (test-specialist, ui-specialist, data-layer-specialist, domain-model-specialist)
Source: L0-TEMPLATE-FEEDBACK-V2.md — Incidents #4 + #5

**Incident #4 — Dev file-path grounding / context bloat** (MEDIUM):
Add to ALL 4 dev templates:
1. Pre-Edit file-path confirmation: echo target path verbatim, compare to dispatch, stop if differs
2. Post-Edit verification echo: Read the file just modified, report "Edit applied to: <path>. Verified via Read: <grep or line count>"
3. Long-session rotation signal: if 15+ tool uses AND 150k+ tokens AND 2+ failed dispatches → stop retrying, signal architect for rotation

**Incident #5 — test-specialist gaming loop / inline stateIn tautology** (HIGH):
Add to test-specialist ONLY:
1. VM factory pattern guidance: for VMs with 5+ deps, NEVER construct local flow to mirror VM. MUST instantiate VM via createMinimal{Name}() factory with stubs.
2. Check #7 grep addition for arch-testing: stateIn in test body WITHOUT viewModel./createXxx() reference = inline stateIn tautology (gaming pattern).
3. Compile-time RED recognized as valid TDD signal for type-system bugs.

### Arch-Testing
From Incident #2 (TDD gate bypass) and Incident #5:
- Check #7 update: add stateIn.*initialValue grep pattern
- TDD order audit: test commit must precede fix commit
- Version: 1.11.0 → 1.12.0

## Key Constraints for Wave 9.3

1. Template size ≤400 lines (enforced by three-phase-architecture.test.ts describe block at line 41-52)
2. Dual-location rule: edit setup/agent-templates/ FIRST, then copy to .claude/agents/
3. Regenerate registry after all template changes: `node mcp-server/build/cli/generate-registry.js`
4. Integration tests that assert specific versions MUST be updated alongside template edits
5. template_version field is in frontmatter at line 9 of all dev templates
6. NEVER overwrite L2 private agents (memory: feedback_never_overwrite_l2_agents.md)

## Generate-Registry CLI

File: mcp-server/build/cli/generate-registry.js (compiled — source in src/cli/)
Entry: writeRegistry(rootDir) → writes to skills/registry.json
No known issues. Requires built JS — run `cd mcp-server && npm run build` if source changed.
