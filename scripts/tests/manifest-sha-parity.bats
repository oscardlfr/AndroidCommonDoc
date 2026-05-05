#!/usr/bin/env bats
#
# Tests that agent template SHAs in agents.manifest.yaml stay in sync with
# setup/agent-templates/. Any uncommitted edit to a template file without a
# corresponding manifest rehash should be detectable via agent-spawn-validator.js.
#
# Scenarios (from BL-W42 PR3 PLAN):
#   1. Clean tree post-rehash → PASS
#   2. Dirty template (printf "x" >> ...) without rehash → FAIL (drift detected)
#   3. After revert → PASS

PROJECT_ROOT="$BATS_TEST_DIRNAME/../.."
VALIDATOR="$PROJECT_ROOT/mcp-server/build/cli/agent-spawn-validator.js"
TEMPLATE="$PROJECT_ROOT/setup/agent-templates/toolkit-specialist.md"
MANIFEST="$PROJECT_ROOT/.claude/registry/agents.manifest.yaml"

setup_file() {
  if [ ! -f "$VALIDATOR" ]; then
    (cd "$PROJECT_ROOT/mcp-server" && npm ci --silent && npm run build --silent) > /dev/null 2>&1
  fi
}

@test "clean tree: agent-spawn-validator sees no SHA drift" {
  run node "$VALIDATOR" --check-sha-parity "$PROJECT_ROOT" 2>&1
  [ "$status" -eq 0 ]
}

@test "dirty template: agent-spawn-validator detects SHA drift" {
  # Append one byte to a tracked template without rehashing
  printf "x" >> "$TEMPLATE"

  run node "$VALIDATOR" --check-sha-parity "$PROJECT_ROOT" 2>&1
  local exit_code=$status

  # Always revert before asserting so teardown is clean
  git -C "$PROJECT_ROOT" checkout -- "$TEMPLATE"

  [ "$exit_code" -ne 0 ]
}

@test "reverted template: agent-spawn-validator sees no SHA drift after revert" {
  run node "$VALIDATOR" --check-sha-parity "$PROJECT_ROOT" 2>&1
  [ "$status" -eq 0 ]
}
