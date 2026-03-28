<!-- GENERATED from skills/pre-pr/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Run all pre-PR checks locally before opening a pull request. Validates commit messages, string resources, architecture guards, and KMP safety patterns. Use before every PR to catch CI failures locally."
---

Run all pre-PR checks locally before opening a pull request. Validates commit messages, string resources, architecture guards, and KMP safety patterns. Use before every PR to catch CI failures locally.

## Instructions

## Usage Examples

```
/pre-pr
/pre-pr --fix
/pre-pr --skip-build
/pre-pr --base main
```

## Parameters

- `--fix` -- Auto-fix what's fixable (commit messages via `/commit-lint --fix`). Read-only by default.
- `--skip-build` -- Skip the Gradle build + test step (fast path: checks only).
- `--base <branch>` -- Base branch to diff against. Default: `develop` (falls back to `main`, then `master`).

## Behavior

### Step 1 — Determine base branch and range

```bash
# Auto-detect base: develop > main > master
BASE=$(git rev-parse --verify develop 2>/dev/null && echo develop \
  || git rev-parse --verify main 2>/dev/null && echo main \
  || echo master)

# Allow --base override
MERGE_BASE=$(git merge-base HEAD "$BASE")
RANGE="$MERGE_BASE..HEAD"
COMMIT_COUNT=$(git log "$RANGE" --oneline | wc -l)
echo "PR range: $RANGE ($COMMIT_COUNT commits against $BASE)"
```

### Step 2 — Commit lint

```
Read skills/commit-lint/SKILL.md
```

Run with `--range $RANGE`. If `--fix` was passed, add `--fix`.

### Step 3 — Lint resources

```
Read skills/lint-resources/SKILL.md
```

Run with `--strict --show-details`.

### Step 4 — Architecture guards

```bash
./gradlew :konsist-guard:test --no-daemon 2>&1
```

If the task doesn't exist, skip with a note. On failure, show the failing test name and violation message.

### Step 5 — KMP safety check

```bash
# GlobalScope — hard error
git diff "$MERGE_BASE..HEAD" -- '*.kt' | grep '^\+' | grep -v '^\+\+\+' | grep -P 'GlobalScope\.'

# Thread.sleep — hard error
git diff "$MERGE_BASE..HEAD" -- '*.kt' | grep '^\+' | grep -v '^\+\+\+' | grep -P 'Thread\.sleep\('

# Hardcoded Dispatchers outside DI/Test — warning
git diff "$MERGE_BASE..HEAD" -- '*.kt' | grep '^\+' | grep -v '^\+\+\+' \
  | grep -P 'Dispatchers\.(IO|Default|Main)' \
  | grep -v -P 'di/|Di|Module|Injection|Test|test'
```

Any GlobalScope or Thread.sleep match → ERROR (blocks).
Dispatchers match → WARNING (reports but doesn't block).

### Step 6 — Registry hash freshness

```bash
bash scripts/sh/rehash-registry.sh --project-root "$(pwd)" --check
```

If stale hashes found and `--fix` was passed:
```bash
bash scripts/sh/rehash-registry.sh --project-root "$(pwd)"
git add skills/registry.json
```

Reports the count of stale entries. Blocks the PR if any hashes are out of date (unless `--fix` auto-repairs them).

### Step 7 — Build + Test (skip if `--skip-build`)

```bash
./gradlew check --no-daemon 2>&1
```

Report per-module pass/fail. Show failing test names on failure.

### Step 8 — Print summary table

```
╔══════════════════════════════════════════╗
║           /pre-pr Summary                ║
╠══════════════════════════════════════════╣
║ Commit lint          ✅ PASS / ❌ FAIL  ║
║ Lint resources       ✅ PASS / ❌ FAIL  ║
║ Architecture guards  ✅ PASS / ❌ FAIL  ║
║ KMP safety           ✅ PASS / ❌ FAIL  ║
║ Registry hashes      ✅ PASS / ❌ FAIL  ║
║ Build + Tests        ✅ PASS / ❌ FAIL  ║
╠══════════════════════════════════════════╣
║ Overall:         ✅ READY / ❌ BLOCKED  ║
╚══════════════════════════════════════════╝
```

If all pass: "Ready to open PR against `{base}`."
If any fail: list specific violations and stop.

## Important Rules

1. **Run before every PR** — CI is not a substitute for local pre-flight
2. **Commit lint must be 100% clean** — no ERRORs. Use `--fix` to repair
3. **Architecture violations block** — fix in the PR, no bypasses
4. **GlobalScope / Thread.sleep block** — hard failures, not warnings
5. **Never open a PR with known failures** — fix locally first

## Cross-References

- Skill: `/commit-lint` — detailed commit message validation and fix
- Skill: `/lint-resources` — string resource naming enforcement
- Workflow: `.github/workflows/reusable-commit-lint.yml`
- Workflow: `.github/workflows/reusable-kmp-safety-check.yml`
- Template: `setup/github-workflows/ci-template.yml`
