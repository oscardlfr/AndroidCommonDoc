---
name: auto-cover
description: "Generate tests for uncovered code paths. Use when asked to increase coverage or auto-generate tests for a module."
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob]
---

## Usage Examples

```
/auto-cover core:domain
/auto-cover core:data --target 90
/auto-cover feature:home --dry-run
/auto-cover core:model --max-tests 5
```

## Parameters

Uses parameters from `params.json`:
- `module` -- Module to cover (required, e.g., `core:domain`).
- `coverage-tool` -- Coverage tool: `jacoco`, `kover`, `auto`, `none`. Passed through to `/coverage`.
- `project-root` -- Path to the project root directory.

Additional skill-specific arguments (not in params.json):
- `--target` -- Target coverage percentage (default: 80).
- `--max-tests` -- Maximum tests to generate per run (default: 10).
- `--dry-run` -- Show what tests would be generated without writing.

## Behavior

### Phase 1: ANALYZE
1. Execute `/coverage` skill to identify gaps (uses `run-parallel-coverage-suite --skip-tests`).
2. Get list of files and lines without coverage.

### Phase 2: READ SOURCE
3. For each gap, read the source code to understand uncovered lines.
4. Identify: function, class, branches, edge cases.

### Phase 3: FIND EXISTING TESTS
5. Find corresponding test files (`**/*Test.kt`).
6. Analyze existing test patterns, imports, fakes, and mocks used.

### Phase 4: GENERATE TESTS
7. Generate tests following project patterns:
   - Follow `viewmodel-state-patterns.md` for ViewModels.
   - Use `StandardTestDispatcher` for coroutines.
   - Add edge cases: null, empty, error, success.

### Phase 5: WRITE TESTS
8. Add tests to the test file, maintaining existing structure and style.

### Phase 6: VERIFY
9. Run tests to confirm coverage improvement.
10. If fail: analyze error, adjust, retry. If pass: report improvement.

**Test naming:** `fun \`methodName returns expected when condition\`()` or `fun test_methodName_condition_expectedResult()`.

**Test structure:** Arrange-Act-Assert (AAA) pattern.

**Required edge cases:** Empty input, error path, success path, boundary conditions.

## Implementation

This skill is an orchestration workflow using the AI agent's built-in tools. No external script is needed.

The agent performs the following steps:
1. Run `/coverage` skill to get coverage gaps (uses `run-parallel-coverage-suite --skip-tests`).
2. Use `Read` tool to examine uncovered source code.
3. Use `Glob` tool to find test files (`**/*Test.kt`, `**/*Test.java`).
4. Use `Grep` tool to search for existing test patterns and imports.
5. Use `Edit` tool to write new test functions.
6. Run `/test` skill to verify the new tests pass.

## Expected Output

**On success:**
- List of tests generated with file paths
- Coverage improvement summary (before vs after percentage)
- All new tests passing

**On dry-run:**
- List of tests that would be generated
- Expected coverage improvement estimate

## Cross-References

- Pattern: `docs/viewmodel-state-patterns.md`, `docs/ui-screen-patterns.md`
- Script: Uses `/coverage` and `/test` skills internally
- Related: `/coverage` (identify gaps), `/test` (verify tests)
