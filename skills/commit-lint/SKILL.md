---
name: commit-lint
description: "Validate and fix commit messages against Conventional Commits v1.0.0. Use when writing commits, reviewing commit history, or enforcing commit conventions."
intent: [commit, lint, conventional-commits, validate, fix]
allowed-tools: [Bash, Read, Grep, Glob, Edit]
copilot: true
---

## Usage Examples

```
/commit-lint
/commit-lint --fix
/commit-lint --range HEAD~5..HEAD
/commit-lint --message "added new feature"
/commit-lint --range develop..HEAD --fix
```

## Parameters

- `--message` -- A single commit message to validate (instead of reading from git log).
- `--range` -- Git ref range to validate (e.g., `HEAD~5..HEAD`, `main..HEAD`). Default: last commit only.
- `--fix` -- Interactively rewrite non-conforming commit messages.
- `--scope-enum` -- Comma-separated list of allowed scopes (e.g., `core,feature,ui`). Default: any scope accepted.
- `--type-enum` -- Comma-separated list of allowed types. Default: `feat,fix,docs,style,refactor,perf,test,build,ci,chore,revert`.

## Behavior

1. **Collect messages**: If `--message` is provided, validate that single message. Otherwise, read commit messages from git log in the specified `--range` (default: `HEAD~1..HEAD`).
2. **Parse each message** against the Conventional Commits v1.0.0 grammar:
   - Format: `<type>[optional scope][!]: <description>\n\n[optional body]\n\n[optional footer(s)]`
   - `type` is a noun: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
   - `scope` is an optional noun in parentheses after the type.
   - `!` before the colon signals a breaking change.
   - `description` must immediately follow the colon and space.
   - Body is free-form, separated from description by one blank line.
   - Footers use `token: value` or `token #value` format. `BREAKING CHANGE` must be uppercase.
3. **Validate rules** (each violation gets a severity):
   - **ERROR** -- Missing type prefix.
   - **ERROR** -- Missing colon-space separator after type/scope.
   - **ERROR** -- Empty description after colon-space.
   - **ERROR** -- Type not in allowed list (if `--type-enum` specified).
   - **ERROR** -- Scope not in allowed list (if `--scope-enum` specified).
   - **ERROR** -- Description starts with uppercase (should be lowercase).
   - **ERROR** -- Description ends with period.
   - **ERROR** -- Subject line exceeds 100 characters.
   - **WARNING** -- Body present but not separated by blank line.
   - **WARNING** -- `BREAKING CHANGE` footer not uppercase.
   - **WARNING** -- Footer token uses spaces instead of hyphens.
   - **INFO** -- No scope provided (optional, just informational).
4. **Report** results per commit with hash, original message, and list of violations.
5. **Fix mode** (`--fix`): For each non-conforming message, propose a corrected version and apply via `git commit --amend` (single commit) or `git rebase -i` instructions (multiple commits). Ask for confirmation before rewriting.

## Conventional Commits Quick Reference

```
<type>[scope][!]: <description>

[body]

[footer(s)]
```

| Type       | SemVer  | When to use                          |
|------------|---------|--------------------------------------|
| `feat`     | MINOR   | New feature                          |
| `fix`      | PATCH   | Bug fix                              |
| `docs`     | —       | Documentation only                   |
| `style`    | —       | Formatting, no code change           |
| `refactor` | —       | Code change, no feature/fix          |
| `perf`     | PATCH   | Performance improvement              |
| `test`     | —       | Adding or fixing tests               |
| `build`    | —       | Build system or dependencies         |
| `ci`       | —       | CI configuration                     |
| `chore`    | —       | Other changes (no src/test)          |
| `revert`   | —       | Reverts a previous commit            |

**Breaking changes**: append `!` after type/scope OR add `BREAKING CHANGE:` footer. Triggers MAJOR bump.

## Implementation

### macOS / Linux
```bash
# Collect commit messages
if [ -n "$MESSAGE" ]; then
  echo "$MESSAGE" | commit_lint_validate
else
  RANGE="${RANGE:-HEAD~1..HEAD}"
  git log "$RANGE" --pretty=format:"%H|%s|%b%x00" | while IFS='|' read -r hash subject body; do
    validate_commit "$hash" "$subject" "$body"
  done
fi
```

### Windows (PowerShell)
```powershell
if ($Message) {
    Invoke-CommitLintValidate -Message $Message
} else {
    $range = if ($Range) { $Range } else { "HEAD~1..HEAD" }
    $commits = git log $range --pretty=format:"%H|%s|%b%x00"
    foreach ($entry in $commits) {
        $parts = $entry -split '\|', 3
        Invoke-CommitLintValidate -Hash $parts[0] -Subject $parts[1] -Body $parts[2]
    }
}
```

> **Note**: The actual validation logic is performed by the AI agent parsing each message against the rules above. The shell snippets show how to collect commit data.

## Expected Output

**On success (all valid):**
```
Commit Lint Results (3 commits)

✓ a1b2c3d feat(auth): add biometric login support
✓ d4e5f6a fix(network): handle timeout on retry
✓ 7g8h9i0 docs: update API reference

Status: PASS (3/3 valid)
```

**On failure:**
```
Commit Lint Results (3 commits)

✗ a1b2c3d "Added new feature"
  [ERROR] Missing type prefix — expected format: <type>[scope]: <description>
  [ERROR] Description starts with uppercase
  → Suggested fix: feat: add new feature

✓ d4e5f6a fix(network): handle timeout on retry

✗ 7g8h9i0 "refactor(ui) updated theme colors."
  [ERROR] Missing colon-space after scope — found ")" not followed by ": "
  [ERROR] Description ends with period
  → Suggested fix: refactor(ui): update theme colors

Status: FAIL (1/3 valid, 2 errors)
```

## Cross-References

- Command: `/changelog` (consumes conventional commits)
- Pattern: `docs/git-workflow.md` (if present)
- Spec: https://www.conventionalcommits.org/en/v1.0.0/
