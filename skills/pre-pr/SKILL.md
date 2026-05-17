---
name: pre-pr
description: "Run all pre-PR checks locally before opening a pull request. Validates commit messages, string resources, architecture guards, and KMP safety patterns. Use before every PR to catch CI failures locally."
intent: [pre-pr, validate, pull-request, ci, lint, quality-gate]
allowed-tools: [Bash, Read, Grep, Glob]
copilot: true
copilot-template-type: behavioral
---

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

### Step 5.5 — Warning & suppress audit

```bash
# New @Suppress annotations in diff → ERROR (not a valid fix)
SUPPRESS_HITS=$(git diff "$MERGE_BASE..HEAD" -- '*.kt' | grep '^\+' | grep -v '^\+\+\+' \
  | grep -E '@Suppress\(|@SuppressWarnings\(|@file:Suppress' \
  | grep -vcE 'ACTUAL_WITHOUT_EXPECT|EXPECT_ACTUAL_CLASSIFIERS_ARE_IN_BETA_WARNING|NO_ACTUAL_FOR_EXPECT|INVISIBLE_MEMBER|INVISIBLE_REFERENCE' || true)

if [ "$SUPPRESS_HITS" -gt 0 ]; then
  echo "ERROR: $SUPPRESS_HITS new @Suppress annotation(s) found. Fix the root cause instead."
  git diff "$MERGE_BASE..HEAD" -- '*.kt' | grep '^\+' | grep -v '^\+\+\+' \
    | grep -E '@Suppress\(|@SuppressWarnings\(|@file:Suppress'
fi
```

New `@Suppress` → ERROR (blocks). Suppressing warnings is not a valid fix strategy. Fix the underlying issue. Exception: K/N stdlib interop suppressions (ACTUAL_WITHOUT_EXPECT, INVISIBLE_MEMBER, INVISIBLE_REFERENCE, etc.) are exempt.

```bash
# Gradle deprecation/outdated warnings (if not --skip-build)
if [ -z "$SKIP_BUILD" ]; then
  ./gradlew build --warning-mode all 2>&1 \
    | grep -iE "deprecated|A newer version of .+ is available" | head -20
fi
```

Gradle deprecation warnings → WARNING (reports, dev must acknowledge).
"A newer version" warnings → WARNING (reports for visibility).

### Step 5.6 — Secret scan

Run TruffleHog on the project to detect committed secrets:

```bash
bash scripts/sh/scan-secrets.sh "$(pwd)"
```

- status=SKIPPED (trufflehog not installed): INFO — do not block
- status=PASS: continue
- findings with severity CRITICAL or HIGH: ERROR (blocks)
- findings with severity MEDIUM or LOW: WARNING (report, do not block)

### Step 5.7 — Dependency freshness

```bash
if [ -f "gradle/libs.versions.toml" ]; then
  node "$ANDROID_COMMON_DOC/mcp-server/build/cli/check-outdated.js" "$(pwd)" --format summary
fi
```

Outdated critical deps (major/minor bumps) --> WARNING (reports for visibility).
Does NOT block -- version updates are a separate task, not a PR gate.

**OBS-C (catalog-freshness monitoring)**: for continuous surveillance beyond per-PR runs, schedule `/check-outdated` via the `/schedule` skill — e.g., weekly cron posts a finding to your inbox if new upstream versions landed. Ad-hoc `/check-outdated` remains available for deep dives.

### Step 5.75 — Catalog coverage (T-BUG-013)

```bash
if git diff --name-only "$MERGE_BASE..HEAD" | grep -qE '\.gradle\.kts$'; then
  bash "$ANDROID_COMMON_DOC/scripts/sh/catalog-coverage-check.sh" --project-root "$(pwd)"
fi
```

Catalog coverage scans `*.gradle.kts` in the consumer project for hardcoded dependency literals that bypass the version catalog (e.g., `implementation("net.java.dev.jna:jna-platform:5.14.0")` when `sharedLibs.jna.platform` exists).

- Findings → WARNING (reports for visibility, does NOT block the PR).
- Fix: replace hardcoded literal with `libs.<alias>` or `sharedLibs.<alias>` — add to the catalog if missing.

