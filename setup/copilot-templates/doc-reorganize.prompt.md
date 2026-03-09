<!-- GENERATED from skills/doc-reorganize/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Reorganize docs/ into category subdirectories using frontmatter. Use when asked to restructure or reorganize documentation."
---

Reorganize docs/ into category subdirectories using frontmatter. Use when asked to restructure or reorganize documentation.

## Implementation

This skill is an orchestration workflow using the AI agent's built-in tools.

The agent performs the following steps:
1. Use the `validate-doc-structure` MCP tool to assess current state (misplaced files, missing categories).
2. Build a move plan: for each misplaced file, determine target directory from its `category` frontmatter.
3. Use `git mv` for file moves (preserves history).
4. Use grep/search to find and update cross-references in all docs that link to moved files.
5. Category vocabulary is NOT hardcoded -- any `category` value in frontmatter is valid.
6. After moves, re-run `validate-doc-structure` to confirm all files are correctly placed.
7. Generate `docs/README.md` using the `validate-doc-structure --generate-index` mode.

