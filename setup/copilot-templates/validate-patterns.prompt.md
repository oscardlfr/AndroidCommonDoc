<!-- GENERATED from skills/validate-patterns/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Validate code against pattern standards (ViewModel, UI, coroutines). Use when asked to check code quality or pattern compliance."
---

Validate code against pattern standards (ViewModel, UI, coroutines). Use when asked to check code quality or pattern compliance.

## Implementation

This skill is an orchestration workflow using the AI agent's built-in tools.

The agent performs the following steps:
1. Read the file(s) using `Read` tool.
2. Compare against patterns from `docs/viewmodel-state-patterns.md`.
3. Compare against patterns from `docs/ui-screen-patterns.md`.
4. Report findings with severity and suggested fixes.

