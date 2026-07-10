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
ts = datetime.datetime.fromtimestamp(time.time() - age_secs, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
with open(path, "w") as f:
    json.dump({"verdict": verdict, "timestamp": ts, "head": head}, f)
PYEOF
}

# Write a canonical-valid push-proof.json + quality-gate-report.json (for in-JS 8-check).
# a7e855e: in-JS fallback recomputes sha256(report, CRLF→LF) — bogus "0"*64 digest blocks
# at check 7. This helper writes a minimal report and computes the real digest.
# f9f0610: check 8 requires proof.bats_evidence present + .head == pushed_sha. Args:
#   <head_sha> <project_root> <stamp_dir> [<bats_evidence_head>]
# bats_evidence_head defaults to <head_sha> (matching — the canonical/positive-control
# shape used by PA-4c/PA-5/#PAG-EV3). Pass "__OMIT__" to omit bats_evidence entirely
# (#PAG-EV1), or a different 40-hex value to force a head mismatch (#PAG-EV2).
write_canonical_proof() {
  local head="$1" root="$2" stamp_dir="$3" bats_evidence_head="${4:-$1}"
  # The in-JS check 5 reads quality-gate-manifest.json from project root.
  # Copy the live manifest into the isolated PROJECT_ROOT so the gate can load it.
  cp "$BATS_TEST_DIRNAME/../../quality-gate-manifest.json" "$root/quality-gate-manifest.json"
  python3 - "$head" "$root" "$stamp_dir" "$bats_evidence_head" <<'PYEOF'
import hashlib, json, sys, datetime

head, root, stamp_dir, bats_evidence_head = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
ts = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
# Dynamic read (never hardcoded) — mirrors the sibling pattern already used correctly by
# test-push-proof-gate.bats (:198/:363/:398) and pre-push-hook.bats (:174). A literal here
# rots at the next manifest_version bump; that is exactly how the Wave A hardcoding defect
# was planted.
manifest_version = json.load(open(root + '/quality-gate-manifest.json', encoding='utf-8'))['manifest_version']

# Minimal quality-gate-report.json with all 6 required steps (ids match manifest required_steps).
report = {
  "steps": {
    "architect-deliberation": {"ran": True, "result": "PASS"},
    "pre-pr":                 {"ran": True, "result": "PASS"},
    "test-suite":             {"ran": True, "result": "PASS"},
    "rule-cross-check":       {"ran": True, "result": "PASS"},
    "registry-hash":          {"ran": True, "result": "PASS"},
    "secret-scan":            {"ran": True, "result": "PASS"}
  }
}
report_raw = json.dumps(report, separators=(',', ':')).encode('utf-8')
# Normalize CRLF→LF (same as gate's byte-by-byte strip) — LF-only content is unchanged.
normalized = bytes(
    b for i, b in enumerate(report_raw)
    if not (b == 0x0D and i + 1 < len(report_raw) and report_raw[i + 1] == 0x0A)
)
digest = hashlib.sha256(normalized).hexdigest()

report_path = stamp_dir + '/quality-gate-report.json'
with open(report_path, 'wb') as f:
    f.write(report_raw)

proof = {
    "schema_version": 1,
    "head": head,
    "generated_at": ts,
    "worktree_id": root,
    "manifest_version": manifest_version,
    "steps_executed": [
        {"step": "architect-deliberation", "result": "PASS", "ran": True},
        {"step": "pre-pr",                 "result": "PASS", "ran": True},
        {"step": "test-suite",             "result": "PASS", "ran": True},
        {"step": "rule-cross-check",       "result": "PASS", "ran": True},
        {"step": "registry-hash",          "result": "PASS", "ran": True},
        {"step": "secret-scan",            "result": "PASS", "ran": True},
        {"step": "doc-validator-parity",   "result": "PASS", "ran": True}
    ],
    "report_digest": digest
}
# check 8 (f9f0610): bats_evidence present + .head == pushed_sha. "__OMIT__" leaves it
# off the proof entirely (#PAG-EV1's absent-evidence scenario); otherwise it's populated
# with bats_evidence_head, which is the pushed head by default (matching/canonical) or a
# deliberately different value (#PAG-EV2's mismatch scenario).
if bats_evidence_head != "__OMIT__":
    proof["bats_evidence"] = {
        "run_id": "canonical-run",
        "head": bats_evidence_head,
        "ok": 10,
        "not_ok": 0,
        "expected": 10,
        "scope": "full",
        "generated_at": ts,
    }
proof_path = stamp_dir + '/push-proof.json'
with open(proof_path, 'w') as f:
    json.dump(proof, f)
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

@test "PA-4c ALLOW: main + bare stub hook (no ACDOC marker) + canonical-valid proof → allowed via stamp path" {
  # Bare stub without marker → gate falls through to stamp check. With valid fresh stamps
  # and a canonical-valid proof (all 8 checks pass), the stamp path should allow.
  # No emit-push-proof.sh in isolated PROJECT_ROOT → in-JS fallback taken.
  # a7e855e: in-JS now does full 7-check including report_digest recompute — bogus "0"*64
  # would block at check 7. Write real quality-gate-report.json, compute sha256, embed digest.
  # f9f0610: an 8th check (bats_evidence present + .head == pushed_sha) now also gates —
  # write_canonical_proof's default bats_evidence_head (= the pushed head) satisfies it.
  mkdir -p "$PROJECT_ROOT/.git/hooks"
  printf '#!/bin/sh\nexit 0\n' > "$PROJECT_ROOT/.git/hooks/pre-push"
  chmod +x "$PROJECT_ROOT/.git/hooks/pre-push"
  write_stamp "quality-gate.stamp" "PASS" 0 "$HEAD_SHA"
  write_stamp "pre-pr.stamp"       "PASS" 0 "$HEAD_SHA"
  write_canonical_proof "$HEAD_SHA" "$PROJECT_ROOT" "$STAMP_DIR"
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 0 ]
}

