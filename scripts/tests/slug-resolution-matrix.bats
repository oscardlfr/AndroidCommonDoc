#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Golden cross-resolver slug agreement matrix (BL-W47 PR-0c.1 P2b).
#
# All 5 slug resolvers must produce IDENTICAL slugs for the same branch:
#   1. subagent-start-context-bundle.js  (branch-last-segment ONLY — no env leg by design)
#   2. wave-phase-gate.js                (CLAUDE_WAVE_SLUG env → branch-last-segment)
#   3. premature-execution-gate.js       (CLAUDE_WAVE_SLUG env → branch-last-segment)
#   4. write-verdict.sh                  (--slug → CLAUDE_WAVE_SLUG → branch-last-segment)
#   5. write-bundle.sh                   (--slug → CLAUDE_WAVE_SLUG → branch-last-segment)
#
# Branch → expected slug table:
#   feature/bl-w47-pr-0c1  → bl-w47-pr-0c1   (all 5 must agree)
#   codex/bl-w47-demo      → bl-w47-demo      (all 5 must agree — this is the P2b regression case)
#   wip                    → wip              (all 5 must agree — no-slash non-protected: last-segment = itself)
#   develop                → reject/skip      (all 5 must reject or skip)
#   master                 → reject/skip      (all 5 must reject or skip)
#
# Env isolation (HARD — S4 lesson):
#   Each test uses mktemp -d + git init + git checkout -b <branch>.
#   NEVER read the live repo's .git or .androidcommondoc stamps.
#
# For wave-phase-gate branch-path tests (SRM-*2b): the sentinel is written at
# $PROJ/.claude/wave-quality-gates/<last-segment>.md. The gate uses CLAUDE_PROJECT_DIR=$PROJ
# and NO CLAUDE_WAVE_SLUG env so Priority 2 (git branch parsing) is exercised.
# BEFORE P2b fix: gate returns full branch (e.g. codex/bl-w47-demo), sentinel path
# embeds a slash → existsSync on the wrong path → exit 2 (RED).
# AFTER P2b fix: gate returns last-segment (bl-w47-demo), sentinel found → exit 0 (GREEN).
#
# Invocation: bats scripts/tests/slug-resolution-matrix.bats (from repo root)

# Hook / script paths
HOOK_SUBAGENT="$BATS_TEST_DIRNAME/../../.claude/hooks/subagent-start-context-bundle.js"
HOOK_WAVE_PHASE="$BATS_TEST_DIRNAME/../../.claude/hooks/wave-phase-gate.js"
HOOK_PEG="$BATS_TEST_DIRNAME/../../.claude/hooks/premature-execution-gate.js"
SCRIPT_VERDICT="$BATS_TEST_DIRNAME/../sh/write-verdict.sh"
SCRIPT_BUNDLE="$BATS_TEST_DIRNAME/../sh/write-bundle.sh"

# Minimal bundle body for write-bundle.sh calls.
BUNDLE_BODY="## Context
- slug matrix test"

setup() {
  PROJ="$(mktemp -d)"
  git -C "$PROJ" init -q 2>/dev/null
  git -C "$PROJ" config user.email "bats@test.local"
  git -C "$PROJ" config user.name "Bats Test"
  git -C "$PROJ" commit --allow-empty -q -m "init"
  unset CLAUDE_WAVE_SLUG
}

teardown() {
  rm -rf "$PROJ"
}

# ── Helper: resolve slug via subagent-start hook (branch-only, no env) ─────────
# Returns the wave_slug that the hook would use for bundle lookup.
# Strategy: create a bundle for the expected last-segment slug; if the hook
# finds and injects it, the resolver produced the correct slug.
resolve_via_subagent() {
  local branch="$1" expected_slug="$2"
  # Check out the branch in the isolated repo.
  git -C "$PROJ" checkout -b "$branch" -q 2>/dev/null || \
    git -C "$PROJ" checkout "$branch" -q 2>/dev/null
  # Write a bundle with wave_slug matching the expected last-segment.
  local bundle_dir="$PROJ/.planning/wave-$expected_slug/context-bundles"
  mkdir -p "$bundle_dir"
  printf -- '---\nwave_slug: %s\n---\n# Slug matrix probe\nMatch confirmed.\n' \
    "$expected_slug" > "$bundle_dir/arch-platform.md"
  # Run the hook — if additionalContext is injected, the slug resolved correctly.
  local input_file
  input_file="$(mktemp "$PROJ/sa-input.XXXXXX.json")"
  python3 - "$input_file" <<'PYEOF'
import json, sys
with open(sys.argv[1], "w") as f:
    json.dump({"hook_event_name": "SubagentStart", "agent_type": "arch-platform"}, f)
PYEOF
  local out
  out="$(cat "$input_file" | CLAUDE_PROJECT_DIR="$PROJ" node "$HOOK_SUBAGENT" 2>/dev/null)"
  rm -f "$input_file"
  echo "$out"
}

