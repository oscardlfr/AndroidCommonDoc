#!/usr/bin/env bats
#
# Tests for scripts/sh/detect-project-type.sh — project-type classification
# script used by quality-gater (BL-W31.7-10) and other polyglot agents.
#
# Detection rules:
#   - settings.gradle{,.kts} at root -> Gradle present
#   - package.json at root OR depth-1 subdir -> Node present
#   - both -> hybrid; gradle only -> gradle; node only -> node; neither -> unknown

SCRIPT="$BATS_TEST_DIRNAME/../sh/detect-project-type.sh"

setup() {
    TMP="${BATS_TEST_TMPDIR:-/tmp}/detect-pt-$$-$BATS_TEST_NAME"
    TMP="${TMP// /_}"
    mkdir -p "$TMP"
}

teardown() {
    rm -rf "$TMP"
}

# ── Classification scenarios ────────────────────────────────────────────────

@test "node project (package.json at root)" {
    touch "$TMP/package.json"
    run bash "$SCRIPT" --project-root "$TMP"
    [ "$status" -eq 0 ]
    [ "$output" = "node" ]
}

@test "node project (package.json in depth-1 subdir like mcp-server/)" {
    mkdir -p "$TMP/mcp-server"
    touch "$TMP/mcp-server/package.json"
    run bash "$SCRIPT" --project-root "$TMP"
    [ "$status" -eq 0 ]
    [ "$output" = "node" ]
}

@test "gradle project (settings.gradle.kts at root)" {
    touch "$TMP/settings.gradle.kts"
    run bash "$SCRIPT" --project-root "$TMP"
    [ "$status" -eq 0 ]
    [ "$output" = "gradle" ]
}

@test "gradle project (legacy settings.gradle Groovy)" {
    touch "$TMP/settings.gradle"
    run bash "$SCRIPT" --project-root "$TMP"
    [ "$status" -eq 0 ]
    [ "$output" = "gradle" ]
}

@test "hybrid project (root package.json + settings.gradle.kts)" {
    touch "$TMP/package.json"
    touch "$TMP/settings.gradle.kts"
    run bash "$SCRIPT" --project-root "$TMP"
    [ "$status" -eq 0 ]
    [ "$output" = "hybrid" ]
}

@test "hybrid project (Gradle root + web/package.json subdir)" {
    touch "$TMP/settings.gradle.kts"
    mkdir -p "$TMP/web"
    touch "$TMP/web/package.json"
    run bash "$SCRIPT" --project-root "$TMP"
    [ "$status" -eq 0 ]
    [ "$output" = "hybrid" ]
}

@test "unknown (empty directory)" {
    run bash "$SCRIPT" --project-root "$TMP"
    [ "$status" -eq 0 ]
    [ "$output" = "unknown" ]
}

@test "unknown (only ignored subdirs: node_modules, build)" {
    mkdir -p "$TMP/node_modules"
    touch "$TMP/node_modules/package.json"
    mkdir -p "$TMP/build"
    touch "$TMP/build/package.json"
    run bash "$SCRIPT" --project-root "$TMP"
    [ "$status" -eq 0 ]
    [ "$output" = "unknown" ]
}

# ── Argument handling ──────────────────────────────────────────────────────

@test "default root is PWD" {
    touch "$TMP/package.json"
    cd "$TMP"
    run bash "$SCRIPT"
    [ "$status" -eq 0 ]
    [ "$output" = "node" ]
}

@test "--project-root=PATH form (equals syntax)" {
    touch "$TMP/package.json"
    run bash "$SCRIPT" "--project-root=$TMP"
    [ "$status" -eq 0 ]
    [ "$output" = "node" ]
}

@test "--help prints usage and exits 0" {
    run bash "$SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"detect-project-type.sh"* ]]
    [[ "$output" == *"Detection rules"* ]]
}

@test "unknown option exits 2" {
    run bash "$SCRIPT" --frobnicate
    [ "$status" -eq 2 ]
    [[ "$output" == *"Unknown option"* ]]
}

@test "non-existent root exits 2" {
    run bash "$SCRIPT" --project-root "/this/path/does/not/exist/$$"
    [ "$status" -eq 2 ]
    [[ "$output" == *"not a directory"* ]]
}
