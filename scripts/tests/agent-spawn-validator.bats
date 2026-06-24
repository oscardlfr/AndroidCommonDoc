#!/usr/bin/env bats
#
# Tests for .claude/hooks/agent-spawn-validator.js (BL-W48 team-model migration).
# The manifest is now a DRIFT REGISTRY for L0 agents, NOT a closed roster:
#   Check 1 INVERTED: types absent from the manifest PASS (harness-native or any
#     valid agent the runtime offers — e.g. Explore, Plan, general-purpose).
#   Check 2 (drift guard): manifest-listed types with template_frontmatter_sha256
#     still SHA-256 checked; mismatch → block.
#   Check 3 REMOVED: TeamCreate-peer team_name/name enforcement is gone.
#     team_name is deprecated/ignored.
#   Narrow stale-suffix guard RESTORED: canonical core roles may not respawn as
#     stale `-2` / `-N` variants.
#
# DELETED cases (removed behavior — NOT changed behavior):
#   SS-A  (canonical-suffix name arch-testing-2 allows silently) — restored as
#         a narrow BLOCK for core roles in H2.
#   SS-C1 (suffix-but-unknown-base foo-specialist-2 emits WARN, exits 0)
#   SS-C2 (free-name free-agent-name emits WARN, exits 0)
#   SS-REG (TeamCreate-peer without team_name/name blocked — regression guard)
#   CR6   subsection (STALE_SUFFIX_ENFORCE=1 block + foreign-base WARN cases)
#   "Check 3: arch-platform without team_name blocked"
#   "blocks unknown subagent_type" + "blocks unknown subagent_type with helpful agent list"
#
# Modeled on scripts/tests/architect-bash-write-gate.bats.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/agent-spawn-validator.js"
PROJECT_ROOT="$BATS_TEST_DIRNAME/../.."
INPUT_FILE="${BATS_TEST_TMPDIR:-/tmp}/agent-spawn-input-$$.json"

setup_file() {
  if [ ! -f "$PROJECT_ROOT/mcp-server/build/cli/generate-template.js" ]; then
    (cd "$PROJECT_ROOT/mcp-server" && npm ci --silent && npm run build --silent) > /dev/null 2>&1
  fi
}

