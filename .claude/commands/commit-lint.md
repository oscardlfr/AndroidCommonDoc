<!-- L0 Generic Command -->
<!-- Usage: /commit-lint [--message MSG] [--range RANGE] [--fix] [--scope-enum SCOPES] [--type-enum TYPES] -->
# /commit-lint - Validate Conventional Commits

Validate and fix commit messages against Conventional Commits v1.0.0. Use when writing commits, reviewing commit history, or enforcing commit conventions across development agents.

## Usage
```
/commit-lint
/commit-lint --fix
/commit-lint --range HEAD~5..HEAD
/commit-lint --message "added new feature"
/commit-lint --range develop..HEAD --fix
```

## Arguments
- `--message` - A single commit message to validate (instead of reading from git log).
- `--range` - Git ref range to validate (e.g., `HEAD~5..HEAD`, `main..HEAD`). Default: last commit only.
- `--fix` - Interactively rewrite non-conforming commit messages.
- `--scope-enum` - Comma-separated list of allowed scopes (e.g., `core,feature,ui`). Default: any scope accepted.
- `--type-enum` - Comma-separated list of allowed types. Default: `feat,fix,docs,style,refactor,perf,test,build,ci,chore,revert`.

## Instructions

### Step 1 -- Collect Messages

If `--message` is provided, validate that single string. Otherwise read from git log:

```bash
RANGE="${RANGE:-HEAD~1..HEAD}"
git log "$RANGE" --pretty=format:"%H %s"
```

### Step 2 -- Parse Against Conventional Commits v1.0.0

Each message MUST match: `<type>[optional scope][!]: <description>`

Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

### Step 3 -- Validate Rules

| Severity | Rule |
|----------|------|
| ERROR | Missing type prefix |
| ERROR | Missing colon-space separator after type/scope |
| ERROR | Empty description after colon-space |
| ERROR | Type not in allowed list (if `--type-enum`) |
| ERROR | Scope not in allowed list (if `--scope-enum`) |
| ERROR | Description starts with uppercase (should be lowercase) |
| ERROR | Description ends with period |
| ERROR | Subject line exceeds 100 characters |
| WARNING | Body present but not separated by blank line |
| WARNING | `BREAKING CHANGE` footer not uppercase |
| WARNING | Footer token uses spaces instead of hyphens |
| INFO | No scope provided (optional, just informational) |

### Step 4 -- Report Results

For each commit, show hash, original message, and list of violations with severity. Show suggested fix for each ERROR.

### Step 5 -- Fix Mode (`--fix`)

If `--fix` is provided, for each non-conforming message:
1. Propose a corrected version
2. Ask for confirmation before rewriting
3. Apply via `git commit --amend` (single commit) or provide `git rebase` instructions (multiple commits)

### Important Rules

1. **Read-only by default** -- only rewrite with `--fix`
2. **Conventional Commits v1.0.0** -- strict spec compliance
3. **Lowercase description** -- first character after colon-space must be lowercase
4. **No trailing period** -- description must not end with `.`
5. **Breaking changes** -- `!` after type/scope OR `BREAKING CHANGE:` footer
