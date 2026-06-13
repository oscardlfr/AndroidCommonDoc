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
  # git init + initial commit so getHeadSha() returns a valid 40-hex SHA for stamp binding.
  # Without git init, HEAD is null and the hook's head-binding check is silently skipped,
  # masking PA-5 locally when the live repo's pre-push hook leaks in via cwd traversal.
  PROJECT_ROOT="${BATS_TEST_TMPDIR}/proj-$$"
  STAMP_DIR="$PROJECT_ROOT/.androidcommondoc"
  mkdir -p "$STAMP_DIR"
  git -C "$PROJECT_ROOT" init -q 2>/dev/null
  git -C "$PROJECT_ROOT" config user.email "bats@test.local"
  git -C "$PROJECT_ROOT" config user.name "Bats Test"
  git -C "$PROJECT_ROOT" commit --allow-empty -q -m "init" 2>/dev/null
  HEAD_SHA="$(git -C "$PROJECT_ROOT" rev-parse HEAD)"
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

@test "PA-4 ALLOW: main (empty agent_type) + git push + ACDoc pre-push hook installed → allowed" {
  # P1b fix: gate must verify the hook contains the ACDOC-PRE-PUSH-GATE marker — not just
  # check existsSync. Install the real marker-bearing hook from the repo source.
  mkdir -p "$PROJECT_ROOT/.git/hooks"
  cp "$BATS_TEST_DIRNAME/../sh/pre-push-hook.sh" "$PROJECT_ROOT/.git/hooks/pre-push"
  chmod +x "$PROJECT_ROOT/.git/hooks/pre-push"
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PA-4b BLOCK: main + bare stub hook (no ACDOC marker) + no stamps → blocked" {
  # Codex repro (P1b): a foreign tool's bare stub hook 'exit 0' should NOT skip stamp
  # validation. Before fix: existsSync alone allowed any hook. After fix: gate reads content
  # and only trusts hooks bearing the ACDOC-PRE-PUSH-GATE marker.
  mkdir -p "$PROJECT_ROOT/.git/hooks"
  printf '#!/bin/sh\nexit 0\n' > "$PROJECT_ROOT/.git/hooks/pre-push"
  chmod +x "$PROJECT_ROOT/.git/hooks/pre-push"
  # No stamps written — with a bare stub (no marker) gate must fall through to stamp check.
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  # Block reason must be stamp-related (not peer-detection).
  [[ "$output" == *"stamp"* || "$output" == *"pre-pr"* || "$output" == *"quality-gate"* ]]
}

@test "PA-4c ALLOW: main + bare stub hook (no ACDOC marker) + valid fresh stamps → allowed via stamp path" {
  # Bare stub without marker → gate falls through to stamp check. With valid fresh stamps
  # matching HEAD, the stamp path should allow. This confirms the stub causes stamp-path
  # fallthrough, not unconditional block.
  mkdir -p "$PROJECT_ROOT/.git/hooks"
  printf '#!/bin/sh\nexit 0\n' > "$PROJECT_ROOT/.git/hooks/pre-push"
  chmod +x "$PROJECT_ROOT/.git/hooks/pre-push"
  write_stamp "quality-gate.stamp" "PASS" 0 "$HEAD_SHA"
  write_stamp "pre-pr.stamp"       "PASS" 0 "$HEAD_SHA"
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 0 ]
}

# ── Main orchestrator: no pre-push hook + fallback stamps ───────────────────

@test "PA-5 ALLOW: main + no pre-push hook + valid fresh stamps with matching HEAD → allowed" {
  # CR-3 (df1a5d1): head must be a valid 40-hex SHA matching current HEAD (unconditional).
  # setup() now git-inits PROJECT_ROOT and sets HEAD_SHA so binding works in isolation.
  # Previously: empty head "" → CR-3 blocks unconditionally. Fix: stamp HEAD_SHA from repo.
  write_stamp "quality-gate.stamp" "PASS" 0 "$HEAD_SHA"
  write_stamp "pre-pr.stamp"       "PASS" 0 "$HEAD_SHA"
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

# ── CR-3 (df1a5d1): unconditional head-sha validation in push-authorization-gate

# ── P2a: segment-aware push detector — compound + prose false-positive ────────
# Codex repro cases: the old single-regex isGitPushCommand fired on prose strings
# and missed compound commands (echo ok && git push ...).

@test "PA-P2A-5 BLOCK: peer + compound 'echo ok && git push origin x' → blocked (segment-aware)" {
  # Codex repro: old regex didn't catch compound commands — segment-aware fix must catch the
  # second segment 'git push origin x' even though the full string starts with 'echo ok'.
  make_input "echo ok && git push origin x" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-6 BLOCK: peer + 'true; git push origin x' (semicolon separator) → blocked" {
  make_input "true; git push origin x" "arch-platform"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-7 ALLOW: main + printf prose 'remember: git push origin feature/test' → isGitPushCommand returns false → exit 0" {
  # False-positive fix (P2a): prose inside a printf/echo string is NOT a real push command.
  # RED trace: BEFORE fix, the single-regex `\bgit\s+push\b` fires on the literal text
  # inside the printf argument → isGitPushCommand returns true → gate reaches stamp check
  # → no stamps + no hook → exit 2 (blocked for wrong reason).
  # GREEN trace: AFTER fix, the segment-aware detector strips quoted spans (or only inspects
  # real shell segments) → isGitPushCommand returns false → gate exits 0 immediately at
  # `if (!isGitPushCommand(cmd)) process.exit(0)` before any stamp logic.
  # Assertion: plain exit 0 — no stamp fallback reached, no hook checked.
  make_input "printf 'remember: git push origin feature/test\n'"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PA-P2A-8 ALLOW: main + 'echo \"git push\"' (push in double-quoted string) → exit 0" {
  # Same false-positive fix: 'git push' inside a double-quoted echo argument is prose.
  # BEFORE fix: regex fires on the echo argument text → stamp fallback → exit 2.
  # AFTER fix: segment-aware detector ignores quoted spans → exit 0.
  make_input 'echo "git push"'
  run_hook
  [ "$status" -eq 0 ]
}

# ── CR-3 (df1a5d1): unconditional head-sha validation in push-authorization-gate

@test "PA-CR3-A BLOCK: pre-pr.stamp with empty head field → BLOCK (head validation)" {
  # df1a5d1: head validation is now unconditional (not gated on live git HEAD lookup).
  # Empty head string fails the /^[0-9a-f]{40}$/ regex check → BLOCK.
  write_stamp "quality-gate.stamp" "PASS" 0
  write_stamp "pre-pr.stamp" "PASS" 0 ""
  make_input "git push origin feature/x"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"head"* ]]
}

@test "PA-CR3-B BLOCK: pre-pr.stamp with non-hex head → BLOCK (head validation)" {
  # Non-hex string 'not-a-sha' fails the /^[0-9a-f]{40}$/ check → BLOCK.
  write_stamp "quality-gate.stamp" "PASS" 0
  write_stamp "pre-pr.stamp" "PASS" 0 "not-a-sha"
  make_input "git push origin feature/x"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"head"* ]]
}
