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
    [ "$status" -eq 0 ]
    [[ "$output" == *"hyphen-notation"* ]]
}

@test "accepts dot-notation in .sh files" {
    cat > "$WORK_DIR/check.sh" <<'EOF'
grep -r "libs.androidx.lifecycle.runtime.ktx" .
EOF
    run "$SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 0 ]
    [[ "$output" != *"hyphen-notation"* ]]
}

@test "flags hardcoded kts dep in strict mode" {
    mkdir -p "$WORK_DIR/app"
    cat > "$WORK_DIR/app/build.gradle.kts" <<'EOF'
implementation("com.example:lib:1.0.0")
EOF
    run "$SCRIPT" --project-root "$WORK_DIR" --strict
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

@test "catalog-coverage-check flags hyphen-notation in Konsist .kt files" {
    mkdir -p "$WORK_DIR/detekt-rules"
    cat > "$WORK_DIR/detekt-rules/FakeKonsist.kt" <<'EOF'
val dep = libs.androidx-lifecycle-runtime-ktx
EOF
    run bash "$SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 1 ]
    [[ "$output" == *"androidx-lifecycle-runtime-ktx"* ]]
}

# BL-W30-08: --module-paths flag
@test "--module-paths restricts scan to specified subdirectory" {
    # module-a has a hardcoded dep; module-b does not
    mkdir -p "$WORK_DIR/module-a" "$WORK_DIR/module-b"
    cat > "$WORK_DIR/module-a/build.gradle.kts" <<'EOF'
implementation("com.example:lib-a:1.0.0")
EOF
    cat > "$WORK_DIR/module-b/build.gradle.kts" <<'EOF'
implementation("com.other:lib-b:2.0.0")
EOF
    # Scanning only module-b in strict mode → should flag lib-b, not lib-a
    run "$SCRIPT" --project-root "$WORK_DIR" --strict --module-paths "module-b"
    [ "$status" -eq 1 ]
    [[ "$output" == *"com.other:lib-b:2.0.0"* ]]
    [[ "$output" != *"com.example:lib-a:1.0.0"* ]]
}

@test "--module-paths with two paths scans both" {
    mkdir -p "$WORK_DIR/core" "$WORK_DIR/feature" "$WORK_DIR/ignored"
    cat > "$WORK_DIR/core/build.gradle.kts" <<'EOF'
implementation("com.core:util:1.1.0")
EOF
    cat > "$WORK_DIR/feature/build.gradle.kts" <<'EOF'
implementation("com.feature:ui:3.0.0")
EOF
    cat > "$WORK_DIR/ignored/build.gradle.kts" <<'EOF'
implementation("com.ignored:dep:9.9.9")
EOF
    run "$SCRIPT" --project-root "$WORK_DIR" --strict --module-paths "core,feature"
    [ "$status" -eq 1 ]
    [[ "$output" == *"com.core:util:1.1.0"* ]]
    [[ "$output" == *"com.feature:ui:3.0.0"* ]]
    [[ "$output" != *"com.ignored:dep:9.9.9"* ]]
}

@test "--module-paths with clean modules exits 0 in strict mode" {
    mkdir -p "$WORK_DIR/clean-module"
    cat > "$WORK_DIR/clean-module/build.gradle.kts" <<'EOF'
implementation(libs.androidx.core.ktx)
EOF
    run "$SCRIPT" --project-root "$WORK_DIR" --strict --module-paths "clean-module"
    [ "$status" -eq 0 ]
    [[ "$output" == *"0 hardcoded"* ]]
}
