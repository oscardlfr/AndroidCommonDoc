#!/usr/bin/env bats
#
# Tests for .claude/hooks/premature-execution-gate.js (BL-W43 W43-03).
# RED-FIRST: hook does not exist yet; all cases must FAIL on first run.
# Spec: .planning/wave-bl-w43/pr3-arch-platform-verdict.md Decision 8.
#
# Infra: fixture-driven (real temp wave dirs, no mock framework).
# setup()/teardown() manage a temp wave dir for wave detection.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/premature-execution-gate.js"
INPUT_FILE="${BATS_TEST_TMPDIR}/premature-exec-input-$$.json"

# setup() creates a temp .planning/wave-bl-w43/ dir to simulate an active wave.
# WAVE_PREP_BYPASS is explicitly cleared to prevent accidental bypass leaking.
# D-3 (BL-W47 ex-PR4): active wave requires PLAN.md + Spawn Table before specialists
# execute. Pre-existing cases inherit a valid PLAN.md from setup(). Tests that need
# to exercise the missing-PLAN.md (ST-5) or missing-Spawn-Table (ST-1) boundaries
# override this by rm -f or write_plan_without_spawn_table in their own body.
setup() {
  WAVE_DIR="$BATS_TEST_TMPDIR/planning/wave-bl-w43"
  mkdir -p "$WAVE_DIR"
  export CLAUDE_PROJECT_DIR="$BATS_TEST_TMPDIR"
  export CLAUDE_WAVE_SLUG="bl-w43"
  export WAVE_PREP_BYPASS=''
  # wave-runtime-topology-disk-first-binding (WS-3): the hardened gate resolves
  # `git rev-parse HEAD` in CLAUDE_PROJECT_DIR (D5 fail-closed) before checking
  # PREP/dispatch currency, so CLAUDE_PROJECT_DIR must be a real git repo with at
  # least one commit.
  git -C "$CLAUDE_PROJECT_DIR" init -q 2>/dev/null
  git -C "$CLAUDE_PROJECT_DIR" -c user.email=test@example.com -c user.name=test \
      commit -q --allow-empty -m init 2>/dev/null
  # write_plan_with_spawn_table is defined later in this file; bats loads the whole
  # file before running any test, so the forward-reference is safe.
  write_plan_with_spawn_table
}

teardown() {
  rm -rf "$BATS_TEST_TMPDIR/planning"
}

# Build a JSON envelope:
#   make_input <tool_name> <target> <agent_type>
# For Bash tools, target is the command string.
# For Write/Edit tools, target is the file_path string.
make_input() {
  local tool="$1" target="$2" agent="$3"
  python3 - "$tool" "$target" "$agent" "$INPUT_FILE" <<'PYEOF'
import json, sys
tool, target, agent, path = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
inp = {"command": target} if tool == "Bash" else {"file_path": target}
with open(path, "w", encoding="utf-8") as f:
    json.dump({"tool_name": tool, "tool_input": inp, "agent_type": agent}, f)
PYEOF
}

run_hook() {
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS='' node '$HOOK'"
}

# ── wave-runtime-topology-disk-first-binding (WS-3) helpers ─────────────────────────────────
#
# These tests target the HARDENED gate (WS-3, toolkit-specialist), which does not exist yet
# at the time this suite is written — the RT-* cases below are expected to be RED until WS-3
# lands. The helpers themselves are correct against the CONTRACT (DECISIONS.md F1/F2/F3/F5,
# arch-integration HIGH/MEDIUM) regardless of the current gate implementation.
#
# CORE NON-VACUITY MANDATE: every "current" fixture derives head/plan_sha256 from a REAL
# `git rev-parse HEAD` + REAL sha256 of the ACTUAL PLAN.md on disk, computed at test-run
# time — never hardcoded matching constants. "Stale" fixtures use REAL-but-wrong values
# (a real divergent commit SHA, a real sha256 of different content) — never fabricated hex.

# _real_sha256 <file> — portable sha256 (mirrors _sha256_file in write-verdict.sh /
# write-specialist-dispatch.sh; matches the Node crypto Buffer-based hash the gate uses — F2).
_real_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# _make_divergent_branch_head <dir> — creates two branches diverging from <dir>'s current
# HEAD. On return, <dir> is checked out on the SECOND branch (its new HEAD becomes <dir>'s
# "current" HEAD for the rest of the test) and DIVERGENT_HEAD (global) holds the commit SHA
# on the FIRST branch — a real commit that is NOT an ancestor of <dir>'s current HEAD
# (`git merge-base --is-ancestor DIVERGENT_HEAD <current>` exits non-zero). Used to build
# genuinely-unrelated "stale" HEAD fixtures per F1 (ancestry, not exact-equality).
DIVERGENT_HEAD=""
_make_divergent_branch_head() {
  local dir="$1"
  local base_branch
  base_branch="$(git -C "$dir" symbolic-ref --short HEAD 2>/dev/null)"
  git -C "$dir" checkout -b "diverge-a" -q 2>/dev/null
  git -C "$dir" -c user.email=test@example.com -c user.name=test \
      commit -q --allow-empty -m "diverge-a" 2>/dev/null
  DIVERGENT_HEAD="$(git -C "$dir" rev-parse HEAD)"
  git -C "$dir" checkout "$base_branch" -q 2>/dev/null
  git -C "$dir" checkout -b "diverge-b" -q 2>/dev/null
  git -C "$dir" -c user.email=test@example.com -c user.name=test \
      commit -q --allow-empty -m "diverge-b" 2>/dev/null
}

