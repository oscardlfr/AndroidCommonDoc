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

# ── Regression: node -e body must not false-trigger PYTHON_WRITE_RE ──────────

@test "allows node -e with open() or writeFileSync inside quoted body (Deferred-2)" {
  make_input "node -e 'require(\"fs\").writeFileSync(\"foo.md\",\"data\")'" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "still blocks python3 -c open(<non-exempt>,'w') after node -e exemption" {
  make_input "python3 -c \"open('bar.md','w').write('x')\"" 'arch-integration'
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"python -c"* ]]
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

@test "allows redirect to 3-level nested wave-chore verdict path" {
  make_input "cat > .planning/wave-chore/wave-f-l1-sync-doc-cleanup/arch-platform-verdict.md <<EOF
APPROVE
EOF" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "4-level nested path is blocked (arbitrary depth not exempt)" {
  make_input "cat > .planning/wave-chore/branch/sub/arch-platform-verdict.md <<EOF
APPROVE
EOF" 'arch-platform'
  run_hook
  [ "$status" -eq 2 ]
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

# ── BL-W43-01: cross-verify path exemption ──────────────────────────────────
# Tests that architect-bash-write-gate.js exempt regex accepts the
# arch-*-cross-verify.md filename family (and pr\d+-prefixed variants)
# in addition to the existing arch-*-verdict.md family.
# Fixes: BL-W42 PR5 arch-integration was blocked writing cross-verify files.
# Current regex (line 94) only covers verdict; these 4 ALLOW cases are RED
# until toolkit-specialist extends the alternation to (verdict|cross-verify).

@test "BL-W43-01: heredoc redirect to arch-integration-cross-verify.md is exempt" {
  make_input "cat <<'EOF' > .planning/wave-bl-w43/arch-integration-cross-verify.md
cross-verify content
EOF" 'arch-integration'
  run_hook
  [ "$status" -eq 0 ]
}

@test "BL-W43-01: heredoc redirect to pr1-prefixed cross-verify.md is exempt" {
  make_input "cat <<'EOF' > .planning/wave-bl-w43/pr1-arch-platform-cross-verify.md
cross-verify content
EOF" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "BL-W43-01: pathlib write_text to pr12-prefixed cross-verify.md is exempt (multi-digit)" {
  make_input "Path('.planning/wave-bl-w43/pr12-arch-testing-cross-verify.md').write_text('x')" 'arch-testing'
  run_hook
  [ "$status" -eq 0 ]
}

@test "BL-W43-01: plain redirect to arch-integration-cross-verify.md is exempt" {
  make_input "echo 'content' > .planning/wave-bl-w43/arch-integration-cross-verify.md" 'arch-integration'
  run_hook
  [ "$status" -eq 0 ]
}

@test "BL-W43-01: arch-platform-cross-check.md (wrong suffix) is blocked" {
  make_input "Path('.planning/wave-bl-w43/arch-platform-cross-check.md').write_text('x')" 'arch-platform'
  run_hook
  [ "$status" -eq 2 ]
}

@test "BL-W43-01: arch-cross-verify.md (missing role segment) is blocked" {
  make_input "Path('.planning/wave-bl-w43/arch-cross-verify.md').write_text('x')" 'arch-platform'
  run_hook
  [ "$status" -eq 2 ]
}

@test "allows arch-* &> stderr+stdout redirect to /dev/null" {
  make_input "noisy_cmd &>/dev/null" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

# ── W44-01: Windows-aware isExemptTarget ────────────────────────────────────
# Tests that os.tmpdir() normalization correctly exempts Windows temp paths
# and correctly blocks non-temp Windows project paths.
# Windows temp path - update if machine changes

@test "W44-01: allows redirect to Windows temp path (forward-slash form)" {
  [[ "$OSTYPE" == "msys"* || "$OSTYPE" == "cygwin"* || "$OS" == "Windows_NT" ]] || skip "Windows-only test (Linux CI exercises /tmp regression case)"
  make_input "echo result > C:/Users/34645/AppData/Local/Temp/foo.txt" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "W44-01: allows redirect to Windows temp path (backslash form)" {
  [[ "$OSTYPE" == "msys"* || "$OSTYPE" == "cygwin"* || "$OS" == "Windows_NT" ]] || skip "Windows-only test (Linux CI exercises /tmp regression case)"
  make_input 'echo result > C:\Users\34645\AppData\Local\Temp\foo.txt' 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "W44-01: allows redirect to /tmp/foo.txt (POSIX /tmp/ regression)" {
  make_input "echo result > /tmp/foo.txt" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "W44-01: allows redirect to \$TMPDIR/foo.txt (env var regression)" {
  make_input 'echo result > $TMPDIR/foo.txt' 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "W44-01: allows redirect to /dev/null (stream sink regression)" {
  make_input "noisy_cmd > /dev/null" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "W44-01: blocks redirect to Windows project path (non-temp)" {
  make_input "echo result > C:/Users/34645/AndroidStudioProjects/foo.js" 'arch-platform'
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"shell redirect"* ]]
}

@test "W44-01: allows tee to Windows temp path (forward-slash form)" {
  [[ "$OSTYPE" == "msys"* || "$OSTYPE" == "cygwin"* || "$OS" == "Windows_NT" ]] || skip "Windows-only test (Linux CI exercises /tmp regression case)"
  make_input "some_cmd | tee C:/Users/34645/AppData/Local/Temp/debug.log" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "W44-01: blocks tee to Windows project path" {
  make_input "some_cmd | tee C:/Users/34645/AndroidStudioProjects/some-file.md" 'arch-platform'
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"tee write"* ]]
}

# ── BL-W44-S2: .claude/wave-quality-gates/arch-*.md is exempt ───────────────
# Tests that architect-bash-write-gate.js exempts arch-prefixed wave-quality-gate
# verdict files that architects write, while blocking sentinel files (no arch- prefix)
# and arbitrary project paths.

@test "BL-W44-S2: allows redirect to .claude/wave-quality-gates/arch-platform-prep-bl-w44-s2-pr1.md" {
  make_input "echo 'APPROVED' > .claude/wave-quality-gates/arch-platform-prep-bl-w44-s2-pr1.md" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

@test "BL-W44-S2: allows redirect to .claude/wave-quality-gates/arch-testing-verify-bl-w44-s2-pr2.md" {
  make_input "echo 'APPROVED' > .claude/wave-quality-gates/arch-testing-verify-bl-w44-s2-pr2.md" 'arch-testing'
  run_hook
  [ "$status" -eq 0 ]
}

@test "BL-W44-S2: allows redirect to .claude/wave-quality-gates/arch-integration-light-bl-w44-s2-pr3.md" {
  make_input "echo 'APPROVED' > .claude/wave-quality-gates/arch-integration-light-bl-w44-s2-pr3.md" 'arch-integration'
  run_hook
  [ "$status" -eq 0 ]
}

@test "BL-W44-S2: blocks redirect to .claude/wave-quality-gates/bl-w44-s2-pr1.md (sentinel, no arch- prefix)" {
  make_input "echo 'stub' > .claude/wave-quality-gates/bl-w44-s2-pr1.md" 'arch-platform'
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"shell redirect"* ]]
}

@test "BL-W44-S2: blocks redirect to docs/agents/foo.md (arbitrary project path)" {
  make_input "echo 'content' > docs/agents/foo.md" 'arch-platform'
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"shell redirect"* ]]
}

# ── BL-W32-12 — pathlib.Path.write_text() exempt detection ──────────────────
# Bug: SECURITY false-negative — PATHLIB_WRITE_RE backreference \1 requires a
# literal " or ' to close the path, but cmd `python3 -c "pathlib.Path(\"<p>\")
# .write_text(\"<d>\")"` has a backslash before each quote. The regex DOES NOT
# MATCH this form at all → no violation detected → write ALLOWED unconditionally.
# For exempt paths this is harmless (correct outcome by accident). For NON-EXEMPT
# paths this is a security hole: dangerous writes via python3 -c wrapper bypass
# the gate entirely.
# Fix: extend PATHLIB_WRITE_RE so it matches the backslash-escaped form and
# extracts the inner path, so isExemptTarget can correctly ALLOW exempt paths
# and BLOCK non-exempt paths.
# Pre-fix state (RED on master): the 2 BLOCK tests below FAIL (write goes through
# unblocked). The 10 ALLOW tests pass for the wrong reason. Post-fix: all 12
# tests pass for the right reason.

# Unit: Path × single-quote inner × exempt verdict path → ALLOW
@test "BL-W32-12: Path single-quote inner exempt verdict path → ALLOW" {
  python3 - "$INPUT_FILE" <<'PYEOF'
import json, sys
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "Bash",
        "tool_input": {"command": "python3 -c 'import pathlib; Path(\".planning/wave-bl-w32-12-pathlib-write-text/arch-platform-verdict.md\").write_text(\"data\")'"},
        "agent_type": "arch-platform",
    }, f)
