#!/usr/bin/env bats
#
# Tests for .claude/hooks/architect-verdict-presence-gate.js.
# Validates that arch-* agents are blocked from sending APPROVE via SendMessage
# unless a verdict file exists at .planning/wave*/arch-{role}-verdict.md.
# Non-arch agents, non-SendMessage tools, non-APPROVE messages, and structured
# JSON message forms all flow through unblocked.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/architect-verdict-presence-gate.js"
INPUT_FILE="${BATS_TEST_TMPDIR:-/tmp}/arch-verdict-presence-input-$$.json"

# Build a JSON SendMessage envelope:
#   make_input <message_body> [agent_type] [recipient]
# Uses python3 to safely serialize the message body as valid JSON.
make_input() {
  local msg="$1" agent="${2:-arch-platform}" recipient="${3:-team-lead}"
  python3 - "$msg" "$agent" "$recipient" "$INPUT_FILE" <<'PYEOF'
import json, sys
msg, agent, recipient, path = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
with open(path, "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "SendMessage",
        "tool_input": {"to": recipient, "message": msg},
        "agent_type": agent,
        "session_id": "session-test",
    }, f)
PYEOF
}

run_hook() {
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
}

# _mint_prep_json <slug> <role> -> git-inits $CLAUDE_PROJECT_DIR (idempotent --
# safe to call more than once per test), creates .planning/wave-<slug>/PLAN.md,
# and publishes a genuine arch-<role>-verdict-prep.json there via the real
# write-verdict-request.sh + write-verdict.sh --decision approve flow (never
# hand-authored JSON) -- mirrors JSON-PREP-1's own real-script-call pattern
# (scripts/tests/premature-execution-gate.bats ~line 1011). write-verdict.sh
# always prefixes "wave-" itself (no override), so this always lands at
# .planning/wave-<slug>/ regardless of what bare-"wave*" name a caller might
# have used historically -- the hook's own wave-dir match is startsWith('wave'),
# satisfied either way.
_mint_prep_json() {
  local slug="$1" role="$2"
  git -C "$CLAUDE_PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
    git -C "$CLAUDE_PROJECT_DIR" init -q
    git -C "$CLAUDE_PROJECT_DIR" -c user.email=test@example.com -c user.name=test commit -q --allow-empty -m init
  }
  local wave_dir="$CLAUDE_PROJECT_DIR/.planning/wave-$slug"
  mkdir -p "$wave_dir"
  cat > "$wave_dir/PLAN.md" <<'PLANEOF'
### Wave Class

- **Class**: HARNESS

### Spawn Table

| Role | Count | Reason |
|---|---|---|
| arch-platform | 1 | fixture |
PLANEOF

  local wvr_script="$BATS_TEST_DIRNAME/../sh/write-verdict-request.sh"
  local wv_script="$BATS_TEST_DIRNAME/../sh/write-verdict.sh"
  local req_out req_path req_sha256
  req_out="$(cd "$CLAUDE_PROJECT_DIR" && CLAUDE_WAVE_SLUG="$slug" bash "$wvr_script" --role "$role" --phase prep --slug "$slug")"
  req_path="$(printf '%s' "$req_out" | awk '{print $1}')"
  req_sha256="$(printf '%s' "$req_out" | awk '{print $2}')"
  bash -c "cd '$CLAUDE_PROJECT_DIR' && printf 'reviewed and approved' | CLAUDE_WAVE_SLUG='$slug' bash '$wv_script' --role '$role' --phase prep --slug '$slug' --request '$req_path' --request-sha256 '$req_sha256' --decision approve" >/dev/null 2>&1
}

setup() {
  export CLAUDE_PROJECT_DIR="$BATS_TEST_TMPDIR"
}

teardown() {
  unset CLAUDE_PROJECT_DIR
}

# ── Block scenarios (exit 2) ─────────────────────────────────────────────────

@test "blocks arch-platform APPROVE without verdict file" {
  make_input "APPROVE" "arch-platform"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"arch-platform"* ]]
}

@test "blocks arch-testing APPROVE without verdict file" {
  make_input "APPROVE" "arch-testing"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"arch-testing"* ]]
}

@test "blocks arch-integration APPROVE without verdict file" {
  make_input "APPROVE" "arch-integration"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"arch-integration"* ]]
}

# ── Allow scenarios — verdict file present (exit 0) ─────────────────────────

@test "allows arch-platform APPROVE when a genuine current JSON PREP verdict exists" {
  _mint_prep_json "avpg-platform" "arch-platform"
  make_input "APPROVE" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows arch-testing APPROVE when a genuine current JSON PREP verdict exists" {
  _mint_prep_json "avpg-testing" "arch-testing"
  make_input "APPROVE" "arch-testing"
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows arch-integration APPROVE when a genuine current JSON PREP verdict exists" {
  _mint_prep_json "avpg-integration" "arch-integration"
  make_input "APPROVE" "arch-integration"
  run_hook
  [ "$status" -eq 0 ]
}

