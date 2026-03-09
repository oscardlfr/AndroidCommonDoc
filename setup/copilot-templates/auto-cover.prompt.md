<!-- GENERATED from skills/auto-cover/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Generate tests for uncovered code paths. Use when asked to increase coverage or auto-generate tests for a module."
---

Generate tests for uncovered code paths. Use when asked to increase coverage or auto-generate tests for a module.

## Implementation

This skill is an orchestration workflow using the AI agent's built-in tools. No external script is needed.

The agent performs the following steps:
1. Run `/coverage` skill to get coverage gaps (uses `run-parallel-coverage-suite --skip-tests`).
2. Use `Read` tool to examine uncovered source code.
3. Use `Glob` tool to find test files (`**/*Test.kt`, `**/*Test.java`).
4. Use `Grep` tool to search for existing test patterns and imports.
5. Use `Edit` tool to write new test functions.
6. Run `/test` skill to verify the new tests pass.