# ── Helper: resolve slug via premature-execution-gate (env override path) ──────
# Sets CLAUDE_WAVE_SLUG env to the last-segment and confirms the gate detects the wave.
# Uses run so non-zero exit is captured in $status, not propagated as bats failure.
run_peg_with_slug() {
  local slug="$1"
  # Create wave dir for the slug so the gate confirms active wave.
  local wave_dir="$PROJ/.planning/wave-$slug"
  mkdir -p "$wave_dir"
  # No verdict → gate blocks (proves wave was detected via slug).
  local input_file
  input_file="$(mktemp "$PROJ/peg-input.XXXXXX.json")"
  python3 - "$input_file" <<'PYEOF'
import json, sys
with open(sys.argv[1], "w") as f:
    json.dump({"tool_name": "Write", "tool_input": {"file_path": "docs/x.md"}, "agent_type": "test-specialist"}, f)
PYEOF
  run bash -c "cat '$input_file' | CLAUDE_PROJECT_DIR='$PROJ' WAVE_PREP_BYPASS='' CLAUDE_WAVE_SLUG='$slug' node '$HOOK_PEG' 2>/dev/null"
  rm -f "$input_file"
}

# ── Helper: run wave-phase-gate via BRANCH path (no CLAUDE_WAVE_SLUG) ──────────
# Checks out the given branch in $PROJ, creates a sentinel for expected_slug,
# runs the gate with CLAUDE_PROJECT_DIR=$PROJ and NO env slug override.
# BEFORE P2b fix: gate returns full branch name → wrong sentinel path → exit 2.
# AFTER  P2b fix: gate returns last-segment → correct sentinel → exit 0.
run_wpg_branch_path() {
  local branch="$1" expected_slug="$2"
  # Checkout branch in isolated repo.
  git -C "$PROJ" checkout -b "$branch" -q 2>/dev/null || \
    git -C "$PROJ" checkout "$branch" -q 2>/dev/null
  # Create sentinel at the CORRECT last-segment path (post-fix path).
  local sentinel_dir="$PROJ/.claude/wave-quality-gates"
  mkdir -p "$sentinel_dir"
  printf '# sentinel for slug-matrix test\n' > "$sentinel_dir/$expected_slug.md"
  # Run gate with no CLAUDE_WAVE_SLUG — forces Priority 2 (branch parsing).
  local payload
  payload="$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"git push origin '"$branch"'"}}')"
  run bash -c "printf '%s' '$payload' | CLAUDE_PROJECT_DIR='$PROJ' node '$HOOK_WAVE_PHASE'"
}

# ── Resolver agreement: feature/bl-w47-pr-0c1 → bl-w47-pr-0c1 ────────────────

@test "SRM-F1: subagent-start resolver: feature/bl-w47-pr-0c1 → slug bl-w47-pr-0c1" {
  git -C "$PROJ" checkout -b "feature/bl-w47-pr-0c1" -q 2>/dev/null
  local out
  out="$(resolve_via_subagent 'feature/bl-w47-pr-0c1' 'bl-w47-pr-0c1')"
  [[ "$out" == *'"additionalContext"'* ]]
  [[ "$out" == *"Match confirmed"* ]]
}

@test "SRM-F2b: wave-phase-gate BRANCH PATH: feature/bl-w47-pr-0c1 → last-segment bl-w47-pr-0c1 → sentinel found → exit 0" {
  # TRUE P2b validation for wave-phase-gate, feature/ row.
  # Drives Priority 2 (branch parsing): no CLAUDE_WAVE_SLUG env.
  # feature/ prefix is already stripped correctly BEFORE the P2b fix, so this
  # is expected GREEN even now — used as a control to verify the branch-path
  # plumbing works before relying on the codex/ and wip cases as RED signals.
  run_wpg_branch_path "feature/bl-w47-pr-0c1" "bl-w47-pr-0c1"
  [ "$status" -eq 0 ]
}

