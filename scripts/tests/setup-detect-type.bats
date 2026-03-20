#!/usr/bin/env bats
# Tests for /setup Step 0 — project type detection
#
# Validates that the KMP/Android-only detection patterns work for all
# Gradle plugin declaration syntaxes including version catalog aliases.

setup() {
    WORK_DIR="$(mktemp -d)"
    mkdir -p "$WORK_DIR/gradle"
    echo 'rootProject.name = "test"' > "$WORK_DIR/settings.gradle.kts"
}

teardown() {
    rm -rf "$WORK_DIR"
}

# Helper: detect project type using the same logic as the setup wizard
detect_type() {
    local PROJECT_ROOT="$1"
    local PROJECT_TYPE="unknown"

    grep -rqE 'kotlin\("multiplatform"\)|org\.jetbrains\.kotlin\.multiplatform|libs\.plugins\.kotlin[Mm]ultiplatform|libs\.plugins\.kotlin\.multiplatform' \
        "$PROJECT_ROOT" --include="*.gradle.kts" --include="*.gradle" 2>/dev/null \
      && PROJECT_TYPE="kmp"
    grep -rqE 'com\.android\.library|com\.android\.application' \
        "$PROJECT_ROOT" --include="*.gradle.kts" --include="*.gradle" 2>/dev/null \
      && [ "$PROJECT_TYPE" = "unknown" ] && PROJECT_TYPE="android-only"

    echo "$PROJECT_TYPE"
}

# ── KMP detection ─────────────────────────────────────────────────────────

@test "detects KMP with kotlin(\"multiplatform\") DSL syntax" {
    cat > "$WORK_DIR/build.gradle.kts" << 'EOF'
plugins {
    kotlin("multiplatform") version "2.3.10"
}
EOF
    result=$(detect_type "$WORK_DIR")
    [ "$result" = "kmp" ]
}

@test "detects KMP with id(\"org.jetbrains.kotlin.multiplatform\")" {
    cat > "$WORK_DIR/build.gradle.kts" << 'EOF'
plugins {
    id("org.jetbrains.kotlin.multiplatform") version "2.3.10"
}
EOF
    result=$(detect_type "$WORK_DIR")
    [ "$result" = "kmp" ]
}

@test "detects KMP with alias(libs.plugins.kotlin.multiplatform)" {
    cat > "$WORK_DIR/build.gradle.kts" << 'EOF'
plugins {
    alias(libs.plugins.kotlin.multiplatform)
}
EOF
    result=$(detect_type "$WORK_DIR")
    [ "$result" = "kmp" ]
}

@test "detects KMP with alias(libs.plugins.kotlinMultiplatform)" {
    cat > "$WORK_DIR/build.gradle.kts" << 'EOF'
plugins {
    alias(libs.plugins.kotlinMultiplatform)
}
EOF
    result=$(detect_type "$WORK_DIR")
    [ "$result" = "kmp" ]
}

@test "detects KMP in submodule build.gradle.kts" {
    mkdir -p "$WORK_DIR/core/domain"
    cat > "$WORK_DIR/core/domain/build.gradle.kts" << 'EOF'
plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.library)
}
EOF
    result=$(detect_type "$WORK_DIR")
    [ "$result" = "kmp" ]
}

@test "detects KMP in .gradle (Groovy) file" {
    cat > "$WORK_DIR/build.gradle" << 'EOF'
plugins {
    id 'org.jetbrains.kotlin.multiplatform' version '2.3.10'
}
EOF
    result=$(detect_type "$WORK_DIR")
    [ "$result" = "kmp" ]
}

# ── Android-only detection ────────────────────────────────────────────────

@test "detects android-only with com.android.application" {
    cat > "$WORK_DIR/build.gradle.kts" << 'EOF'
plugins {
    id("com.android.application")
    kotlin("android")
}
EOF
    result=$(detect_type "$WORK_DIR")
    [ "$result" = "android-only" ]
}

@test "detects android-only with com.android.library" {
    cat > "$WORK_DIR/build.gradle.kts" << 'EOF'
plugins {
    id("com.android.library")
}
EOF
    result=$(detect_type "$WORK_DIR")
    [ "$result" = "android-only" ]
}

@test "android-only does not override KMP when both present" {
    cat > "$WORK_DIR/build.gradle.kts" << 'EOF'
plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.library)
}
EOF
    # KMP takes priority (detected first)
    result=$(detect_type "$WORK_DIR")
    [ "$result" = "kmp" ]
}

# ── Unknown detection ─────────────────────────────────────────────────────

@test "returns unknown for empty project" {
    result=$(detect_type "$WORK_DIR")
    [ "$result" = "unknown" ]
}

@test "returns unknown for non-Android Kotlin project" {
    cat > "$WORK_DIR/build.gradle.kts" << 'EOF'
plugins {
    kotlin("jvm") version "2.3.10"
}
EOF
    result=$(detect_type "$WORK_DIR")
    [ "$result" = "unknown" ]
}

@test "returns unknown for Java-only project" {
    cat > "$WORK_DIR/build.gradle.kts" << 'EOF'
plugins {
    java
}
EOF
    result=$(detect_type "$WORK_DIR")
    [ "$result" = "unknown" ]
}