# write_current_prep_raw <verdict-file> <head> <plan-sha256> — low-level: writes an
# APPROVED-PREP verdict with EXPLICIT **PREP-HEAD**/**PLAN_SHA256** values (may be current or
# deliberately stale, caller's choice).
write_current_prep_raw() {
  local file="$1" head="$2" plan_sha256="$3"
  printf '**Status**: APPROVED-PREP\n**PREP-HEAD**: %s\n**PLAN_SHA256**: %s\n' \
    "$head" "$plan_sha256" > "$file"
}

# write_current_prep <verdict-file> — CURRENT PREP: **PREP-HEAD** == real current HEAD of
# $CLAUDE_PROJECT_DIR, **PLAN_SHA256** == real sha256 of $WAVE_DIR/PLAN.md, both derived at
# call-time (CORE NON-VACUITY MANDATE).
write_current_prep() {
  local file="$1"
  local head plan_sha256
  head="$(git -C "$CLAUDE_PROJECT_DIR" rev-parse HEAD)"
  plan_sha256="$(_real_sha256 "$WAVE_DIR/PLAN.md")"
  write_current_prep_raw "$file" "$head" "$plan_sha256"
}

# write_dispatch_raw <specialist> <head> <plan-sha256> [file...] — low-level: writes a
# dispatch JSON under $WAVE_DIR/specialist-dispatches/<specialist>/ with EXPLICIT head/
# plan_sha256 (current or deliberately stale). Remaining args are files[]; if none given,
# bash_only:true + files:[] is written (bash-only dispatch).
write_dispatch_raw() {
  local specialist="$1" head="$2" plan_sha256="$3"
  shift 3
  local dir="$WAVE_DIR/specialist-dispatches/$specialist"
  mkdir -p "$dir"
  local ts
  ts="$(date -u '+%Y%m%dT%H%M%SZ')-$$-${RANDOM}"
  local out="$dir/arch-testing-${ts}.json"
  local bash_only_flag=0
  [ "$#" -eq 0 ] && bash_only_flag=1
  WD_SPECIALIST="$specialist" WD_HEAD="$head" WD_PLAN_SHA256="$plan_sha256" \
  WD_FILES="$(printf '%s\n' "$@")" WD_BASH_ONLY="$bash_only_flag" WD_OUT="$out" \
  python3 - <<'PYEOF'
import json, os
files_raw = os.environ.get("WD_FILES", "")
files = [f for f in files_raw.split("\n") if f != ""]
bash_only = os.environ.get("WD_BASH_ONLY", "0") == "1"
payload = {
    "schema": "specialist-dispatch/v1",
    "wave_slug": "bl-w43",
    "architect": "arch-testing",
    "specialist": os.environ["WD_SPECIALIST"],
    "head": os.environ["WD_HEAD"],
    "plan_path": ".planning/wave-bl-w43/PLAN.md",
    "plan_sha256": os.environ["WD_PLAN_SHA256"],
    "files": files,
    "bash_only": bash_only,
    "allowed_tools": ["Bash"] if bash_only else [],
    "summary": "test dispatch",
    "task": "test task body",
    "created_at": "2026-01-01T00:00:00Z",
}
with open(os.environ["WD_OUT"], "w", encoding="utf-8") as fh:
    json.dump(payload, fh, indent=2)
PYEOF
}

# write_dispatch <specialist> [file...] — CURRENT dispatch: head/plan_sha256 derived from
# real git/shasum at call-time (CORE NON-VACUITY MANDATE). No files => bash-only dispatch.
write_dispatch() {
  local specialist="$1"
  shift
  local head plan_sha256
  head="$(git -C "$CLAUDE_PROJECT_DIR" rev-parse HEAD)"
  plan_sha256="$(_real_sha256 "$WAVE_DIR/PLAN.md")"
  write_dispatch_raw "$specialist" "$head" "$plan_sha256" "$@"
}

# ── BLOCK scenarios ─────────────────────────────────────────────────────────

# Case 1 BLOCK: specialist Write + active wave + no APPROVED-PREP -> exit 2
@test "Case 1: blocks specialist Write when active wave has no APPROVED-PREP verdict" {
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"APPROVED-PREP"* ]]
}

# Case 2 BLOCK: specialist Edit + active wave + no APPROVED-PREP -> exit 2
@test "Case 2: blocks specialist Edit when active wave has no APPROVED-PREP verdict" {
  make_input "Edit" "docs/existing-doc.md" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"APPROVED-PREP"* ]]
}

# Case 3 BLOCK: specialist Bash + active wave + no APPROVED-PREP -> exit 2
@test "Case 3: blocks specialist Bash when active wave has no APPROVED-PREP verdict" {
  make_input "Bash" "echo hello > docs/output.md" "doc-updater"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"APPROVED-PREP"* ]]
}