PYEOF
  run_hook
  [ "$status" -eq 0 ]
}

# Unit: pathlib.Path × double-quote-escaped inner × exempt verdict path → ALLOW (primary reproducer)
@test "BL-W32-12: pathlib.Path double-quote-escaped inner exempt verdict path → ALLOW (primary reproducer)" {
  python3 - "$INPUT_FILE" <<'PYEOF'
import json, sys
cmd = 'python3 -c "import pathlib; pathlib.Path(\\".planning/wave-bl-w32-12-pathlib-write-text/arch-platform-verdict.md\\").write_text(\\"data\\")"'
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "Bash",
        "tool_input": {"command": cmd},
        "agent_type": "arch-platform",
    }, f)
PYEOF
  run_hook
  [ "$status" -eq 0 ]
}

# Unit: pathlib.Path × single-quote inner × exempt verdict path → ALLOW
@test "BL-W32-12: pathlib.Path single-quote inner exempt verdict path → ALLOW" {
  python3 - "$INPUT_FILE" <<'PYEOF'
import json, sys
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "Bash",
        "tool_input": {"command": "python3 -c 'pathlib.Path(\".planning/wave-bl-w32-12-pathlib-write-text/arch-testing-verdict.md\").write_text(\"ok\")'"},
        "agent_type": "arch-testing",
    }, f)
