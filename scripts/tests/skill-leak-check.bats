#!/usr/bin/env bats
#
# Tests for scripts/sh/skill-leak-check.sh — Level B analytics: skill leak detection.
# Style: mirrors scripts/tests/gradle-run.bats (BL-W44-S2).

export KMP_TEST_RUNNER_BYPASS=1

SCRIPT="$BATS_TEST_DIRNAME/../sh/skill-leak-check.sh"
PS1_SCRIPT="$BATS_TEST_DIRNAME/../ps1/skill-leak-check.ps1"

setup() {
  PROJECT_ROOT="${BATS_TEST_TMPDIR:-/tmp}/slc-test-$$"
  mkdir -p "$PROJECT_ROOT/.androidcommondoc"
  LOG_FILE="$PROJECT_ROOT/.androidcommondoc/tool-use-log.jsonl"
}

teardown() {
  rm -rf "${BATS_TEST_TMPDIR:-/tmp}/slc-test-$$" 2>/dev/null || true
}

# ── Script existence ──────────────────────────────────────────────────────────

@test "skill-leak-check.sh exists and is executable" {
  [ -f "$SCRIPT" ]
  [ -x "$SCRIPT" ]
}

@test "skill-leak-check.ps1 exists" {
  [ -f "$PS1_SCRIPT" ]
}

# ── PS1 parity ────────────────────────────────────────────────────────────────

@test "parity: skill-leak-check.ps1 delegates to skill-leak-check.sh" {
  grep -q "skill-leak-check.sh" "$PS1_SCRIPT"
}

# ── --help / -h ───────────────────────────────────────────────────────────────

@test "--help exits 0" {
  run bash "$SCRIPT" --help
  [ "$status" -eq 0 ]
}

@test "--help output contains usage information" {
  run bash "$SCRIPT" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"--project-root"* ]]
}

@test "-h exits 0" {
  run bash "$SCRIPT" -h
  [ "$status" -eq 0 ]
}

# ── Missing --project-root ────────────────────────────────────────────────────

@test "missing --project-root exits 1" {
  run bash "$SCRIPT"
  [ "$status" -eq 1 ]
}

@test "missing --project-root emits JSON error on stderr" {
  run bash "$SCRIPT"
  [ "$status" -eq 1 ]
  [[ "$stderr" == *'"error"'* ]] || [[ "${lines[*]}" == *'"error"'* ]]
}

@test "missing --project-root error message mentions --project-root" {
  run bash "$SCRIPT" 2>&1
  [[ "$output" == *"--project-root"* ]]
}

# ── Non-existent project-root ─────────────────────────────────────────────────

@test "non-existent project-root exits 1" {
  run bash "$SCRIPT" --project-root "/tmp/does-not-exist-$$"
  [ "$status" -eq 1 ]
}

@test "non-existent project-root emits JSON error on stderr" {
  run bash "$SCRIPT" --project-root "/tmp/does-not-exist-$$" 2>&1
  [[ "$output" == *'"error"'* ]]
}

# ── Unknown flag ──────────────────────────────────────────────────────────────

@test "unknown flag exits 1" {
  run bash "$SCRIPT" --unknown-flag
  [ "$status" -eq 1 ]
}

# ── No log file (clean project) ───────────────────────────────────────────────

@test "valid project-root with no log file exits 0" {
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT"
  [ "$status" -eq 0 ]
}

@test "valid project-root with no log file prints no-data message" {
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"No tool-use-log"* ]] || [[ "$output" == *"no data"* ]] || [[ "$output" == *"not found"* ]]
}

@test "no-log --json mode exits 0 with valid JSON" {
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'leaks' in d and 'leak_count' in d"
}

# ── Clean log (no leaks) ──────────────────────────────────────────────────────