**Why it matters (T-BUG-013)**: An L2 debug session (2026-04-18) caught `jna-platform:5.14.0` hardcoded in an L2 consumer while the L1 project had bumped to `5.16.0`. Silent split-version drift. The script's logic already scanned `*.gradle.kts` correctly (since T-BUG-009) but was never invoked from any pipeline — pure theater. This step closes the wiring gap.

### Step 5.8 — Agent template tests

Run Vitest integration tests when agent templates, .claude/agents/, or mcp-server sources changed:

```bash
if git diff --name-only "$BASE_SHA" HEAD | grep -qE '^(setup/agent-templates/|\.claude/agents/|mcp-server/)'; then
  cd "$ANDROID_COMMON_DOC/mcp-server" && npm test
  cd - > /dev/null
fi
```

Failures BLOCK the PR. The integration suite enforces Wave 1 template rules (Edit-directly removal, NEVER-you-fix rows, Scope Validation Gate, DURING-WAVE Protocol, Exact Fix Format, Post-Wave Team Integrity, dual-location sync).

### Step 5.9 — Agent template behavioral lint

Run when agent templates or `.claude/agents/` changed:

```bash
if git diff --name-only "$MERGE_BASE" HEAD | grep -qE '^(setup/agent-templates/|\.claude/agents/)'; then
  bash scripts/sh/validate-agent-templates.sh --show-details
fi
```

Failures BLOCK the PR. Validates role keyword contracts, tool-body cross-references, anti-patterns, size limits, and version/MIGRATIONS.json alignment.

### Step 6 — Registry hash freshness

```bash
node mcp-server/build/cli/generate-registry.js
bash scripts/sh/rehash-registry.sh --project-root "$(pwd)" --check
```

Run `node mcp-server/build/cli/generate-registry.js` then `bash scripts/sh/rehash-registry.sh --project-root "$(pwd)" --check`. Both tools produce identical hashes post-S2.1; chaining remains required through Wave 22 as regression guard.

If stale hashes found and `--fix` was passed:
```bash
node mcp-server/build/cli/generate-registry.js
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
║ Warning audit        ✅ PASS / ❌ FAIL  ║
║ Secret scan          ✅ PASS / ❌ FAIL / ⏭️ SKIP ║
║ Dep freshness        ⚠️ INFO / ⏭️ SKIP  ║
║ Catalog coverage     ⚠️ INFO / ⏭️ SKIP  ║
║ Agent template behavioral lint ✅ PASS / ❌ FAIL ║
║ Registry hashes      ✅ PASS / ❌ FAIL  ║
║ Build + Tests        ✅ PASS / ❌ FAIL  ║
╠══════════════════════════════════════════╣
║ Overall:         ✅ READY / ❌ BLOCKED  ║
╚══════════════════════════════════════════╝
```

If all pass: "Ready to open PR against `{base}`."
If any fail: list specific violations and stop.

### Step 8.5 — Write pre-pr stamp (PASS only)

On READY/PASS outcome only, write a machine-readable stamp so `pre-push-pre-pr-gate.js` can verify the check was run:

```bash
STAMP_PATH="$(pwd)/.androidcommondoc/pre-pr.stamp"
mkdir -p "$(dirname "$STAMP_PATH")"
cat > "$STAMP_PATH" <<EOF
{
  "verdict": "PASS",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "head": "$(git rev-parse HEAD)",
  "branch": "$(git branch --show-current)"
}
EOF
echo "Stamp written: $STAMP_PATH"
```

On BLOCKED/FAIL outcome: do NOT write the stamp (or write with `"verdict": "FAIL"` for audit purposes). The gate hook reads this stamp before any `git push` on feature branches.

## Important Rules

1. **Run before every PR** — CI is not a substitute for local pre-flight
2. **Commit lint must be 100% clean** — no ERRORs. Use `--fix` to repair
3. **Architecture violations block** — fix in the PR, no bypasses
4. **GlobalScope / Thread.sleep block** — hard failures, not warnings
5. **Never open a PR with known failures** — fix locally first
6. **@Suppress annotations block** — never suppress warnings to pass checks. Fix the root cause.

## Cross-References

- Skill: `/commit-lint` — detailed commit message validation and fix
- Skill: `/lint-resources` — string resource naming enforcement
- Workflow: `.github/workflows/reusable-commit-lint.yml`
- Workflow: `.github/workflows/reusable-kmp-safety-check.yml`
- Template: `setup/github-workflows/ci-template.yml`