# ── PASS scenarios ──────────────────────────────────────────────────────────

# Case 4 PASS: specialist Write + a CURRENT APPROVED-PREP + matching dispatch -> exit 0
# (wave-runtime-topology-disk-first-binding, WS-3: a bare APPROVED-PREP with no
# PREP-HEAD/PLAN_SHA256/dispatch is no longer sufficient — see RT-1.)
@test "Case 4: allows specialist Write when a CURRENT APPROVED-PREP + matching dispatch are present" {
  write_current_prep "$WAVE_DIR/pr3-arch-platform-verdict.md"
  write_dispatch "test-specialist" "docs/new-doc.md"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# Case 5 PASS: arch-testing Write + active wave + no APPROVED-PREP (not subject) -> exit 0
@test "Case 5: allows arch-testing Write even without APPROVED-PREP (not in subject list)" {
  make_input "Write" "docs/new-doc.md" "arch-testing"
  run_hook
  [ "$status" -eq 0 ]
}

# Case 6 PASS: WAVE_PREP_BYPASS=1 env set -> exit 0
@test "Case 6: allows specialist Write when WAVE_PREP_BYPASS=1 is set" {
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS=1 node '$HOOK'"
  [ "$status" -eq 0 ]
}

# Case 7 PASS: [PREMATURE_EXEC_BYPASS] inline in Bash command -> exit 0
@test "Case 7: allows specialist Bash when [PREMATURE_EXEC_BYPASS] inline token present" {
  make_input "Bash" "[PREMATURE_EXEC_BYPASS] echo hello" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# Case 8 PASS: no active wave detected (CLAUDE_WAVE_SLUG unset, no branch match), fail-open -> exit 0
@test "Case 8: allows specialist Write when no active wave detected, fail-open" {
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS='' CLAUDE_WAVE_SLUG='' node '$HOOK'"
  [ "$status" -eq 0 ]
}

# Case 9 PASS: no verdict file at all (wave dir empty), fail-open -> exit 0
# (Wave dir exists but has no verdict file — distinct from Case 1 which relies on block logic.
#  This case verifies the scanner returns 0 when the dir is entirely absent of verdict files,
#  but wait — Case 1 also has no verdict file and must BLOCK. The distinction: Case 9 tests
#  the scenario where the .planning/wave-{slug}/ directory itself does not exist, so the
#  hook cannot confirm an active wave, and therefore fails open.)
@test "Case 9: allows specialist Write when wave plan dir does not exist, fail-open" {
  rm -rf "$WAVE_DIR"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# Case 10 PASS: arch-integration-verdict.md CURRENT PREP + matching dispatch unblocks
# specialist (BL-W47-prep-2; hardened to current-PREP+dispatch by
# wave-runtime-topology-disk-first-binding, WS-3).
@test "Case 10: allows specialist Write when arch-integration-verdict.md has a CURRENT APPROVED-PREP + matching dispatch" {
  write_current_prep "$WAVE_DIR/arch-integration-verdict.md"
  write_dispatch "toolkit-specialist" "docs/new-doc.md"
  make_input "Write" "docs/new-doc.md" "toolkit-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# Case 11 PASS: arch-testing-verdict.md CURRENT PREP + matching dispatch unblocks specialist
# (BL-W47-prep-2; hardened to current-PREP+dispatch by wave-runtime-topology-disk-first-binding, WS-3).
@test "Case 11: allows specialist Write when arch-testing-verdict.md has a CURRENT APPROVED-PREP + matching dispatch" {
  write_current_prep "$WAVE_DIR/arch-testing-verdict.md"
  write_dispatch "test-specialist" "docs/new-doc.md"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# ── Identity-tolerance: suffix-rotation + free-name (BL-W47 OQ3) ─────────────
# SUBJECT_TYPES uses startsWith — suffix-rotated peers (e.g. test-specialist-2)
# must be caught the same as the canonical name.

@test "IT-1 BLOCK: suffix-rotated specialist (test-specialist-2) blocked without APPROVED-PREP" {
  # No verdict file — test-specialist-2 startsWith test-specialist → subject → BLOCK
  make_input "Write" "docs/new-doc.md" "test-specialist-2"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"APPROVED-PREP"* ]]
}

@test "IT-2 BLOCK: suffix-rotated specialist (toolkit-specialist-2) blocked without APPROVED-PREP" {
  make_input "Write" "docs/new-doc.md" "toolkit-specialist-2"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"APPROVED-PREP"* ]]
}

@test "IT-3 PASS: free-name agent (free-agent) allowed without verdict (not a subject type)" {
  # free-agent does not startWith any SUBJECT_TYPE — not gated, exits 0
  make_input "Write" "docs/new-doc.md" "free-agent"
  run_hook
  [ "$status" -eq 0 ]
}

@test "IT-4 PASS: suffix-rotated specialist unblocked when CURRENT PREP + dispatch exist" {
  # Dispatch is written under the CANONICAL specialist dir ("test-specialist"), not the
  # suffix-rotated agent_type ("test-specialist-2") — the gate resolves
  # canonical = SUBJECT_TYPES.find(s => agentType.startsWith(s)) before the dispatch lookup,
  # so a canonical dispatch dir must still authorize a suffix-rotated peer.
  write_current_prep "$WAVE_DIR/arch-testing-verdict.md"
  write_dispatch "test-specialist" "docs/new-doc.md"
  make_input "Write" "docs/new-doc.md" "test-specialist-2"
  run_hook
  [ "$status" -eq 0 ]
}

# ── P1c: block channel — block JSON must appear on STDOUT not stderr ──────────
# Codex repro (P1c): premature-execution-gate.js at line 142 uses process.stderr.write(...)
# for the block JSON. All 3 sibling gates use process.stdout. After the fix, the
# structured block decision must be on stdout so the harness can read it.
#
# Test strategy: redirect stderr to /dev/null; assert structured JSON is on stdout.
# RED before fix: stdout is empty (JSON goes to stderr, lost after redirect).
# GREEN after fix: JSON block decision is on stdout.

@test "P1c BLOCK: specialist + active wave + no APPROVED-PREP emits block JSON on stdout (not stderr)" {
  # No verdict file — gate must block. Redirect stderr to /dev/null to prove
  # the block JSON is on stdout, not leaking through stderr.
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS='' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 2 ]
  # The block decision JSON must be present on stdout (captured in $output by bats).
  [[ "$output" == *'"decision"'* ]]
  [[ "$output" == *'"block"'* ]]
}