# ── Main orchestrator: no pre-push hook + fallback stamps ───────────────────

@test "PA-5 ALLOW: main + no pre-push hook + canonical-valid proof → allowed" {
  # CR-3 (df1a5d1): head must be a valid 40-hex SHA matching current HEAD (unconditional).
  # setup() now git-inits PROJECT_ROOT and sets HEAD_SHA so binding works in isolation.
  # a7e855e: in-JS fallback does full 7-check including report_digest recompute — bogus
  # "0"*64 digest now blocks at check 7. Use canonical proof with real digest.
  # f9f0610: an 8th check (bats_evidence present + .head == pushed_sha) now also gates —
  # write_canonical_proof's default bats_evidence_head (= the pushed head) satisfies it.
  write_stamp "quality-gate.stamp" "PASS" 0 "$HEAD_SHA"
  write_stamp "pre-pr.stamp"       "PASS" 0 "$HEAD_SHA"
  write_canonical_proof "$HEAD_SHA" "$PROJECT_ROOT" "$STAMP_DIR"
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

@test "PA-P2A-24 BLOCK: peer + bash -lc \$'git push origin x' (ANSI-C quoting) → BLOCK" {
  # ANSI-C quoting $'...' is treated as a quoted span by the Pass-1 quote-strip regex,
  # so the payload 'git push origin x' is stripped as prose before shell-exec recursion.
  # Fix: extend Pass-1 regexes to also match $'...' spans so they are NOT stripped.
  # BEFORE fix: $'git push origin x' stripped → shell-exec payload empty → exits 0. RED.
  # AFTER fix: $'...' preserved → recursive detection finds 'git push origin x' → exit 2.
  make_input "bash -lc \$'git push origin x'" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-25 BLOCK: peer + sh -c \$'echo ok && git push origin x' (ANSI-C compound) → BLOCK" {
  # Compound command inside an ANSI-C-quoted sh -c payload.
  # BEFORE fix: $'...' stripped → recursive payload empty → exits 0. RED.
  # AFTER fix: payload preserved → segment split finds 'git push origin x' → exit 2.
  make_input "sh -c \$'echo ok && git push origin x'" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-26 BLOCK: peer + eval \$'git push origin x' (ANSI-C eval payload) → BLOCK" {
  # eval with ANSI-C-quoted argument — $'git push origin x' is the executed command.
  # BEFORE fix: $'...' stripped as prose → 'eval' prefix-stripped → nothing left → exits 0. RED.
  # AFTER fix: $'...' preserved → eval recursion finds 'git push origin x' → exit 2.
  make_input "eval \$'git push origin x'" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-27 ALLOW: peer + echo \$'git push' (ANSI-C prose) → ALLOW (no real push)" {
  # Guard: $'git push' inside an echo argument is prose — must NOT over-block.
  # Stays GREEN before and after the ANSI-C fix.
  make_input "echo \$'git push'" "toolkit-specialist"
  run_hook
  [ "$status" -eq 0 ]
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

# ── a7e855e: in-JS fallback 7-check reject cases (bash hidden; proofScript absent = in-JS path) ──
# Base: canonical proof + report; mutate one thing per test to assert BLOCK.
# In all cases: no emit-push-proof.sh in isolated PROJECT_ROOT → in-JS fallback taken.
# (bash may or may not be available — the gate falls back when fs.existsSync(proofScript) is false)

@test "PA-JS1 BLOCK: in-JS fallback — empty steps_executed → BLOCK (required-step coverage)" {
  # Check 6: all 6 required steps must be present with result=PASS. Empty array → all missing.
  write_stamp "quality-gate.stamp" "PASS" 0 "$HEAD_SHA"
  write_stamp "pre-pr.stamp"       "PASS" 0 "$HEAD_SHA"
  write_canonical_proof "$HEAD_SHA" "$PROJECT_ROOT" "$STAMP_DIR"
  # Overwrite proof with empty steps_executed (keep valid digest for report — digest check
  # fires AFTER step-coverage check, so any digest value is fine here; step check fires first).
  python3 - "$STAMP_DIR/push-proof.json" "$HEAD_SHA" "$PROJECT_ROOT" "$STAMP_DIR" <<'PYEOF'
import hashlib, json, sys, datetime
proof_path, head, root, stamp_dir = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
ts = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
report_raw = open(stamp_dir + '/quality-gate-report.json', 'rb').read()
normalized = bytes(b for i, b in enumerate(report_raw)
    if not (b == 0x0D and i + 1 < len(report_raw) and report_raw[i + 1] == 0x0A))
digest = hashlib.sha256(normalized).hexdigest()
# Dynamic read (never hardcoded) — see write_canonical_proof's own comment for why.
manifest_version = json.load(open(root + '/quality-gate-manifest.json', encoding='utf-8'))['manifest_version']
proof = {
    "schema_version": 1, "head": head, "generated_at": ts,
    "worktree_id": root, "manifest_version": manifest_version,
    "steps_executed": [],
    "report_digest": digest
}
with open(proof_path, 'w') as f: json.dump(proof, f)
PYEOF
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"BLOCKED"* ]]
}

