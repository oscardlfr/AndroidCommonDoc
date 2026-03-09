<!-- GENERATED from skills/monitor-docs/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Monitor upstream doc sources for version drift and deprecations. Use when asked to check for outdated dependencies or doc freshness."
---

Monitor upstream doc sources for version drift and deprecations. Use when asked to check for outdated dependencies or doc freshness.

## Implementation

This skill is an orchestration workflow using the AI agent's built-in tools.

The agent performs the following steps:
1. Call the `monitor-sources` MCP tool with the specified tier and review options.
2. Parse the structured JSON response containing findings and severity counts.
3. Present findings to the user grouped by severity.
4. For each finding the user accepts:
   - Use `Read` to load the affected pattern doc.
   - Use `Write` or `Edit` to apply the recommended update.
   - Use `Bash` to update `versions-manifest.json` if applicable.
   - Generate a conventional commit message and commit with user approval.
5. For rejected/deferred findings: update the review state via `saveReviewState`.

