<!-- L0 Generic Command -->
<!-- Usage: /pre-pr [--fix] [--skip-build] [--base BRANCH] -->
# /pre-pr - Pre-PR Validation Suite

Run all checks that CI will enforce before opening a PR. Fixes issues locally to avoid failed CI runs.

## Usage
```
/pre-pr
/pre-pr --fix
/pre-pr --skip-build
/pre-pr --base main
```

## Arguments
- `--fix` - Auto-fix fixable issues (commit messages via `/commit-lint --fix`).
- `--skip-build` - Skip Gradle build + test (fast path: checks only).
- `--base <branch>` - Base branch for diff. Default: `develop` → `main` → `master` (auto-detected).

## Instructions

Load and follow `skills/pre-pr/SKILL.md`.