# ── Allow scenarios — non-APPROVE messages (exit 0) ─────────────────────────

@test "allows arch-platform ESCALATE message (not gated)" {
  make_input "ESCALATE: foo is blocking" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows arch-platform plain question (no APPROVE keyword)" {
  make_input "what's blocking the release?" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
}

# ── Allow scenarios — non-arch agents (exit 0) ──────────────────────────────

@test "allows test-specialist sending APPROVE (not arch-*)" {
  make_input "APPROVE" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# ── Allow scenarios — non-SendMessage tool (exit 0) ─────────────────────────

@test "allows non-SendMessage tool even if APPROVE in message" {
  python3 - "$INPUT_FILE" <<'PYEOF'
import json, sys
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "Read",
        "tool_input": {"file_path": "APPROVE.md"},
        "agent_type": "arch-platform",
        "session_id": "session-test",
    }, f)
PYEOF
  run_hook
  [ "$status" -eq 0 ]
}

# ── Allow scenarios — edge cases (exit 0) ───────────────────────────────────

@test "allows malformed JSON (fail-open)" {
  printf '%s' '{not json' > "$INPUT_FILE"
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows a genuine JSON PREP verdict in an alternate wave dir (glob resolves across wave names)" {
  _mint_prep_json "avpg-alt-wave" "arch-platform"
  make_input "APPROVE" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows empty message body (no APPROVE keyword)" {
  make_input "" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows structured JSON message object form (not a string APPROVE)" {
  python3 - "$INPUT_FILE" <<'PYEOF'
import json, sys
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "SendMessage",
        "tool_input": {
            "to": "team-lead",
            "message": {"type": "shutdown_response", "request_id": "abc", "approve": True}
        },
        "agent_type": "arch-platform",
        "session_id": "session-test",
    }, f)
PYEOF
  run_hook
  [ "$status" -eq 0 ]
}

# ── Identity-tolerance: suffix-rotation + free-name (BL-W47 OQ3) ─────────────
# ARCH_ROLES uses startsWith — suffix-rotated arch peers must be blocked the
# same as canonical; free names (no arch- prefix) must pass through.

@test "IT-1 BLOCK: suffix-rotated arch-platform-2 blocked on APPROVE without verdict" {
  make_input "APPROVE" "arch-platform-2"
  run_hook
  [ "$status" -eq 2 ]
}

@test "IT-2 BLOCK: suffix-rotated arch-testing-2 blocked on APPROVE without verdict" {
  make_input "APPROVE" "arch-testing-2"
  run_hook
  [ "$status" -eq 2 ]
}

@test "IT-3 PASS: free-name agent sending APPROVE allowed (not arch-*)" {
  make_input "APPROVE" "free-agent"
  run_hook
  [ "$status" -eq 0 ]
}

@test "IT-4 PASS: suffix-rotated arch-platform-2 APPROVE allowed when a genuine JSON PREP verdict exists" {
  # The verdict is minted for the CANONICAL role (arch-platform) -- the hook
  # resolves matchedRole via startsWith before doing any verdict lookup, so a
  # suffix-rotated peer (arch-platform-2) is authorized by the same canonical
  # verdict, exactly like the non-JSON identity-tolerance cases above.
  _mint_prep_json "bl-w47" "arch-platform"
  make_input "APPROVE" "arch-platform-2"
  run_hook
  [ "$status" -eq 0 ]
}

# ── structured-verdict-evidence-contract (P3 consumer migration, arch-integration ──
# dispatch 2026-09-21T17:55:38Z): the migrated hook requires a canonical
# arch-{role}-verdict-{prep,verify-final}.json (verdict/v1) with authorizes==true --
# mere .md existence no longer authorizes (PLAN.md sec 2 item 3 / sec 3.8).

@test "blocks arch-platform APPROVE when the only JSON verdict is decision=escalate (well-formed, non-authorizing)" {
  local slug="avpg-escalate"
  git -C "$CLAUDE_PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
    git -C "$CLAUDE_PROJECT_DIR" init -q
    git -C "$CLAUDE_PROJECT_DIR" -c user.email=test@example.com -c user.name=test commit -q --allow-empty -m init
  }
  local wave_dir="$CLAUDE_PROJECT_DIR/.planning/wave-$slug"
  mkdir -p "$wave_dir"
  cat > "$wave_dir/PLAN.md" <<'PLANEOF'
### Wave Class

- **Class**: HARNESS

### Spawn Table

