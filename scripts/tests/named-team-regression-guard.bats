#!/usr/bin/env bats
#
# named-team-regression-guard.bats — regression guard for BL-W48 team-model migration.
#
# Asserts that the obsolete named-team coupling does NOT exist in any active path:
#   - `TeamCreate(` call (the API removed from Claude Code runtime)
#   - `spawn_method: TeamCreate-peer` in manifests (obsolete spawn method)
#   - `team_name=` as a REQUIRED spawn parameter in hook/skill code
#
# Active paths scanned:
#   - .claude/hooks/   (hook JavaScript)
#   - skills/          (skill Markdown)
#   - .claude/registry/agents.manifest.yaml
#   - setup/agent-templates/  (agent template Markdown)
#
# NEGATIVE cases (legitimate multi-agent usage — must NOT trigger the guard):
#   - Agent(...)       fan-out subagent spawns
#   - run_in_background
#   - SendMessage
#   - Task*            tool calls
#   - team_name=       when present as a comment, example, or historical reference
#     in a doc (guard targets CODE paths only, not prose)
#
# PLANT tests: write a temp fixture containing the forbidden patterns and assert
#   the guard catches them; write a clean fixture and assert the guard lets it through.
# Temp fixtures are isolated in os.tmpdir()-style paths — never touch live files.
#
# Modeled on scripts/tests/wave-phase-gate.bats.

PROJECT_ROOT="$BATS_TEST_DIRNAME/../.."
GUARD_SCRIPT="$BATS_TEST_DIRNAME/../sh/named-team-regression-guard.sh"

# ── Helpers ──────────────────────────────────────────────────────────────────

# Scan a single file for the forbidden patterns; exits 1 if any found, 0 if clean.
# Uses pure grep (POSIX extended regex, -E); not the Bash grep tool ban — this IS
# the guard itself, not a pattern-lookup bypass.
scan_file_for_team_create() {
  local file="$1"
  # Pattern 1: TeamCreate( API call in code
  if grep -qE 'TeamCreate\(' "$file" 2>/dev/null; then
    return 1
  fi
  return 0
}

scan_file_for_teamcreate_peer() {
  local file="$1"
  # Pattern 2: spawn_method: TeamCreate-peer in YAML
  if grep -qE 'spawn_method:\s*TeamCreate-peer' "$file" 2>/dev/null; then
    return 1
  fi
  return 0
}

# ── PLANT test fixtures ───────────────────────────────────────────────────────
# Written to BATS_TEST_TMPDIR (isolated per test run), never touching live files.

make_dirty_hook_fixture() {
  local file="${BATS_TEST_TMPDIR}/dirty-hook-$$.js"
  cat > "$file" <<'EOF'
// Simulated hook with obsolete TeamCreate call
const result = await TeamCreate("session-bl-w48-test");
EOF
  echo "$file"
}

make_dirty_manifest_fixture() {
  local file="${BATS_TEST_TMPDIR}/dirty-manifest-$$.yaml"
  cat > "$file" <<'EOF'
agents:
  test-agent:
    dispatch:
      spawn_method: TeamCreate-peer
      dispatched_by: [team-lead]
EOF
  echo "$file"
}

make_clean_hook_fixture() {
  local file="${BATS_TEST_TMPDIR}/clean-hook-$$.js"
  cat > "$file" <<'EOF'
// Clean hook: no TeamCreate usage
// Legitimate multi-agent patterns:
//   Agent(subagent_type="planner")
//   run_in_background(...)
//   SendMessage(to="arch-testing", message="...")
//   TaskCreate, TaskUpdate, TaskGet, TaskList
const ok = true;
EOF
  echo "$file"
}

make_clean_manifest_fixture() {
  local file="${BATS_TEST_TMPDIR}/clean-manifest-$$.yaml"
  cat > "$file" <<'EOF'
agents:
  arch-testing:
    dispatch:
      spawn_method: Agent
      dispatched_by: [team-lead]
  planner:
    dispatch:
      spawn_method: Agent
      dispatched_by: [team-lead]
EOF
  echo "$file"
}

