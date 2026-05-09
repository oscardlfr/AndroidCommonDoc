#!/usr/bin/env bats
#
# Tests for scripts/sh/validate-agent-templates.sh — Check 7 (version tuple lookup).
# Covers the BL-W44-S2 regression fix: jq/python3 tuple lookup prevents
# substring false-positive where version exists for a different agent.

export KMP_TEST_RUNNER_BYPASS=1

SCRIPT="$BATS_TEST_DIRNAME/../sh/validate-agent-templates.sh"

# ── Fixture helpers ───────────────────────────────────────────────────────────

# Build a fake agent-templates dir with MIGRATIONS.json and one template file.
#   make_fixtures <tmpdir> <agent_name> <template_version>
# MIGRATIONS.json always contains:
#   agent-a → 1.0.0
#   agent-b → 2.0.0
# The template file uses the supplied agent_name + template_version.
make_fixtures() {
  local dir="$1" agent_name="$2" template_version="$3"
  # The script checks for `agent-templates` in the path — use that as dirname.
  local tdir="$dir/agent-templates"
  mkdir -p "$tdir"

  # MIGRATIONS.json: agent-a owns 1.0.0, agent-b owns 2.0.0
  python3 - "$tdir/MIGRATIONS.json" <<'PYEOF'
import json, sys
data = {
    "templates": {
        "agent-a": {"1.0.0": {"desc": "initial"}},
        "agent-b": {"2.0.0": {"desc": "initial"}}
    }
}
with open(sys.argv[1], "w") as f:
    json.dump(data, f)
PYEOF

  # Minimal valid template file
  cat > "$tdir/agent-a.md" <<EOF
---
name: $agent_name
description: Test agent
tools: Read
model: claude-opus-4-5
token_budget: 10000
template_version: $template_version
---

## Role

MANDATORY behavior. APPROVE or ESCALATE.

SendMessage to coordinator with results.
EOF
}

# ── Check 7: registered tuple → PASS ─────────────────────────────────────────

@test "Check 7: registered (name, version) tuple → PASS" {
  local tdir="${BATS_TEST_TMPDIR:-/tmp}/vat-pass-$$"
  make_fixtures "$tdir" "agent-a" "1.0.0"

  run bash "$SCRIPT" \
    --templates-dir "$tdir/agent-templates" \
    --check "version"

  # Should exit 0 (no errors)
  [ "$status" -eq 0 ]
  [[ "$output" == *"[OK]"* ]]
}

# ── Check 7: name registered, version missing → FAIL ─────────────────────────

@test "Check 7: agent name registered, version not registered → FAIL" {
  local tdir="${BATS_TEST_TMPDIR:-/tmp}/vat-ver-missing-$$"
  make_fixtures "$tdir" "agent-a" "9.9.9"

  run bash "$SCRIPT" \
    --templates-dir "$tdir/agent-templates" \
    --check "version"

  # Should exit non-zero (errors found)
  [ "$status" -ne 0 ]
  [[ "$output" == *"[FAIL]"* ]]
}

# ── Check 7: false-positive regression — version belongs to different agent ───

@test "Check 7: version exists for different agent → FAIL (no substring false-positive)" {
  local tdir="${BATS_TEST_TMPDIR:-/tmp}/vat-fp-$$"
  # agent-a template claims version 2.0.0 — that version exists in MIGRATIONS
  # but only for agent-b. Old substring grep would PASS; jq tuple must FAIL.
  make_fixtures "$tdir" "agent-a" "2.0.0"

  run bash "$SCRIPT" \
    --templates-dir "$tdir/agent-templates" \
    --check "version"

  # Must fail — (agent-a, 2.0.0) is not a registered tuple
  [ "$status" -ne 0 ]
  [[ "$output" == *"[FAIL]"* ]]
}

# ── Deferred-3: backtick-wrapped Agent() in body does NOT trigger xref WARN ───

@test "Check 4: backtick-wrapped Agent() in body does NOT trigger xref WARN" {
  local tdir="${BATS_TEST_TMPDIR:-/tmp}/vat-btick-$$"
  local tfile="$tdir/agent-templates/agent-a.md"
  mkdir -p "$tdir/agent-templates"

  # Template declares tools: Read (no Agent) but body mentions `Agent()` inside backticks.
  # After backtick strip, Agent( is gone → no xref mismatch.
  cat > "$tfile" <<'EOF'
---
name: agent-a
description: Test agent
tools: Read
model: claude-opus-4-5
token_budget: 10000
template_version: 1.0.0
---

## Role

Use `Agent()` to spawn sub-agents — this is only a prose reference inside backticks.
EOF

  run bash "$SCRIPT" \
    --templates-dir "$tdir/agent-templates" \
    --check "tool-body-xref"

  # Must exit 0 — backtick-wrapped Agent() must not produce WARN
  [ "$status" -eq 0 ]
  [[ "$output" != *"WARN"* ]] && [[ "$output" != *"references 'Agent'"* ]]
}

# ── Check 7: MIGRATIONS.json missing → graceful skip ─────────────────────────

@test "Check 7: MIGRATIONS.json missing → no error (graceful skip)" {
  local tdir="${BATS_TEST_TMPDIR:-/tmp}/vat-nomig-$$"
  make_fixtures "$tdir" "agent-a" "1.0.0"
  # Remove MIGRATIONS.json
  rm "$tdir/agent-templates/MIGRATIONS.json"

  run bash "$SCRIPT" \
    --templates-dir "$tdir/agent-templates" \
    --check "version"

  # Should exit 0 — no MIGRATIONS.json means version tuple check is skipped
  [ "$status" -eq 0 ]
  # Must NOT contain FAIL for the version check
  [[ "$output" != *"[FAIL]"* ]]
}