@test "PA-JS2 BLOCK: in-JS fallback — required step result=SKIP → BLOCK (step-not-pass)" {
  # Check 6: required step 'test-suite' present but result=SKIP (not PASS) → BLOCK.
  write_stamp "quality-gate.stamp" "PASS" 0 "$HEAD_SHA"
  write_stamp "pre-pr.stamp"       "PASS" 0 "$HEAD_SHA"
  write_canonical_proof "$HEAD_SHA" "$PROJECT_ROOT" "$STAMP_DIR"
  python3 - "$STAMP_DIR/push-proof.json" "$HEAD_SHA" "$PROJECT_ROOT" "$STAMP_DIR" <<'PYEOF'
import hashlib, json, sys, datetime
proof_path, head, root, stamp_dir = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
ts = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
report_raw = open(stamp_dir + '/quality-gate-report.json', 'rb').read()
normalized = bytes(b for i, b in enumerate(report_raw)
    if not (b == 0x0D and i + 1 < len(report_raw) and report_raw[i + 1] == 0x0A))
digest = hashlib.sha256(normalized).hexdigest()
# Dynamic read (never hardcoded) — see write_canonical_proof's own comment for why.
manifest_version = json.load(open(root + '/quality-gate-manifest.json', encoding='utf-8'))['manifest_version']
proof = {
    "schema_version": 1, "head": head, "generated_at": ts,
    "worktree_id": root, "manifest_version": manifest_version,
    "steps_executed": [
        {"step": "architect-deliberation", "result": "PASS", "ran": True},
        {"step": "pre-pr",                 "result": "PASS", "ran": True},
        {"step": "test-suite",             "result": "SKIP", "ran": False},  # mutated
        {"step": "rule-cross-check",       "result": "PASS", "ran": True},
        {"step": "registry-hash",          "result": "PASS", "ran": True},
        {"step": "secret-scan",            "result": "PASS", "ran": True},
        {"step": "doc-validator-parity",   "result": "PASS", "ran": True}
    ],
    "report_digest": digest
}
with open(proof_path, 'w') as f: json.dump(proof, f)
PYEOF
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"BLOCKED"* ]]
}

