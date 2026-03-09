# T02: 05-tech-debt-foundation 02

**Slice:** S01 — **Milestone:** M002

## Description

Refactor quality-gate-orchestrator.md to delegate to individual gate agents instead of inlining their logic, and delete the 5 orphaned validate-phase01-*.sh scripts.

Purpose: Eliminate the drift problem where the orchestrator's inlined copy of gate logic falls behind individual agent updates (this already caused INT-05 in v1.0). Clean up orphaned scripts that produce noise in quality gate runs.
Output: Slim orchestrator (~80-100 lines) that reads individual agents at runtime. 5 orphaned scripts deleted.

## Must-Haves

- [ ] "Quality-gate-orchestrator reads individual agent .md files at runtime and follows their instructions"
- [ ] "Updating an individual gate agent automatically changes what the orchestrator checks -- no manual orchestrator sync needed"
- [ ] "Individual gate agents remain independently invocable for debugging"
- [ ] "Orchestrator produces the same unified report format as before"
- [ ] "Token Cost Summary section stays inline in orchestrator"
- [ ] "The 5 orphaned validate-phase01-*.sh scripts no longer exist in scripts/sh/"
- [ ] "No active code or configuration references the deleted scripts"

## Files

- `.claude/agents/quality-gate-orchestrator.md`
- `scripts/sh/validate-phase01-pattern-docs.sh`
- `scripts/sh/validate-phase01-param-manifest.sh`
- `scripts/sh/validate-phase01-skill-pipeline.sh`
- `scripts/sh/validate-phase01-agents-md.sh`
- `scripts/sh/validate-phase01-param-drift.sh`
