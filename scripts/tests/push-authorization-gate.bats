#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for .claude/hooks/push-authorization-gate.js (BL-W47 Commits 10a/10b/10d).
# Replaces the two retired gates: quality-gate-pre-push.sh and pre-push-pre-pr-gate.js.
#
# Gate contract:
#   - Peer/subagent (non-empty agent_type) + git push → BLOCK (exit 2)
#   - Main orchestrator (empty agent_type) + pre-push hook installed → ALLOW (exit 0)
#   - Main orchestrator + no pre-push hook + valid stamps → ALLOW (exit 0)
#   - Main orchestrator + no pre-push hook + missing/stale stamps → BLOCK (exit 2)
#   - PUSH_AUTHORIZATION_BYPASS=1 → ALLOW regardless of agent or stamps
#   - "rtk git push" command string → also BLOCK for peers (regex covers both forms)
#   - Non-push commands → always ALLOW (exit 0)
#
# Infra: JSON-piped-to-node. All stamp files written to tmpdir (never live project).

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/push-authorization-gate.js"
INPUT_FILE="${BATS_TEST_TMPDIR}/push-auth-input-$$.json"

setup() {
  # Isolated project root in tmpdir; no real .git/hooks present unless the test creates one.
  PROJECT_ROOT="${BATS_TEST_TMPDIR}/proj-$$"
  STAMP_DIR="$PROJECT_ROOT/.androidcommondoc"
  mkdir -p "$STAMP_DIR"
  unset PUSH_AUTHORIZATION_BYPASS
}

teardown() {
  rm -rf "${BATS_TEST_TMPDIR}/proj-$$"
}

# Build JSON envelope for a Bash tool call.
# Args: <command> [agent_type]
make_input() {
  local cmd="$1" agent="${2-}"
  python3 - "$cmd" "$agent" "$INPUT_FILE" <<'PYEOF'
import json, sys
cmd, agent, path = sys.argv[1], sys.argv[2], sys.argv[3]
payload = {"tool_name": "Bash", "tool_input": {"command": cmd}}
if agent:
    payload["agent_type"] = agent
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f)
PYEOF
}

run_hook() {
  run bash -c "cat '$INPUT_FILE' | PUSH_AUTHORIZATION_BYPASS='' CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
}

# Write a stamp file (quality-gate.stamp or pre-pr.stamp).
# Args: <filename> [verdict=PASS] [age_secs=0] [head=""]
write_stamp() {
  local fname="$1" verdict="${2:-PASS}" age_secs="${3:-0}" head="${4:-}"
  python3 - "$STAMP_DIR/$fname" "$verdict" "$age_secs" "$head" <<'PYEOF'
import json, sys, time, datetime
path, verdict, age_secs, head = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
ts = datetime.datetime.utcfromtimestamp(time.time() - age_secs).strftime('%Y-%m-%dT%H:%M:%SZ')
with open(path, "w") as f:
    json.dump({"verdict": verdict, "timestamp": ts, "head": head}, f)
PYEOF
}

# ── Peer/subagent BLOCK cases ────────────────────────────────────────────────

@test "PA-1 BLOCK: peer agent (non-empty agent_type) + git push → blocked unconditionally" {
  make_input "git push origin feature/test" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
  [[ "$output" == *"toolkit-specialist"* ]]
}

@test "PA-2 BLOCK: peer agent + rtk git push → also blocked (rtk prefix covered by regex)" {
  make_input "rtk git push origin feature/test" "arch-platform"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-3 BLOCK: suffix-rotated peer (toolkit-specialist-2) + git push → blocked" {
  make_input "git push origin feature/test" "toolkit-specialist-2"
  run_hook
  [ "$status" -eq 2 ]
}

# ── Main orchestrator: pre-push hook installed → ALLOW ──────────────────────

@test "PA-4 ALLOW: main (empty agent_type) + git push + pre-push hook installed → allowed" {
  # Install a stub pre-push hook so the gate sees it and delegates to the git layer.
  mkdir -p "$PROJECT_ROOT/.git/hooks"
  printf '#!/bin/sh\nexit 0\n' > "$PROJECT_ROOT/.git/hooks/pre-push"
  chmod +x "$PROJECT_ROOT/.git/hooks/pre-push"
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 0 ]
}

# ── Main orchestrator: no pre-push hook + fallback stamps ───────────────────

@test "PA-5 ALLOW: main + no pre-push hook + valid fresh stamps → allowed" {
  write_stamp "quality-gate.stamp" "PASS" 0 ""
  write_stamp "pre-pr.stamp"       "PASS" 0 ""
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PA-6 BLOCK: main + no pre-push hook + missing quality-gate.stamp → blocked with stamp error" {
  # Only pre-pr.stamp present; quality-gate.stamp absent.
  write_stamp "pre-pr.stamp" "PASS" 0 ""
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"quality-gate.stamp"* ]]
}

@test "PA-7 BLOCK: main + no pre-push hook + missing pre-pr.stamp → blocked with stamp error" {
  write_stamp "quality-gate.stamp" "PASS" 0 ""
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"pre-pr.stamp"* ]]
}

@test "PA-8 BLOCK: main + no pre-push hook + stale quality-gate.stamp (35 min) → blocked" {
  write_stamp "quality-gate.stamp" "PASS" $((35 * 60)) ""
  write_stamp "pre-pr.stamp"       "PASS" 0             ""
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"quality-gate.stamp"* ]]
}

@test "PA-9 BLOCK: main + no pre-push hook + stale pre-pr.stamp (35 min) → blocked" {
  write_stamp "quality-gate.stamp" "PASS" 0             ""
  write_stamp "pre-pr.stamp"       "PASS" $((35 * 60)) ""
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"pre-pr.stamp"* ]]
}

@test "PA-10 BLOCK: main + no pre-push hook + FAIL verdict in quality-gate.stamp → blocked" {
  write_stamp "quality-gate.stamp" "FAIL" 0 ""
  write_stamp "pre-pr.stamp"       "PASS" 0 ""
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"quality-gate.stamp"* ]]
}

# ── Bypass ────────────────────────────────────────────────────────────────────

@test "PA-11 ALLOW: PUSH_AUTHORIZATION_BYPASS=1 allows peer push regardless" {
  make_input "git push origin feature/test" "toolkit-specialist"
  run bash -c "cat '$INPUT_FILE' | PUSH_AUTHORIZATION_BYPASS=1 CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "PA-12 ALLOW: PUSH_AUTHORIZATION_BYPASS=1 allows main push with no stamps" {
  # No stamps at all — bypass should still allow
  make_input "git push origin feature/test"
  run bash -c "cat '$INPUT_FILE' | PUSH_AUTHORIZATION_BYPASS=1 CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
}

# ── Non-push commands: always ALLOW ──────────────────────────────────────────

@test "PA-13 ALLOW: git commit (non-push) from peer passes through" {
  make_input "git commit -m 'chore: update'" "toolkit-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PA-14 ALLOW: non-Bash tool from peer passes through" {
  python3 - "$INPUT_FILE" <<'PYEOF'
import json, sys
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({"tool_name": "Read", "tool_input": {"file_path": "foo.md"}, "agent_type": "toolkit-specialist"}, f)
PYEOF
  run_hook
  [ "$status" -eq 0 ]
}

@test "PA-15 ALLOW: malformed JSON → fail-open (exit 0)" {
  printf '%s' '{not json' > "$INPUT_FILE"
  run_hook
  [ "$status" -eq 0 ]
}
