---
name: coverage-full
description: "Generate comprehensive coverage report across all modules. Use when asked for full project coverage overview or metrics."
intent: [coverage, report, modules, comprehensive, metrics]
allowed-tools: [Bash, Read, Grep, Glob]
copilot: true
---

## Reproducible evidence

For any result consumed by a quality gate, wrap execution with `scripts/tools/evidence-run.cjs`: create a start record before the command, finish it with the real artifact and counts, and retain its HEAD/PLAN/wave/target/environment/tool-version binding. Security-critical mint evidence requires two distinct agreeing records; newest-wins discovery and reused run IDs are rejected.

## Usage Examples

```
/coverage-full
/coverage-full --include-shared
/coverage-full --min-lines 5
/coverage-full --coverage-tool kover
```

## Parameters

Uses parameters from `params.json`:
- `include-shared` -- Include the shared library project in the coverage report.
- `min-missed-lines` -- Minimum missed lines to show a class (default: 0 = all classes).
- `coverage-tool` -- Coverage tool: `jacoco`, `kover`, `auto`, `none`.
- `skip-tests` -- Always `true` for this skill; uses existing coverage data.
- `project-root` -- Path to the project root directory.

## Behavior

1. Scan the current project (and the shared library if `--include-shared`).
2. Find all coverage XML reports per module (JaCoCo or Kover).
3. Parse and aggregate coverage:
   - Coverage percentage per module.
   - All classes with covered/missed lines.
   - Exact missed line numbers.
4. Generate comprehensive Markdown report.
5. Save report to `coverage-full-report.md`.

**CRITICAL:** Do NOT read XML coverage files directly. Trust the script output.

## Implementation

```bash
node .claude/runtime/l0-toolkit-launcher.cjs run test-full --project-root "$PWD" -- --skip-tests $ARGUMENTS
```

### Windows
Claude Code runs the POSIX command above from Bash on Windows as well. The
consumer-local launcher selects the platform implementation, verifies the
manifest-pinned toolkit, and injects the project root.

## Expected Output

**On success:**
- Summary table by module with coverage percentage
- Grand totals (covered, missed, total lines)
- Detailed class listing per module with missed line ranges
- File: `coverage-full-report.md`

**Difference from /coverage:**

| Feature | /coverage | /coverage-full |
|---------|-----------|----------------|
| Purpose | Identify gaps to fix | Complete overview |
| Filter | Only files >= 5 missed lines | All classes (configurable) |
| Multi-project | Single project | + shared library support |
| Use case | Before PR / fixing coverage | Documentation / metrics |

## Cross-References

- Pattern: `docs/testing-patterns.md`
- Script: `scripts/sh/run-parallel-coverage-suite.sh`, `scripts/ps1/run-parallel-coverage-suite.ps1`
- Related: `/coverage` (gap analysis), `/test-full` (run tests + coverage)
