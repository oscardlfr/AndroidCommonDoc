#!/usr/bin/env bats
# Tests for the pre-commit hook (scripts/sh/pre-commit-hook.sh).
# It detects staged skills/*/SKILL.md or skills/registry.json and runs rehash-registry.sh --check --verbose.
# Hook accepts project root as $1.

HOOK_SCRIPT="$BATS_TEST_DIRNAME/../sh/pre-commit-hook.sh"

REHASH_SCRIPT="$BATS_TEST_DIRNAME/../sh/rehash-registry.sh"

setup() {
    WORK_DIR="$(mktemp -d)"
    mkdir -p "$WORK_DIR/skills/test-skill"
    mkdir -p "$WORK_DIR/.git/hooks"

    printf "name: test-skill\ndescription: test\n" > "$WORK_DIR/skills/test-skill/SKILL.md"
}

teardown() {
    rm -rf "$WORK_DIR"
}

# Helper: compute sha256 of a file
compute_hash() {
    if command -v sha256sum &>/dev/null; then
        sha256sum "$1" | cut -d' ' -f1
    elif command -v shasum &>/dev/null; then
        shasum -a 256 "$1" | cut -d' ' -f1
    else
        python3 -c "import hashlib; print(hashlib.sha256(open('$1','rb').read()).hexdigest())"
    fi
}

# Helper: write registry.json with given skill hash
write_registry_with_hash() {
    local skill_hash="$1"
    python3 - "$WORK_DIR" "$skill_hash" << 'EOF'
import json, sys
work_dir, skill_hash = sys.argv[1], sys.argv[2]
reg = {
    "skills": [
        {
            "name": "test-skill",
            "type": "skill",
            "path": "skills/test-skill/SKILL.md",
            "hash": skill_hash
        }
    ]
}
with open(f"{work_dir}/skills/registry.json", "w") as f:
    json.dump(reg, f, indent=2)
EOF
}

# Helper: write registry.json with the correct current hash for SKILL.md
write_correct_registry() {
    local h="sha256:$(compute_hash "$WORK_DIR/skills/test-skill/SKILL.md")"
    write_registry_with_hash "$h"
}

# Helper: init a git repo in WORK_DIR (minimal config to allow staging)
init_git_repo() {
    git -C "$WORK_DIR" init -q
    git -C "$WORK_DIR" config user.email "test@test.com"
    git -C "$WORK_DIR" config user.name "Test"
}

# ── case (a): no SKILL.md staged → hook exits 0, rehash NOT invoked ──────

@test "(a) clean commit — non-skill files staged — hook exits 0" {
    init_git_repo
    write_correct_registry

    # Stage a non-skill file only
    mkdir -p "$WORK_DIR/src"
    printf "class Foo\n" > "$WORK_DIR/src/Foo.kt"
    git -C "$WORK_DIR" add src/Foo.kt

    run bash "$HOOK_SCRIPT" "$WORK_DIR"
    [ "$status" -eq 0 ]
}

# ── case (b): SKILL.md staged with stale hash → exits non-zero ──────────

@test "(b) SKILL.md staged with stale hash — hook exits non-zero with stale message" {
    init_git_repo
    write_registry_with_hash "sha256:stale"

    git -C "$WORK_DIR" add skills/test-skill/SKILL.md skills/registry.json

    run bash "$HOOK_SCRIPT" "$WORK_DIR"
    [ "$status" -ne 0 ]
    [[ "$output" == *"[REHASH]"* ]]
}

# ── case (c): SKILL.md staged with correct hash → exits 0 ───────────────

@test "(c) SKILL.md staged with current hash — hook exits 0" {
    init_git_repo
    write_correct_registry

    git -C "$WORK_DIR" add skills/test-skill/SKILL.md skills/registry.json

    run bash "$HOOK_SCRIPT" "$WORK_DIR"
    [ "$status" -eq 0 ]
}

# ── case (d): registry.json staged with stale hash → exits non-zero ─────

@test "(d) registry.json staged with stale hash — hook exits non-zero" {
    init_git_repo
    write_registry_with_hash "sha256:stale"

    # Stage only registry.json (not the SKILL.md)
    git -C "$WORK_DIR" add skills/registry.json

    run bash "$HOOK_SCRIPT" "$WORK_DIR"
    [ "$status" -ne 0 ]
    [[ "$output" == *"[REHASH]"* ]]
}

# ── case (e): only .kt files staged → hook exits 0 ──────────────────────

@test "(e) only non-skill changes staged — hook exits 0 without invoking rehash" {
    init_git_repo
    write_correct_registry

    mkdir -p "$WORK_DIR/feature"
    printf "object Main\n" > "$WORK_DIR/feature/Main.kt"
    git -C "$WORK_DIR" add feature/Main.kt

    run bash "$HOOK_SCRIPT" "$WORK_DIR"
    [ "$status" -eq 0 ]
}