@test "PA-JS3 BLOCK: in-JS fallback — tampered report (report_digest mismatch) → BLOCK" {
  # Check 7: recomputed sha256(report) != proof.report_digest → BLOCK (forged or tampered).
  write_stamp "quality-gate.stamp" "PASS" 0 "$HEAD_SHA"
  write_stamp "pre-pr.stamp"       "PASS" 0 "$HEAD_SHA"
  write_canonical_proof "$HEAD_SHA" "$PROJECT_ROOT" "$STAMP_DIR"
  # Overwrite the report file with different content — digest in proof is now stale.
  printf '{"tampered":true}' > "$STAMP_DIR/quality-gate-report.json"
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"report_digest"* ]]
}

@test "PA-JS4 BLOCK: in-JS fallback — manifest_version mismatch → BLOCK" {
  # Check 5: proof.manifest_version != live manifest.manifest_version → BLOCK.
  # Canonical manifest has manifest_version=2 (Wave A bump); write proof with manifest_version=99.
  write_stamp "quality-gate.stamp" "PASS" 0 "$HEAD_SHA"
  write_stamp "pre-pr.stamp"       "PASS" 0 "$HEAD_SHA"
  write_canonical_proof "$HEAD_SHA" "$PROJECT_ROOT" "$STAMP_DIR"
  # Overwrite push-proof.json with manifest_version=99 but a valid report digest
  # (digest check fires after manifest_version check only if manifest check passes,
  # but we need a valid report.json to exist for check 7 — write_canonical_proof wrote it).
  python3 - "$STAMP_DIR/push-proof.json" "$HEAD_SHA" "$PROJECT_ROOT" "$STAMP_DIR" <<'PYEOF'
import hashlib, json, sys, datetime
proof_path, head, root, stamp_dir = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
ts = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
report_raw = open(stamp_dir + '/quality-gate-report.json', 'rb').read()
normalized = bytes(b for i, b in enumerate(report_raw)
    if not (b == 0x0D and i + 1 < len(report_raw) and report_raw[i + 1] == 0x0A))
digest = hashlib.sha256(normalized).hexdigest()
proof = {
    "schema_version": 1, "head": head, "generated_at": ts,
    "worktree_id": root,
    "manifest_version": 99,   # mutated — live manifest is 2 (Wave A bump); 99 is intentional mismatch test data
    "steps_executed": [
        {"step": "architect-deliberation", "result": "PASS", "ran": True},
        {"step": "pre-pr",                 "result": "PASS", "ran": True},
        {"step": "test-suite",             "result": "PASS", "ran": True},
        {"step": "rule-cross-check",       "result": "PASS", "ran": True},
        {"step": "registry-hash",          "result": "PASS", "ran": True},
        {"step": "secret-scan",            "result": "PASS", "ran": True},
        {"step": "doc-validator-parity",   "result": "PASS", "ran": True}
    ],
    "report_digest": digest
}
with open(proof_path, 'w') as f: json.dump(proof, f)
PYEOF
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"manifest_version"* ]]
}

# ── f9f0610: in-JS fallback check 8 — bats_evidence binding ──────────────────
# Gate 0b (Codex pre-exec review of .claude/hooks/push-authorization-gate.js) has
# cleared; toolkit-specialist landed the 8th check in f9f0610. #PAG-EV3 is a POSITIVE
# CONTROL and is load-bearing: without it, #PAG-EV1/#PAG-EV2 could pass against a gate
# that blocks every proof unconditionally, proving nothing.

@test "#PAG-EV1 BLOCK: in-JS fallback — push-proof.json missing bats_evidence → BLOCK" {
  # Check 8: proof.bats_evidence absent → BLOCK. absent-means-skip is a bypass, not a
  # default — same rule as every earlier check.
  write_stamp "quality-gate.stamp" "PASS" 0 "$HEAD_SHA"
  write_stamp "pre-pr.stamp"       "PASS" 0 "$HEAD_SHA"
  write_canonical_proof "$HEAD_SHA" "$PROJECT_ROOT" "$STAMP_DIR" "__OMIT__"
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"bats_evidence"* ]]
}

