#!/usr/bin/env bats
#
# Smoke tests for scripts/sh/generate-template.sh — the bash wrapper around
# mcp-server/build/cli/generate-template.js.
#
# Pattern: mirrors architect-bash-write-gate.bats (W31.7 Phase 2 PR #73).
# Location: scripts/tests/ (not scripts/tests/sh/).

SCRIPT="$BATS_TEST_DIRNAME/../sh/generate-template.sh"
PS1_SCRIPT="$BATS_TEST_DIRNAME/../ps1/generate-template.ps1"
REAL_PROJECT_ROOT="$BATS_TEST_DIRNAME/../.."
TMP_DIR="${BATS_TEST_TMPDIR:-/tmp}/gen-template-smoke-$$"

# ── Helpers ──────────────────────────────────────────────────────────────────

# Build a minimal synthetic project under the REAL project root's build so the
# wrapper can locate node + the already-built CLI. We pass PROJECT_ROOT
# explicitly via --project-root so detect_project_root() uses our synthetic
# root, but the CLI binary is pulled from the real build.
#
# Strategy: create a synthetic tmpdir with the required layout, then invoke
# the CLI directly via node (bypassing the bash wrapper's project-root
# detection) for most tests. For wrapper-level tests we pass --project-root.

REAL_CLI="$REAL_PROJECT_ROOT/mcp-server/build/cli/generate-template.js"

# Build a minimal synthetic project.  Prints the project root path.
make_project() {
  local name="$1"
  local root="$TMP_DIR/proj-$RANDOM"
  mkdir -p "$root/.claude/registry"
  mkdir -p "$root/setup/agent-templates"
  mkdir -p "$root/.claude/agents"

  cat > "$root/.claude/registry/agents.manifest.yaml" <<YAML
manifest:
  version: 1
  generated_at: "2026-04-27"
categories: [core-specialist]
lifecycles: [persistent]
invariants: []
agents:
  ${name}:
    canonical_name: ${name}
    subagent_type: ${name}
    template_version: "1.0.0"
    category: core-specialist
    lifecycle: persistent
    description: "${name} description"
    runtime:
      model: sonnet
    tools:
      allowed:
        - Read
        - SendMessage
    dispatch:
      spawn_method: TeamCreate-peer
      dispatched_by: [team-lead]
      can_dispatch_to: []
      can_send_to: []
YAML

  local desc="${name} description"
  {
    echo '---'
    echo "name: ${name}"
    echo "description: \"${desc}\""
    echo 'tools: Read, SendMessage'
    echo 'model: sonnet'
    echo 'template_version: "1.0.0"'
    echo '---'
    echo ''
    echo 'Body content.'
    echo ''
  } > "$root/setup/agent-templates/${name}.md"
  cp "$root/setup/agent-templates/${name}.md" "$root/.claude/agents/${name}.md"

  echo "$root"
}

# Build a project whose template has scrambled frontmatter order (drift).
make_drifted_project() {
  local name="$1"
  local root
  root=$(make_project "$name")
  local desc="${name} description"
  # Scrambled: template_version first, name last.
  {
    echo '---'
    echo 'template_version: "1.0.0"'
    echo 'model: sonnet'
    echo 'tools: Read, SendMessage'
    echo "description: \"${desc}\""
    echo "name: ${name}"
    echo '---'
    echo ''
    echo 'Body content.'
    echo ''
  } > "$root/setup/agent-templates/${name}.md"
  cp "$root/setup/agent-templates/${name}.md" "$root/.claude/agents/${name}.md"
  echo "$root"
}

# Run the CLI directly via node (avoids bash wrapper project-root detection).
run_cli() {
  run node "$REAL_CLI" "$@"
}

setup() {
  mkdir -p "$TMP_DIR"
}

teardown() {
  rm -rf "$TMP_DIR" 2>/dev/null || true
}

# ── Script existence + parity ─────────────────────────────────────────────────

@test "generate-template.sh exists and is executable" {
  [ -f "$SCRIPT" ]
  [ -x "$SCRIPT" ]
}

@test "generate-template.ps1 exists" {
  [ -f "$PS1_SCRIPT" ]
}

# ── --help ────────────────────────────────────────────────────────────────────

@test "--help exits 0 and prints usage (via bash wrapper)" {
  run bash "$SCRIPT" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"generate-template"* ]]
}

@test "--help exits 0 and prints usage (via CLI directly)" {
  run_cli --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"generate-template"* ]]
}

# ── Error cases (CLI direct) ──────────────────────────────────────────────────

@test "missing agent-name and no --all exits 2" {
  local root
  root=$(make_project "test-specialist")
  run_cli "$root"
  [ "$status" -eq 2 ]
}

@test "unknown agent name exits 2" {
  local root
  root=$(make_project "test-specialist")
  run_cli "totally-unknown-agent-xyz" "$root"
  [ "$status" -eq 2 ]
}

# ── --check mode ──────────────────────────────────────────────────────────────

@test "--check exits 1 on drifted (scrambled) frontmatter" {
  local root
  root=$(make_drifted_project "test-specialist")
  run_cli "test-specialist" "$root" --check
  [ "$status" -eq 1 ]
}

@test "--check exits 0 after write-mode canonicalizes the template" {
  local root
  root=$(make_drifted_project "test-specialist")
  # Repair pass (write mode).
  node "$REAL_CLI" "test-specialist" "$root"
  # Now check should find no drift.
  run_cli "test-specialist" "$root" --check
  [ "$status" -eq 0 ]
}

# ── Write mode ────────────────────────────────────────────────────────────────

@test "default write mode exits 0" {
  local root
  root=$(make_project "test-specialist")
  run_cli "test-specialist" "$root"
  [ "$status" -eq 0 ]
}

@test "after write mode, template and mirror files are byte-identical" {
  local root
  root=$(make_project "test-specialist")
  node "$REAL_CLI" "test-specialist" "$root"
  cmp --silent \
    "$root/setup/agent-templates/test-specialist.md" \
    "$root/.claude/agents/test-specialist.md"
}

@test "write mode is idempotent (second --check exits 0)" {
  local root
  root=$(make_project "test-specialist")
  node "$REAL_CLI" "test-specialist" "$root"
  run_cli "test-specialist" "$root" --check
  [ "$status" -eq 0 ]
}