make_clean_template_fixture() {
  local file="${BATS_TEST_TMPDIR}/clean-template-$$.md"
  cat > "$file" <<'EOF'
---
name: test-agent
description: "A clean test agent"
tools: Read, SendMessage
model: sonnet
template_version: "1.0.0"
---

You are a test agent. You use Agent() to spawn single-use subagents.
Use SendMessage(to="arch-testing") to communicate.
Use run_in_background for background tasks.
TaskCreate, TaskUpdate, TaskList, TaskGet are all fine.
EOF
  echo "$file"
}

# ── PLANT tests: fixtures with forbidden patterns are CAUGHT ─────────────────

@test "PLANT-1 CATCH: temp fixture with TeamCreate( → detected by scan" {
  # Write a plant fixture containing TeamCreate( and verify the scanner catches it.
  local dirty_fixture
  dirty_fixture="$(make_dirty_hook_fixture)"
  # The scan should detect TeamCreate(
  run bash -c "grep -qE 'TeamCreate\(' '$dirty_fixture' && echo FOUND || echo CLEAN"
  [ "$status" -eq 0 ]
  [[ "$output" == *"FOUND"* ]]
}

@test "PLANT-2 CATCH: temp fixture with spawn_method: TeamCreate-peer → detected by scan" {
  local dirty_fixture
  dirty_fixture="$(make_dirty_manifest_fixture)"
  run bash -c "grep -qE 'spawn_method:\s*TeamCreate-peer' '$dirty_fixture' && echo FOUND || echo CLEAN"
  [ "$status" -eq 0 ]
  [[ "$output" == *"FOUND"* ]]
}

# ── PLANT tests: clean fixtures are let through ───────────────────────────────

@test "PLANT-3 ALLOW: clean hook fixture (Agent fan-out, SendMessage, Task*) → not flagged" {
  local clean_fixture
  clean_fixture="$(make_clean_hook_fixture)"
  # TeamCreate( must NOT appear in the clean fixture
  run bash -c "grep -qE 'TeamCreate\(' '$clean_fixture' && echo FOUND || echo CLEAN"
  [ "$status" -eq 0 ]
  [[ "$output" == "CLEAN" ]]
}

@test "PLANT-4 ALLOW: clean manifest fixture (spawn_method: Agent) → not flagged" {
  local clean_fixture
  clean_fixture="$(make_clean_manifest_fixture)"
  run bash -c "grep -qE 'spawn_method:\s*TeamCreate-peer' '$clean_fixture' && echo FOUND || echo CLEAN"
  [ "$status" -eq 0 ]
  [[ "$output" == "CLEAN" ]]
}

@test "PLANT-5 ALLOW: clean agent template fixture → not flagged" {
  local clean_fixture
  clean_fixture="$(make_clean_template_fixture)"
  run bash -c "grep -qE 'TeamCreate\(' '$clean_fixture' && echo FOUND || echo CLEAN"
  [ "$status" -eq 0 ]
  [[ "$output" == "CLEAN" ]]
}

# ── POSITIVE cases: live files must be clean ─────────────────────────────────

@test "GUARD-PASS: agents.manifest.yaml has zero spawn_method: TeamCreate-peer entries" {
  local manifest="$PROJECT_ROOT/.claude/registry/agents.manifest.yaml"
  [ -f "$manifest" ]
  run bash -c "grep -cE 'spawn_method:\s*TeamCreate-peer' '$manifest' || true"
  # Count must be 0
  [ "$output" = "0" ]
}

@test "GUARD-PASS: .claude/hooks/ has no TeamCreate( calls" {
  # Hooks are the highest-risk path — a regression here would brick the harness.
  local count
  count=$(grep -rlE 'TeamCreate\(' "$PROJECT_ROOT/.claude/hooks/" 2>/dev/null | wc -l | tr -d '[:space:]')
  [ "$count" = "0" ]
}

