<!-- GENERATED from skills/ingest-content/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Analyze external content and extract patterns for routing to docs. Use when asked to ingest an article, URL, or pasted content."
---

Analyze external content and extract patterns for routing to docs. Use when asked to ingest an article, URL, or pasted content.

## Implementation

This skill is an orchestration workflow using the AI agent's built-in tools.

The agent performs the following steps:
1. If URL provided: call the `ingest-content` MCP tool with the `url` parameter.
2. If URL unfetchable: inform the user and ask them to paste the content.
3. If content provided (pasted or from step 1): call the `ingest-content` MCP tool with the `content` parameter.
4. Parse the structured JSON response with suggestions.
5. Display suggestions grouped by target pattern doc.
6. For each accepted suggestion:
   - Use `Read` to load the target pattern doc.
   - Present the extracted patterns as recommendations for the user to incorporate.
   - Use `Write` or `Edit` to apply user-approved updates.

