<!-- GENERATED from skills/doc-reorganize/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Reorganize docs/ into category subdirectories using frontmatter. Use when asked to restructure or reorganize documentation."
---

Reorganize docs/ into category subdirectories using frontmatter. Use when asked to restructure or reorganize documentation.

## Instructions

## Usage Examples

```
/doc-reorganize                    # Reorganize docs/ in current project
/doc-reorganize --dry-run          # Show planned moves without executing
/doc-reorganize --validate-only    # Just validate existing structure
```

## Parameters

Uses parameters from `params.json`:
- `project-root` -- Path to the project root directory containing docs/.

Additional skill-specific arguments (not in params.json):
- `--dry-run` -- Show what would be moved without actually moving files.
- `--validate-only` -- Only run validation, report mismatches between category frontmatter and directory placement.

## Behavior

1. Read all `.md` files in `docs/` (recursive, skip `archive/`).
2. Parse frontmatter, extract `category` field from each file.
3. For each file: if `category` value does not match the parent directory name, plan a move to `docs/{category}/`.
4. Hub+sub-doc groups must always stay together -- if a hub doc moves, all its sub-docs (files with `parent: hub-slug`) move to the same directory.
5. Update all cross-references (`../category/file.md` relative paths) in moved files.
6. Generate/update `docs/README.md` index with category sections and key entry points.
7. Commit atomically with descriptive message.

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

## Expected Output

```
Doc Reorganization Report:

Scanned: 47 files in docs/
Already correct: 39 files
Moved: 8 files
  - testing-patterns.md -> docs/testing/testing-patterns.md
  - compose-resources.md -> docs/compose/compose-resources.md
  ...

Cross-references updated: 12 files
README.md: generated (14 categories, 47 docs)

Commit: feat(docs): reorganize into category subdirectories
```

Dry-run output:
```
[DRY RUN] Would move 8 files:
  testing-patterns.md -> docs/testing/testing-patterns.md
  compose-resources.md -> docs/compose/compose-resources.md
  ...
No files were modified.
```

## Cross-References

- MCP tool: `validate-doc-structure` (validation + README generation)
- Template: `docs/guides/doc-template.md` (recommended structure and category vocabulary)
- Related skill: `/sync-vault` (run after reorganization to update vault with new paths)
- Related skill: `/validate-patterns` (verify frontmatter validity after moves)
