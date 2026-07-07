#!/usr/bin/env bats

setup() {
  export TMPDIR="${BATS_TMPDIR:-/tmp}"
  export SESSION_ID="test-session-$$"
  export FLAG_FILE="${TMPDIR:-/tmp}/claude-cp-consulted-${SESSION_ID}.flag"
  rm -f "$FLAG_FILE"
}

teardown() {
  rm -f "$FLAG_FILE"
  rm -f "${TMPDIR:-/tmp}/claude-arch-responded-${SESSION_ID}-"*.flag
  # Wave 2 (portable-coordination-artifacts): guarded cleanup for the isolated
  # git-repo fixture used by the disk-consult adversarial matrix (CP-A..CP-N
  # below). $PROJ is unset for every pre-existing test above — no-op there.
  [ -n "${PROJ:-}" ] && rm -rf "$PROJ"
  true
}

INPUT_FILE="${BATS_TEST_TMPDIR:-/tmp}/hook-input-$$.json"

make_input() {
  local tool="$1" path="$2" agent="${3:-arch-integration}"
  printf '%s\n' "{\"tool_name\":\"$tool\",\"tool_input\":{\"file_path\":\"$path\"},\"agent_type\":\"$agent\",\"session_id\":\"$SESSION_ID\"}" > "$INPUT_FILE"
}

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/context-provider-gate.js"

