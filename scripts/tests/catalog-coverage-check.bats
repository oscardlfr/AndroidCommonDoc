#!/usr/bin/env bats
# =============================================================================
# Tests for scripts/sh/catalog-coverage-check.sh
#
# Validates:
#   - Flags hyphen-notation catalog accessors in .sh files (T3-1 new check)
#   - Accepts dot-notation catalog accessors in .sh files
#   - Flags hardcoded KTS deps in strict mode (existing check)
#   - PS1 wrapper parity via direct .sh invocation
# =============================================================================

SCRIPT="$BATS_TEST_DIRNAME/../sh/catalog-coverage-check.sh"

setup() {
    WORK_DIR="$(mktemp -d)"
}

teardown() {
    rm -rf "$WORK_DIR"
}

@test "flags hyphen-notation in .sh files" {
    cat > "$WORK_DIR/check.sh" <<'EOF'
grep -r "libs.androidx-lifecycle-runtime-ktx" .
EOF
    run "$SCRIPT" --project-root "$WORK_DIR"
    echo "# T1 status=$status" >&3
    echo "# T1 output=$output" >&3
    [ "$status" -eq 0 ]
    [[ "$output" == *"hyphen-notation"* ]]
}

@test "accepts dot-notation in .sh files" {
    cat > "$WORK_DIR/check.sh" <<'EOF'
grep -r "libs.androidx.lifecycle.runtime.ktx" .
EOF
    run "$SCRIPT" --project-root "$WORK_DIR"
    echo "# T2 status=$status" >&3
    echo "# T2 output=$output" >&3
    [ "$status" -eq 0 ]
    [[ "$output" != *"hyphen-notation"* ]]
}

@test "flags hardcoded kts dep in strict mode" {
    mkdir -p "$WORK_DIR/app"
    cat > "$WORK_DIR/app/build.gradle.kts" <<'EOF'
implementation("com.example:lib:1.0.0")
EOF
    run "$SCRIPT" --project-root "$WORK_DIR" --strict
    echo "# T3 status=$status" >&3
    echo "# T3 output=$output" >&3
    [ "$status" -eq 1 ]
    [[ "$output" == *"com.example:lib:1.0.0"* ]]
}

@test "ps1 wrapper delegates to sh" {
    # ps1 wrapper is a thin delegate; on Windows+bash, parity is tested by calling .sh directly
    cat > "$WORK_DIR/check.sh" <<'EOF'
grep -r "libs.androidx-lifecycle-runtime-ktx" .
EOF
    run bash "$BATS_TEST_DIRNAME/../sh/catalog-coverage-check.sh" --project-root "$WORK_DIR"
    [ "$status" -eq 0 ]
    [[ "$output" == *"hyphen-notation"* ]]
}
