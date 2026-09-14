#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# CI-parity tests: assert that .github/workflows/reusable-shell-tests.yml contains
# the same completeness logic as scripts/sh/run-bats.sh.
#
# Coverage map (8 tests):
#   #CP1  Workflow contains the plan-parse grep (^1\.[0-9]) — mirroring run-bats.sh LD1(c)
#   #CP2  Workflow contains the total != expected mismatch fail branch — LD1(c)
#   #CP3  Workflow contains the Executed-warning grep — LD1(d)
#   #CP4  Workflow drives bats from the planner's explicit file list, not a
#         bare directory target or a fragile shell glob
#   #CP5  Explicit glob count equals directory count for the current suite
#   #CP6  Workflow declares the required 4-shard bats matrix
#   #CP7  Per-shard artifact upload name includes the matrix shard id (never collides)
#   #CP8  Hook-install/Node-hook-test steps run exactly once, in a post-shard
#         job (needs: bats), never inside the matrix job body
#   #CP9  Failure-artifact upload is scoped to the shard's log + manifest,
#         never the whole scripts/tests/ tree
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

@test "#CP4 PARITY: workflow drives bats from the planner's explicit file list, never a bare directory or a fragile glob" {
    [ -f "$WORKFLOW" ] || {
        echo "WORKFLOW not found: $WORKFLOW" >&2
        return 1
    }
    [ -f "$README_WORKFLOW" ] || {
        echo "README_WORKFLOW not found: $README_WORKFLOW" >&2
        return 1
    }

    # Sequence 9: sharding replaced the single bare-directory invocation with
    # a per-shard explicit list from scripts/tools/plan-bats-shards.cjs.
    grep -qF 'plan-bats-shards.cjs' "$WORKFLOW"
    grep -qF 'npx bats "${FILES[@]}"' "$WORKFLOW"
    ! grep -qF 'npx bats scripts/tests' "$WORKFLOW"
    ! grep -qF 'scripts/tests/*.bats' "$WORKFLOW"
    # readme-audit.yml is unrelated to sharding and keeps its own directory-count invocation.
    grep -qF 'npx bats --count scripts/tests' "$README_WORKFLOW"
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

# ─────────────────────────────────────────────────────────────────────────────
# #CP6  Workflow declares the required 4-shard bats matrix
# ─────────────────────────────────────────────────────────────────────────────
@test "#CP6 PARITY: workflow declares a 4-shard bats matrix (do not use Bats --jobs)" {
    [ -f "$WORKFLOW" ] || {
        echo "WORKFLOW not found: $WORKFLOW" >&2
        return 1
    }
    grep -qE 'shard:[[:space:]]*\[0,[[:space:]]*1,[[:space:]]*2,[[:space:]]*3\]' "$WORKFLOW"
    ! grep -qE -- '--jobs' "$WORKFLOW"
}

# ─────────────────────────────────────────────────────────────────────────────
# #CP7  Per-shard artifact upload name includes the matrix shard id
#
# GitHub rejects/overwrites same-named artifacts uploaded from parallel
# matrix instances of one job; the upload name must be shard-qualified.
# ─────────────────────────────────────────────────────────────────────────────
@test "#CP7 PARITY: shard artifact upload name includes the matrix shard id (never collides)" {
    [ -f "$WORKFLOW" ] || {
        echo "WORKFLOW not found: $WORKFLOW" >&2
        return 1
    }
    grep -qF 'name: bats-results-shard-${{ matrix.shard }}' "$WORKFLOW"
}

# ─────────────────────────────────────────────────────────────────────────────
# #CP8  Hook-install/Node-hook-test steps run exactly once, in a post-shard
#       job, never inside the matrix job body
#
# Splits the workflow source at the `bats-post:` job marker: the matrix
# `bats:` job body (everything before the marker) must not itself install
# hooks or run the Node test roster; the post-shard job (after the marker)
# must, and must declare `needs: bats` so it waits for all four shards.
# ─────────────────────────────────────────────────────────────────────────────
@test "#CP8 PARITY: hook-install and Node.js hook-test steps run once, in a post-shard job with needs: bats" {
    [ -f "$WORKFLOW" ] || {
        echo "WORKFLOW not found: $WORKFLOW" >&2
        return 1
    }
    local before_post after_post
    before_post="$(awk '/^  bats-post:/{exit} {print}' "$WORKFLOW")"
    after_post="$(awk 'f{print} /^  bats-post:/{f=1}' "$WORKFLOW")"
    [ -n "$after_post" ] || {
        echo "bats-post: job not found in $WORKFLOW" >&2
        return 1
    }

    ! grep -qF 'Install and verify git hooks' <<< "$before_post"
    ! grep -qF 'Run Node.js hook tests' <<< "$before_post"
    grep -qF 'Install and verify git hooks' <<< "$after_post"
    grep -qF 'Run Node.js hook tests' <<< "$after_post"
    # POSIX [[:space:]], not \s (a GNU/PCRE extension BSD/macOS grep -E rejects).
    grep -qE '^[[:space:]]*needs:[[:space:]]*bats[[:space:]]*$' <<< "$after_post"
}

# ─────────────────────────────────────────────────────────────────────────────
# #CP9  Failure-artifact upload is scoped to this shard's TAP log + file
#       manifest, never the whole scripts/tests/ tree
#
# The old single-job workflow uploaded `path: scripts/tests/` wholesale on
# failure. Sharding means four parallel jobs would each re-upload all 111
# suite files unscoped; the upload must be limited to exactly what this
# shard produced.
# ─────────────────────────────────────────────────────────────────────────────
@test "#CP9 PARITY: failure-artifact upload is scoped to the shard log + manifest, never the whole scripts/tests/ tree" {
    [ -f "$WORKFLOW" ] || {
        echo "WORKFLOW not found: $WORKFLOW" >&2
        return 1
    }
    grep -qF 'bats-output-shard-${{ matrix.shard }}.log' "$WORKFLOW"
    grep -qF 'bats-shard-manifest.txt' "$WORKFLOW"
    ! grep -qF 'path: scripts/tests/' "$WORKFLOW"
}
