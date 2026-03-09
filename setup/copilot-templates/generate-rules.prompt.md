<!-- GENERATED from skills/generate-rules/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Generate Detekt custom rules from pattern doc frontmatter. Use when asked to create or update lint rules from documentation."
---

Generate Detekt custom rules from pattern doc frontmatter. Use when asked to create or update lint rules from documentation.

## Implementation

This skill is an orchestration workflow using the AI agent's built-in tools.

The agent performs the following steps:
1. Call the `generate-detekt-rules` MCP tool with `dry_run: true`.
2. Parse the `GenerationResult` JSON response.
3. Display a preview table: generated rules, skipped hand-written rules, and orphaned removals.
4. Ask the user for confirmation to proceed.
5. On confirmation: call `generate-detekt-rules` with `dry_run: false`.
6. Use `Bash` to run `./gradlew :detekt-rules:test` and verify compilation.
7. If new rules added: show the provider update block for `AndroidCommonDocRuleSetProvider.kt`.