PYEOF
  run_hook
  [ "$status" -eq 0 ]
}

# Unit: pathlib.Path × double-quote-escaped inner × exempt testing verdict path → ALLOW
@test "BL-W32-12: pathlib.Path double-quote-escaped inner testing verdict path → ALLOW" {
  python3 - "$INPUT_FILE" <<'PYEOF'
import json, sys
cmd = 'python3 -c "pathlib.Path(\\".planning/wave-bl-w32-12-pathlib-write-text/arch-testing-verdict.md\\").write_text(\\"ok\\")"'
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "Bash",
        "tool_input": {"command": cmd},
        "agent_type": "arch-testing",
    }, f)
PYEOF
  run_hook
  [ "$status" -eq 0 ]
}

# Unit: Path × single-quote inner × non-exempt /etc/passwd → BLOCK
@test "BL-W32-12: Path single-quote inner non-exempt /etc/passwd → BLOCK" {
  python3 - "$INPUT_FILE" <<'PYEOF'
import json, sys
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "Bash",
        "tool_input": {"command": "python3 -c 'Path(\"/etc/passwd\").write_text(\"evil\")'"},
        "agent_type": "arch-platform",
    }, f)
PYEOF
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"pathlib.Path"* ]]
}

# Unit: pathlib.Path × double-quote-escaped inner × non-exempt /etc/shadow → BLOCK
@test "BL-W32-12: pathlib.Path double-quote-escaped inner non-exempt /etc/shadow → BLOCK" {
  python3 - "$INPUT_FILE" <<'PYEOF'
import json, sys
cmd = 'python3 -c "pathlib.Path(\\"/etc/shadow\\").write_text(\\"evil\\")"'
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "Bash",
        "tool_input": {"command": cmd},
        "agent_type": "arch-platform",
    }, f)