# ── P2b: non-feature branch slug resolution for premature-execution-gate ──────
# Per PLAN Step 10: each resolver file gets a non-feature branch case.
# Setup: switch CLAUDE_WAVE_SLUG to a non-feature-prefixed slug (last-segment only).

@test "P2b PEG-SLUG: codex/bl-w47-demo branch → slug 'bl-w47-demo' + active wave dir detected" {
  # After the P2b fix, premature-execution-gate must resolve 'codex/bl-w47-demo' to
  # last-segment slug 'bl-w47-demo'. Create a wave dir for that slug and confirm the gate
  # detects the active wave (which means slug resolution worked).
  local non_feature_slug="bl-w47-demo"
  local non_feature_wave_dir="$BATS_TEST_TMPDIR/planning/wave-$non_feature_slug"
  mkdir -p "$non_feature_wave_dir"
  # D-3: wave dir needs PLAN.md + Spawn Table so the gate reaches the APPROVED-PREP check.
  cat > "$non_feature_wave_dir/PLAN.md" <<'PLANEOF'
### Spawn Table
| Role | Count | Reason |
|---|---|---|
| arch-platform | 1 | test |
PLANEOF
  # No verdict → gate must BLOCK on APPROVED-PREP (proves slug resolved + wave found).
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS='' CLAUDE_WAVE_SLUG='$non_feature_slug' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 2 ]
  [[ "$output" == *"APPROVED-PREP"* ]]
}

# ── B: env reject-list for CLAUDE_WAVE_SLUG (CodeRabbit #3) ──────────────────
# After the fix, the 3 JS resolvers must apply the reject-list to CLAUDE_WAVE_SLUG too.
# When CLAUDE_WAVE_SLUG is 'develop' or 'master', the gate must skip/fail-open.
# RED now: env slug returned unvalidated → gate looks for wave-develop/ → not found
# → fails open (exit 0). GREEN after fix confirms the SAME behaviour, but via explicit
# reject-list path rather than accidental miss. Both before and after the fix the exit
# is 0 — the test validates that the gate does NOT incorrectly block.

@test "B PEG-ENV-REJECT-develop: CLAUDE_WAVE_SLUG=develop → gate fails open (no block)" {
  # develop is a reject-list slug — gate must skip/fail-open regardless of wave dirs.
  # Create a wave-develop dir to confirm the gate is NOT finding it and blocking.
  local dev_wave_dir="$BATS_TEST_TMPDIR/planning/wave-develop"
  mkdir -p "$dev_wave_dir"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS='' CLAUDE_PROJECT_DIR='$BATS_TEST_TMPDIR' CLAUDE_WAVE_SLUG='develop' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 0 ]
}

@test "B PEG-ENV-REJECT-master: CLAUDE_WAVE_SLUG=master → gate fails open (no block)" {
  # master is a reject-list slug — same behaviour as develop.
  local master_wave_dir="$BATS_TEST_TMPDIR/planning/wave-master"
  mkdir -p "$master_wave_dir"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS='' CLAUDE_PROJECT_DIR='$BATS_TEST_TMPDIR' CLAUDE_WAVE_SLUG='master' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 0 ]
}

# ── C: branch path (no env) for premature-execution-gate (CodeRabbit #4) ──────
# Drive slug resolution via git branch (no CLAUDE_WAVE_SLUG), mirroring the
# subagent-start F1/C1 model. Creates an isolated git repo on codex/ branch.
# BEFORE fix: gate returns full branch 'codex/bl-w47-demo' as slug →
#   wave dir is 'wave-codex/bl-w47-demo' (invalid path or not found) → fails open.
# AFTER fix: slug = 'bl-w47-demo' → wave-bl-w47-demo/ found → no verdict → exit 2.

