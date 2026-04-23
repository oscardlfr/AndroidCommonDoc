#!/usr/bin/env bats
# =============================================================================
# Tests for .claude/hooks/compile-fail-pre-commit.sh (BL-W30-07)
#
# The hook reads PreToolUse JSON from stdin, intercepts git commit commands,
# and blocks commits that stage .kt files containing error() compile-fail patterns.
# =============================================================================

HOOK_SCRIPT="$BATS_TEST_DIRNAME/../../.claude/hooks/compile-fail-pre-commit.sh"

setup() {
    WORK_DIR="$(mktemp -d)"
    cd "$WORK_DIR" || exit 1
    git init --quiet
    git config user.email "test@test.com"
    git config user.name "Test"
}

teardown() {
    cd / || true
    rm -rf "$WORK_DIR"
}

# Helper: build a PreToolUse JSON payload for a git commit command
make_commit_input() {
    jq -n --arg cmd "$1" '{"tool_input": {"command": $cmd}}'
}

@test "allows commit when no staged .kt files" {
    # No staged files at all
    run bash "$HOOK_SCRIPT" <<< "$(make_commit_input 'git commit -m msg')"
    [ "$status" -eq 0 ]
    # No deny output
    [[ "$output" != *"permissionDecision"* ]] || [[ "$output" == *'"allow"'* ]]
}

@test "allows commit when staged .kt files are clean (no error() calls)" {
    cat > "$WORK_DIR/Clean.kt" <<'EOF'
fun greet(name: String): String {
    return "Hello, $name"
}
EOF
    git add "$WORK_DIR/Clean.kt"
    run bash "$HOOK_SCRIPT" <<< "$(make_commit_input 'git commit -m clean')"
    [ "$status" -eq 0 ]
    [[ "$output" != *'"deny"'* ]]
}

@test "blocks commit when staged .kt file contains error() pattern" {
    cat > "$WORK_DIR/Bad.kt" <<'EOF'
fun notImplemented(): String {
    error("not implemented")
}
EOF
    git add "$WORK_DIR/Bad.kt"
    run bash "$HOOK_SCRIPT" <<< "$(make_commit_input 'git commit -m bad')"
    [ "$status" -eq 0 ]
    [[ "$output" == *'"deny"'* ]]
    [[ "$output" == *"compile-fail-pre-commit"* ]]
}

@test "does not intercept non-commit git commands" {
    cat > "$WORK_DIR/Bad.kt" <<'EOF'
fun broken() { error("oops") }
EOF
    git add "$WORK_DIR/Bad.kt"
    run bash "$HOOK_SCRIPT" <<< "$(make_commit_input 'git status')"
    [ "$status" -eq 0 ]
    [[ "$output" != *'"deny"'* ]]
}

@test "does not intercept non-git commands" {
    run bash "$HOOK_SCRIPT" <<< "$(make_commit_input 'npm install')"
    [ "$status" -eq 0 ]
    [[ "$output" != *'"deny"'* ]]
}

@test "allows when input has no command field" {
    run bash "$HOOK_SCRIPT" <<< '{"tool_input": {}}'
    [ "$status" -eq 0 ]
}

@test "skips comment lines containing error(" {
    cat > "$WORK_DIR/Commented.kt" <<'EOF'
// error("this is just a comment, not real code")
fun fine() = "ok"
EOF
    git add "$WORK_DIR/Commented.kt"
    run bash "$HOOK_SCRIPT" <<< "$(make_commit_input 'git commit -m commented')"
    [ "$status" -eq 0 ]
    [[ "$output" != *'"deny"'* ]]
}
