#!/usr/bin/env bats
# Tests for scripts/sh/commit-msg-hook.sh
#
# Hook validates Conventional Commits format + scope whitelist from .commitlintrc.json.
# Fail-open policy: exits 0 on missing config, malformed config, no scope, merge commits.
# Compound scopes (core-error-sdk): pass when first segment (core) is in valid_scopes.

SCRIPT="$BATS_TEST_DIRNAME/../sh/commit-msg-hook.sh"

setup() {
    MSG_FILE="$(mktemp)"
}

teardown() {
    rm -f "$MSG_FILE"
}

# ── helper: write commit message to MSG_FILE ─────────────────────────────────
write_msg() {
    printf '%s\n' "$1" > "$MSG_FILE"
}

# ── FORMAT + SCOPE (live .commitlintrc.json via git rev-parse) ───────────────

@test "(a) invalid scope is blocked — exit 1" {
    # 'readme' is not in valid_scopes
    write_msg "docs(readme): update"
    run bash "$SCRIPT" "$MSG_FILE"
    [ "$status" -eq 1 ]
}

@test "(b) valid scope is accepted — exit 0" {
    # 'tests' is in valid_scopes
    write_msg "docs(tests): update bats suite"
    run bash "$SCRIPT" "$MSG_FILE"
    [ "$status" -eq 0 ]
}

@test "(c) no scope — fail-open, exit 0" {
    # scope is optional per Conventional Commits
    write_msg "docs: update something"
    run bash "$SCRIPT" "$MSG_FILE"
    [ "$status" -eq 0 ]
}

@test "(d) compound scope with valid first segment — exit 0" {
    # 'core-error-sdk': first segment 'core' is in valid_scopes
    write_msg "feat(core-error-sdk): add error type"
    run bash "$SCRIPT" "$MSG_FILE"
    [ "$status" -eq 0 ]
}

@test "(e) compound scope with invalid first segment — exit 1" {
    # 'bogus-thing': first segment 'bogus' is NOT in valid_scopes
    write_msg "feat(bogus-thing): bad scope"
    run bash "$SCRIPT" "$MSG_FILE"
    [ "$status" -eq 1 ]
}

@test "(f) merge commit — fast-pass, exit 0" {
    write_msg "Merge branch 'feature/foo' into 'develop'"
    run bash "$SCRIPT" "$MSG_FILE"
    [ "$status" -eq 0 ]
}

@test "(g) non-conventional format — exit 1" {
    write_msg "random commit message without type"
    run bash "$SCRIPT" "$MSG_FILE"
    [ "$status" -eq 1 ]
}

# ── MISSING CONFIG — isolated tmpdir git repo (never touch real .commitlintrc.json) ──

@test "(h) missing .commitlintrc.json — fail-open, exit 0" {
    # Create an isolated git repo in tmpdir with no .commitlintrc.json.
    # git rev-parse will return that tmpdir root → config not found → fail-open.
    local isolated_repo
    isolated_repo="$(mktemp -d)"
    git -C "$isolated_repo" init -q
    git -C "$isolated_repo" config user.email "test@test.com"
    git -C "$isolated_repo" config user.name "Test"
    # No .commitlintrc.json created

    write_msg "feat(scope-that-would-be-invalid): something"
    # Run from inside the isolated repo so git rev-parse returns its root
    run bash -c "cd '$isolated_repo' && bash '$SCRIPT' '$MSG_FILE'"
    rm -rf "$isolated_repo"
    [ "$status" -eq 0 ]
}

@test "(i) malformed .commitlintrc.json — fail-open, exit 0" {
    local isolated_repo
    isolated_repo="$(mktemp -d)"
    git -C "$isolated_repo" init -q
    git -C "$isolated_repo" config user.email "test@test.com"
    git -C "$isolated_repo" config user.name "Test"
    # Write deliberately malformed JSON
    printf 'not valid json {{{' > "$isolated_repo/.commitlintrc.json"

    write_msg "feat(scope-that-would-be-invalid): something"
    run bash -c "cd '$isolated_repo' && bash '$SCRIPT' '$MSG_FILE'"
    rm -rf "$isolated_repo"
    [ "$status" -eq 0 ]
}

# ── CWD-INDEPENDENCE (invoke from mcp-server/, still resolves real repo config) ──

@test "(j) cwd-independent — resolves .commitlintrc.json from mcp-server/ subdir" {
    # 'tests' scope is valid; running from mcp-server/ must still pass
    local mcp_dir
    mcp_dir="$(cd "$BATS_TEST_DIRNAME/../../mcp-server" && pwd)"
    write_msg "test(tests): verify cwd independence"
    run bash -c "cd '$mcp_dir' && bash '$SCRIPT' '$MSG_FILE'"
    [ "$status" -eq 0 ]
}