@test "C PEG-BRANCH-PATH: codex/bl-w47-demo branch (no env) → gate detects wave via branch → exit 2" {
  # Isolated git repo — never reads live .git.
  local proj
  proj="$(mktemp -d)"
  git -C "$proj" init -q 2>/dev/null
  git -C "$proj" config user.email "bats@test.local"
  git -C "$proj" config user.name "Bats Test"
  git -C "$proj" commit --allow-empty -q -m "init"
  git -C "$proj" checkout -b "codex/bl-w47-demo" -q 2>/dev/null
  # Create wave dir for the CORRECT last-segment slug.
  mkdir -p "$proj/.planning/wave-bl-w47-demo"
  # D-3: wave dir needs PLAN.md + Spawn Table so the gate reaches the APPROVED-PREP check.
  cat > "$proj/.planning/wave-bl-w47-demo/PLAN.md" <<'PLANEOF'
### Spawn Table
| Role | Count | Reason |
|---|---|---|
| arch-platform | 1 | test |
PLANEOF
  # Explicitly clear CLAUDE_WAVE_SLUG so setup()'s export doesn't leak into the subprocess
  # and bypass branch parsing (the env-bypass class of bug — S4 lesson).
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS='' CLAUDE_WAVE_SLUG='' CLAUDE_PROJECT_DIR='$proj' node '$HOOK' 2>/dev/null"
  rm -rf "$proj"
  # BEFORE fix: exits 0 (wave dir not found due to full-branch slug). RED.
  # AFTER fix: exits 2 (no verdict → gate blocks).
  [ "$status" -eq 2 ]
  [[ "$output" == *"APPROVED-PREP"* ]]
}

@test "B PEG-SLUG-TRAVERSAL: CLAUDE_WAVE_SLUG=../evil — robustness check (no crash, fail-open via isValidSlug rejection)" {
  # Robustness: invalid slug (contains /) → isValidSlug rejects → getWaveSlug returns null
  # → no waveDir resolved → fail-open (exit 0, no block decision).
  # Non-vacuity for isValidSlug is proven at the bash layer (SRM-TRAVERSAL asserts
  # wave-slug.sh outputs empty for ../evil vs a valid slug). isValidSlug in JS mirrors
  # the same allowlist; arch-platform confirmed all 3 getWaveSlug return points are guarded.
  make_input "Write" "docs/x.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_WAVE_SLUG='../evil' WAVE_PREP_BYPASS='' node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$output" != *'"decision"'* ]]
}

# ── D-3 Spawn-Table check (BL-W47 ex-PR4) ────────────────────────────────────
#
# After Decision 3 (CORRECTED fail-open boundary): when waveDir is confirmed +
# tool is by a SUBJECT_TYPES role, PLAN.md must exist AND contain ### Spawn Table.
# Missing waveDir still fails open (exit 0). Missing PLAN.md or missing Spawn Table
# in PLAN.md → exit 2 (BLOCK). SKIP_SPAWN_TABLE=1 is the escape hatch.
#
# These cases use the existing setup() wave dir (WAVE_DIR=$BATS_TEST_TMPDIR/planning/wave-bl-w43)
# and write PLAN.md into it via the helpers below (Option a — simpler, no slug override needed).

write_plan_with_spawn_table() {
  cat > "$WAVE_DIR/PLAN.md" <<'PLANEOF'
### Wave Class

- **Class**: HARNESS

### Path-Manifest

- scripts/sh/pre-commit-hook.sh

### Spawn Table

| Role | Count | Reason |
|---|---|---|
| arch-platform | 1 | hook surgery |
| test-specialist | 1 | bats tests |
PLANEOF
}

write_plan_without_spawn_table() {
  cat > "$WAVE_DIR/PLAN.md" <<'PLANEOF'
### Wave Class

- **Class**: HARNESS

### Path-Manifest

- scripts/sh/pre-commit-hook.sh

(no Spawn Table section)
PLANEOF
}

@test "ST-1 BLOCK: active wave + specialist Write + PLAN.md missing Spawn Table → exit 2" {
  write_plan_without_spawn_table
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"Spawn Table"* ]]
}

