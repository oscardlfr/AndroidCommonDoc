#!/usr/bin/env bats
# Tests for .claude/hooks/registry-pre-commit.sh (PreToolUse Claude hook).
# Hook intercepts Bash(git commit) to auto-rehash registry when relevant files change.
# test-infra: bats fixture + real temp git repo + ANDROID_COMMON_DOC mock isolation.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/registry-pre-commit.sh"

setup() {
  command -v jq >/dev/null 2>&1 || skip "jq not available"

  WORK_DIR="$(mktemp -d)"

  # Windows / Git Bash: convert WORK_DIR to Windows path if cygpath available
  if command -v cygpath >/dev/null 2>&1; then
    WORK_DIR="$(cygpath -u "$WORK_DIR")"
  fi

  git -C "$WORK_DIR" init -q
  git -C "$WORK_DIR" config user.email "test@test.com"
  git -C "$WORK_DIR" config user.name "Test"

  # Build mock rehash-registry.sh inside WORK_DIR for ANDROID_COMMON_DOC isolation
  mkdir -p "$WORK_DIR/scripts/sh"
  cat > "$WORK_DIR/scripts/sh/rehash-registry.sh" <<'MOCK'
#!/bin/bash
set -euo pipefail
for arg in "$@"; do
  if [ "$arg" = "--check" ]; then
    echo '{"updated":1}'
    exit 0
  fi
done
exit 0
MOCK
  chmod +x "$WORK_DIR/scripts/sh/rehash-registry.sh"

  mkdir -p "$WORK_DIR/skills"
  touch "$WORK_DIR/skills/registry.json"
}

teardown() {
  rm -rf "$WORK_DIR"
}

# TC1 — non-commit command exits 0 immediately, no rehash
@test "TC1: non-commit command (git status) exits 0" {
  INPUT='{"tool_name":"Bash","tool_input":{"command":"git status"},"session_id":"t1"}'
  run bash -c "cd '$WORK_DIR' && printf '%s' '$INPUT' | bash '$HOOK'"
  [ "$status" -eq 0 ]
}

# TC2 — git commit with no staged files exits 0
@test "TC2: git commit with no staged files exits 0" {
  INPUT='{"tool_name":"Bash","tool_input":{"command":"git commit -m \"test\""},"session_id":"t2"}'
  run bash -c "cd '$WORK_DIR' && printf '%s' '$INPUT' | bash '$HOOK'"
  [ "$status" -eq 0 ]
}

# TC3 — git commit with staged non-relevant file exits 0
@test "TC3: git commit with staged non-relevant file exits 0" {
  mkdir -p "$WORK_DIR/src"
  printf 'class Foo\n' > "$WORK_DIR/src/Foo.kt"
  git -C "$WORK_DIR" add src/Foo.kt

  INPUT='{"tool_name":"Bash","tool_input":{"command":"git commit -m \"test\""},"session_id":"t3"}'
  run bash -c "cd '$WORK_DIR' && printf '%s' '$INPUT' | bash '$HOOK'"
  [ "$status" -eq 0 ]
}

# TC4 — git commit with staged .claude/agents/ file triggers rehash + stages registry.json
@test "TC4: staged .claude/agents/ triggers rehash and re-stages registry.json" {
  mkdir -p "$WORK_DIR/.claude/agents"
  printf -- "---\nname: test-agent\n---\nbody.\n" > "$WORK_DIR/.claude/agents/test-agent.md"
  git -C "$WORK_DIR" add .claude/agents/test-agent.md

  INPUT='{"tool_name":"Bash","tool_input":{"command":"git commit -m \"test\""},"session_id":"t4"}'
  run bash -c "cd '$WORK_DIR' && printf '%s' '$INPUT' | ANDROID_COMMON_DOC='$WORK_DIR' bash '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"permissionDecision"* ]]
  git -C "$WORK_DIR" diff --cached --name-only | grep -q "skills/registry.json"
}

# TC5 — git commit with staged skills/*/SKILL.md triggers rehash + stages registry.json
@test "TC5: staged skills/SKILL.md triggers rehash and re-stages registry.json" {
  mkdir -p "$WORK_DIR/skills/my-skill"
  printf 'name: my-skill\n' > "$WORK_DIR/skills/my-skill/SKILL.md"
  git -C "$WORK_DIR" add skills/my-skill/SKILL.md

  INPUT='{"tool_name":"Bash","tool_input":{"command":"git commit -m \"test\""},"session_id":"t5"}'
  run bash -c "cd '$WORK_DIR' && printf '%s' '$INPUT' | ANDROID_COMMON_DOC='$WORK_DIR' bash '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"permissionDecision"* ]]
  git -C "$WORK_DIR" diff --cached --name-only | grep -q "skills/registry.json"
}

# TC6 — non-Bash tool (SendMessage) exits 0 — no .tool_input.command → empty → exit 0
@test "TC6: non-Bash tool payload (SendMessage) exits 0" {
  INPUT='{"tool_name":"SendMessage","tool_input":{"to":"context-provider","message":"query"},"session_id":"t6"}'
  run bash -c "cd '$WORK_DIR' && printf '%s' '$INPUT' | bash '$HOOK'"
  [ "$status" -eq 0 ]
}

# TC7 — malformed JSON input exits 0 (fail-open via || exit 0 at line 11)
@test "TC7: malformed JSON input exits 0 (fail-open)" {
  run bash -c "printf '%s' 'bad json' | bash '$HOOK'"
  [ "$status" -eq 0 ]
}