@test "SRM-F3: premature-execution-gate resolver: feature/bl-w47-pr-0c1 → slug bl-w47-pr-0c1 → wave detected" {
  # Pass CLAUDE_WAVE_SLUG as the pre-resolved last-segment. Gate detects wave → blocks.
  git -C "$PROJ" checkout -b "feature/bl-w47-pr-0c1" -q 2>/dev/null
  run_peg_with_slug "bl-w47-pr-0c1"
  [ "$status" -eq 2 ]
}

@test "SRM-F4: write-verdict.sh: --slug bl-w47-pr-0c1 accepted → verdict created" {
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG=bl-w47-pr-0c1 bash '$SCRIPT_VERDICT' \
    --role arch-testing --phase prep --slug bl-w47-pr-0c1"
  [ "$status" -eq 0 ]
  [ -f "$PROJ/.planning/wave-bl-w47-pr-0c1/arch-testing-verdict.md" ]
}

@test "SRM-F5: write-bundle.sh: --slug bl-w47-pr-0c1 accepted → bundle created" {
  run bash -c "cd '$PROJ' && printf '%s\n' '$BUNDLE_BODY' | bash '$SCRIPT_BUNDLE' \
    --role test-specialist --plan-id 'wave-bl-w47-pr-0c1/PLAN.md#SRM' --slug bl-w47-pr-0c1"
  [ "$status" -eq 0 ]
  [ -f "$PROJ/.planning/wave-bl-w47-pr-0c1/context-bundles/test-specialist.md" ]
}

# ── Resolver agreement: codex/bl-w47-demo → bl-w47-demo (P2b regression) ──────

@test "SRM-C1: subagent-start resolver: codex/bl-w47-demo → slug bl-w47-demo" {
  # P2b Codex repro: before fix, subagent-start returned full branch 'codex/bl-w47-demo'.
  # After fix, it must return last-segment 'bl-w47-demo'. Probe: write bundle for 'bl-w47-demo';
  # if injected, resolver produced the correct last-segment slug.
  local out
  out="$(resolve_via_subagent 'codex/bl-w47-demo' 'bl-w47-demo')"
  [[ "$out" == *'"additionalContext"'* ]]
  [[ "$out" == *"Match confirmed"* ]]
}

@test "SRM-C2b: wave-phase-gate BRANCH PATH: codex/bl-w47-demo → last-segment bl-w47-demo → sentinel found → exit 0" {
  # TRUE P2b regression for wave-phase-gate.
  # BEFORE fix: getWaveSlug() returns 'codex/bl-w47-demo' (full branch, no stripping for non-feature/).
  #   getSentinelPath() → '.claude/wave-quality-gates/codex/bl-w47-demo.md'
  #   fs.existsSync() cannot find it (sentinel is at 'bl-w47-demo.md') → exit 2. RED.
  # AFTER fix: returns 'bl-w47-demo' (last-segment via split('/').pop() or ${branch##*/})
  #   getSentinelPath() → '.claude/wave-quality-gates/bl-w47-demo.md' → found → exit 0. GREEN.
  run_wpg_branch_path "codex/bl-w47-demo" "bl-w47-demo"
  [ "$status" -eq 0 ]
}

@test "SRM-WPG-BRANCH: wave-phase-gate resolves codex/ branch via last-segment (no env)" {
  # Canonical P2b regression for wave-phase-gate branch-parsing path.
  # Exactly mirrors team-lead dispatch template — no CLAUDE_WAVE_SLUG env.
  # Sentinel at bl-w47-demo.md (correct last-segment); BEFORE fix the gate
  # looks for codex/bl-w47-demo.md (embedded slash, wrong path) → exit 2 (RED).
  # AFTER fix: last-segment slug → sentinel found → exit 0 (GREEN).
  git -C "$PROJ" checkout -b codex/bl-w47-demo -q 2>/dev/null
  mkdir -p "$PROJ/.claude/wave-quality-gates"
  : > "$PROJ/.claude/wave-quality-gates/bl-w47-demo.md"
  run bash -c "printf '%s' '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin codex/bl-w47-demo\"}}' | CLAUDE_PROJECT_DIR='$PROJ' node '$HOOK_WAVE_PHASE'"
  [ "$status" -eq 0 ]
}

@test "SRM-C3: premature-execution-gate resolver: codex/bl-w47-demo → slug bl-w47-demo → wave detected" {
  git -C "$PROJ" checkout -b "codex/bl-w47-demo" -q 2>/dev/null
  run_peg_with_slug "bl-w47-demo"
  [ "$status" -eq 2 ]
}

