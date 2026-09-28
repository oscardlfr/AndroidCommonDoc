---
name: lint-resources
description: "Validate string resource naming conventions (snake_case, prefixes, duplicates, Swift sync). Use when checking resource files or before merging UI changes."
intent: [lint, resources, strings, naming, validate, duplicates]
allowed-tools: [Bash, Read, Grep, Glob]
copilot: true
---

## Prerequisites

The project must have a qualified runtime installation from `/sync-l0`. The
consumer-local launcher resolves the manifest-pinned toolkit; no ambient path
or guessed sibling checkout is accepted.

## Usage Examples

```
/lint-resources
/lint-resources --module-path feature/home
/lint-resources --strict
/lint-resources --check-swift-sync
/lint-resources --output-format json
```

## Parameters

- `--project-root` -- Project root directory (default: current working directory).
- `--module-path` -- Specific module to check, relative to project root.
- `--strict` -- Fail on warnings (prefix/format) in addition to errors.
- `--show-details` -- Show matched lines for each violation.
- `--check-swift-sync` -- Compare Compose keys against `.xcstrings` for parity.
- `--output-format` -- Output format: `human` (default) or `json`.

## Behavior

1. **Discover files**: Find all `composeResources/values/strings.xml` files under project root (or scoped module).
2. **Validate each key** against naming conventions from `compose-resources-usage.md`:
   - **ERROR**: camelCase detected — must use `snake_case`.
   - **ERROR**: uppercase letters — must use lowercase.
   - **ERROR**: invalid characters — only `[a-z0-9_]` allowed.
   - **WARNING**: no category prefix — expected `{category}_{entity}_{descriptor}` (known: `common_`, `error_`, `a11y_`, or feature prefix).
   - **WARNING**: no underscore — expected at least `{category}_{descriptor}`.
3. **Detect cross-module duplicates**: same key defined in multiple modules.
4. **Swift sync** (`--check-swift-sync`): compare Compose keys vs `.xcstrings` and report mismatches.
5. **Report** summary with error/warning/duplicate counts and exit code.

## Implementation

```bash
node .claude/runtime/l0-toolkit-launcher.cjs run lint-resources --project-root "$PWD" -- $ARGUMENTS
```

### Windows

Claude Code runs the POSIX command above from Bash on Windows as well. The
launcher selects the platform implementation and injects the project root.

## Expected Output

**On success:**
```
=== Resource Lint Report ===
Files checked: 4
Total keys:    87

-- SUMMARY -------------------------------------------------
Errors:     0
Warnings:   3
Duplicates: 0
Status:     PASSED
```

**On failure:**
```
=== Resource Lint Report ===
Files checked: 4
Total keys:    87

-- ERRORS --------------------------------------------------
  ERROR [feature/home/src/commonMain/composeResources/values/strings.xml] Key 'homeTitle' uses camelCase -- must use snake_case

-- SUMMARY -------------------------------------------------
Errors:     1
Warnings:   3
Duplicates: 0
Status:     FAILED
```

## Cross-References

- Pattern doc: `docs/ui/compose-resources-usage.md`
- Skill: `/verify-kmp` (source set validation)
- Convention plugin: `androidcommondoc.toolkit` (detekt + ktlint)
