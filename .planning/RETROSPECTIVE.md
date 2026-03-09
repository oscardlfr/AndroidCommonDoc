# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-03-13
**Phases:** 4 | **Plans:** 12 | **Sessions:** ~6

### What Was Built
- 8 standardized pattern docs with anti-patterns and canonical SKILL.md format generating 32 output files for Claude Code + GitHub Copilot
- 5 custom Detekt AST-only architecture rules with full TDD test coverage
- Automated quality infrastructure: version freshness tracking, script parity validation, cross-surface drift detection, token cost measurement
- Convention plugin for one-line Gradle adoption + real-time Claude Code hooks
- Unified setup-toolkit automating full toolkit adoption in consuming projects
- Phase 4 closed 4 integration gaps found by milestone audit

### What Worked
- **Coarse phase granularity**: 4 phases (not 8+) meant less planning overhead and natural dependency flow
- **Research-before-plan**: Phase research caught Detekt API differences (RuleSetId vs RuleSet.Id) before execution, saving rework
- **Python3 adapter pattern**: Consistent cross-platform approach for all adapters — Git Bash + Windows Python just works
- **Milestone audit before completion**: Caught 4 real integration gaps that would have shipped as silent bugs
- **AST-only Detekt rule design**: Avoided #8882 type resolution performance issue entirely

### What Was Inefficient
- **Orchestrator inlining**: quality-gate-orchestrator duplicates agent logic instead of delegating — caused INT-05 drift when template-sync-validator was fixed but orchestrator's copy wasn't
- **Phase 4 was needed**: Integration gaps between phases suggest tighter cross-phase verification during execution
- **5 orphaned validation scripts**: Phase 1 one-off scripts were never cleaned up, producing noise in quality gate runs

### Patterns Established
- Adapter pipeline: SKILL.md + params.json → adapter script → tool-specific output (open/closed for new tools)
- Anti-pattern format: DON'T/DO pairs with BAD: explanation and Key insight one-liner
- afterEvaluate guard: all DSL extension property reads in convention plugins
- Marker comment idempotency: check before insert for build file modifications
- PostToolUse hook pattern: skip files >500 lines, use Detekt CLI with download+cache

### Key Lessons
1. **Inline duplication in orchestrators drifts** — when individual agents are fixed, the orchestrator's copy falls behind. v2 should delegate to agents if possible, or at minimum have a single-source approach
2. **Cross-phase integration checks should happen during execution, not only at milestone end** — Phase 4 existed entirely because Phases 1-3 had wiring gaps between them
3. **Python3 as universal adapter language works well on Windows** — avoided all bash regex pain for complex version parsing, JSON manipulation, and file generation

### Cost Observations
- Model mix: ~70% opus, ~30% sonnet (research phases used sonnet)
- Sessions: ~6 total across 4 days
- Notable: 12 plans in ~1.1 hours total execution — average 6 min/plan. Phase 4 cleanup was just 2 min

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~6 | 4 | First milestone — established adapter pipeline, quality gates, convention plugin patterns |

### Cumulative Quality

| Milestone | Detekt Rules | Quality Agents | E2E Flows Verified |
|-----------|-------------|----------------|-------------------|
| v1.0 | 5 | 4 + orchestrator | 6/6 |

### Top Lessons (Verified Across Milestones)

1. (First milestone — lessons above will be cross-validated in future milestones)