@test "blocks Read of docs pattern file when CP not consulted" {
  make_input Read '/project/docs/di/di-patterns-modules.md'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "blocks Read of .claude/agents/ file when CP not consulted" {
  make_input Read '/project/.claude/agents/arch-integration.md'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "allows Read of .planning/ file without CP flag" {
  make_input Read '/project/.planning/PLAN-W30.md'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows Read of docs pattern file when CP flag exists" {
  touch "$FLAG_FILE"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows Read of source .kt file without CP flag" {
  make_input Read '/project/src/main/kotlin/Foo.kt'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

make_specialist_input() {
  local tool="$1" path="$2"
  printf '%s\n' "{\"tool_name\":\"$tool\",\"tool_input\":{\"file_path\":\"$path\"},\"agent_type\":\"test-specialist\",\"session_id\":\"$SESSION_ID\"}" > "$INPUT_FILE"
}

make_arch_sendmsg_input() {
  # Simulates an arch→specialist SendMessage for consulted.js
  local to="$1"
  printf '%s\n' "{\"tool_name\":\"SendMessage\",\"tool_input\":{\"to\":\"$to\",\"message\":\"dispatch\"},\"agent_type\":\"arch-testing\",\"session_id\":\"$SESSION_ID\"}" > "$INPUT_FILE"
}

CONSULTED_HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/context-provider-consulted.js"

@test "specialist Read on docs blocked when only global CP flag set (C1 regression)" {
  # Global CP flag set (as if planner contacted CP) but no arch-response flag
  touch "$FLAG_FILE"
  make_specialist_input Read '/project/docs/di/di-patterns-modules.md'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "specialist Read on docs allowed when arch-response flag set (C1 happy path)" {
  local arch_flag="${TMPDIR:-/tmp}/claude-arch-responded-${SESSION_ID}-test-specialist.flag"
  touch "$arch_flag"
  make_specialist_input Read '/project/docs/di/di-patterns-modules.md'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
  rm -f "$arch_flag"
}

@test "consulted hook writes arch-response flag on arch→specialist SendMessage" {
  make_arch_sendmsg_input 'test-specialist'
  run bash -c "cat '$INPUT_FILE' | node '$CONSULTED_HOOK'"
  [ "$status" -eq 0 ]
  local arch_flag="${TMPDIR:-/tmp}/claude-arch-responded-${SESSION_ID}-test-specialist.flag"
  [ -f "$arch_flag" ]
  rm -f "$arch_flag"
}

@test "consulted hook does NOT write arch-response flag on planner→CP SendMessage" {
  printf '%s\n' "{\"tool_name\":\"SendMessage\",\"tool_input\":{\"to\":\"context-provider\",\"message\":\"query\"},\"agent_type\":\"planner\",\"session_id\":\"$SESSION_ID\"}" > "$INPUT_FILE"
  run bash -c "cat '$INPUT_FILE' | node '$CONSULTED_HOOK'"
  [ "$status" -eq 0 ]
  local arch_flag="${TMPDIR:-/tmp}/claude-arch-responded-${SESSION_ID}-context-provider.flag"
  [ ! -f "$arch_flag" ]
}

@test "specialist Read on own template file blocked regardless of flags (C2)" {
  touch "$FLAG_FILE"
  local arch_flag="${TMPDIR:-/tmp}/claude-arch-responded-${SESSION_ID}-test-specialist.flag"
  touch "$arch_flag"
  make_specialist_input Read '/project/setup/agent-templates/test-specialist.md'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
  rm -f "$arch_flag"
}

@test "CLAUDE_CP_GATE_DISABLED=1 allows any specialist search (emergency bypass)" {
  make_specialist_input Read '/project/docs/di/di-patterns-modules.md'
  run env CLAUDE_CP_GATE_DISABLED=1 bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "non-specialist arch agent Read still uses global CP flag (no regression)" {
  touch "$FLAG_FILE"
  make_input Read '/project/docs/di/di-patterns-modules.md' 'arch-integration'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

# ── D12: main orchestrator exemption (empty agent_type) ───────────────────────
# Empty agent_type means the main orchestrator — always exempt regardless of path
# or CP flag state (line 44 of gate: if (agentType === '') process.exit(0)).

make_main_input() {
  local tool="$1" path="$2"
  printf '%s\n' "{\"tool_name\":\"$tool\",\"tool_input\":{\"file_path\":\"$path\"},\"agent_type\":\"\",\"session_id\":\"$SESSION_ID\"}" > "$INPUT_FILE"
}

@test "D12: main (empty agent_type) reading CLAUDE.md is always exempt" {
  # No CP flag set — main must still exit 0 via the empty-agent_type shortcut.
  make_main_input Read '/project/CLAUDE.md'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "D12: main (empty agent_type) reading tl-session-start.md is always exempt" {
  make_main_input Read '/project/docs/guides/tl-session-start.md'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

# ── D12: Grep/Glob doc-path boundary — no trailing separator required ─────────
# Regex fix: /[/\\]docs([/\\]|$)/ — matches /foo/docs with no trailing slash.

make_grep_input() {
  local search_path="$1" agent="${2:-arch-integration}"
  printf '%s\n' "{\"tool_name\":\"Grep\",\"tool_input\":{\"path\":\"$search_path\"},\"agent_type\":\"$agent\",\"session_id\":\"$SESSION_ID\"}" > "$INPUT_FILE"
}

@test "D12: Grep on /foo/docs (no trailing sep) blocked without CP flag" {
  # No CP flag — docs boundary regex must catch /foo/docs via ($) anchor.
  make_grep_input '/foo/docs'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "D12: Grep on /foo/docs/ (trailing sep) still blocked without CP flag (regression)" {
  make_grep_input '/foo/docs/'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

# ── D12: specialist without arch-response flag regression guard ───────────────

@test "D12: toolkit-specialist Grep on docs blocked without arch-response flag (regression)" {
  # No flags set — specialist must be blocked even without an active CP flag.
  make_grep_input '/project/docs/testing/testing-patterns.md' 'toolkit-specialist'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

# ══════════════════════════════════════════════════════════════════════════
# Wave 2 (portable-coordination-artifacts): disk-consult adversarial matrix
# A-N (PLAN.md "CP-gate adversarial matrix" + arch-testing dispatch rows K/N).
#
# Additive OR-branch under test: allowed = <existing SendMessage session-flag>
# || coordinationArtifact.hasValidConsult(<wave>/inbox/context-provider, {slug}).
# Rows A/I prove the ORIGINAL path stays untouched; the rest exercise the NEW
# disk-consult branch. Row M (approval->request linkage) is validator-only —
# the CP-gate's disk branch only ever reads consult/v1, never approval/v1 — so
# M lives entirely in coordination-artifact-validation.bats, not repeated here.
#
# Isolation (mirrors slug-resolution-matrix.bats): mktemp -d + throwaway git
# init, CLAUDE_PROJECT_DIR + CLAUDE_WAVE_SLUG always explicit per invocation —
# NEVER touches the live .planning/wave-portable-coordination-artifacts/.
# teardown() above gained one guarded `rm -rf "$PROJ"` line; the pre-existing
# setup()/teardown() semantics for every test above this marker are otherwise
# unchanged.
# ══════════════════════════════════════════════════════════════════════════

CONSULT_WAVE_SLUG="cp-gate-consult-wave"
VALIDATOR="$BATS_TEST_DIRNAME/../../.claude/hooks/coordination-artifact.js"
# Single source of truth (arch-testing/team-lead ratified): read constants via
# `node coordination-artifact.js const <NAME>` rather than hardcoding a duplicate
# that could drift from the validator's own values.
CONSULT_TTL_SECONDS="$(node "$VALIDATOR" const CONSULT_TTL_SECONDS)"
MAX_CONSULT_HARD_CAP="$(node "$VALIDATOR" const MAX_CONSULT_HARD_CAP)"
MAX_CONSULT_ENTRIES="$(node "$VALIDATOR" const MAX_CONSULT_ENTRIES)"
MAX_CONSULT_BYTES="$(node "$VALIDATOR" const MAX_CONSULT_BYTES)"

_setup_wave_proj() {
  PROJ="$(mktemp -d)"
  git -C "$PROJ" init -q 2>/dev/null
  git -C "$PROJ" config user.email "bats@test.local"
  git -C "$PROJ" config user.name "Bats Test"
  git -C "$PROJ" commit -q --allow-empty -m init 2>/dev/null
  # Deterministic protected default branch regardless of the host's
  # init.defaultBranch config — row N's "no wave" control needs this fixed.
  git -C "$PROJ" branch -m main 2>/dev/null || true
}

_consult_dir() {
  printf '%s' "$PROJ/.planning/wave-$CONSULT_WAVE_SLUG/inbox/context-provider"
}

_now_iso()     { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
_now_compact() { date -u '+%Y%m%dT%H%M%SZ'; }

# Portable "N hours ago" — GNU -d first, BSD/macOS -v fallback (mirrors the
# sha256sum||shasum idiom used throughout scripts/sh/*.sh in this repo).
_hours_ago_iso() {
  local n="$1"
  date -u -d "-${n} hours" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v-"${n}"H '+%Y-%m-%dT%H:%M:%SZ'
}

# Portable "N seconds from now" — same GNU/BSD fallback shape as _hours_ago_iso,
# used for the directional-TTL future-skew E-future row below.
_seconds_from_now_iso() {
  local n="$1"
  date -u -d "+${n} seconds" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v+"${n}"S '+%Y-%m-%dT%H:%M:%SZ'
}

# _write_consult <dir> <fname> <wave_slug> <to> <created_at>
_write_consult() {
  local dir="$1" fname="$2" wave_slug="$3" to="$4" created_at="$5"
  mkdir -p "$dir"
  printf '{"schema":"coordination/consult/v1","wave_slug":"%s","from":"test-specialist","to":"%s","created_at":"%s"}\n' \
    "$wave_slug" "$to" "$created_at" > "$dir/$fname"
}

# _write_oversized_file <path> <size_bytes> — byte-exact filler (python3, already
# a hard dependency of this wave's writer — see write-coordination-artifact.bats).
_write_oversized_file() {
  python3 -c "import sys; open(sys.argv[1], 'wb').write(b'0' * int(sys.argv[2]))" "$1" "$2"
}

make_specialist_grep_input() {
  local search_path="$1"
  printf '%s\n' "{\"tool_name\":\"Grep\",\"tool_input\":{\"path\":\"$search_path\"},\"agent_type\":\"test-specialist\",\"session_id\":\"$SESSION_ID\"}" > "$INPUT_FILE"
}

# _run_hook_env <extra_env_assignments> — always unsets ambient CLAUDE_WAVE_SLUG
# first so every row controls slug resolution explicitly (row N relies on this).
_run_hook_env() {
  local extra_env="$1"
  run bash -c "unset CLAUDE_WAVE_SLUG; cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJ' $extra_env node '$HOOK'"
}

# ── Row A: SendMessage session flag present -> exit 0 (existing path preserved, wave fixture active) ──

@test "CP-A-read: session flag present with an active wave fixture -> exit 0 (no regression from the new branch)" {
  _setup_wave_proj
  touch "$FLAG_FILE"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 0 ]
}

@test "CP-A-grep: session flag present with an active wave fixture -> exit 0 (no regression from the new branch)" {
  _setup_wave_proj
  touch "$FLAG_FILE"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 0 ]
}

# ── Row B: no flag; valid fresh consult-*.json for current wave -> exit 0 (NEW disk unblock) ──

@test "CP-B-read: no session flag; valid fresh consult-*.json -> exit 0 (NEW disk unblock)" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_now_iso)"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 0 ]
}

@test "CP-B-grep: no session flag; valid fresh consult-*.json -> exit 0 (NEW disk unblock)" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_now_iso)"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 0 ]
}

# ── Row C: no flag, no artifact -> exit 2 (block preserved) ──

@test "CP-C-read: no session flag, empty consult inbox -> exit 2" {
  _setup_wave_proj
  mkdir -p "$(_consult_dir)"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CP-C-grep: no session flag, empty consult inbox -> exit 2" {
  _setup_wave_proj
  mkdir -p "$(_consult_dir)"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

# ── Row D: artifact w/ wrong wave_slug -> exit 2 (fail-closed) ──

@test "CP-D-read: consult artifact stamped for a DIFFERENT wave_slug -> exit 2" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "some-other-wave" "context-provider" "$(_now_iso)"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CP-D-grep: consult artifact stamped for a DIFFERENT wave_slug -> exit 2" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "some-other-wave" "context-provider" "$(_now_iso)"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

# ── Row E: artifact w/ created_at beyond CONSULT_TTL_SECONDS -> exit 2 (stale) ──

@test "CP-E-read: consult artifact created_at beyond CONSULT_TTL_SECONDS -> exit 2 (stale, fail-closed)" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_hours_ago_iso 13)"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CP-E-grep: consult artifact created_at beyond CONSULT_TTL_SECONDS -> exit 2 (stale, fail-closed)" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_hours_ago_iso 13)"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

# ── Row E-future: consult artifact created_at far in the FUTURE -> exit 2 (directional
# TTL, team-lead / STOP-9 hardening: valid window is [now-CONSULT_TTL_SECONDS,
# now+MAX_CONSULT_FUTURE_SKEW_SECONDS], not a symmetric window). now+TTL+margin is
# unambiguously beyond the much-smaller future-skew allowance regardless of its exact
# configured value — distinct from row E above, which is the PAST-side bound.

@test "CP-Efuture-read: consult artifact created_at far in the future (beyond the skew allowance) -> exit 2" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_seconds_from_now_iso "$((CONSULT_TTL_SECONDS + 60))")"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CP-Efuture-grep: consult artifact created_at far in the future (beyond the skew allowance) -> exit 2" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_seconds_from_now_iso "$((CONSULT_TTL_SECONDS + 60))")"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

# ── Row E-regression: the DISCRIMINATING case (toolkit-specialist's own before/after
# repro) — created_at within the OLD symmetric TTL window (comfortably < TTL) but
# beyond the NEW directional skew (comfortably > skew). CP-Efuture above (now+TTL+
# margin) would ALSO have been rejected under the OLD Math.abs() check, so it can't
# prove the fix alone; this is the value that was WRONGLY valid pre-fix and is the
# actual /security-review finding being closed.

@test "CP-Eregression-read: consult artifact created_at halfway into the TTL window, in the future -> exit 2 (would have wrongly passed pre-fix)" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_seconds_from_now_iso "$((CONSULT_TTL_SECONDS / 2))")"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CP-Eregression-grep: consult artifact created_at halfway into the TTL window, in the future -> exit 2 (would have wrongly passed pre-fix)" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_seconds_from_now_iso "$((CONSULT_TTL_SECONDS / 2))")"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

# ── Row F: artifact w/ wrong `to` (not context-provider) -> exit 2 (fail-closed) ──

@test "CP-F-read: consult artifact addressed to a role other than context-provider -> exit 2" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "arch-testing" "$(_now_iso)"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CP-F-grep: consult artifact addressed to a role other than context-provider -> exit 2" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "arch-testing" "$(_now_iso)"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

# ── Row G: malformed/empty/non-JSON artifact -> exit 2 (fail-closed, NOT fail-open) ──

@test "CP-G-read: non-JSON consult candidate (only candidate) -> exit 2" {
  _setup_wave_proj
  mkdir -p "$(_consult_dir)"
  printf 'not valid json at all' > "$(_consult_dir)/consult-$(_now_compact).json"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CP-G-grep: non-JSON consult candidate (only candidate) -> exit 2" {
  _setup_wave_proj
  mkdir -p "$(_consult_dir)"
  printf 'not valid json at all' > "$(_consult_dir)/consult-$(_now_compact).json"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CP-G2-read: empty consult candidate (only candidate) -> exit 2" {
  _setup_wave_proj
  mkdir -p "$(_consult_dir)"
  : > "$(_consult_dir)/consult-$(_now_compact).json"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CP-G2-grep: empty consult candidate (only candidate) -> exit 2" {
  _setup_wave_proj
  mkdir -p "$(_consult_dir)"
  : > "$(_consult_dir)/consult-$(_now_compact).json"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

# ── Row H: symlink-escape consult candidate resolving outside the confined inbox dir -> exit 2 ──
# (Slug-level traversal, e.g. CLAUDE_WAVE_SLUG=../evil, is already proven closed
# upstream at the shared getWaveSlug()/get_wave_slug() layer — see
# slug-resolution-matrix.bats "SRM-TRAVERSAL"; not re-tested here.)

@test "CP-H-read: symlink-escape consult candidate resolving outside the confined inbox dir -> exit 2" {
  _setup_wave_proj
  local outside_dir="$PROJ/outside-escape"
  mkdir -p "$outside_dir" "$(_consult_dir)"
  _write_consult "$outside_dir" "evil.json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_now_iso)"
  ln -s "$outside_dir/evil.json" "$(_consult_dir)/consult-$(_now_compact).json"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CP-H-grep: symlink-escape consult candidate resolving outside the confined inbox dir -> exit 2" {
  _setup_wave_proj
  local outside_dir="$PROJ/outside-escape"
  mkdir -p "$outside_dir" "$(_consult_dir)"
  _write_consult "$outside_dir" "evil.json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_now_iso)"
  ln -s "$outside_dir/evil.json" "$(_consult_dir)/consult-$(_now_compact).json"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

# ── Row I: specialist + valid disk consult but NO arch-responded flag -> exit 2 (specialist gating NOT bypassed) ──

@test "CP-I-read: test-specialist with a valid disk consult but no arch-responded flag -> exit 2" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_now_iso)"
  make_specialist_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CP-I-grep: test-specialist with a valid disk consult but no arch-responded flag -> exit 2" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_now_iso)"
  make_specialist_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

# ── Row J: many-file consult dir (300 valid+invalid) -> exit 0, deterministic newest-valid selection ──
# The lexicographically-NEWEST file (highest seq) is deliberately INVALID (wrong wave),
# forcing the scan to fall through past it. The ONE true positive's position is DERIVED
# (Codex/PR#236 hardening — was a hardcoded "150" magic number) from MAX_CONSULT_ENTRIES
# rather than an arbitrary constant: it sits at half of MAX_CONSULT_ENTRIES ranks back
# from the newest file, which is comfortably inside the retained top-N collection window
# (with margin on both sides) for any sane MAX_CONSULT_ENTRIES value, and proves the
# selection isn't "just grab whatever opendir returns first" / doesn't depend on
# directory iteration order.

_populate_many_consult_files() {
  local dir="$1" total="$2"
  mkdir -p "$dir"
  local max_val=$((total - 1))
  local width=${#max_val}
  local rank_from_newest=$((MAX_CONSULT_ENTRIES / 2))
  local valid_seq
  printf -v valid_seq "%0${width}d" "$((max_val - rank_from_newest))"
  local n fresh
  fresh="$(_now_iso)"
  for n in $(seq -w 0 "$max_val"); do
    if [ "$n" = "$valid_seq" ]; then
      _write_consult "$dir" "consult-20260101T000${n}Z.json" "$CONSULT_WAVE_SLUG" "context-provider" "$fresh"
    else
      _write_consult "$dir" "consult-20260101T000${n}Z.json" "wrong-wave-noise" "context-provider" "$fresh"
    fi
  done
}

@test "CP-J-read: 300-file consult dir, newest file deliberately invalid -> exit 0 (deterministic fallback, in-budget)" {
  _setup_wave_proj
  _populate_many_consult_files "$(_consult_dir)" 300
  make_input Read '/project/docs/di/di-patterns-modules.md'
  SECONDS=0
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 0 ]
  [ "$SECONDS" -le 3 ]
}

@test "CP-J-grep: 300-file consult dir, newest file deliberately invalid -> exit 0 (deterministic fallback, in-budget)" {
  _setup_wave_proj
  _populate_many_consult_files "$(_consult_dir)" 300
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  SECONDS=0
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 0 ]
  [ "$SECONDS" -le 3 ]
}

# ── Row K: consult dir over MAX_CONSULT_HARD_CAP -> exit 2 (DoS fail-closed) ──
# REQUIRED construction (arch-testing, ratified by team-lead + confirmed against the
# real toolkit implementation): EVERY entry over the hard cap is a genuinely VALID
# consult-*.json (not tiny/padding junk) — i.e. any single one of them would unblock
# (exit 0) if the scan ever reached/selected it. This is order-independent and airtight
# regardless of opendir/readSync iteration order: the confirmed real behavior is an
# UNCONDITIONAL `return false` the moment total-entries-scanned exceeds the cap — it
# never falls through to validate whatever it already collected. If a regression ever
# removed that early abort (falling through to "sort collected candidates, validate
# newest-first" instead), it WOULD find a valid one among the up-to-MAX_CONSULT_ENTRIES
# it gathered and incorrectly return exit 0 — so exit==2 here is the primary,
# discriminating proof, not just an incidental exit-code check. Files are realistically
# sized (not maximally tiny) as a supplementary signal: the wall-clock assertion stays
# as a backstop, though the exit-code is what actually catches a missing early-stop.

_populate_all_valid_over_cap() {
  local dir="$1" count="$2"
  mkdir -p "$dir"
  local fresh; fresh="$(_now_iso)"
  # Pure-bash padding (no per-file subprocess spawn across ~1000+ files): printf's
  # field-width trick produces N spaces, translated to a filler character.
  local padding; printf -v padding '%*s' 4096 ''; padding="${padding// /x}"
  local n
  for n in $(seq -w 0 "$((count - 1))"); do
    printf '{"schema":"coordination/consult/v1","wave_slug":"%s","from":"test-specialist","to":"context-provider","created_at":"%s","padding":"%s"}\n' \
      "$CONSULT_WAVE_SLUG" "$fresh" "$padding" > "$dir/consult-20260101T0${n}Z.json"
  done
}

@test "CP-K-read: ALL entries over MAX_CONSULT_HARD_CAP are genuinely valid consult files -> exit 2 anyway (hard-cap overrides unconditionally, order-independent)" {
  _setup_wave_proj
  local dir; dir="$(_consult_dir)"
  _populate_all_valid_over_cap "$dir" "$((MAX_CONSULT_HARD_CAP + 6))"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  SECONDS=0
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
  [ "$SECONDS" -le 3 ]
}

@test "CP-K-grep: ALL entries over MAX_CONSULT_HARD_CAP are genuinely valid consult files -> exit 2 anyway (hard-cap overrides unconditionally, order-independent)" {
  _setup_wave_proj
  local dir; dir="$(_consult_dir)"
  _populate_all_valid_over_cap "$dir" "$((MAX_CONSULT_HARD_CAP + 6))"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  SECONDS=0
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
  [ "$SECONDS" -le 3 ]
}

# ── Row L: single oversized consult candidate (> MAX_CONSULT_BYTES), only candidate -> exit 2 ──

@test "CP-L-read: single consult candidate exceeding MAX_CONSULT_BYTES -> exit 2 (skipped-as-invalid, no fallback candidate)" {
  _setup_wave_proj
  local dir; dir="$(_consult_dir)"
  mkdir -p "$dir"
  _write_oversized_file "$dir/consult-$(_now_compact).json" "$((MAX_CONSULT_BYTES + 1))"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CP-L-grep: single consult candidate exceeding MAX_CONSULT_BYTES -> exit 2 (skipped-as-invalid, no fallback candidate)" {
  _setup_wave_proj
  local dir; dir="$(_consult_dir)"
  mkdir -p "$dir"
  _write_oversized_file "$dir/consult-$(_now_compact).json" "$((MAX_CONSULT_BYTES + 1))"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  [ "$status" -eq 2 ]
}

# Row M (approval/v1 referencing a missing/invalid request) is validator-only —
# the CP-gate's disk-consult branch never reads approval/v1. See the
# approval-linkage tests in coordination-artifact-validation.bats.

# ── Row N: unresolvable/null wave slug -> exit 2, NOT fail-open (distinct code path from row D) ──
# Row D exercises "slug resolves, but the artifact names a DIFFERENT wave" (a
# string mismatch). Row N exercises "slug does not resolve AT ALL" (getWaveSlug
# returns null — no env, no non-protected branch, no single wave-*/PLAN.md
# alias). These are different branches in the gate's own slug handling; a gate
# that only guards against wrong-non-null-slug could still fail open on null.

@test "CP-N-read: unresolvable/null wave slug (no env override, protected branch, no wave dir) -> exit 2" {
  _setup_wave_proj
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env ""
  [ "$status" -eq 2 ]
}

@test "CP-N-grep: unresolvable/null wave slug (no env override, protected branch, no wave dir) -> exit 2" {
  _setup_wave_proj
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env ""
  [ "$status" -eq 2 ]
}