@test "SRM-C4: write-verdict.sh: --slug bl-w47-demo accepted → verdict created" {
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG=bl-w47-demo bash '$SCRIPT_VERDICT' \
    --role arch-testing --phase prep --slug bl-w47-demo"
  [ "$status" -eq 0 ]
  [ -f "$PROJ/.planning/wave-bl-w47-demo/arch-testing-verdict.md" ]
}

@test "SRM-C5: write-bundle.sh: --slug bl-w47-demo accepted → bundle created (P2b regression)" {
  # Before P2b fix, write-bundle.sh only accepted feature/ branches → error on codex/.
  # After fix: last-segment slug from any branch prefix is accepted.
  run bash -c "cd '$PROJ' && printf '%s\n' '$BUNDLE_BODY' | bash '$SCRIPT_BUNDLE' \
    --role test-specialist --plan-id 'wave-bl-w47-demo/PLAN.md#SRM' --slug bl-w47-demo"
  [ "$status" -eq 0 ]
  [ -f "$PROJ/.planning/wave-bl-w47-demo/context-bundles/test-specialist.md" ]
}

# ── Resolver agreement: wip → wip (no-slash, non-protected) ─────────────────
# This row exposes the real P2b divergence for shell scripts: the 3 JS hooks
# already return 'wip' (last-segment of itself), but write-verdict.sh and
# write-bundle.sh ERROR today when detecting 'wip' via branch-inspection because
# their slug resolvers require the branch to contain '/' to extract a slug.
# The --slug flag bypasses this (Priority 1) and already works; the regression
# is in the branch-detection path (no --slug, no CLAUDE_WAVE_SLUG).
# After the P2b fix (${branch##*/} regardless of slash presence + reject-list),
# all 5 must agree on 'wip'.
# SRM-W3 and SRM-W5 are RED now and GREEN after toolkit's P2b impl.
# SRM-W2b is a GREEN control case (wip has no slash; current code already returns 'wip').

@test "SRM-W1: subagent-start resolver: wip branch (no-slash) → slug 'wip'" {
  local out
  out="$(resolve_via_subagent 'wip' 'wip')"
  [[ "$out" == *'"additionalContext"'* ]]
  [[ "$out" == *"Match confirmed"* ]]
}

@test "SRM-W2b: wave-phase-gate BRANCH PATH: wip (no-slash) → last-segment wip → sentinel found → exit 0" {
  # TRUE P2b regression for wave-phase-gate, no-slash branch row.
  # BEFORE fix: getWaveSlug() returns 'wip' (passes the non-empty, non-HEAD, non-protected check;
  #   not feature/ → falls into `return branch` which is 'wip').
  # Wait — 'wip' would ALREADY return 'wip' via `return branch` in the current code
  # (line 41 in wave-phase-gate.js). The P2b bug for wave-phase-gate only fires on branches
  # with a slash that aren't feature/ (e.g. codex/bl-w47-demo → 'codex/bl-w47-demo').
  # For 'wip' (no slash), the current code already returns 'wip' (last-segment = itself).
  # So this test is a control case: both BEFORE and AFTER the fix, exit 0 (GREEN).
  # It confirms the sentinel-path logic works for no-slash slugs.
  run_wpg_branch_path "wip" "wip"
  [ "$status" -eq 0 ]
}

@test "SRM-W3: write-verdict.sh: wip branch (branch-detection path, no --slug) → verdict created (P2b regression)" {
  # The P2b regression fires on the branch-detection path (no --slug flag, no CLAUDE_WAVE_SLUG).
  # write-verdict.sh resolve_slug(): `if [[ "$branch" == *"/"* ]]` — only extracts
  # the last segment when branch contains a slash. A bare 'wip' branch (no slash) falls
  # through to the ERROR exit.
  # After fix: ${branch##*/} applied regardless of slash, then reject-list checked.
  git -C "$PROJ" checkout -b "wip" -q 2>/dev/null
  run bash -c "cd '$PROJ' && bash '$SCRIPT_VERDICT' \
    --role arch-testing --phase prep"
  [ "$status" -eq 0 ]
  [ -f "$PROJ/.planning/wave-wip/arch-testing-verdict.md" ]
}

