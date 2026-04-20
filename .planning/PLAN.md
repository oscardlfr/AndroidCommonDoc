# Wave 22 — Token Topology

> Branch: feature/wave22-token-topology from develop
> Status: Phase 1 — Planning

## Scope

Token reduction architecture for agent sessions. Target: 300K → 60-80K tokens/session in main context.

## Sprints

| # | Sprint | Effort | Files |
|---|--------|--------|-------|
| S1 | PM template model → sonnet | ~1h | setup/agent-templates/project-manager.md, .claude/agents/project-manager.md |
| S2 | Spawn-prompt diet ≤25 lines | ~4-5h | setup/agent-templates/project-manager.md, docs/agents/agent-core-rules.md |
| S3 | Mandatory rtk prefix | ~1-2h | setup/agent-templates/project-manager.md, CLAUDE.md |
| S4 | Shared-context via files | ~3-4h | docs/agents/agent-verdict-protocol.md, setup/agent-templates/arch-*.md |
| S5 | Verdict archiver pattern | ~2h | setup/agent-templates/arch-*.md, setup/agent-templates/project-manager.md |
| S6 | Compaction-loop detection | ~2-3h | setup/agent-templates/project-manager.md |
| S7 | PLAN.md modularization | ~2h | docs/agents/pm-phase-execution.md |
| S8 | Token meter (STRETCH) | ~2-3h | setup/agent-templates/project-manager.md |

## Scope Files

- setup/agent-templates/project-manager.md
- .claude/agents/project-manager.md
- setup/agent-templates/arch-testing.md
- setup/agent-templates/arch-platform.md
- setup/agent-templates/arch-integration.md
- .claude/agents/arch-testing.md
- .claude/agents/arch-platform.md
- .claude/agents/arch-integration.md
- docs/agents/agent-core-rules.md
- docs/agents/agent-verdict-protocol.md
- docs/agents/pm-phase-execution.md
- docs/agents/agents-hub.md
- CLAUDE.md
- .planning/PLAN-W22.md
- .claude/model-profiles.json
- mcp-server/tests/integration/model-profiles.test.ts

## Acceptance Criteria

- S1: model field = sonnet in both template locations, template_version = 5.14.0
- S2: all 6 peer spawn prompts ≤25 lines; agent-core-rules.md created with correct frontmatter; agents-hub.md row added
- S3: rtk rule in PM Script Invocation section; CLAUDE.md Wave 22 note present
- S4: agent-verdict-protocol.md created with frontmatter; arch templates write verdict to .planning/wave{N}/ + 1-liner DM; arch-platform extracted to sub-doc before additions (399-line limit)
- S5: arch templates: APPROVE=TaskUpdate only, ESCALATE=SendMessage with ESCALATION marker; PM template: TaskList tally pattern documented
- S6: PM template: peer_last_sha[] tracking + 3-echo detection
- S7: pm-phase-execution.md (EXISTS, 90 lines) updated to document master/per-wave PLAN.md split
- S8 (stretch): PM template: byte-estimate logging + retrospective file generation

## Risks

- arch-platform.md at 399/400 lines — MUST extract content to sub-doc before S4/S5 additions or bust hard limit
- pm-phase-execution.md already exists (90 lines) — S7 is an UPDATE not a new file; no frontmatter creation needed
- agent-core-rules.md and agent-verdict-protocol.md are new — both need YAML frontmatter + agents-hub.md row

## Open from Wave 21

- Bug #5: arch activation reads hardcoded cwd/.planning/PLAN.md (not in Wave 22 scope)
- Bug #6: PREP/EXECUTE dispatch mode tagging (not in Wave 22 scope)
- P4: 18 agent mirrors + Windows test path (not in Wave 22 scope)