@test "ST-2 PASS: active wave + specialist Write + PLAN.md has Spawn Table + CURRENT PREP + dispatch → exit 0" {
  write_plan_with_spawn_table
  write_current_prep "$WAVE_DIR/arch-testing-verdict.md"
  write_dispatch "test-specialist" "docs/new-doc.md"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

@test "ST-3 PASS: no wave dir → fail-open exit 0 (fail-open preserved, regression guard)" {
  # CRITICAL: rm -rf the wave dir created by setup() so the hook sees no active wave.
  # Without this, the hook finds waveDir present but no PLAN.md → falls into ST-5's
  # BLOCK path. The rm is load-bearing for this fail-open regression guard.
  rm -rf "$WAVE_DIR"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

@test "ST-4 PASS: SKIP_SPAWN_TABLE=1 + PLAN.md missing Spawn Table → exit 0 (escape hatch)" {
  write_plan_without_spawn_table
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS='' SKIP_SPAWN_TABLE=1 node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "ST-5 BLOCK: wave dir exists + no PLAN.md + specialist Write → exit 2 (old fail-open closed)" {
  # setup() now writes PLAN.md; remove it so the wave dir exists but has no PLAN.md.
  # rm -f (not rm -rf) keeps the wave dir — that's what distinguishes ST-5 from ST-3.
  # Decision 3 CORRECTED: confirmed waveDir + no PLAN.md → BLOCK (not fail-open).
  rm -f "$WAVE_DIR/PLAN.md"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"PLAN.md"* ]]
}

# Helper path for .codex mirror (used by codex-identity check below)
HOOK_CODEX="$BATS_TEST_DIRNAME/../../.codex/hooks/premature-execution-gate.js"

@test "CODEX-1: .codex mirror produces identical exit behavior to canonical (post-sync parity)" {
  # Run the .codex copy against the same scenario as Case 1 (specialist Write + no APPROVED-PREP → block).
  # After D-3 full re-sync, both copies must exit 2 with block JSON on stdout.
  # RED before sync (if .codex still has process.stderr.write): stdout will be empty, test fails.
  # GREEN after sync: .codex exits 2 with block JSON on stdout, identical to canonical.
  # .codex/ is gitignored — skip on CI where the mirror is absent.
  [ -f "$HOOK_CODEX" ] || skip ".codex mirror not present (gitignored)"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS='' node '$HOOK_CODEX' 2>/dev/null"
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision"'* ]]
  [[ "$output" == *'"block"'* ]]
}

# ── wave-runtime-topology-disk-first-binding (WS-3): disk-first specialist<->architect binding ─
#
# RT-* cases target the HARDENED gate (WS-3, toolkit-specialist) — EXPECTED RED until WS-3
# lands (replaces hasApprovedPrep() per DECISIONS.md F1/F2/F3/F5 + arch-integration
# HIGH/MEDIUM). Do NOT force-green by weakening assertions; these prove the failure class in
# project_specialist_architect_binding_enforcement_queued.md is closed.

# RT-1 BLOCK: bare APPROVED-PREP alone (no PREP-HEAD/PLAN_SHA256) is stale/generic — must block.
@test "RT-1 BLOCK: bare APPROVED-PREP with no PREP-HEAD/PLAN_SHA256 (stale/generic PREP) blocks" {
  printf 'STATUS: APPROVED-PREP\n' > "$WAVE_DIR/arch-testing-verdict.md"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 2 ]
}

# RT-2 PASS: current PREP + current dispatch allows matching Edit (Write already covered by
# the converted Case 4/10/11).
@test "RT-2 PASS: current PREP + current dispatch allows matching Edit" {
  write_current_prep "$WAVE_DIR/arch-testing-verdict.md"
  write_dispatch "test-specialist" "docs/existing-doc.md"
  make_input "Edit" "docs/existing-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# RT-3 BLOCK: target outside dispatch files[] blocks with a discriminating message.
@test "RT-3 BLOCK: target outside dispatch files[] blocks with a discriminating message" {
  write_current_prep "$WAVE_DIR/arch-testing-verdict.md"
  write_dispatch "test-specialist" "docs/allowed-only.md"
  make_input "Write" "docs/not-in-dispatch.md" "test-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" =~ (files|scope|target) ]]
}

# ── F1 ancestry: stale PREP / stale dispatch use a genuinely UNRELATED head (divergent
# branch, not merely a different sha); a legitimate descendant commit must NOT self-block ────

# RT-4 BLOCK: stale PREP — **PREP-HEAD** on an unrelated (non-ancestor) divergent commit.
@test "RT-4 BLOCK: stale PREP (PREP-HEAD on an unrelated/divergent commit) blocks" {
  _make_divergent_branch_head "$CLAUDE_PROJECT_DIR"
  local plan_sha256
  plan_sha256="$(_real_sha256 "$WAVE_DIR/PLAN.md")"
  write_current_prep_raw "$WAVE_DIR/arch-testing-verdict.md" "$DIVERGENT_HEAD" "$plan_sha256"
  write_dispatch "test-specialist" "docs/new-doc.md"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 2 ]
}

# RT-5 BLOCK: stale PREP via **PLAN_SHA256** mismatch (real hash of DIFFERENT content).
@test "RT-5 BLOCK: stale PREP via PLAN_SHA256 mismatch blocks" {
  local head wrong_plan_sha256
  head="$(git -C "$CLAUDE_PROJECT_DIR" rev-parse HEAD)"
  printf 'unrelated content, not the real PLAN.md\n' > "$BATS_TEST_TMPDIR/other-plan.md"
  wrong_plan_sha256="$(_real_sha256 "$BATS_TEST_TMPDIR/other-plan.md")"
  write_current_prep_raw "$WAVE_DIR/arch-testing-verdict.md" "$head" "$wrong_plan_sha256"
  write_dispatch "test-specialist" "docs/new-doc.md"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 2 ]
}

# RT-6 BLOCK: stale dispatch — head on an unrelated (non-ancestor) divergent commit.
@test "RT-6 BLOCK: stale dispatch (head on an unrelated/divergent commit) blocks" {
  _make_divergent_branch_head "$CLAUDE_PROJECT_DIR"
  write_current_prep "$WAVE_DIR/arch-testing-verdict.md"
  local plan_sha256
  plan_sha256="$(_real_sha256 "$WAVE_DIR/PLAN.md")"
  write_dispatch_raw "test-specialist" "$DIVERGENT_HEAD" "$plan_sha256" "docs/new-doc.md"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 2 ]
}