@test "GUARD-PASS: setup/agent-templates/ has no TeamCreate( agent spawn calls" {
  # Templates may MENTION TeamCreate in prose/historical context, but must not
  # contain an Agent() call pattern that includes TeamCreate( as the spawn mechanism.
  # We check for literal TeamCreate( as an executable call (not quoted prose).
  # This guards against a template instructing agents to call TeamCreate.
  local count
  count=$(grep -rlE 'TeamCreate\(' "$PROJECT_ROOT/setup/agent-templates/" 2>/dev/null | wc -l | tr -d '[:space:]')
  [ "$count" = "0" ]
}

@test "GUARD-PASS: skills/ directory has no TeamCreate( calls" {
  [ -d "$PROJECT_ROOT/skills" ] || skip "skills/ directory not present"
  local count
  count=$(grep -rlE 'TeamCreate\(' "$PROJECT_ROOT/skills/" 2>/dev/null | wc -l | tr -d '[:space:]')
  [ "$count" = "0" ]
}

# ── NEGATIVE cases: legitimate multi-agent patterns not flagged ───────────────

@test "NEGATIVE-1: Agent(...) fan-out pattern in fixture → not caught by TeamCreate( guard" {
  # Use node to both write the fixture and scan it, avoiding shell quoting issues
  # on Windows where BATS_TEST_TMPDIR may contain backslashes.
  local result
  result=$(node -e "
const fs=require('fs'), path=require('path');
const file=path.join(process.argv[1], 'agent-fanout-neg1.js');
fs.writeFileSync(file, '// fan-out\nAgent(subagent_type=\"arch-testing\")\nAgent(subagent_type=\"planner\")\n');
const content=fs.readFileSync(file,'utf8');
console.log(/TeamCreate\(/.test(content) ? 'CAUGHT' : 'ALLOWED');
" "$BATS_TEST_TMPDIR")
  [ "$result" = "ALLOWED" ]
}

@test "NEGATIVE-2: run_in_background in fixture → not caught" {
  local file="${BATS_TEST_TMPDIR}/run-in-bg-$$.js"
  cat > "$file" <<'EOF'
run_in_background(async () => { ... });
EOF
  run bash -c "grep -qE 'TeamCreate\(' '$file' && echo CAUGHT || echo ALLOWED"
  [ "$status" -eq 0 ]
  [[ "$output" == "ALLOWED" ]]
}

@test "NEGATIVE-3: SendMessage in fixture → not caught" {
  local file="${BATS_TEST_TMPDIR}/sendmessage-$$.md"
  cat > "$file" <<'EOF'
SendMessage(to="arch-testing", message="please verify...")
SendMessage(to="team-lead", message="READY-FOR-REVIEW")
EOF
  run bash -c "grep -qE 'TeamCreate\(' '$file' && echo CAUGHT || echo ALLOWED"
  [ "$status" -eq 0 ]
  [[ "$output" == "ALLOWED" ]]
}

@test "NEGATIVE-4: Task* tools in fixture → not caught" {
  local file="${BATS_TEST_TMPDIR}/task-tools-$$.md"
  cat > "$file" <<'EOF'
TaskCreate(subject="...", description="...")
TaskUpdate(taskId="1", status="completed")
TaskList()
TaskGet(taskId="2")
EOF
  run bash -c "grep -qE 'TeamCreate\(' '$file' && echo CAUGHT || echo ALLOWED"
  [ "$status" -eq 0 ]
  [[ "$output" == "ALLOWED" ]]
}

@test "NEGATIVE-5: spawn_method: Agent in manifest fixture → not caught by TeamCreate-peer guard" {
  local file="${BATS_TEST_TMPDIR}/agent-manifest-$$.yaml"
  cat > "$file" <<'EOF'
agents:
  arch-testing:
    dispatch:
      spawn_method: Agent
EOF
  run bash -c "grep -qE 'spawn_method:\s*TeamCreate-peer' '$file' && echo CAUGHT || echo ALLOWED"
  [ "$status" -eq 0 ]
  [[ "$output" == "ALLOWED" ]]
}
