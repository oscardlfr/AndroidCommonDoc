#!/usr/bin/env bats
#
# Tests for .claude/hooks/agent-spawn-validator.js (Phase 4 sub-deliverable 2).
# Validates that agent spawns with subagent_type matching the manifest baseline
# pass through, while unknown subagent_type values and frontmatter drift are
# blocked. Modeled on scripts/tests/architect-bash-write-gate.bats.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/agent-spawn-validator.js"
PROJECT_ROOT="$BATS_TEST_DIRNAME/../.."
INPUT_FILE="${BATS_TEST_TMPDIR:-/tmp}/agent-spawn-input-$$.json"

setup_file() {
  if [ ! -f "$PROJECT_ROOT/mcp-server/build/cli/generate-template.js" ]; then
    (cd "$PROJECT_ROOT/mcp-server" && npm ci --silent && npm run build --silent) > /dev/null 2>&1
  fi
}

# JSON envelope builder. Args: <tool_name> <subagent_type | "">
make_input() {
  local tool="$1" sub="${2-}"
  python3 - "$tool" "$sub" "$INPUT_FILE" <<'PYEOF'
import json, sys
tool, sub, path = sys.argv[1], sys.argv[2], sys.argv[3]
payload = {"tool_name": tool, "tool_input": {}}
if sub:
    payload["tool_input"]["subagent_type"] = sub
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f)
PYEOF
}

run_hook() {
  run bash -c "cd '$PROJECT_ROOT' && cat '$INPUT_FILE' | node '$HOOK'"
}

# ── Allow scenarios ─────────────────────────────────────────────────────────

@test "allows valid manifest agent (advisor)" {
  make_input "Task" "advisor"
  run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "allows valid manifest agent via Agent tool name" {
  make_input "Agent" "researcher"
  run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "allows spawn without subagent_type (default agent)" {
  make_input "Task" ""
  run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "allows scaffold-exempt agent (feature-domain-specialist with skip:true)" {
  make_input "Task" "feature-domain-specialist"
  run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "passes through non-Task/Agent tools (Bash)" {
  # tool_input is irrelevant — hook only checks tool_name; use empty payload
  make_input "Bash" ""
  run_hook
  [ "$status" -eq 0 ]
}

@test "passes through non-Task/Agent tools (Read)" {
  make_input "Read" ""
  run_hook
  [ "$status" -eq 0 ]
}

# ── Block scenarios ─────────────────────────────────────────────────────────

@test "blocks unknown subagent_type" {
  make_input "Task" "definitely-not-a-real-agent-xyz"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"not found"* ]]
  [[ "$output" == *"definitely-not-a-real-agent-xyz"* ]]
  [[ "$output" == *"\"decision\":\"block\""* ]]
}

@test "blocks unknown subagent_type with helpful agent list in reason" {
  make_input "Task" "garbage"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"Known agents:"* ]]
}

@test "blocks frontmatter drift (template SHA-256 ≠ manifest baseline)" {
  cp "$PROJECT_ROOT/setup/agent-templates/advisor.md" "$BATS_TEST_TMPDIR/advisor-original.md"
  sed -i 's/^domain: development/domain: testing/' "$PROJECT_ROOT/setup/agent-templates/advisor.md"

  make_input "Task" "advisor"
  run_hook

  # Restore BEFORE asserting so a failed test doesn't leave the repo dirty.
  cp "$BATS_TEST_TMPDIR/advisor-original.md" "$PROJECT_ROOT/setup/agent-templates/advisor.md"

  [ "$status" -eq 2 ]
  [[ "$output" == *"drifted from the manifest baseline"* ]]
  [[ "$output" == *"Baseline:"* ]]
  [[ "$output" == *"Computed:"* ]]
  [[ "$output" == *"--update-manifest-hash"* ]]
}

# ── Fail-open scenarios (validator must NEVER block due to its own bugs) ────

@test "fails open on malformed JSON input" {
  echo "not-valid-json" > "$INPUT_FILE"
  run_hook
  [ "$status" -eq 0 ]
}

@test "fails open on empty input" {
  : > "$INPUT_FILE"
  run_hook
  [ "$status" -eq 0 ]
}

@test "fails open when manifest file is missing" {
  # Move manifest temporarily; the hook must allow rather than crash.
  mv "$PROJECT_ROOT/.claude/registry/agents.manifest.yaml" "$BATS_TEST_TMPDIR/manifest.bak"
  make_input "Task" "advisor"
  run_hook
  mv "$BATS_TEST_TMPDIR/manifest.bak" "$PROJECT_ROOT/.claude/registry/agents.manifest.yaml"
  [ "$status" -eq 0 ]
}

@test "fails open when template file is missing" {
  mv "$PROJECT_ROOT/setup/agent-templates/advisor.md" "$BATS_TEST_TMPDIR/advisor.bak"
  make_input "Task" "advisor"
  run_hook
  mv "$BATS_TEST_TMPDIR/advisor.bak" "$PROJECT_ROOT/setup/agent-templates/advisor.md"
  [ "$status" -eq 0 ]
}