@test "#PAG-EV2 BLOCK: in-JS fallback — bats_evidence.head mismatched pushed SHA → BLOCK" {
  # Check 8: proof.bats_evidence.head != headShaForProof → BLOCK. The evidence binding
  # exists but does not correspond to the commit actually being pushed.
  write_stamp "quality-gate.stamp" "PASS" 0 "$HEAD_SHA"
  write_stamp "pre-pr.stamp"       "PASS" 0 "$HEAD_SHA"
  local mismatched_head="deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
  write_canonical_proof "$HEAD_SHA" "$PROJECT_ROOT" "$STAMP_DIR" "$mismatched_head"
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"bats_evidence"* ]] || [[ "$output" == *"head"* ]]
}

@test "#PAG-EV3 ALLOW (positive control): in-JS fallback — bats_evidence.head matches pushed SHA → still passes" {
  # Proves #PAG-EV1/#PAG-EV2 are exercising a real check, not passing against a gate
  # that blocks every proof unconditionally — a correctly-bound bats_evidence must
  # still allow the push, exactly like PA-5's canonical scenario.
  write_stamp "quality-gate.stamp" "PASS" 0 "$HEAD_SHA"
  write_stamp "pre-pr.stamp"       "PASS" 0 "$HEAD_SHA"
  write_canonical_proof "$HEAD_SHA" "$PROJECT_ROOT" "$STAMP_DIR"
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 0 ]
}

# ── Peer-block CONTRACT test — NOT a fail-open regression pin; see #PAG-GUARD ────
#
# Asserts the peer-block contract: agent_type != '' + git push => exit 2 +
# decision:block, with PA-4 (the identical marker-bearing fixture) as its positive
# control for the main orchestrator. Would catch a future refactor that drops or
# weakens the agent_type check entirely.
#
# THIS TEST PASSES AGAINST THE PRE-9336e5e CODE TOO, BY DESIGN — that is a fact about
# block()'s own mechanics, not a flaw in the test. block() calls process.exit(2)
# SYNCHRONOUSLY whenever stdout.write() returns true, which it always does for this
# hook's ~200-byte JSON payload (nowhere near a pipe's high-water mark). So even
# without the `return` that follows the peer-block call, block() still exits 2 before
# the later `if (hookIsACDoc) process.exit(0)` fall-through — reached via NO `else`,
# the line labelled "Main orchestrator" a few lines down is a comment, not a branch —
# can ever execute.
#
# That fall-through is REACHABLE (there is no else) but UNOBSERVABLE at this payload
# size (block() never defers to 'drain' here). Those are different facts, and only
# the second is why this test can't catch a missing `return`: do not read "reachable"
# as "belt-and-braces" — that single `return` is the SOLE guard. Delete it and put
# stdout under genuine backpressure and the FIXED code would deadlock instead (the
# 5s escape-hatch timer is already cleared by the time block() would defer to
# 'drain'), so a runtime test for this fail-open hangs on CORRECT code — only a
# static check fits. #PAG-GUARD (below) is the ONLY test in this suite that can
# detect the missing `return`; see its own red-then-green verification.
#
# ADDENDUM — found vacuous by an actual `git push`, not a test: this fixture uses the
# BARE command shape ("git push origin feature/test"), no shell wrapper. That is NOT
# the shape this repo's agents actually issue — the mandated invocation wraps through
# `env PATH="$HOME/.local/gnubin-l0:..." bash -c 'cd <repo>\n<command>'` for GNU-userland
# reasons. isGitPushCommand splits on &&/||/;/| but never on a literal newline, so a
# bash -c payload whose FIRST LINE is `cd ...` is one segment starting with `cd` —
# never recognized as a push at all, for ANY agent_type, peer or main. This test was
# GREEN, unbroken, for the entire period that bypass existed, because it never once
# exercised the wrapped shape. See #PAG-PEER-WRAPPED / #PAG-MAIN-STALE-WRAPPED below,
# which cover the shape this repo actually uses and were RED against the unfixed hook
# before being written. Keep this test — it is still a real contract pin for the bare
# shape — but its green never was, and is not now, evidence that the peer-block holds
# for every invocation shape a peer might actually use.