PYEOF
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"pathlib.Path"* ]]
}

# Unit: .claude/wave-quality-gates/arch-platform.md exempt via python3 -c wrapper → ALLOW
@test "BL-W32-12: pathlib.Path double-quote-escaped .claude/wave-quality-gates/arch-platform.md → ALLOW" {
  python3 - "$INPUT_FILE" <<'PYEOF'
import json, sys
cmd = 'python3 -c "pathlib.Path(\\".claude/wave-quality-gates/arch-platform-prep-bl-w32-12.md\\").write_text(\\"APPROVED\\")"'
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "Bash",
        "tool_input": {"command": cmd},
        "agent_type": "arch-platform",
    }, f)
PYEOF
  run_hook
  [ "$status" -eq 0 ]
}

# Unit: write_bytes() variant with exempt verdict path via python3 -c wrapper → ALLOW
@test "BL-W32-12: write_bytes double-quote-escaped inner exempt verdict path → ALLOW" {
  python3 - "$INPUT_FILE" <<'PYEOF'
import json, sys
cmd = 'python3 -c "pathlib.Path(\\".planning/wave-bl-w32-12-pathlib-write-text/arch-platform-verdict.md\\").write_bytes(b\\"data\\")"'
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "Bash",
        "tool_input": {"command": cmd},
        "agent_type": "arch-platform",
    }, f)
PYEOF
  run_hook
  [ "$status" -eq 0 ]
}

# Unit: regression — bare Path single-quote exempt verdict (no python3 -c wrapper) still ALLOW
@test "BL-W32-12: regression — bare Path single-quote exempt verdict path still ALLOW" {
  make_input "Path('.planning/wave-bl-w32-12-pathlib-write-text/arch-platform-verdict.md').write_text('ok')" 'arch-platform'
  run_hook
  [ "$status" -eq 0 ]
}

# Unit: pr-prefixed verdict via python3 -c double-quote-escaped form → ALLOW
@test "BL-W32-12: pathlib.Path double-quote-escaped pr1-prefixed verdict path → ALLOW" {
  python3 - "$INPUT_FILE" <<'PYEOF'
import json, sys
cmd = 'python3 -c "pathlib.Path(\\".planning/wave-bl-w32-12-pathlib-write-text/pr1-arch-platform-verdict.md\\").write_text(\\"data\\")"'
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "Bash",
        "tool_input": {"command": cmd},
        "agent_type": "arch-platform",
    }, f)
PYEOF
  run_hook
  [ "$status" -eq 0 ]
}

# ── BL-W32-12 integration: hook stdin JSON ──────────────────────────────────

# Integration 1: python3 -c with exempt verdict path → exit 0 (ALLOW)
@test "BL-W32-12 integration: python3 -c exempt verdict path → exit 0 (ALLOW)" {
  python3 - "$INPUT_FILE" <<'PYEOF'
import json, sys
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "Bash",
        "tool_input": {
            "command": "python3 -c \"import pathlib; pathlib.Path(\\\".planning/wave-bl-w32-12-pathlib-write-text/arch-platform-verdict.md\\\").write_text(\\\"verdict data\\\")\""
        },
        "agent_type": "arch-platform",
    }, f)
PYEOF
  run_hook
  [ "$status" -eq 0 ]
}

# Integration 2: python3 -c with /etc/passwd → exit 2 (BLOCK)
@test "BL-W32-12 integration: python3 -c non-exempt /etc/passwd → exit 2 (BLOCK)" {
  python3 - "$INPUT_FILE" <<'PYEOF'
import json, sys
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "Bash",
        "tool_input": {
            "command": "python3 -c \"pathlib.Path(\\\"/etc/passwd\\\").write_text(\\\"evil\\\")\""
        },
        "agent_type": "arch-platform",
    }, f)
PYEOF
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"pathlib.Path"* ]]
}