@test "SRM-W4: premature-execution-gate resolver: CLAUDE_WAVE_SLUG=wip → wave detected → blocks" {
  run_peg_with_slug "wip"
  [ "$status" -eq 2 ]
}

@test "SRM-W5: write-bundle.sh: wip branch (branch-detection path, no --slug) → bundle created (P2b regression)" {
  # Same branch-detection regression as SRM-W3: write-bundle.sh today requires the branch to
  # match ^feature/(.+)$ — a bare 'wip' branch triggers the ERROR exit.
  # After fix: last-segment logic (${branch##*/}) accepts 'wip'; not in reject-list → success.
  git -C "$PROJ" checkout -b "wip" -q 2>/dev/null
  run bash -c "cd '$PROJ' && printf '%s\n' '$BUNDLE_BODY' | bash '$SCRIPT_BUNDLE' \
    --role test-specialist --plan-id 'wave-wip/PLAN.md#SRM'"
  [ "$status" -eq 0 ]
  [ -f "$PROJ/.planning/wave-wip/context-bundles/test-specialist.md" ]
}

# ── Reject-list: develop → reject/skip (all 5 must refuse) ───────────────────

@test "SRM-D1: subagent-start: CLAUDE_WAVE_SLUG=develop (reject-list) → no bundle injected, silent exit 0" {
  # develop is in the reject-list — hook must return null slug → no bundle injected.
  local input_file
  input_file="$(mktemp "$PROJ/sa-input.XXXXXX.json")"
  python3 - "$input_file" <<'PYEOF'
import json, sys
with open(sys.argv[1], "w") as f:
    json.dump({"hook_event_name": "SubagentStart", "agent_type": "arch-platform"}, f)
PYEOF
  run bash -c "cat '$input_file' | CLAUDE_PROJECT_DIR='$PROJ' CLAUDE_WAVE_SLUG='develop' node '$HOOK_SUBAGENT' 2>/dev/null"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  rm -f "$input_file"
}

@test "SRM-D2: premature-execution-gate: CLAUDE_WAVE_SLUG=develop → fail-open (no wave dir for develop)" {
  # With CLAUDE_WAVE_SLUG=develop and no wave-develop/ dir, gate fails open (exit 0).
  # If reject-list is implemented in the gate, it also exits 0 (fail-open on reject slug).
  local input_file
  input_file="$(mktemp "$PROJ/peg-input.XXXXXX.json")"
  python3 - "$input_file" <<'PYEOF'
import json, sys
with open(sys.argv[1], "w") as f:
    json.dump({"tool_name": "Write", "tool_input": {"file_path": "docs/x.md"}, "agent_type": "test-specialist"}, f)
PYEOF
  run bash -c "cat '$input_file' | CLAUDE_PROJECT_DIR='$PROJ' WAVE_PREP_BYPASS='' CLAUDE_WAVE_SLUG='develop' node '$HOOK_PEG' 2>/dev/null"
  [ "$status" -eq 0 ]
  rm -f "$input_file"
}

@test "SRM-D3: write-verdict.sh: --slug develop → exit non-zero (reject-list)" {
  run bash -c "cd '$PROJ' && bash '$SCRIPT_VERDICT' \
    --role arch-testing --phase prep --slug develop"
  [ "$status" -ne 0 ]
}

@test "SRM-D4: write-bundle.sh: --slug develop → exit non-zero (reject-list)" {
  run bash -c "cd '$PROJ' && printf '%s\n' '$BUNDLE_BODY' | bash '$SCRIPT_BUNDLE' \
    --role test-specialist --plan-id 'wave-develop/PLAN.md#SRM' --slug develop"
  [ "$status" -ne 0 ]
}

# ── Reject-list: master → reject/skip (all 5 must refuse) ────────────────────

@test "SRM-M1: subagent-start: real master branch checkout → no slug → silent exit 0" {
  # P2b reject-list: subagent-start must reject 'master' via branch detection.
  # BEFORE SRM-M1 fix: test checked out 'master-test' branch + set CLAUDE_WAVE_SLUG='master'
  # env → tested the env path only, NOT the branch-detection reject-list.
  # AFTER fix (this test): checkout 'master' directly in $PROJ; no CLAUDE_WAVE_SLUG env →
  # hook reads git branch 'master' → reject-list fires → returns null slug → no bundle → exit 0, empty output.
  git -C "$PROJ" checkout -b "master" -q 2>/dev/null || \
    git -C "$PROJ" checkout "master" -q 2>/dev/null
  local input_file
  input_file="$(mktemp "$PROJ/sa-input.XXXXXX.json")"
  python3 - "$input_file" <<'PYEOF'
import json, sys
with open(sys.argv[1], "w") as f:
    json.dump({"hook_event_name": "SubagentStart", "agent_type": "arch-platform"}, f)
PYEOF
  run bash -c "cat '$input_file' | CLAUDE_PROJECT_DIR='$PROJ' node '$HOOK_SUBAGENT' 2>/dev/null"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  rm -f "$input_file"
}