@test "log with no Bash entries exits 0" {
  printf '%s\n' \
    '{"tool_name":"Read","input_summary":"some/file.kt","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    '{"tool_name":"Grep","input_summary":"some pattern","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    > "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT"
  [ "$status" -eq 0 ]
}

@test "clean Bash commands (no skill leak) exits 0" {
  printf '%s\n' \
    '{"tool_name":"Bash","input_summary":"echo hello","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    '{"tool_name":"Bash","input_summary":"ls -la","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    > "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT"
  [ "$status" -eq 0 ]
}

@test "clean Bash commands --json reports leak_count 0" {
  printf '%s\n' \
    '{"tool_name":"Bash","input_summary":"echo hello","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    > "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['leak_count'] == 0, d"
}

@test "clean Bash commands --json reports correct total_bash_calls" {
  printf '%s\n' \
    '{"tool_name":"Bash","input_summary":"echo hello","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    '{"tool_name":"Bash","input_summary":"ls -la","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    > "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['total_bash_calls'] == 2, d"
}

# ── Leak detection ────────────────────────────────────────────────────────────

@test "gradlew test command detected as leak exits 0" {
  printf '%s\n' \
    '{"tool_name":"Bash","input_summary":"./gradlew test","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    > "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT"
  [ "$status" -eq 0 ]
}

@test "gradlew test command leak detected in output" {
  printf '%s\n' \
    '{"tool_name":"Bash","input_summary":"./gradlew test","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    > "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"leak"* ]] || [[ "$output" == *"gradlew"* ]] || [[ "$output" == *"/test"* ]]
}

@test "gradlew test --json reports leak_count 1" {
  printf '%s\n' \
    '{"tool_name":"Bash","input_summary":"./gradlew test","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    > "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['leak_count'] >= 1, d"
}

@test "grep -rE command detected as leak" {
  printf '%s\n' \
    '{"tool_name":"Bash","input_summary":"grep -rE pattern src/","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    > "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['leak_count'] >= 1, d"
}

@test "--json output preserves embedded quotes in command field" {
  printf '%s\n' \
    '{"tool_name":"Bash","input_summary":"grep -rE \"pattern\" src/","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    > "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d['leak_count'] == 1, d
cmd = d['leaks'][0]['command']
assert cmd == 'grep -rE \"pattern\" src/', repr(cmd)
"
}

@test "git log without rtk prefix detected as leak" {
  printf '%s\n' \
    '{"tool_name":"Bash","input_summary":"git log --oneline -10","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    > "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['leak_count'] >= 1, d"
}

@test "multiple leaks in one log all reported" {
  printf '%s\n' \
    '{"tool_name":"Bash","input_summary":"./gradlew test","agent_name":"agent-a","timestamp":"2026-05-07T00:01:00Z"}' \
    '{"tool_name":"Bash","input_summary":"grep -rE foo src/","agent_name":"agent-b","timestamp":"2026-05-07T00:02:00Z"}' \
    '{"tool_name":"Bash","input_summary":"git log","agent_name":"agent-a","timestamp":"2026-05-07T00:03:00Z"}' \
    > "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['leak_count'] >= 3, d"
}

@test "non-Bash tool entries are not counted as bash calls" {
  printf '%s\n' \
    '{"tool_name":"Read","input_summary":"./gradlew test","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    '{"tool_name":"Bash","input_summary":"echo ok","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    > "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['total_bash_calls'] == 1, d"
}

# ── --json output structure ───────────────────────────────────────────────────

@test "--json output has required top-level keys" {
  printf '%s\n' \
    '{"tool_name":"Bash","input_summary":"echo hello","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    > "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for key in ('leaks', 'total_bash_calls', 'leak_count'):
    assert key in d, f'missing key: {key}'
"
}

@test "--json leaks array entries have agent and command fields" {
  printf '%s\n' \
    '{"tool_name":"Bash","input_summary":"./gradlew test","agent_name":"my-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    > "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert len(d['leaks']) >= 1
entry = d['leaks'][0]
assert 'agent' in entry, entry
assert 'command' in entry, entry
assert 'skill' in entry, entry
"
}

@test "--json output is valid JSON for empty leaks" {
  printf '%s\n' \
    '{"tool_name":"Bash","input_summary":"echo clean","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    > "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -m json.tool > /dev/null
}

# ── Idempotency ───────────────────────────────────────────────────────────────

@test "running twice on same input gives same output" {
  printf '%s\n' \
    '{"tool_name":"Bash","input_summary":"./gradlew test","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    '{"tool_name":"Bash","input_summary":"echo ok","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    > "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT" --json
  [ "$status" -eq 0 ]
  first="$output"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT" --json
  [ "$status" -eq 0 ]
  [ "$output" = "$first" ]
}

# ── Skill suggestion content ──────────────────────────────────────────────────

@test "gradlew leak suggests /test skill" {
  printf '%s\n' \
    '{"tool_name":"Bash","input_summary":"./gradlew test","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    > "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
skills = [e['skill'] for e in d['leaks']]
assert any('/test' in s for s in skills), skills
"
}

@test "grep -rE leak suggests find-pattern skill" {
  printf '%s\n' \
    '{"tool_name":"Bash","input_summary":"grep -rE foo .","agent_name":"test-agent","timestamp":"2026-05-07T00:00:00Z"}' \
    > "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
skills = [e['skill'] for e in d['leaks']]
assert any('find-pattern' in s for s in skills), skills
"
}

# ── Edge cases ────────────────────────────────────────────────────────────────

@test "empty log file exits 0" {
  touch "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT"
  [ "$status" -eq 0 ]
}

@test "empty log file --json reports zero counts" {
  touch "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d['total_bash_calls'] == 0, d
assert d['leak_count'] == 0, d
"
}

@test "log with only blank lines exits 0" {
  printf '\n\n\n' > "$LOG_FILE"
  run bash "$SCRIPT" --project-root "$PROJECT_ROOT"
  [ "$status" -eq 0 ]
}

@test "project-root with = separator works" {
  run bash "$SCRIPT" "--project-root=$PROJECT_ROOT"
  [ "$status" -eq 0 ]
}
