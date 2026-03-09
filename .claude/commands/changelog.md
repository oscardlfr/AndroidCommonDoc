<!-- L0 Generic Command -->
<!-- Usage: /changelog [FROM_REF] [TO_REF] [--format FORMAT] -->
# /changelog - Generate Changelog from Git History

Generate a changelog from git log between two refs. Classify by conventional commit prefix. Output developer CHANGELOG.md and user-facing release notes.

## Usage
```
/changelog [FROM_REF] [TO_REF] [--format FORMAT]
```

## Arguments
- `FROM_REF` - Starting ref (default: last tag or initial commit)
- `TO_REF` - Ending ref (default: HEAD)
- `--format` - Output format: `full` (developer + user), `dev` (developer only), `user` (user-facing only). Default: `full`.

## Instructions

### Step 1 -- Determine Range

1. If FROM_REF not provided, find the last tag: `git describe --tags --abbrev=0`
2. If no tags exist, use the initial commit
3. If TO_REF not provided, use HEAD

### Step 2 -- Collect Commits

```bash
git log FROM_REF..TO_REF --pretty=format:"%h|%s|%an|%ad" --date=short
```

### Step 3 -- Classify Commits

Parse by conventional commit prefix:

| Prefix | Category | User-Visible? |
|--------|----------|---------------|
| `feat` | Features | Yes |
| `fix` | Bug Fixes | Yes |
| `perf` | Performance | Yes |
| `docs` | Documentation | No |
| `test` | Tests | No |
| `refactor` | Refactoring | No |
| `chore` | Maintenance | No |

### Step 4 -- Generate Developer Changelog

Group by category with commit hashes and scopes.

### Step 5 -- Generate User-Facing Release Notes

Filter to user-visible categories. Rewrite in plain language. No commit hashes.

### Step 6 -- Output

Based on `--format`, output developer changelog, user release notes, or both. Display in terminal by default (don't write files unless asked).

### Important Rules

1. **Read-only by default** -- display, don't write
2. **Conventional commits** -- respect prefix classification
3. **User-facing clarity** -- plain language, no hashes
4. **Skip merge commits**