@test "SRM-M2: write-verdict.sh: --slug master → exit non-zero (reject-list)" {
  run bash -c "cd '$PROJ' && bash '$SCRIPT_VERDICT' \
    --role arch-testing --phase prep --slug master"
  [ "$status" -ne 0 ]
}

@test "SRM-M3: write-bundle.sh: --slug master → exit non-zero (reject-list)" {
  run bash -c "cd '$PROJ' && printf '%s\n' '$BUNDLE_BODY' | bash '$SCRIPT_BUNDLE' \
    --role test-specialist --plan-id 'wave-master/PLAN.md#SRM' --slug master"
  [ "$status" -ne 0 ]
}

# ── Resolver #6: wave-slug.sh bash resolver (BL-W47 ex-PR4) ─────────────────
#
# wave-slug.sh is a new shared bash lib (scripts/sh/lib/wave-slug.sh) that exposes
# get_wave_slug() to gate scripts and pre-commit-hook.sh Gate 3.
# It mirrors the JS getWaveSlug() logic: env-reject → CLAUDE_WAVE_SLUG env → git branch
# last-segment (${branch##*/}) with reject-list (develop, master, main, HEAD).
#
# API DEPENDENCY: these tests use `get_wave_slug` as the function name.
# If toolkit-specialist implements the function under a different name, update the
# function call below. This dependency is flagged explicitly in the READY-FOR-REVIEW
# message from test-specialist.
#
# Status: RED until toolkit-specialist ships scripts/sh/lib/wave-slug.sh.

SCRIPT_WAVE_SLUG="$BATS_TEST_DIRNAME/../sh/lib/wave-slug.sh"

@test "SRM-6a feature branch → correct last-segment slug (wave-slug.sh)" {
  git -C "$PROJ" checkout -b "feature/bl-w47-pr-0c1" -q 2>/dev/null
  mkdir -p "$PROJ/.planning/wave-bl-w47-pr-0c1"

  result="$(CLAUDE_PROJECT_DIR="$PROJ" CLAUDE_WAVE_SLUG="" bash -c "source '$SCRIPT_WAVE_SLUG' && get_wave_slug '$PROJ'")"
  [ "$result" = "bl-w47-pr-0c1" ]
}

@test "SRM-6b codex/ branch → last-segment slug (wave-slug.sh, P2b regression)" {
  git -C "$PROJ" checkout -b "codex/bl-w47-demo" -q 2>/dev/null
  mkdir -p "$PROJ/.planning/wave-bl-w47-demo"

  result="$(CLAUDE_PROJECT_DIR="$PROJ" CLAUDE_WAVE_SLUG="" bash -c "source '$SCRIPT_WAVE_SLUG' && get_wave_slug '$PROJ'")"
  [ "$result" = "bl-w47-demo" ]
}

@test "SRM-6c develop branch → rejected (wave-slug.sh env reject-list)" {
  result="$(CLAUDE_WAVE_SLUG="develop" bash -c "source '$SCRIPT_WAVE_SLUG' && get_wave_slug '${PROJ}'")"
  [ -z "$result" ]
}

@test "SRM-6d explicit env slug → returned as-is when not on reject-list (wave-slug.sh)" {
  result="$(CLAUDE_WAVE_SLUG="bl-w47-expr4" bash -c "source '$SCRIPT_WAVE_SLUG' && get_wave_slug '${PROJ}'")"
  [ "$result" = "bl-w47-expr4" ]
}

@test "SRM-TRAVERSAL: ../evil slug rejected — getWaveSlug returns null, no path escape" {
  # Set CLAUDE_WAVE_SLUG to a traversal attempt; hook must treat it as no-wave
  run bash -c "echo '{}' | CLAUDE_WAVE_SLUG='../evil' WAVE_PREP_BYPASS='' node '$HOOK_PEG'"
  [ "$status" -eq 0 ]
  [[ "$output" != *'"decision"'* ]]
}