@test "#PAG-PEER-BLOCK BLOCK: peer + git push + ACDoc pre-push hook installed → exit 2 + decision:block (peer-block contract)" {
  # The marker-bearing real pre-push-hook.sh must be installed (hookIsACDoc=true) so
  # the fixture matches PA-4's, its positive control — proving this block is
  # specifically about agent_type, not an unconditional block on every push through
  # this hook.
  mkdir -p "$PROJECT_ROOT/.git/hooks"
  cp "$BATS_TEST_DIRNAME/../sh/pre-push-hook.sh" "$PROJECT_ROOT/.git/hooks/pre-push"
  chmod +x "$PROJECT_ROOT/.git/hooks/pre-push"
  make_input "git push origin feature/test" "toolkit-specialist"
  run_hook
  # Assert BOTH exit code and the actual decision JSON — a crash also exits non-zero
  # (e.g. Node's default uncaught-exception exit code), so exit-code alone cannot
  # distinguish "blocked with a message" from "died". The outer catch{} fail-open would
  # make a crash exit 0, not nonzero — but a corrupted intermediate state could still
  # exit nonzero for the wrong reason, so pin the real payload too.
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
  [[ "$output" == *"push-authorization-gate"* ]]
}

# ── #PAG-PEER-WRAPPED / #PAG-MAIN-STALE-WRAPPED — the real bypass shape ─────────
#
# Found by an actual `git push`, not a test: team-lead's own push went through with
# 58-minute-stale stamps and no pre-push hook installed. Root cause: isGitPushCommand
# splits a command on &&, ||, ;, | — never on a literal newline — then anchors
# ^git push per segment. This repo's mandated invocation shape is
# `env PATH="$HOME/.local/gnubin-l0:..." bash -c 'cd <repo>\n<real command>'` (the GNU
# userland requires the env-prefix; the newline separates cd from the payload). A
# bash -c body whose FIRST LINE is `cd ...` is one segment beginning with `cd`, so
# isGitPushCommand returns false for the WHOLE string — and :174's
# `if (!isGitPushCommand(cmd)) process.exit(0)` runs before the peer-block (:200) and
# before the stamp/staleness check either one is ever reached. Nobody issues the bare
# shape #PAG-PEER-BLOCK tests; everybody issues this one.
#
# RED confirmed against the last-committed pre-fix hook (1653eb5, via a scratch copy —
# .claude/hooks/ was never touched to get this evidence) before writing these
# assertions: both #PAG-PEER-WRAPPED and #PAG-MAIN-STALE-WRAPPED exit=0 with NO output
# at all — a silent ALLOW, not even a decision JSON, because the early exit at :174
# fires before the hook ever forms an opinion. toolkit-specialist is fixing
# isGitPushCommand in parallel; these two assert the CORRECT (post-fix) behavior, so
# they are RED until that fix lands and GREEN after — do not weaken them to match
# today's behavior.

@test "#PAG-PEER-WRAPPED BLOCK: peer + newline-wrapped bash -c 'cd <repo>\ngit push' → exit 2 + decision:block (the real bypass shape)" {
  local wrapped_cmd
  wrapped_cmd="env PATH=\"\$HOME/.local/gnubin-l0:/opt/homebrew/bin:\$PATH\" bash -c 'cd $PROJECT_ROOT"$'\n'"git push -u origin br'"
  make_input "$wrapped_cmd" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
}

@test "#PAG-MAIN-STALE-WRAPPED BLOCK: main + same wrapped command + stale stamps (35 min) → exit 2, stale-stamp reason" {
  # This is literally the shape of team-lead's real push tonight: main orchestrator,
  # stamps well past the 30-minute freshness window, wrapped invocation.
  write_stamp "quality-gate.stamp" "PASS" $((35 * 60)) "$HEAD_SHA"
  write_stamp "pre-pr.stamp"       "PASS" $((35 * 60)) "$HEAD_SHA"
  local wrapped_cmd
  wrapped_cmd="env PATH=\"\$HOME/.local/gnubin-l0:/opt/homebrew/bin:\$PATH\" bash -c 'cd $PROJECT_ROOT"$'\n'"git push -u origin br'"
  make_input "$wrapped_cmd"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"stamp"* || "$output" == *"pre-pr"* || "$output" == *"quality-gate"* ]]
}

