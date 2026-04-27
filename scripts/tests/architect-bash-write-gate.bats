#!/usr/bin/env bats
#
# Tests for .claude/hooks/architect-bash-write-gate.js. Mirrors the shape of
# scripts/tests/architect-self-edit-gate.bats. Validates that arch-* agents
# are blocked from writing project files via Bash bypass patterns and that
# legitimate / non-arch traffic flows through unblocked.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/architect-bash-write-gate.js"
INPUT_FILE="${BATS_TEST_TMPDIR:-/tmp}/arch-bash-write-input-$$.json"

# Build a JSON envelope:
#   make_input <bash command> <agent_type>
# Uses a single-quoted JSON template; the command is JSON-escaped via printf %s
# so embedded quotes / heredocs survive intact.
make_input() {
  local cmd="$1" agent="${2-arch-integration}"
  python3 - "$cmd" "$agent" "$INPUT_FILE" <<'PYEOF'
import json, sys
cmd, agent, path = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "Bash",
        "tool_input": {"command": cmd},
        "agent_type": agent,
    }, f)
PYEOF
}

run_hook() {
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
}

# ── Block scenarios ─────────────────────────────────────────────────────────

@test "blocks heredoc redirect to project file" {
  make_input 'cat > docs/foo.md <<EOF
hello
EOF' 'arch-platform'
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"heredoc redirect"* ]]
}

@test "blocks heredoc with redirect AFTER the EOF marker (cat << EOF > file)" {
  make_input 'cat << EOF > foo.md
body
EOF' 'arch-testing'
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"heredoc redirect"* ]]
}

@test "blocks sed -i in-place edit" {
  make_input "sed -i 's/foo/bar/' README.md" 'arch-integration'
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"sed -i"* ]]
}

@test "blocks sed --in-place" {
  make_input "sed --in-place 's/foo/bar/' README.md" 'arch-platform'
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"sed -i"* ]]
}

@test "blocks awk -i inplace" {
  make_input "awk -i inplace '{print toupper(\$0)}' README.md" 'arch-testing'
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"awk -i inplace"* ]]
}

@test "blocks python3 -c open(...,'w')" {
  make_input "python3 -c \"open('foo.md','w').write('x')\"" 'arch-platform'
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"python -c"* ]]
}

@test "blocks python3 <<EOF heredoc with open(...,'w')" {
  # Real bypass observed 2026-04-21 (arch-platform editing MIGRATIONS.json).
  make_input "python3 << 'PYEOF'
import json
with open('setup/agent-templates/MIGRATIONS.json', 'w') as f:
    json.dump({}, f)
PYEOF" 'arch-platform'
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"python <<EOF"* ]]
}

@test "blocks plain shell redirect to project file" {
  make_input "echo body > docs/new.md" 'arch-integration'
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"shell redirect"* ]]
}

@test "blocks tee writing to a project file" {
  make_input "echo x | tee README.md" 'arch-testing'
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"tee write"* ]]
}

# ── Allow scenarios — exempt targets ────────────────────────────────────────

@test "allows redirect to /tmp" {
  make_input "git status --short > /tmp/status.txt" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows redirect to /dev/null" {
  make_input "noisy_command > /dev/null 2>&1" 'arch-integration'
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows redirect to architect verdict file" {
  make_input "cat > .planning/wave31.7/arch-platform-verdict.md <<EOF
APPROVE
EOF" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows append to .androidcommondoc/audit-log.jsonl" {
  make_input "echo '{\"event\":\"x\"}' >> .androidcommondoc/audit-log.jsonl" 'arch-testing'
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows tee /dev/null" {
  make_input "echo x | tee /dev/null" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

# ── Allow scenarios — non-arch agents and read-only commands ────────────────

@test "allows data-layer-specialist heredoc redirect (non-arch)" {
  make_input 'cat > foo.md <<EOF
body
EOF' 'data-layer-specialist'
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows test-specialist sed -i (non-arch)" {
  make_input "sed -i 's/foo/bar/' src/foo.kt" 'test-specialist'
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows arch-platform read-only bash" {
  make_input "git log --oneline | head -5" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows arch-testing pipe-only command (no redirect)" {
  make_input "ls -la | grep .md" 'arch-testing'
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows python3 heredoc without open() write (read-only analysis)" {
  make_input "python3 << 'PYEOF'
import json
data = json.load(open('foo.json', 'r'))
print(len(data))
PYEOF" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

# ── Edge cases — fail-open ──────────────────────────────────────────────────

@test "allows malformed JSON (fail-open)" {
  printf '%s' '{not json' > "$INPUT_FILE"
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows empty agent_type (fail-open — unknown caller)" {
  make_input "cat > foo.md <<EOF
body
EOF" ''
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows non-Bash tool calls" {
  python3 - "$INPUT_FILE" <<'PYEOF'
import json, sys
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "Read",
        "tool_input": {"file_path": "foo.md"},
        "agent_type": "arch-platform",
    }, f)
PYEOF
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows arch-platform redirecting fd 2 (stderr swallow)" {
  make_input "noisy_cmd 2>/dev/null" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}
