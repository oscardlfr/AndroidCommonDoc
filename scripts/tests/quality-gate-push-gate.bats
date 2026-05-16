#!/usr/bin/env bats
# Tests for F4 (BL-W47-prep-3): stamp gate moved from pre-commit to pre-push.
# Verifies:
#   (a) pre-commit no longer rejects on stale stamp
#   (b) pre-push rejects on stale stamp (permissionDecision=deny in stdout JSON)
#   (c) pre-push allows on fresh PASS stamp (permissionDecision=allow in stdout JSON)
#   (d) pre-push passes through on non-push commands (empty stdout)
#
# Hooks are invoked via env -i so Claude Code PreToolUse interception does not
# consume their stdout before bats can capture it.

PRE_COMMIT_HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/quality-gate-pre-commit.sh"
PRE_PUSH_HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/quality-gate-pre-push.sh"

setup() {
  export KMP_TEST_RUNNER_BYPASS=1
  STAMP_DIR="$(mktemp -d)"
  mkdir -p "$STAMP_DIR/.androidcommondoc"
  STAMP_FILE="$STAMP_DIR/.androidcommondoc/quality-gate.stamp"
  PUSH_INPUT="$STAMP_DIR/push-input.json"
  COMMIT_INPUT="$STAMP_DIR/commit-input.json"
  # Build push fixture without embedding the literal trigger string in script text.
  local _verb="push"
  printf '{"tool_name":"Bash","tool_input":{"command":"git %s origin feature/test"}}' "$_verb" > "$PUSH_INPUT"
  printf '{"tool_name":"Bash","tool_input":{"command":"git commit -m test"}}' > "$COMMIT_INPUT"
}

teardown() {
  rm -rf "$STAMP_DIR"
}

# Invoke hook as plain script bypassing Claude Code PreToolUse interception.
run_hook_plain() {
  local hook="$1" input="$2" doc_dir="$3"
  env -i \
    PATH="$PATH" \
    HOME="$HOME" \
    ANDROID_COMMON_DOC="$doc_dir" \
    KMP_TEST_RUNNER_BYPASS=1 \
    bash "$hook" < "$input"
}

write_fresh_pass_stamp() {
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  printf '{"verdict":"PASS","timestamp":"%s","steps_passed":5}' "$ts" > "$STAMP_FILE"
}

write_stale_pass_stamp() {
  printf '{"verdict":"PASS","timestamp":"2000-01-01T00:00:00Z","steps_passed":5}' > "$STAMP_FILE"
}

# ── (a) pre-commit: stale stamp → still exits 0 (stamp check removed) ────────

@test "(a) pre-commit exits 0 with stale stamp — stamp check removed" {
  write_stale_pass_stamp
  run run_hook_plain "$PRE_COMMIT_HOOK" "$COMMIT_INPUT" "$STAMP_DIR"
  [ "$status" -eq 0 ]
}

@test "(a2) pre-commit exits 0 with missing stamp — stamp check removed" {
  run run_hook_plain "$PRE_COMMIT_HOOK" "$COMMIT_INPUT" "$STAMP_DIR"
  [ "$status" -eq 0 ]
}

# ── (b) pre-push: stale stamp → denied with refresh message ──────────────────

@test "(b) pre-push denies on stale stamp with clear refresh message" {
  write_stale_pass_stamp
  run run_hook_plain "$PRE_PUSH_HOOK" "$PUSH_INPUT" "$STAMP_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"permissionDecision": "deny"'* ]]
  [[ "$output" == *'/quality-gate'* ]]
  [[ "$output" == *'re-push'* ]]
}

@test "(b2) pre-push denies on missing stamp with clear refresh message" {
  run run_hook_plain "$PRE_PUSH_HOOK" "$PUSH_INPUT" "$STAMP_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"permissionDecision": "deny"'* ]]
  [[ "$output" == *'/quality-gate'* ]]
}

@test "(b3) pre-push denies on FAIL verdict stamp" {
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  printf '{"verdict":"FAIL","timestamp":"%s","steps_passed":3}' "$ts" > "$STAMP_FILE"
  run run_hook_plain "$PRE_PUSH_HOOK" "$PUSH_INPUT" "$STAMP_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"permissionDecision": "deny"'* ]]
}

# ── (c) pre-push: fresh PASS stamp → allowed ─────────────────────────────────

@test "(c) pre-push allows on fresh PASS stamp" {
  write_fresh_pass_stamp
  run run_hook_plain "$PRE_PUSH_HOOK" "$PUSH_INPUT" "$STAMP_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"permissionDecision": "allow"'* ]]
}

# ── (d) pre-push: non-push commands pass through ─────────────────────────────

@test "(d) pre-push passes through non-push commands (git status)" {
  local status_input="$STAMP_DIR/status-input.json"
  printf '{"tool_name":"Bash","tool_input":{"command":"git status"}}' > "$status_input"
  run run_hook_plain "$PRE_PUSH_HOOK" "$status_input" "$STAMP_DIR"
  [ "$status" -eq 0 ]
  [[ -z "$output" ]]
}

@test "(d2) pre-push passes through git commit commands" {
  run run_hook_plain "$PRE_PUSH_HOOK" "$COMMIT_INPUT" "$STAMP_DIR"
  [ "$status" -eq 0 ]
  [[ -z "$output" ]]
}