# RT-7 BLOCK: stale dispatch via plan_sha256 mismatch (real hash of DIFFERENT content).
@test "RT-7 BLOCK: stale dispatch via plan_sha256 mismatch blocks" {
  write_current_prep "$WAVE_DIR/arch-testing-verdict.md"
  local head wrong_plan_sha256
  head="$(git -C "$CLAUDE_PROJECT_DIR" rev-parse HEAD)"
  printf 'unrelated content for dispatch mismatch test\n' > "$BATS_TEST_TMPDIR/other-plan-2.md"
  wrong_plan_sha256="$(_real_sha256 "$BATS_TEST_TMPDIR/other-plan-2.md")"
  write_dispatch_raw "test-specialist" "$head" "$wrong_plan_sha256" "docs/new-doc.md"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 2 ]
}

# RT-8 PASS: PREP + dispatch remain current after a legitimate in-wave DESCENDANT commit
# (proves ancestry — not exact-equality — permits normal wave progress; the core F1 fix).
@test "RT-8 PASS: PREP + dispatch remain current after a legitimate in-wave descendant commit" {
  write_current_prep "$WAVE_DIR/arch-testing-verdict.md"
  write_dispatch "test-specialist" "docs/new-doc.md"
  git -C "$CLAUDE_PROJECT_DIR" -c user.email=test@example.com -c user.name=test \
      commit -q --allow-empty -m "in-wave descendant commit" 2>/dev/null
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# ── arch-integration HIGH: dispatch-scan fails CLOSED, never crash-to-allow ──────────────────

# RT-9 BLOCK: current PREP but the dispatch dir does not exist at all (never dispatched).
@test "RT-9 BLOCK: current PREP but dispatch dir absent (never dispatched) blocks, not crash-to-allow" {
  write_current_prep "$WAVE_DIR/arch-testing-verdict.md"
  # Deliberately do NOT create $WAVE_DIR/specialist-dispatches/ at all.
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 2 ]
}

# ── arch-integration MEDIUM: out-of-repo target carve-out (Write/Edit) ──────────────────────

