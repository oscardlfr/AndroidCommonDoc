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

@test "blocks python3 -c open(<non-exempt>,'w')" {
  make_input "python3 -c \"open('docs/leak.md','w').write('x')\"" 'arch-platform'
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"python -c"* ]]
}

@test "allows python3 -c open(<exempt verdict path>,'w')" {
  make_input "python3 -c \"open('.planning/wave-bl-w32-05/arch-platform-verdict.md','w').write('APPROVE')\"" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows python3 -c open(<exempt>,'wb') binary write mode" {
  make_input "python3 -c \"open('.planning/wave-bl-w32-05/arch-platform-verdict.md','wb').write(b'x')\"" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows python3 <<EOF heredoc open(<exempt verdict path>,'w')" {
  make_input "python3 << 'PYEOF'
with open('.planning/wave-bl-w32-05/arch-testing-verdict.md', 'w') as f:
    f.write('APPROVE')
PYEOF" 'arch-testing'
  run_hook
  [ "$status" -eq 0 ]
}

@test "blocks python3 <<EOF heredoc open(<non-exempt>,'w') even if exempt path also present" {
  make_input "python3 << 'PYEOF'
with open('/tmp/ok.txt', 'w') as a:
    a.write('safe')
with open('docs/leak.md', 'w') as b:
    b.write('leak')
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

@test "allows redirect to hyphenated wave verdict path (wave-bl-w32-05)" {
  make_input "cat > .planning/wave-bl-w32-05/arch-integration-verdict.md <<EOF
APPROVE
EOF" 'arch-integration'
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

# ── Regression: REDIRECT_RE must not false-match >= comparison operator ──────

@test "allows heredoc to exempt verdict path with >= in body content" {
  make_input "cat <<'EOF' > .planning/wave-foo/arch-platform-verdict.md
bats coverage exceeds >=10 cases
EOF" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "still blocks redirect to non-exempt path even with >= elsewhere in command" {
  make_input "echo foo > docs/new.md && [ \$count >= 0 ]" 'arch-platform'
  run_hook
  [ "$status" -eq 2 ]
}

# ── Heredoc-aware scanner: body content must not be scanned for redirects ────

@test "allows heredoc to exempt path with regex literal in body" {
  make_input "cat <<'EOF' > .planning/wave-foo/arch-platform-verdict.md
fix: regex \`>{1,2}\` tightened
EOF" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows heredoc to exempt path with redirect-like text in body" {
  make_input "cat <<'EOF' > .planning/wave-foo/arch-platform-verdict.md
blocked redirect like > /etc/passwd is illegal
EOF" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "still blocks heredoc to NON-exempt path" {
  make_input "cat <<'EOF' > /etc/passwd
any content
EOF" 'arch-platform'
  run_hook
  [ "$status" -eq 2 ]
}

@test "allows tab-stripped heredoc <<- to exempt path" {
  make_input "	cat <<-'EOF' > .planning/wave-foo/arch-testing-verdict.md
	content
	EOF" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "blocks redirect AFTER heredoc terminator (multi-statement)" {
  make_input "cat <<'EOF' > /tmp/ok
data
EOF
echo leak > /etc/passwd" 'arch-platform'
  run_hook
  [ "$status" -eq 2 ]
}

@test "allows heredoc opener with double-quoted delimiter" {
  make_input 'cat <<"EOF" > .planning/wave-foo/arch-integration-verdict.md
content with $variable
EOF' 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

# ── pathlib.Path.write_text() / write_bytes() detector ──────────────────────
# BL-W32-12: PATHLIB_WRITE_RE catches Path(...).write_text/write_bytes bypasses.
# Standalone regex (no python3 -c anchor needed). Feeds through isExemptTarget().
# Backreference enforces quote consistency. Conservative block on f-string (fail-open).

@test "pathlib write_text to /dev/null is exempt" {
  make_input "Path('/dev/null').write_text('x')" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "pathlib write_text to /tmp path is exempt" {
  make_input "pathlib.Path('/tmp/foo.txt').write_text('x')" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "pathlib write_text to verdict path is exempt" {
  make_input "Path('.planning/wave-bl-w33-l1-triage/arch-platform-pr3-verdict.md').write_text('x')" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "pathlib write_text to source file is blocked" {
  make_input 'Path("src/main.py").write_text("x")' 'arch-platform'
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"pathlib.Path"* ]]
}

@test "pathlib write_text to doc file is blocked" {
  make_input 'pathlib.Path("docs/foo.md").write_text("x")' 'arch-platform'
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"pathlib.Path"* ]]
}

@test "pathlib write_text double-quote exempt /dev/null passes (cross-quote variant)" {
  # Uses python3 directly to avoid MSYS path translation of double-quoted /dev/null.
  python3 - "$INPUT_FILE" <<'PYEOF'
import json, sys
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "Bash",
        "tool_input": {"command": "Path(\"/dev/null\").write_text(\"x\")"},
        "agent_type": "arch-platform",
    }, f)
PYEOF
  run_hook
  [ "$status" -eq 0 ]
}

@test "pathlib write_text f-string path is not matched by regex (fail-open per arch-platform)" {
  make_input "Path(f'/tmp/{var}').write_text('x')" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "pathlib write_bytes to /tmp path is exempt (write_bytes alternation)" {
  make_input "Path('/tmp/baz').write_bytes(b'x')" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

# ── BL-W36-01: pr-prefixed verdict filenames ────────────────────────────────
# Tests that architect-bash-write-gate.js exempt regex accepts the new
# pr\d+-arch-*-verdict.md prefix-style filename convention used in multi-PR
# waves (in addition to the existing arch-*-verdict.md convention).
# See .planning/wave-bl-w37-cross-repo-sync/PR3-PLAN.md for context.

@test "pathlib write_text to pr-prefixed verdict path is exempt" {
  make_input "Path('.planning/wave-bl-w37-cross-repo-sync/pr3-arch-platform-verdict.md').write_text('x')" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "pathlib write_text to pr1-prefixed testing verdict path is exempt" {
  make_input "Path('.planning/wave-bl-w37-cross-repo-sync/pr1-arch-testing-verdict.md').write_text('x')" 'arch-testing'
  run_hook
  [ "$status" -eq 0 ]
}

@test "pathlib write_text to pr12-prefixed verdict path is exempt (multi-digit)" {
  make_input "Path('.planning/wave-bl-w37-cross-repo-sync/pr12-arch-integration-verdict.md').write_text('x')" 'arch-integration'
  run_hook
  [ "$status" -eq 0 ]
}

@test "pathlib write_text to pr-prefixed file without -verdict suffix is blocked" {
  make_input "Path('.planning/wave-bl-w37/pr5-arch-platform-something.md').write_text('x')" 'arch-platform'
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"pathlib.Path"* ]]
}

@test "pathlib write_text to prx-prefixed (non-digit) verdict path is blocked" {
  make_input "Path('.planning/wave-bl-w37/prx-arch-platform-verdict.md').write_text('x')" 'arch-platform'
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"pathlib.Path"* ]]
}

# ── Structural tokenizer: REDIRECT_RE false-positive regression suite ────────
# These scenarios verify that the structural bash tokenizer does NOT
# false-positive on -> arrows, --flag> patterns, >=, >>= and &> sequences.

@test "allows arch-* echo with -> arrow in message (no real redirect)" {
  make_input "echo 'sending message agent -> arch-platform'" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows arch-* command with -> arrow and pipe (no file redirect)" {
  make_input "git log --oneline | grep 'A -> B' | head -5" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows arch-* command with >= comparison in shell arithmetic" {
  make_input "if [ \$count -ge 10 ]; then echo ok; fi" 'arch-integration'
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows arch-* command with >>= shift-assign-like token (no file target)" {
  make_input "echo 'state >>= 2 shifts bits'" 'arch-testing'
  run_hook
  [ "$status" -eq 0 ]
}

@test "still blocks real redirect even when -> arrow appears in the same command" {
  make_input "echo 'A -> B' > docs/output.md" 'arch-platform'
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"shell redirect"* ]]
}

@test "allows arch-* heredoc where body contains -> arrow lines" {
  make_input "cat <<'EOF' > .planning/wave-foo/arch-platform-verdict.md
flow: A -> B -> C
EOF" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows arch-* &> stderr+stdout redirect to /dev/null" {
  make_input "noisy_cmd &>/dev/null" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}
