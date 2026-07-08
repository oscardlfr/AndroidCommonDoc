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

# ── BL-W4-3: Check 4 bash-3.2-safe rewrite (declare -A -> indexed-array lookup) ──
#
# validate-agent-templates.sh L307/L320-321 used `declare -A TOOL_PATTERNS=(...)` +
# `${!TOOL_PATTERNS[@]}` — Bash-4+-only constructs. This Mac's only /bin/bash is
# 3.2.57, so under `set -euo pipefail` Check 4 aborted outright (the existing "Check 4:
# backtick-wrapped Agent() in body does NOT trigger xref WARN" test above is part of
# that abort and is expected to flip green with this fix — see delta-honest
# reconciliation in the wave report, not re-tested here).

@test "Check 4: tool referenced in body but absent from frontmatter tools triggers xref WARN (positive detection, BL-W4-3)" {
  local tdir="${BATS_TEST_TMPDIR:-/tmp}/vat-xref-warn-$$"
  local tfile="$tdir/agent-templates/agent-a.md"
  mkdir -p "$tdir/agent-templates"

  # Template declares tools: Read (no Write) but body genuinely calls Write(...) in
  # plain prose — not backticked, not inside a WRONG/NEVER/FORBIDDEN/example guard.
  # This MUST still trigger the xref WARN under the rewritten bash-3.2-safe lookup,
  # proving the rewrite still DETECTS mismatches (not merely that it no longer aborts).
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

Call Write(file_path, content) directly to persist results to disk.
EOF

  run bash "$SCRIPT" \
    --templates-dir "$tdir/agent-templates" \
    --check "tool-body-xref" \
    --show-details

  [ "$status" -eq 0 ]
  # Non-final [[ ]] does not abort a bats test body on failure (bash/bats quirk,
  # verified empirically in this repo) — `|| return 1` restores correct abort-on-fail.
  [[ "$output" == *"[WARN]"* ]] || return 1
  [[ "$output" == *"references 'Write' but not in frontmatter tools"* ]] || return 1
}

@test "STATIC GUARD: validate-agent-templates.sh contains no 'declare -A' (bash 3.2 safety, BL-W4-3 — sole CI backstop)" {
  # CI (reusable-shell-tests.yml, ubuntu-latest) runs Bash 5.x, which supports
  # associative arrays natively — a reintroduced `declare -A` would pass CI silently.
  # This static guard is the ONLY check that would catch that regression; it is
  # load-bearing, not redundant with the functional WARN test above. Targets
  # `declare -A` specifically — indexed-array `${!arr[@]}` usage elsewhere in the file
  # is fine on bash 3.2 and must not be blanket-banned.
  #
  # Comment-only lines are excluded: the fix's own explanatory comment legitimately
  # names "declare -A" in prose to document what was removed/avoided, which would
  # otherwise false-positive a bare substring grep.
  ! grep -vE '^[[:space:]]*#' "$SCRIPT" | grep -q 'declare -A'
}