# RT-10 PASS: out-of-repo Write target (/tmp) allowed even with no matching files[].
@test "RT-10 PASS: out-of-repo Write target (/tmp) allowed even with no matching files[]" {
  write_current_prep "$WAVE_DIR/arch-testing-verdict.md"
  write_dispatch "test-specialist" "docs/only-this-is-authorized.md"
  make_input "Write" "/tmp/scratch-out-of-repo-$$.md" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# RT-11 PASS: ..-escaping Write target (resolves outside repo) allowed even with no matching files[].
@test "RT-11 PASS: ..-escaping Write target (resolves outside repo) allowed even with no matching files[]" {
  write_current_prep "$WAVE_DIR/arch-testing-verdict.md"
  write_dispatch "test-specialist" "docs/only-this-is-authorized.md"
  make_input "Write" "../outside-repo-escape.md" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# ── bash-only dispatch: authorizes execution-Bash only, never Write/Edit ────────────────────

# RT-12 PASS: bash-only dispatch (empty files[]) allows Bash.
@test "RT-12 PASS: bash-only dispatch (empty files[]) allows Bash" {
  write_current_prep "$WAVE_DIR/arch-testing-verdict.md"
  write_dispatch "test-specialist"
  make_input "Bash" "echo hello" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# RT-13 BLOCK: bash-only dispatch (empty files[]) blocks Write.
@test "RT-13 BLOCK: bash-only dispatch (empty files[]) blocks Write" {
  write_current_prep "$WAVE_DIR/arch-testing-verdict.md"
  write_dispatch "test-specialist"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 2 ]
}

# RT-14 BLOCK: bash-only dispatch (empty files[]) blocks Edit.
@test "RT-14 BLOCK: bash-only dispatch (empty files[]) blocks Edit" {
  write_current_prep "$WAVE_DIR/arch-testing-verdict.md"
  write_dispatch "test-specialist"
  make_input "Edit" "docs/existing-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 2 ]
}

# ── Bash: dispatch-presence gated, never file-parsed ─────────────────────────────────────────

# RT-15 PASS: Bash with a current (non-bash-only) dispatch is allowed even when the command
# targets a file NOT in files[] — proves the gate does not parse Bash commands for file targets.
@test "RT-15 PASS: Bash with current dispatch allowed even targeting a file outside files[] (no file-parse for Bash)" {
  write_current_prep "$WAVE_DIR/arch-testing-verdict.md"
  write_dispatch "test-specialist" "docs/only-this-is-authorized.md"
  make_input "Bash" "echo hello > docs/totally-different-file.md" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# RT-16 BLOCK: Bash with current PREP but NO dispatch at all blocks.
@test "RT-16 BLOCK: Bash with current PREP but no dispatch at all blocks" {
  write_current_prep "$WAVE_DIR/arch-testing-verdict.md"
  make_input "Bash" "echo hello" "test-specialist"
  run_hook
  [ "$status" -eq 2 ]
}

# ── F5: files[] membership = UNION across ALL current dispatches ────────────────────────────

# RT-17 PASS: a stale dispatch alongside a current one — the current one's files still
# authorize (union across all dispatch files in the directory, not just the newest).
@test "RT-17 PASS: multi-dispatch union — stale dispatch alongside current one still authorizes the current one's files" {
  _make_divergent_branch_head "$CLAUDE_PROJECT_DIR"
  write_current_prep "$WAVE_DIR/arch-testing-verdict.md"
  local plan_sha256
  plan_sha256="$(_real_sha256 "$WAVE_DIR/PLAN.md")"
  # Stale dispatch (head pinned to the abandoned divergent branch) — authorizes a DIFFERENT file.
  write_dispatch_raw "test-specialist" "$DIVERGENT_HEAD" "$plan_sha256" "docs/stale-only.md"
  # Current dispatch — authorizes the actual target.
  write_dispatch "test-specialist" "docs/new-doc.md"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# ── Path normalization equivalence ───────────────────────────────────────────────────────────

# RT-18 PASS: ./docs/foo.md (Write target) matches a files[] entry of docs/foo.md.
@test "RT-18 PASS: path-normalization — ./docs/foo.md matches files[] entry docs/foo.md" {
  write_current_prep "$WAVE_DIR/arch-testing-verdict.md"
  write_dispatch "test-specialist" "docs/foo.md"
  make_input "Write" "./docs/foo.md" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# RT-19 BLOCK: a lexically-different path is NOT conflated with an authorized file.
@test "RT-19 BLOCK: path-normalization — lexically-different path is not conflated with an authorized file" {
  write_current_prep "$WAVE_DIR/arch-testing-verdict.md"
  write_dispatch "test-specialist" "docs/foo.md"
  make_input "Write" "docs/foobar.md" "test-specialist"
  run_hook
  [ "$status" -eq 2 ]
}

# ── D4: doc-updater is PREP-gated only — no dispatch requirement ────────────────────────────

# RT-20 PASS: doc-updater allowed via current-PREP-only, no dispatch required.
@test "RT-20 PASS: doc-updater allowed via current-PREP-only, no dispatch required (D4 exemption)" {
  write_current_prep "$WAVE_DIR/arch-testing-verdict.md"
  # Deliberately NOT writing any dispatch — doc-updater is PREP-gated only.
  make_input "Write" "docs/new-doc.md" "doc-updater"
  run_hook
  [ "$status" -eq 0 ]
}

# RT-21 BLOCK: doc-updater blocked when no current PREP exists at all.
@test "RT-21 BLOCK: doc-updater blocked when no current PREP exists" {
  # No verdict file at all.
  make_input "Write" "docs/new-doc.md" "doc-updater"
  run_hook
  [ "$status" -eq 2 ]
}

# ── Cross-tool smoke: real write-verdict.sh + real write-specialist-dispatch.sh + real gate ──
# Proves bash `shasum -a 256`/`sha256sum` agrees byte-for-byte with the gate's Node
# `crypto.createHash('sha256').update(fs.readFileSync(...))` (F2) — no encoding-mismatch
# false "stale PLAN" block.

@test "RT-22 CROSS-TOOL SMOKE: real write-verdict.sh prep -> real write-specialist-dispatch.sh -> real gate exits 0" {
  local wv_script="$BATS_TEST_DIRNAME/../sh/write-verdict.sh"
  local wsd_script="$BATS_TEST_DIRNAME/../sh/write-specialist-dispatch.sh"

  # write-verdict.sh / write-specialist-dispatch.sh hardcode .planning/wave-<slug>/ (no
  # override) — use a slug distinct from setup()'s bl-w43 fixture (which lives under the
  # bats-fixture-compat planning/, no dot) so the two do not collide.
  local smoke_slug="rtdfb-smoke"
  local smoke_wave_dir="$CLAUDE_PROJECT_DIR/.planning/wave-$smoke_slug"
  mkdir -p "$smoke_wave_dir"
  cat > "$smoke_wave_dir/PLAN.md" <<'PLANEOF'
### Wave Class

- **Class**: HARNESS

### Spawn Table

| Role | Count | Reason |
|---|---|---|
| arch-testing | 1 | smoke |
| test-specialist | 1 | smoke |
PLANEOF

  run bash -c "cd '$CLAUDE_PROJECT_DIR' && CLAUDE_WAVE_SLUG='$smoke_slug' \
    bash '$wv_script' --role arch-testing --phase prep --slug '$smoke_slug'"
  [ "$status" -eq 0 ]

  run bash -c "cd '$CLAUDE_PROJECT_DIR' && printf 'smoke task body\n' | CLAUDE_WAVE_SLUG='$smoke_slug' \
    bash '$wsd_script' --architect arch-testing --specialist test-specialist \
    --file docs/smoke-target.md --slug '$smoke_slug'"
  [ "$status" -eq 0 ]

  make_input "Write" "docs/smoke-target.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS='' CLAUDE_WAVE_SLUG='$smoke_slug' \
    CLAUDE_PROJECT_DIR='$CLAUDE_PROJECT_DIR' node '$HOOK'"
  [ "$status" -eq 0 ]
}
