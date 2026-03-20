#!/usr/bin/env bats
# Tests for check-detekt-coverage.sh — diagnoses which modules have Detekt tasks

SCRIPT="$BATS_TEST_DIRNAME/../sh/check-detekt-coverage.sh"

setup() {
    WORK_DIR="$(mktemp -d)"
    echo 'rootProject.name = "test"' > "$WORK_DIR/settings.gradle.kts"
}

teardown() {
    rm -rf "$WORK_DIR"
}

@test "detects KMP module with toolkit plugin" {
    mkdir -p "$WORK_DIR/core/domain"
    cat > "$WORK_DIR/core/domain/build.gradle.kts" << 'EOF'
plugins {
    alias(libs.plugins.kotlin.multiplatform)
    id("androidcommondoc.toolkit")
}
EOF
    run bash "$SCRIPT" --project-root "$WORK_DIR"
    echo "$output" | grep -q "detekt.*core:domain.*KMP"
}

@test "detects KMP module WITHOUT toolkit plugin" {
    mkdir -p "$WORK_DIR/core/data"
    cat > "$WORK_DIR/core/data/build.gradle.kts" << 'EOF'
plugins {
    alias(libs.plugins.kotlin.multiplatform)
}
EOF
    run bash "$SCRIPT" --project-root "$WORK_DIR"
    echo "$output" | grep -q "NO detekt.*core:data.*KMP"
}

@test "detects Android module without plugin" {
    mkdir -p "$WORK_DIR/app"
    cat > "$WORK_DIR/app/build.gradle.kts" << 'EOF'
plugins {
    id("com.android.application")
}
EOF
    run bash "$SCRIPT" --project-root "$WORK_DIR"
    echo "$output" | grep -q "NO detekt.*app.*Android"
}

@test "detects module with dev.detekt directly" {
    mkdir -p "$WORK_DIR/core/result"
    cat > "$WORK_DIR/core/result/build.gradle.kts" << 'EOF'
plugins {
    kotlin("jvm")
    id("dev.detekt")
}
EOF
    run bash "$SCRIPT" --project-root "$WORK_DIR"
    echo "$output" | grep -q "detekt.*core:result"
}

@test "counts summary correctly" {
    mkdir -p "$WORK_DIR/mod-a" "$WORK_DIR/mod-b" "$WORK_DIR/mod-c"
    cat > "$WORK_DIR/mod-a/build.gradle.kts" << 'EOF'
plugins { alias(libs.plugins.kotlin.multiplatform); id("androidcommondoc.toolkit") }
EOF
    cat > "$WORK_DIR/mod-b/build.gradle.kts" << 'EOF'
plugins { alias(libs.plugins.kotlin.multiplatform) }
EOF
    cat > "$WORK_DIR/mod-c/build.gradle.kts" << 'EOF'
plugins { alias(libs.plugins.kotlin.multiplatform) }
EOF
    run bash "$SCRIPT" --project-root "$WORK_DIR"
    # Should show 1 with detekt, 2 KMP without
    echo "$output" | grep -q "With Detekt:.*1"
    echo "$output" | grep -q "KMP without:.*2"
}

@test "JSON output is valid" {
    mkdir -p "$WORK_DIR/mod-a"
    cat > "$WORK_DIR/mod-a/build.gradle.kts" << 'EOF'
plugins { alias(libs.plugins.kotlin.multiplatform) }
EOF
    run bash "$SCRIPT" --project-root "$WORK_DIR"
    # Last line should be JSON
    last_line=$(echo "$output" | tail -1)
    echo "$last_line" | python3 -c "import json,sys; json.load(sys.stdin)"
}

@test "shows fix instructions when KMP modules missing detekt" {
    mkdir -p "$WORK_DIR/mod-a"
    cat > "$WORK_DIR/mod-a/build.gradle.kts" << 'EOF'
plugins { alias(libs.plugins.kotlin.multiplatform) }
EOF
    run bash "$SCRIPT" --project-root "$WORK_DIR"
    echo "$output" | grep -q "androidcommondoc.toolkit"
    echo "$output" | grep -q "subprojects"
}

@test "handles empty project gracefully" {
    run bash "$SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 0 ]
}