# JSON envelope builder. Args: <tool_name> <subagent_type | ""> [team_name] [name]
make_input() {
  local tool="$1" sub="${2-}" team_name="${3-}" agent_name="${4-}"
  python3 - "$tool" "$sub" "$team_name" "$agent_name" "$INPUT_FILE" <<'PYEOF'
import json, sys
tool, sub, team_name, agent_name, path = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
payload = {"tool_name": tool, "tool_input": {}}
if sub:
    payload["tool_input"]["subagent_type"] = sub
if team_name:
    payload["tool_input"]["team_name"] = team_name
if agent_name:
    payload["tool_input"]["name"] = agent_name
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

# ── BL-W48 Check-1 inversion: harness-native types now PASS ─────────────────
# The manifest is a drift registry, NOT a closed roster. Types absent from it
# are harness-native (Explore / Plan / general-purpose) or any valid runtime
# agent — multi-agent capability must NOT be gated by L0 membership.

@test "BL-W48: Explore (harness-native, not in manifest) → PASS (Check 1 inverted)" {
  make_input "Agent" "Explore"
  run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "BL-W48: Plan (harness-native, not in manifest) → PASS (Check 1 inverted)" {
  make_input "Agent" "Plan"
  run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "BL-W48: general-purpose (harness-native, not in manifest) → PASS (Check 1 inverted)" {
  make_input "Agent" "general-purpose"
  run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "BL-W48: arch-platform without team_name → PASS (Check 3 removed)" {
  # Old behavior: blocked unless team_name+name supplied (TeamCreate-peer).
  # New behavior: team_name is deprecated/ignored; bare Agent() spawn PASSES.
  make_input "Agent" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
  # No block output
  [[ "$output" != *'"decision":"block"'* ]]
}

@test "BL-W48: arch-testing without team_name → PASS (Check 3 removed)" {
  make_input "Agent" "arch-testing"
  run_hook
  [ "$status" -eq 0 ]
  [[ "$output" != *'"decision":"block"'* ]]
}

@test "BL-W48: arch-integration without team_name → PASS (Check 3 removed)" {
  make_input "Agent" "arch-integration"
  run_hook
  [ "$status" -eq 0 ]
  [[ "$output" != *'"decision":"block"'* ]]
}

@test "BL-W48: planner without team_name → PASS (Check 3 removed)" {
  make_input "Agent" "planner"
  run_hook
  [ "$status" -eq 0 ]
  [[ "$output" != *'"decision":"block"'* ]]
}

@test "H2: blocks stale suffixed architect role arch-platform-2" {
  make_input "Agent" "arch-platform-2"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
  [[ "$output" == *"Stale suffixed core role spawn blocked"* ]]
  [[ "$output" == *"Canonical role: arch-platform"* ]]
  [[ "$output" == *'$HOME/.claude/teams/'* ]]
}

@test "H2: blocks multi-digit stale suffixed architect role arch-platform-10" {
  make_input "Agent" "arch-platform-10"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
  [[ "$output" == *"Stale suffixed core role spawn blocked"* ]]
  [[ "$output" == *"Canonical role: arch-platform"* ]]
}

@test "H2: blocks stale suffixed core orchestrator quality-gater-9" {
  make_input "Agent" "quality-gater-9"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"Canonical role: quality-gater"* ]]
}

@test "H2: allows unknown suffixed runtime role because manifest is not a closed roster" {
  make_input "Agent" "foo-specialist-2"
  run_hook
  [ "$status" -eq 0 ]
  [[ "$output" != *'"decision":"block"'* ]]
}

@test "H2: allows non-core manifest base with numeric suffix" {
  make_input "Agent" "advisor-2"
  run_hook
  [ "$status" -eq 0 ]
  [[ "$output" != *'"decision":"block"'* ]]
}

# ── Block scenarios (only drift remains) ─────────────────────────────────────

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

# ── Check 2 still active: manifest-listed agents get drift-checked ───────────
# An agent listed in the manifest with a template_frontmatter_sha256 baseline
# must pass the SHA check regardless of whether team_name is supplied.

@test "manifest agent with team_name supplied still passes when SHA matches" {
  # team_name is accepted/ignored; the SHA check still runs and should PASS.
  make_input "Agent" "arch-platform" "session-test" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
}

@test "manifest agent with no dispatch key in manifest passes through (fail-open)" {
  # Agent with no template_frontmatter_sha256 baseline → no drift check → allow.
  local tmp_root="$BATS_TEST_TMPDIR/fake-root"
  mkdir -p "$tmp_root/.claude/registry"
  mkdir -p "$tmp_root/mcp-server/node_modules"
  # Symlink the real yaml module so the hook can load it
  ln -sfn "$PROJECT_ROOT/mcp-server/node_modules/yaml" "$tmp_root/mcp-server/node_modules/yaml"
  cat > "$tmp_root/.claude/registry/agents.manifest.yaml" <<'YAML'
manifest:
  version: 1
agents:
  test-no-dispatch:
    canonical_name: test-no-dispatch
    subagent_type: test-no-dispatch
    template_frontmatter_sha256: skip
YAML
  python3 - "Agent" "test-no-dispatch" "$INPUT_FILE" <<'PYEOF'
import json, sys
tool, sub, path = sys.argv[1], sys.argv[2], sys.argv[3]
payload = {"tool_name": tool, "tool_input": {"subagent_type": sub}}
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f)
PYEOF
  run bash -c "cd '$tmp_root' && CLAUDE_PROJECT_DIR='$tmp_root' cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}
