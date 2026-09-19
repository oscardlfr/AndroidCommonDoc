#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# CI-parity tests: assert that .github/workflows/reusable-shell-tests.yml contains
# the same completeness logic as scripts/sh/run-bats.sh.
#
# Coverage map (12 tests):
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
#   #CP10 Any shard whose files need mcp-server (per the planner's own
#         content-based needsMcpServer classification, never a hardcoded
#         filename/shard index) builds it (npm ci + npm run build) before Bats runs
#   #CP11 bats-post's Node-hook skip roster is exactly the eight PLAN §13 R33
#         sentinels -- no fewer (accidental re-inclusion of a suite that still
#         needs the absent native provider) and no more/no wildcard (overbroad
#         exclusion silently hiding an unrelated functional suite)
#   #CP12 bats-post installs bats (npm install bats + npx bats --version)
#         before running the Node hook-test roster -- that roster includes
#         run-bats-sharded-stdin-regression.test.js, which spawns run-bats.sh
#         for real and needs bats resolvable, unlike bats-post's other Node
#         tests, which don't touch a real bats subprocess at all
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

# ─────────────────────────────────────────────────────────────────────────────
# #CP10  Sequence C19 (CI run 34897150035): any shard whose files need
#        mcp-server builds it before Bats runs
#
# Sequence 11's original mechanism keyed off ONE hardcoded filename
# (runtime-consultation-bridge.bats) via an exact manifest-line match. C18's
# weight-based rebalancing split that file's two sibling hot files
# (runtime-consultation-role-gate.bats -- itself later split again in
# Sequence C20 into runtime-consultation-role-gate-{core,plane,evidence}.bats
# -- and runtime-consultation-e2e.bats) into their OWN shards, each with the
# identical undeclared mcp-server/node_modules
# symlink prerequisite -- the exact-filename mechanism could not generalize to
# them, and CI run 34897150035 proved it: both siblings' shards failed every
# test with "Cannot find module '@modelcontextprotocol/sdk/client/index.js'".
# The fix is the planner's own content-based needsMcpServer classification
# (plan-bats-shards.cjs), consulted once via its --json report -- so this
# tracks correctly no matter how many hot files exist or how balancing
# assigns them, never a hardcoded filename or shard index.
# ─────────────────────────────────────────────────────────────────────────────
@test "#CP10 PARITY: any shard whose files need mcp-server (planner-classified) builds it (npm ci + npm run build) before Bats, never a hardcoded filename or shard index" {
    [ -f "$WORKFLOW" ] || {
        echo "WORKFLOW not found: $WORKFLOW" >&2
        return 1
    }

    # Driven by the planner's own JSON report and its needsMcpServer field --
    # never a re-invented/duplicated classification inside the workflow.
    grep -qF -- '--json' "$WORKFLOW"
    grep -qF 'shard.needsMcpServer' "$WORKFLOW"

    # The superseded exact-filename mechanism (Sequence 11) must be genuinely
    # gone, not left dead alongside the new one.
    ! grep -qF 'runtime-consultation-bridge.bats' "$WORKFLOW"
    ! grep -qF 'OWNS_RUNTIME_CONSULTATION_BRIDGE' "$WORKFLOW"

    # Shard-scoped env flag, written from the planner's own classification and
    # read by the conditional build step.
    grep -qF 'SHARD_NEEDS_MCP_SERVER=' "$WORKFLOW"
    grep -qF "if: env.SHARD_NEEDS_MCP_SERVER == 'true'" "$WORKFLOW"

    # Never a hardcoded shard index driving the decision.
    ! grep -qE "matrix\.shard[[:space:]]*==[[:space:]]*'?0'?" "$WORKFLOW"

    # Conditional MCP prerequisite: npm ci + npm run build, scoped to mcp-server.
    grep -qF 'working-directory: mcp-server' "$WORKFLOW"
    grep -qF 'npm ci' "$WORKFLOW"
    grep -qF 'npm run build' "$WORKFLOW"

    # Ordering: the build step must appear before "Run shell tests" in the
    # matrix job body.
    local build_line run_line
    build_line="$(grep -n 'name: Build mcp-server' "$WORKFLOW" | head -1 | cut -d: -f1)"
    run_line="$(grep -n 'name: Run shell tests' "$WORKFLOW" | head -1 | cut -d: -f1)"
    [ -n "$build_line" ] || {
        echo "Build mcp-server step not found in $WORKFLOW" >&2
        return 1
    }
    [ -n "$run_line" ] || {
        echo "Run shell tests step not found in $WORKFLOW" >&2
        return 1
    }
    [ "$build_line" -lt "$run_line" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #CP11  Sequence C26 (CI run 34916418722): bats-post's Node-hook SKIP_PATTERNS
#        must be exactly PLAN.md §13/L2064-2070's eight named R33 sentinels
#
# The native r33-provider is intentionally absent; PLAN §13 requires functional
# CI to skip precisely these eight scripts/tests/r33-*.test.js files by exact
# name (never a r33-* wildcard) and never claim their conformance passed. This
# closed-set comparison fails if the roster shrinks (silently re-running a
# suite that still can't pass) or grows/widens (silently hiding an unrelated
# functional suite behind the same skip).
# ─────────────────────────────────────────────────────────────────────────────
@test "#CP11 PARITY: bats-post Node-hook skip roster is exactly the eight PLAN §13 R33 sentinels (no more, no fewer, no wildcard)" {
    [ -f "$WORKFLOW" ] || {
        echo "WORKFLOW not found: $WORKFLOW" >&2
        return 1
    }

    local expected actual
    expected="$(cat <<'NAMES'
r33-authority-positive.test.js
r33-clock-containment.test.js
r33-golden-vectors.test.js
r33-native-abi.test.js
r33-native-ci-contract.test.js
r33-native-loader.test.js
r33-provider-child.test.js
r33-wire-protocol.test.js
NAMES
)"
    actual="$(awk '/SKIP_PATTERNS=\(/{f=1;next} f&&/^[[:space:]]*\)/{exit} f' "$WORKFLOW" \
        | sed -e "s/[',]//g" -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
        | grep -v '^$' | sort)"

    [ "$actual" = "$expected" ] || {
        echo "expected exactly the 8 sealed PLAN §13 R33 sentinel names, got:" >&2
        echo "$actual" >&2
        return 1
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# #CP12  bats-post installs bats before running the Node hook-test roster
#
# bats-post runs `npm ci` (mcp-server deps) but, unlike the `bats` matrix job,
# never ran `npm install bats` -- GitHub Actions jobs are isolated VMs with no
# shared filesystem/npm cache, so `run-bats-sharded-stdin-regression.test.js`
# (which spawns run-bats.sh for real) found bats unresolvable, producing an
# empty TAP log and BATS_EXPECTED=0/BATS_TOTAL=0 -- SHARD_INCOMPLETE, not a
# flake. Reproduced in a clean Docker container with and without `npm install
# bats` present. The install step must exist, appear before "Run Node.js hook
# tests", and use the exact same install command as the matrix job (never a
# separate/drifted install mechanism).
# ─────────────────────────────────────────────────────────────────────────────
@test "#CP12 PARITY: bats-post installs bats before running the Node hook-test roster" {
    [ -f "$WORKFLOW" ] || {
        echo "WORKFLOW not found: $WORKFLOW" >&2
        return 1
    }
    local after_post
    after_post="$(awk 'f{print} /^  bats-post:/{f=1}' "$WORKFLOW")"
    [ -n "$after_post" ] || {
        echo "bats-post: job not found in $WORKFLOW" >&2
        return 1
    }

    grep -qF 'Install bats for Node hook tests' <<< "$after_post"
    grep -qF 'npm install bats' <<< "$after_post"
    grep -qF 'npx bats --version' <<< "$after_post"

    local install_line run_line
    install_line="$(grep -n 'name: Install bats for Node hook tests' "$WORKFLOW" | head -1 | cut -d: -f1)"
    run_line="$(grep -n 'name: Run Node.js hook tests' "$WORKFLOW" | head -1 | cut -d: -f1)"
    [ -n "$install_line" ] || {
        echo "Install bats for Node hook tests step not found in $WORKFLOW" >&2
        return 1
    }
    [ -n "$run_line" ] || {
        echo "Run Node.js hook tests step not found in $WORKFLOW" >&2
        return 1
    }
    [ "$install_line" -lt "$run_line" ]
}