| Role | Count | Reason |
|---|---|---|
| arch-platform | 1 | fixture |
PLANEOF
  local wvr_script="$BATS_TEST_DIRNAME/../sh/write-verdict-request.sh"
  local wv_script="$BATS_TEST_DIRNAME/../sh/write-verdict.sh"
  local req_out req_path req_sha256
  req_out="$(cd "$CLAUDE_PROJECT_DIR" && CLAUDE_WAVE_SLUG="$slug" bash "$wvr_script" --role arch-platform --phase prep --slug "$slug")"
  req_path="$(printf '%s' "$req_out" | awk '{print $1}')"
  req_sha256="$(printf '%s' "$req_out" | awk '{print $2}')"
  bash -c "cd '$CLAUDE_PROJECT_DIR' && printf 'scope conflict, escalating' | CLAUDE_WAVE_SLUG='$slug' bash '$wv_script' --role arch-platform --phase prep --slug '$slug' --request '$req_path' --request-sha256 '$req_sha256' --decision escalate --reason-code scope-conflict" >/dev/null 2>&1

  make_input "APPROVE" "arch-platform"
  run_hook
  [ "$status" -eq 2 ]
}

@test "blocks arch-testing APPROVE when the only JSON verdict is bound to a now-superseded (stale) PLAN.md digest" {
  local slug="avpg-stale-plan"
  git -C "$CLAUDE_PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
    git -C "$CLAUDE_PROJECT_DIR" init -q
    git -C "$CLAUDE_PROJECT_DIR" -c user.email=test@example.com -c user.name=test commit -q --allow-empty -m init
  }
  local wave_dir="$CLAUDE_PROJECT_DIR/.planning/wave-$slug"
  mkdir -p "$wave_dir"
  cat > "$wave_dir/PLAN.md" <<'PLANEOF'
### Wave Class

- **Class**: HARNESS

### Spawn Table

| Role | Count | Reason |
|---|---|---|
| arch-testing | 1 | fixture |
PLANEOF
  local wvr_script="$BATS_TEST_DIRNAME/../sh/write-verdict-request.sh"
  local wv_script="$BATS_TEST_DIRNAME/../sh/write-verdict.sh"
  local req_out req_path req_sha256
  req_out="$(cd "$CLAUDE_PROJECT_DIR" && CLAUDE_WAVE_SLUG="$slug" bash "$wvr_script" --role arch-testing --phase prep --slug "$slug")"
  req_path="$(printf '%s' "$req_out" | awk '{print $1}')"
  req_sha256="$(printf '%s' "$req_out" | awk '{print $2}')"
  bash -c "cd '$CLAUDE_PROJECT_DIR' && printf 'reviewed' | CLAUDE_WAVE_SLUG='$slug' bash '$wv_script' --role arch-testing --phase prep --slug '$slug' --request '$req_path' --request-sha256 '$req_sha256' --decision approve" >/dev/null 2>&1

  # PLAN.md amended AFTER the PREP was approved -- real content change, real
  # divergent digest (never a fabricated hex), mirroring JSON-PREP-4's own
  # stale-plan construction.
  cat >> "$wave_dir/PLAN.md" <<'PLANEOF2'

Amended after PREP approval.
PLANEOF2

  make_input "APPROVE" "arch-testing"
  run_hook
  [ "$status" -eq 2 ]
}

@test "blocks arch-integration APPROVE when only a well-formed legacy Markdown verdict exists (real --publication-nonce compat writer) -- no fallback" {
  local slug="avpg-legacy-only"
  git -C "$CLAUDE_PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
    git -C "$CLAUDE_PROJECT_DIR" init -q
    git -C "$CLAUDE_PROJECT_DIR" -c user.email=test@example.com -c user.name=test commit -q --allow-empty -m init
  }
  local wave_dir="$CLAUDE_PROJECT_DIR/.planning/wave-$slug"
  mkdir -p "$wave_dir"
  cat > "$wave_dir/PLAN.md" <<'PLANEOF'
### Wave Class

- **Class**: HARNESS

### Spawn Table

| Role | Count | Reason |
|---|---|---|
| arch-integration | 1 | fixture |
PLANEOF
  local wv_script="$BATS_TEST_DIRNAME/../sh/write-verdict.sh"
  local nonce; nonce="$(node -e "process.stdout.write(require('crypto').randomBytes(16).toString('hex'))")"
  bash -c "cd '$CLAUDE_PROJECT_DIR' && CLAUDE_WAVE_SLUG='$slug' bash '$wv_script' --role arch-integration --phase prep --slug '$slug' --publication-nonce '$nonce'" >/dev/null 2>&1
  [ -f "$wave_dir/arch-integration-verdict.md" ] || return 1
  grep -q 'APPROVED-PREP' "$wave_dir/arch-integration-verdict.md" || return 1

  make_input "APPROVE" "arch-integration"
  run_hook
  [ "$status" -eq 2 ]
}
