---
name: kdoc-audit
description: "Audit KDoc coverage on public Kotlin APIs. Reports undocumented symbols, per-module coverage, and regression warnings vs baseline."
intent: [kdoc, audit, coverage, kotlin, api, undocumented]
allowed-tools: [Bash, Read, Grep, Glob]
disable-model-invocation: true
copilot: true
copilot-template-type: behavioral
---

## Usage Examples

```
/kdoc-audit                                    # all modules, full report
/kdoc-audit --changed-only                     # only files changed in current branch
/kdoc-audit --module core-domain               # single module deep audit
/kdoc-audit --threshold 90                     # custom coverage target
/kdoc-audit --project-root ../shared-kmp-libs  # cross-project
/kdoc-audit --check-content                    # semantic: KDoc vs pattern docs (deep)
```

## Parameters

- `--project-root PATH` -- Target project root (default: auto-detect).
- `--module MODULE` -- Single module to audit (default: all modules).
- `--changed-only` -- Only check files changed since base branch (quality gate mode).
- `--threshold N` -- Minimum coverage percentage target (default: 80).
- `--check-content` -- Deep mode: compare KDoc content against pattern docs for semantic alignment. Expensive — uses LLM.
- `--format json|markdown|both` -- Output format (default: both).

## Behavior

### Standard Mode (default)

1. Call `kdoc-coverage` MCP tool with `project_root` and optional `modules`/`changed_files`
2. Display per-module coverage table
3. Compare against previous baseline in `.androidcommondoc/audit-log.jsonl`
4. Flag regressions: module coverage dropped since last audit
5. List undocumented public APIs with `file:line` references
6. Prioritize: public interfaces > sealed classes > public classes > functions > properties

### Changed-Only Mode (`--changed-only`)

1. Detect base branch: `develop` → `main` → `master`
2. Get changed .kt files: `git diff --name-only $BASE...HEAD | grep '\.kt$'`
3. Call `kdoc-coverage` with `changed_files` parameter
4. **Report PASS/FAIL**: any new public API without KDoc = FAIL

### Deep Mode (`--check-content`)

1. Run standard mode first
2. For each documented public API in changed files:
   a. Extract KDoc content
   b. Find related pattern docs via `find-pattern` MCP tool
   c. Compare KDoc recommendations against pattern doc conventions
   d. Flag contradictions (e.g., KDoc says "use Channel" but pattern says "SharedFlow")
3. Report semantic drift findings with severity

## Output

```markdown
## KDoc Coverage Audit

| Module | Public APIs | Documented | Coverage | Trend |
|--------|------------|------------|----------|-------|
| core-domain | 45 | 38 | 84.4% | ↑ +2.1% |
| core-data | 30 | 22 | 73.3% | ↓ -1.2% |
| **Overall** | **75** | **60** | **80.0%** | **→** |

### Undocumented APIs (15)
- `invoke` (function) — src/.../FetchProjectsUseCase.kt:12
- `Repository` (interface) — src/.../ProjectRepository.kt:5
...

### Regressions
- core-data: dropped from 74.5% to 73.3% (-1.2%)

### Semantic Drift (--check-content only)
- ProjectRepository.sync(): KDoc says "blocks thread" but pattern says "suspend function required"
```

## Cross-References

- MCP tool: `kdoc-coverage` (data source)
- Quality gate: Step 0.5 uses `kdoc-coverage` in changed-only mode
- Guardian: `doc-alignment-agent` runs KDoc coverage as continuous drift detection
- Migration: `/kdoc-migrate` uses this to measure progress
