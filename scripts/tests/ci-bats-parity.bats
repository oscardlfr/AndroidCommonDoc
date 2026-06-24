#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# CI-parity tests: assert that .github/workflows/reusable-shell-tests.yml contains
# the same completeness logic as scripts/sh/run-bats.sh.
#
# Coverage map (5 tests):
#   #CP1  Workflow contains the plan-parse grep (^1\.[0-9]) — mirroring run-bats.sh LD1(c)
#   #CP2  Workflow contains the total != expected mismatch fail branch — LD1(c)
#   #CP3  Workflow contains the Executed-warning grep — LD1(d)
#   #CP4  Workflows use the scripts/tests directory target and do not retain fragile *.bats globs
#   #CP5  Explicit glob count equals directory count for the current suite
#
# Rationale: the CI inline bats guard (reusable-shell-tests.yml) duplicates the
# completeness logic from run-bats.sh by design (consumer-portability invariant —
# CI must be self-contained and not call run-bats.sh directly).  These string-
# presence assertions pin the parity invariant so that if the CI inline guard
# drifts from run-bats.sh the tests fail immediately, prompting a reciprocal update.
#
# Isolation: read-only; WORKFLOW path is resolved relative to BATS_TEST_DIRNAME.
# NEVER modifies any file.

REPO_ROOT="$BATS_TEST_DIRNAME/../.."
WORKFLOW="$REPO_ROOT/.github/workflows/reusable-shell-tests.yml"
README_WORKFLOW="$REPO_ROOT/.github/workflows/readme-audit.yml"

# ─────────────────────────────────────────────────────────────────────────────
# #CP1  Workflow contains the plan-parse grep (^1\.[0-9])
#
# run-bats.sh parses the plan line with:
#   grep -c "^1\.\.[0-9]"
# The CI inline guard must contain the same anchor-free pattern so that both
# evaluate the same TAP plan line.  The \.. in YAML becomes \. after shell
# interpretation, so we search for the literal string `^1\.\.[0-9]` in the
# workflow source.
# ─────────────────────────────────────────────────────────────────────────────
@test "#CP1 PARITY: workflow contains ^1\.\.[0-9] plan-parse pattern (mirrors run-bats.sh)" {
    [ -f "$WORKFLOW" ] || {
        echo "WORKFLOW not found: $WORKFLOW" >&2
        return 1
    }
    grep -qF '^1\.\.[0-9]' "$WORKFLOW"
}

# ─────────────────────────────────────────────────────────────────────────────
# #CP2  Workflow contains the total != expected mismatch fail branch
#
# run-bats.sh fails with exit 1 when (ok + not_ok) != plan-N.
# The CI inline guard must implement an equivalent branch.  We check for the
# presence of `-ne` combined with `expected` in the workflow — the idiomatic
# sh fragment `[ "$total" -ne "${expected:-0}" ]` (or equivalent).
# ─────────────────────────────────────────────────────────────────────────────
@test "#CP2 PARITY: workflow contains total != expected mismatch fail branch (mirrors run-bats.sh)" {
    [ -f "$WORKFLOW" ] || {
        echo "WORKFLOW not found: $WORKFLOW" >&2
        return 1
    }
    # The workflow must contain both `-ne` (numeric comparison) and `expected`
    # on lines that implement the completeness mismatch branch.
    grep -q '\-ne' "$WORKFLOW"
    grep -q 'expected' "$WORKFLOW"
}

# ─────────────────────────────────────────────────────────────────────────────
# #CP3  Workflow contains the Executed-warning grep
#
# run-bats.sh checks:
#   grep -q "bats warning: Executed" <<< "$clean_log"
# and exits 1 if the warning is present.  The CI inline guard must contain the
# same check so that a teardown_file race caught locally is also caught in CI.
# ─────────────────────────────────────────────────────────────────────────────
@test "#CP3 PARITY: workflow contains bats Executed-warning grep (mirrors run-bats.sh)" {
    [ -f "$WORKFLOW" ] || {
        echo "WORKFLOW not found: $WORKFLOW" >&2
        return 1
    }
    grep -q 'bats warning: Executed' "$WORKFLOW"
}

@test "#CP4 PARITY: workflows use scripts/tests directory target, not fragile scripts/tests/*.bats glob" {
    [ -f "$WORKFLOW" ] || {
        echo "WORKFLOW not found: $WORKFLOW" >&2
        return 1
    }
    [ -f "$README_WORKFLOW" ] || {
        echo "README_WORKFLOW not found: $README_WORKFLOW" >&2
        return 1
    }

    grep -qF 'npx bats scripts/tests' "$WORKFLOW"
    grep -qF 'npx bats --count scripts/tests' "$README_WORKFLOW"
    ! grep -qF 'scripts/tests/*.bats' "$WORKFLOW"
    ! grep -qF 'scripts/tests/*.bats' "$README_WORKFLOW"
}

@test "#CP5 PARITY: explicit glob count equals directory count for current suite" {
    command -v npx >/dev/null 2>&1 || skip "npx not on PATH"

    cd "$REPO_ROOT"
    explicit_count="$(npx bats --count scripts/tests/*.bats)"
    directory_count="$(npx bats --count scripts/tests)"

    [ "$explicit_count" -gt 0 ]
    [ "$explicit_count" = "$directory_count" ]
}