# ── Positive controls — pin what must NOT change alongside what must ───────────
# Verified against the same pre-fix hook snapshot: all six already behave as asserted
# today. They exist so a fix aimed at #PAG-PEER-WRAPPED/#PAG-MAIN-STALE-WRAPPED cannot
# silently overcorrect into blocking real non-push commands, blocking prose that merely
# mentions "git push", or — the sharpest risk — regressing the &&/;-separated and
# leading-newline shapes that already work today for the wrong reason to still work.

@test "#PAG-WRAPPED-NONPUSH ALLOW: peer + wrapped non-push bash -c 'cd /tmp\necho hi' → exit 0 (not a push at all)" {
  local wrapped_cmd
  wrapped_cmd="bash -c 'cd /tmp"$'\n'"echo hi'"
  make_input "$wrapped_cmd" "toolkit-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

@test "#PAG-PROSE-SH ALLOW: main + sh -c \"echo 'git push'\" (prose, no real push) → exit 0" {
  make_input "sh -c \"echo 'git push'\""
  run_hook
  [ "$status" -eq 0 ]
}

@test "#PAG-PROSE-PRINTF ALLOW: main + printf 'git push' (prose, no real push) → exit 0" {
  make_input "printf 'git push'"
  run_hook
  [ "$status" -eq 0 ]
}

@test "#PAG-PROSE-ANSI ALLOW: main + echo \$'git push' (ANSI-C prose, no real push) → exit 0" {
  make_input "echo \$'git push'"
  run_hook
  [ "$status" -eq 0 ]
}

@test "#PAG-PEER-AND-BLOCK BLOCK: peer + 'cd /tmp && git push origin x' (already-working && path) → exit 2, regression pin" {
  # Already blocks today via the &&-splitting path (segment-aware detector already
  # inspects each &&-separated segment). Pinned so a fix for the newline case cannot
  # silently regress the already-working && case.
  make_input "cd /tmp && git push origin x" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
}

@test "#PAG-PEER-LEADING-NEWLINE BLOCK: peer + bash -c '\ngit push origin x' (leading newline only, no cd) → exit 2, regression pin" {
  # Already blocks today: with no 'cd' prefix, the one newline-containing segment
  # trims down to a leading blank line + 'git push origin x' — trimming leading
  # whitespace before the ^git push anchor check means this shape is caught even
  # though the fix for #PAG-PEER-WRAPPED (which has a non-whitespace 'cd' prefix
  # before the same anchor) has not landed yet. Pinned so a newline-splitting fix
  # doesn't accidentally special-case "payload starts with a newline" into an allow.
  local wrapped_cmd
  wrapped_cmd="bash -c '"$'\n'"git push origin x'"
  make_input "$wrapped_cmd" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
}

# ── #PAG-GUARD — static invariant: every block( call site is immediately followed by
# return ────────────────────────────────────────────────────────────────────────────
#
# WHY this invariant exists (for the next person tempted to delete a `return`): block()
# only calls process.exit(2) synchronously when stdout.write() succeeds; under
# backpressure it defers exit to the 'drain' event. Without `return` immediately after,
# execution continues past a decision that has already been made, ending in an
# accidental ALLOW — either a deref-throw swallowed by the outer catch{}'s fail-open, or
# (the real, historical case — #PAG-PEER-BLOCK above) a silent fall-through to a later
# unconditional process.exit(0). Neither failure mode crashes loudly; both look like a
# normal allow.
#
# Model/precedent: scripts/tests/portable-shell-guards.bats (Wave B, same problem shape).
#
# SANITY FLOOR IS THE WHOLE POINT (repo memory: "a guard that cannot fail is worse than
# no guard" — a detector that scans and finds zero block( call sites reports "0
# violations", indistinguishable from "0 call sites", and would pass against an empty
# file, a moved file, or a broken regex). The floor is >=15, not >=8 and not ==20:
# >=8 is loose enough that a half-broken regex finding 9 would still pass; ==20 is
# brittle and would fail spuriously the moment anyone adds or removes a legitimate
# block() call as part of ordinary maintenance. >=15 fails loudly if the parser breaks
# and survives ordinary maintenance. The file has exactly 20 call sites as of this wave.
#
# Four shapes the parser must survive (all verified against the real file AND against a
# deliberately-broken copy with one return removed, to confirm this is non-vacuous):
#   1. Multi-line call: `block(\n  '...'\n);` then `return;` on the NEXT physical line.
#   2. catch-oneliner:  `catch { block('...'); return; }` — return on the SAME line,
#      immediately after `);` with no line break.
#   3. Leading comment: a line starting with `//` that merely mentions `block()` in
#      prose (the INVARIANT comment block above `function block` does this twice) — must
#      be excluded, not counted as a call site.
#   4. TRAILING comment: `return; // ... mentions block() in a later comment ...` — the
#      trailing `//` must be stripped BEFORE searching for `block(`, or this line is
#      miscounted as an extra call site whose "next line" is a comment continuation, not
#      `return` — a false violation on the very line that documents the invariant. This
#      is the shape that produced 1 false positive while developing this detector (a
#      naive "does this line end in );" check breaks on shape 2, since `);` there is
#      followed by more code on the same line, not end-of-line — fixed by searching for
#      the ");" substring at any position, not requiring it at end-of-line).
@test "#PAG-GUARD static: every block( call site in the hook is immediately followed by return" {
  local hook="$BATS_TEST_DIRNAME/../../.claude/hooks/push-authorization-gate.js"
  [ -f "$hook" ]

  run python3 - "$hook" << 'PYEOF'
import re, sys

path = sys.argv[1]
with open(path, encoding='utf-8') as f:
    lines = f.readlines()

def strip_comment(line):
    # Strip from the first // onward. Safe for THIS file specifically: verified no
    # line's genuine (non-comment) content contains a literal "//" (e.g. no URLs).
    idx = line.find('//')
    return line if idx == -1 else line[:idx]

cleaned = [strip_comment(l) for l in lines]

# Call sites: lines containing `block(` as a token, excluding the `function block(`
# definition and excluding lines that are pure comments (already blanked above).
call_sites = []
for i, line in enumerate(cleaned):
    if re.search(r'function\s+block\s*\(', line):
        continue
    m = re.search(r'\bblock\s*\(', line)
    if m:
        call_sites.append((i, m.start()))

violations = []
for (i, col) in call_sites:
    # Find the first ");" substring from (i, col) onward, scanning forward up to 15
    # lines (covers multi-line calls). Searching for the substring anywhere on the
    # line (not requiring end-of-line) is what survives shape 2 (catch-oneliner).
    close_pos = None
    search_from = col
    for j in range(i, min(i + 15, len(cleaned))):
        idx = cleaned[j].find(');', search_from if j == i else 0)
        if idx != -1:
            close_pos = (j, idx + 2)
            break
    if close_pos is None:
        violations.append((i + 1, 'no closing ); found within 15 lines'))
        continue

    close_line_idx, after_idx = close_pos
    remainder = cleaned[close_line_idx][after_idx:]
    if re.search(r'\breturn\s*;', remainder):
        continue  # shape 2: return on the same line as the close

    if remainder.strip() != '':
        violations.append((i + 1, f'trailing code after close, no return: {remainder!r}'))
        continue

    # shape 1: return on the next non-blank line
    k = close_line_idx + 1
    while k < len(cleaned) and cleaned[k].strip() == '':
        k += 1
    if k < len(cleaned) and re.match(r'^\s*return\s*;', cleaned[k]):
        continue

    violations.append((i + 1, f'no return immediately after close at line {close_line_idx + 1}'))

print(f'call_sites={len(call_sites)}')
print(f'violations={len(violations)}')
for ln, reason in violations:
    print(f'VIOLATION at line {ln}: {reason}')
PYEOF
  [ "$status" -eq 0 ]

  local call_sites violations
  call_sites="$(printf '%s\n' "$output" | python3 -c "import sys; print(next(l.split('=')[1] for l in sys.stdin if l.startswith('call_sites=')))")"
  violations="$(printf '%s\n' "$output" | python3 -c "import sys; print(next(l.split('=')[1] for l in sys.stdin if l.startswith('violations=')))")"

  # Sanity floor FIRST: fails loudly if the parser is broken, not if the code is.
  [ "$call_sites" -ge 15 ]
  [ "$violations" -eq 0 ]
}
