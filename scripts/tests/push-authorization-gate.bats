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

# ── P2a follow-up: shell-exec wrapper bypass (CodeRabbit/Codex — post-ship) ────
# The segment-aware quote-strip correctly kills printf/echo prose (PA-P2A-7/8),
# but also strips the PAYLOAD of sh/bash -c "..." — which is EXECUTED code, not prose.
# Fix: recurse into sh|bash|zsh|dash|ksh -c/-lc payloads before quote-stripping.
# PA-P2A-9/10/11: RED now (exits 0, should be 2); GREEN after toolkit's recursive fix.
# PA-P2A-12/13: guard cases — must stay/go GREEN (no over-block).

@test "PA-P2A-9 BLOCK: peer + sh -c 'git push origin x' → BLOCK (shell-exec wrapper)" {
  # Bypass: isGitPushCommand strips the quoted 'git push origin x' payload as prose.
  # Fix: detect sh -c / bash -lc pattern → recurse into quoted payload.
  # BEFORE fix: exits 0 (push allowed through wrapper). RED.
  # AFTER fix: recursive detection finds 'git push origin x' → exit 2.
  make_input "sh -c 'git push origin x'" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-10 BLOCK: peer + bash -lc \"git push origin x\" → BLOCK (login-shell wrapper)" {
  # Same bypass via bash -lc (login shell invocation).
  # BEFORE fix: exits 0. RED.
  # AFTER fix: recursive detection → exit 2.
  make_input 'bash -lc "git push origin x"' "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-11 BLOCK: peer + sh -c 'echo ok && git push origin x' → BLOCK (compound in payload)" {
  # Compound command inside sh -c payload — recursive detection must handle && in payload.
  # BEFORE fix: exits 0. RED.
  # AFTER fix: recurse into payload → segment-aware split finds 'git push origin x' → exit 2.
  make_input "sh -c 'echo ok && git push origin x'" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-12 ALLOW: peer + sh -c \"echo 'git push'\" → ALLOW (payload only echoes prose)" {
  # Guard: recursing into the sh -c payload finds 'echo ...' not a real push.
  # The echo argument 'git push' is prose inside the payload — must NOT over-block.
  # Must stay GREEN before and after the fix.
  make_input "sh -c \"echo 'git push'\"" "toolkit-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PA-P2A-13 ALLOW: main + printf 'remember: git push origin x' (no stamps) → ALLOW (prose still works)" {
  # Guard: confirms PA-P2A-7-style prose detection still works after recursive fix.
  # main role + no stamps + no hook → prose correctly not detected → exit 0.
  # Must stay GREEN before and after the fix.
  make_input "printf 'remember: git push origin x\n'"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PA-P2A-14 BLOCK: peer + zsh -c 'git push origin x' → BLOCK (zsh shell-exec wrapper)" {
  # Same class of bypass as PA-P2A-9/10 — zsh -c wraps executed payload.
  # BEFORE fix: exits 0. RED.
  # AFTER fix: recursive shell-exec detection finds 'git push' → exit 2.
  make_input "zsh -c 'git push origin x'" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-15 BLOCK: peer + env sh -c 'git push origin x' → BLOCK (env-prefixed shell exec)" {
  # env sh -c is another shell-exec pattern; 'env' before 'sh' must not bypass detection.
  # BEFORE fix: exits 0. RED.
  # AFTER fix: recursive detection handles env-prefixed shell launch → exit 2.
  make_input "env sh -c 'git push origin x'" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-16 BLOCK: peer + eval 'git push origin x' → BLOCK (eval bypass)" {
  # eval executes its argument as a shell command — 'git push' inside the string is real.
  # BEFORE fix: exits 0. RED.
  # AFTER fix: eval detected as a shell-exec wrapper → recurse → exit 2.
  make_input "eval 'git push origin x'" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-17 BLOCK: peer + \$(git push origin x) command-substitution → BLOCK" {
  # Command substitution \$(git push ...) executes the command.
  # The segment-aware detector strips \$(...) content as a quoted span → bypassed.
  # BEFORE fix: exits 0. RED.
  # AFTER fix: command-substitution content inspected → exit 2.
  make_input '$(git push origin x)' "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-18 BLOCK: peer + backtick \`git push origin x\` command-substitution → BLOCK" {
  # Backtick command substitution — same as \$(...) but legacy syntax.
  # BEFORE fix: exits 0. RED.
  # AFTER fix: backtick content inspected → exit 2.
  make_input '`git push origin x`' "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-19 BLOCK: peer + command git push origin x → BLOCK (command builtin bypass)" {
  # 'command' builtin bypasses shell functions/aliases but still executes git push.
  # isGitPushCommand must recognise 'command git push' as a push.
  # BEFORE fix: exits 0 (not matched by /^git\s+push\b/ after strip). RED.
  # AFTER fix: 'command' prefix stripped → git push detected → exit 2.
  make_input "command git push origin x" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-20 BLOCK: peer + xargs git push → BLOCK (xargs bypass)" {
  # xargs passes stdin lines as arguments to git push — real push execution.
  # BEFORE fix: exits 0. RED.
  # AFTER fix: xargs git push pattern detected → exit 2.
  make_input "xargs git push" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-21 BLOCK: peer + time git push origin x → BLOCK (time prefix bypass)" {
  # 'time' measures execution time of the command — git push still executes.
  # BEFORE fix: exits 0 (time not stripped, git push not first token). RED.
  # AFTER fix: time/nice/sudo prefix stripping extended → git push detected → exit 2.
  make_input "time git push origin x" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-23 BLOCK: peer + eval git push origin x (unquoted) → BLOCK (eval prefix-strip)" {
  # Unquoted form: 'eval git push origin x' — the whole remainder IS the push command.
  # Differs from PA-P2A-16 which tests eval 'git push origin x' (quoted payload).
  # BEFORE fix: 'eval' not stripped → first token 'eval' ≠ 'git' → exits 0. RED.
  # AFTER fix: eval stripped as a prefix → 'git push origin x' detected → exit 2.
  make_input "eval git push origin x" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-22 ALLOW: peer + echo \"\$(date) pushed ok\" → ALLOW (command-sub in prose, no real push)" {
  # Guard: command substitution \$(date) inside an echo argument is prose — the command
  # inside \$() is 'date', not 'git push'. Must NOT over-block.
  # Stays GREEN before and after the deep fix.
  make_input 'echo "$(date) pushed ok"' "toolkit-specialist"
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
